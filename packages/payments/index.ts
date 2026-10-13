// ============================================================================
// Payments System — MTN MoMo, Bank Transfer, Cash
// Plugin-ready architecture
// ============================================================================

import QRCode from 'qrcode'
import { prisma } from '@novastar/database'
import { sendEmail } from '@novastar/notifications'

// --- Payment Provider Interface ---

export interface PaymentProvider {
  id: PaymentProviderType
  name: string
  processPayment(input: PaymentInput): Promise<PaymentResult>
  /**
   * Ask the provider whether the money arrived. The scope narrows the local row
   * lookups to the caller's tenant and school: `Payment.reference` is
   * caller-supplied and not unique, so an unscoped lookup can read — and settle
   * — another school's row. Required, not optional: a caller that forgot it
   * would be a silent cross-tenant read.
   */
  verifyPayment(reference: string, scope: PaymentScope): Promise<VerificationResult>
  generateQR? (input: QRInput): Promise<string>
  getFees(amount: number): FeeBreakdown
}

export type PaymentProviderType = 'mtn-momo' | 'bank-transfer' | 'cash' | 'mtn-bulk'

/** The caller's tenant and school, used to scope every row a provider touches. */
export interface PaymentScope {
  tenantId: string
  schoolId: string
}

export interface PaymentInput {
  amount: number
  currency: 'GHS'
  payer: {
    phone?: string
    name?: string
    email?: string
  }
  /**
   * The provider reference a collection call was issued under. Without it the
   * status API has nothing to query, so the payment can never be verified
   * COMPLETED — which is the correct failure direction, but recording a mobile
   * money payment without one makes the payment permanently unsettleable.
   */
  providerReference?: string
  metadata: {
    invoiceId: string
    studentId: string
    termId: string
    [key: string]: string | undefined
  }
  callbackUrl: string
}

export interface PaymentResult {
  success: boolean
  reference: string
  providerReference?: string
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  redirectUrl?: string
  qrCode?: string
  instructions?: string
  error?: string
}

export interface VerificationResult {
  success: boolean
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  amount: number
  transactionId?: string
  paidAt?: Date
  error?: string
}

export interface FeeBreakdown {
  providerFee: number
  processingFee: number
  totalFees: number
  netAmount: number
}

export interface QRInput {
  amount: number
  reference: string
  payerName: string
  callbackUrl: string
}

// --- MTN MoMo Provider ---

/**
 * MTN MoMo Collection API.
 *
 * Environment (all opt-in — when absent, verification FAILS CLOSED to PENDING;
 * a missing configuration must never read as a settled payment):
 *   MTN_API_BASE_URL          sandbox default; production base differs
 *   MTN_API_USER              collection API user (UUID)
 *   MTN_API_KEY               collection API key
 *   MTN_SUBSCRIPTION_KEY      Ocp-Apim-Subscription-Key
 *   MTN_TARGET_ENVIRONMENT    'sandbox' (default) or the live environment name
 */
const MTN_BASE_URL = () => process.env.MTN_API_BASE_URL ?? 'https://sandbox.momodeveloper.mtn.com'
const MTN_TARGET_ENVIRONMENT = () => process.env.MTN_TARGET_ENVIRONMENT ?? 'sandbox'

function mtnConfigured(): boolean {
  return Boolean(
    process.env.MTN_API_USER &&
      process.env.MTN_API_KEY &&
      process.env.MTN_SUBSCRIPTION_KEY
  )
}

async function mtnAccessToken(): Promise<string> {
  const basic = Buffer.from(
    `${process.env.MTN_API_USER}:${process.env.MTN_API_KEY}`
  ).toString('base64')
  const response = await fetch(`${MTN_BASE_URL()}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': process.env.MTN_SUBSCRIPTION_KEY ?? '',
    },
  })
  if (!response.ok) {
    throw new Error(`MTN token request failed with HTTP ${response.status}`)
  }
  const body = (await response.json()) as { access_token?: string }
  if (!body.access_token) throw new Error('MTN token response carried no access token')
  return body.access_token
}

class MTNMoMoProvider implements PaymentProvider {
  id = 'mtn-momo' as const
  name = 'MTN Mobile Money'

  getFees(amount: number): FeeBreakdown {
    // MTN MoMo fees: ~1.5% + flat ₵0.50
    const processingFee = Math.max(0.5, amount * 0.015)
    return {
      providerFee: 0,
      processingFee,
      totalFees: processingFee,
      netAmount: amount - processingFee,
    }
  }

  async processPayment(input: PaymentInput): Promise<PaymentResult> {
    // MTN MoMo Collection API (Request to Pay)
    const reference = `MM-${Date.now()}-${input.metadata.studentId}`
    
    try {
      // In production: call MTN MoMo API
      // For now: return payment instructions
      const _callbackUrl = `${input.callbackUrl}/webhook/mtn-momo`
      
      return {
        success: true,
        reference,
        status: 'PENDING',
        instructions: `Dial *170#, select "Pay Bill", enter merchant code "${process.env.MTN_MERCHANT_ID}", enter amount ₵${input.amount}, reference ${reference}`,
        providerReference: reference,
      }
    } catch (error) {
      return {
        success: false,
        reference,
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Payment processing failed',
      }
    }
  }

  /**
   * Verify a mobile money payment with the MTN Collection status API.
   *
   * The provider — never the local row — decides COMPLETED. Verification:
   *   1. resolves the provider reference the collection call was issued under;
   *   2. fetches the transaction status from MTN with API-user auth;
   *   3. reports COMPLETED only when MTN says SUCCESSFUL **and** the amount
   *      matches the recorded amount to the pesewa.
   * Every other path — no provider reference, no configuration, an auth or
   * network failure, an unknown status — is PENDING or FAILED, never COMPLETED.
   */
  async verifyPayment(reference: string, scope: PaymentScope): Promise<VerificationResult> {
    try {
      const payment = await prisma.payment.findFirst({
        where: scope ? { reference, ...scope } : { reference },
      })

      if (!payment) {
        return { success: false, status: 'PENDING', amount: 0, error: 'No payment recorded under this reference' }
      }
      const recordedAmount = Number(payment.amount)
      const providerReference = payment.transactionId ?? undefined

      if (!providerReference) {
        return {
          success: true,
          status: 'PENDING',
          amount: recordedAmount,
          error: 'No provider reference recorded for this payment',
        }
      }
      if (!mtnConfigured()) {
        return {
          success: true,
          status: 'PENDING',
          amount: recordedAmount,
          error: 'MTN provider is not configured; verification is not possible',
        }
      }

      const token = await mtnAccessToken()
      const response = await fetch(
        `${MTN_BASE_URL()}/collection/v1_0/requesttopay/${encodeURIComponent(providerReference)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Target-Environment': MTN_TARGET_ENVIRONMENT(),
            'Ocp-Apim-Subscription-Key': process.env.MTN_SUBSCRIPTION_KEY ?? '',
          },
        }
      )

      if (response.status === 404) {
        return { success: true, status: 'PENDING', amount: recordedAmount, error: 'MTN holds no such transaction' }
      }
      if (!response.ok) {
        return { success: true, status: 'PENDING', amount: recordedAmount, error: `MTN status request failed with HTTP ${response.status}` }
      }

      const body = (await response.json()) as {
        amount?: string
        status?: string
        financialTransactionId?: string
        reason?: { message?: string }
      }

      if (body.status === 'FAILED') {
        return {
          success: true,
          status: 'FAILED',
          amount: recordedAmount,
          transactionId: body.financialTransactionId,
          error: body.reason?.message ?? 'Provider reported the transaction as failed',
        }
      }
      if (body.status !== 'SUCCESSFUL') {
        return { success: true, status: 'PENDING', amount: recordedAmount, transactionId: body.financialTransactionId }
      }

      const providerAmount = Number(body.amount ?? Number.NaN)
      if (!Number.isFinite(providerAmount) || Math.abs(providerAmount - recordedAmount) > 0.01) {
        return {
          success: true,
          status: 'FAILED',
          amount: recordedAmount,
          transactionId: body.financialTransactionId,
          error: `Provider settled ₵${body.amount ?? 'unknown'} against a recorded ₵${recordedAmount}`,
        }
      }

      return {
        success: true,
        status: 'COMPLETED',
        amount: recordedAmount,
        transactionId: body.financialTransactionId ?? providerReference,
        paidAt: new Date(),
      }
    } catch (error) {
      // Only our own provider messages are safe to return; a driver error from
      // Prisma or `pg` quotes the host and the credentials in its message, so
      // anything unexpected is replaced with a generic reason.
      const message = error instanceof Error ? error.message : 'Verification failed'
      return {
        success: false,
        status: 'PENDING',
        amount: 0,
        error: message.startsWith('MTN ') ? message : 'Verification could not be completed',
      }
    }
  }

  async generateQR(input: QRInput): Promise<string> {
    // Generate MTN MoMo QR code
    const qrData = JSON.stringify({
      amount: input.amount,
      reference: input.reference,
      payerName: input.payerName,
      callbackUrl: input.callbackUrl,
      provider: 'mtn-momo',
    })
    return QRCode.toDataURL(qrData)
  }
}

// --- Bank Transfer Provider ---

class BankTransferProvider implements PaymentProvider {
  id = 'bank-transfer' as const
  name = 'Bank Transfer'

  getFees(amount: number): FeeBreakdown {
    // No fees for bank transfers (manual reconciliation)
    return {
      providerFee: 0,
      processingFee: 0,
      totalFees: 0,
      netAmount: amount,
    }
  }

  async processPayment(input: PaymentInput): Promise<PaymentResult> {
    const reference = `BANK-${Date.now()}-${input.metadata.studentId}`
    
    return {
      success: true,
      reference,
      status: 'PENDING',
      instructions: `Transfer ₵${input.amount} to: ${process.env.SCHOOL_BANK_NAME}, Account: ${process.env.SCHOOL_BANK_ACCOUNT}. Use reference: ${reference}`,
    }
  }

  /**
   * Bank transfer has no instant verification channel: settlement happens when
   * an operator reconciles a bank statement line, which lands as a COMPLETED row
   * (see `reconcilePayments`). Until that explicit reconciliation exists, the
   * payment is PENDING — the absence of a reconciliation is never read as
   * settled money.
   */
  async verifyPayment(reference: string, scope: PaymentScope): Promise<VerificationResult> {
    const payment = await prisma.payment.findFirst({
      where: scope ? { reference, ...scope } : { reference },
    })

    if (payment && payment.status === 'COMPLETED') {
      return {
        success: true,
        status: 'COMPLETED',
        amount: Number(payment.amount),
        paidAt: payment.paidAt,
        transactionId: payment.transactionId || undefined,
      }
    }

    return {
      success: true,
      status: 'PENDING',
      amount: payment ? Number(payment.amount) : 0,
      error: payment ? 'Awaiting manual bank reconciliation' : 'No payment recorded under this reference',
    }
  }
}

// --- Cash Provider ---

class CashProvider implements PaymentProvider {
  id = 'cash' as const
  name = 'Cash'

  getFees(amount: number): FeeBreakdown {
    // No fees for cash
    return {
      providerFee: 0,
      processingFee: 0,
      totalFees: 0,
      netAmount: amount,
    }
  }

  async processPayment(input: PaymentInput): Promise<PaymentResult> {
    const reference = `CASH-${Date.now()}-${input.metadata.studentId}`
    
    return {
      success: true,
      reference,
      status: 'COMPLETED', // Cash is immediately "received"
      instructions: `Cash payment of ₵${input.amount}. Collected by: __collector_name__. Receipt #: ${reference}`,
    }
  }

  async verifyPayment(reference: string, scope: PaymentScope): Promise<VerificationResult> {
    // Check if cash payment was recorded. Scoped when the caller names one:
    // `payments.some` matches any row with the reference, and the reference is
    // caller-supplied and not unique.
    const invoice = await prisma.feeInvoice.findFirst({
      where: {
        ...(scope ?? {}),
        payments: { some: { reference } },
      },
      include: { payments: { where: { reference } } },
    })

    if (invoice && invoice.payments[0]?.status === 'COMPLETED') {
      return {
        success: true,
        status: 'COMPLETED',
        amount: Number(invoice.payments[0].amount),
        paidAt: invoice.payments[0].paidAt,
      }
    }

    return { success: false, status: 'FAILED', amount: 0, error: 'Payment not found' }
  }
}

// --- Provider Registry ---

export const PAYMENT_PROVIDERS: Record<PaymentProviderType, PaymentProvider> = {
  'mtn-momo': new MTNMoMoProvider(),
  'bank-transfer': new BankTransferProvider(),
  'cash': new CashProvider(),
  'mtn-bulk': new MTNMoMoProvider(), // alias for bulk MoMo payments
}

export function getProvider(type: PaymentProviderType): PaymentProvider {
  const provider = PAYMENT_PROVIDERS[type]
  if (!provider) {
    throw new Error(`Payment provider "${type}" not found`)
  }
  return provider
}

// --- Payment Service ---

export class PaymentService {
  static async processPayment(
    providerType: PaymentProviderType,
    input: PaymentInput
  ): Promise<PaymentResult> {
    const provider = getProvider(providerType)
    const result = await provider.processPayment(input)
    const fees = provider.getFees(input.amount)

    if (result.success) {
      // The row must name a tenant and a school. The metadata index signature
      // makes both `string | undefined`, and the old `as string` casts wrote
      // `undefined` into non-nullable columns whenever a caller omitted them —
      // which then failed at the database, far from the mistake. Refuse here
      // instead, where the caller can see it.
      const tenantId = input.metadata.tenantId
      const schoolId = input.metadata.schoolId
      const studentId = input.metadata.studentId
      if (!tenantId || !schoolId || !studentId) {
        throw new Error('Payment metadata must carry tenantId, schoolId and studentId')
      }

      // Record payment in database. The row carries the provider's own verdict
      // (cash settles on the spot, everything else starts PENDING) — writing
      // PENDING over an already-settled cash row would leave the ledger
      // disagreeing with the receipt.
      await prisma.payment.create({
        data: {
          tenantId,
          schoolId,
          invoiceId: input.metadata.invoiceId ? (input.metadata.invoiceId as unknown as string) : undefined,
          studentId,
          amount: input.amount,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma relation field
          method: { connect: { code: providerType } } as any,
          reference: result.reference,
          // The reference the collection call was issued under — the only thing
          // the status API can be asked about later.
          transactionId: input.providerReference ?? result.providerReference,
          status: result.status,
          // `paidAt` is the moment the money arrived, not the moment a row was
          // written: stamping it on a PENDING payment makes an uncollected
          // transfer read as paid.
          paidAt: result.status === 'COMPLETED' ? new Date() : null,
          recordedById: input.metadata.recordedById || 'system',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma data object
        } as any,
      })
    }

    return {
      ...result,
      instructions: fees.totalFees > 0 
        ? `${result.instructions || ''} Fees: ₵${fees.totalFees.toFixed(2)}`
        : result.instructions,
    }
  }

  /**
   * Ask the provider what it knows about a reference. This is a pure consult:
   * it changes no ledger row, because the settle transition (and the invoice
   * balance it depends on) must happen once, atomically, in the domain layer —
   * `FinanceService.settlePayment` owns that. The scope narrows the local row
   * lookups to the caller's tenant and school.
   */
  static async verifyPayment(
    providerType: PaymentProviderType,
    reference: string,
    scope: PaymentScope
  ): Promise<VerificationResult> {
    const provider = getProvider(providerType)
    return provider.verifyPayment(reference, scope)
  }

  static async generatePaymentQR(
    providerType: PaymentProviderType,
    input: QRInput
  ): Promise<string | null> {
    const provider = getProvider(providerType)
    if (provider.generateQR) {
      return provider.generateQR(input)
    }
    return null
  }
}

// --- Reconciliation ---

/**
 * Send the parent a receipt for a settled payment.
 *
 * Called by the settle endpoint after the domain layer has moved the payment
 * and the invoice balance. The scope narrows the row lookup: the reference is
 * caller-supplied and not unique, so an unscoped lookup can email the wrong
 * school's parent about a payment that was never theirs.
 *
 * Returns false when there is nothing to send (no such row, no parent email).
 * A delivery failure THROWS: `sendEmail` throws by design — a silent drop
 * strands any credential email — and the caller catches it and logs through the
 * app's structured logger, which is where a mail failure belongs. A best-effort
 * swallow here would hide it from exactly the surface that can act on it.
 */
export async function sendPaymentReceipt(
  reference: string,
  providerName: string,
  scope: PaymentScope
): Promise<boolean> {
  const payment = await prisma.payment.findFirst({ where: { reference, ...scope } })
  if (!payment) return false

  const student = await prisma.student.findUnique({
    where: { id: payment.studentId },
    include: { parent: true, class: true },
  })
  if (!student?.parent?.email) return false

  await sendEmail({
    to: student.parent.email,
    subject: 'Payment Confirmation',
    html: `<p>Dear Parent,</p><p>We confirm receipt of your payment of ₵${Number(payment.amount).toFixed(2)} via ${providerName}.</p><p>Thank you.</p>`,
  })
  return true
}

export interface ReconciliationInput {
  providerType: PaymentProviderType
  transactions: Array<{
    reference: string
    amount: number
    transactionId: string
    paidAt: Date
    status: 'COMPLETED' | 'FAILED' | 'PENDING'
  }>
}

export async function reconcilePayments(input: ReconciliationInput): Promise<{
  matched: number
  unmatched: number
  discrepancies: Array<{ reference: string; expected: number; actual?: number }>
}> {
  let matched = 0
  let unmatched = 0
  const discrepancies: { reference: string; expected: number; actual?: number }[] = []

  for (const txn of input.transactions) {
    const payment = await prisma.payment.findFirst({
      where: { reference: txn.reference },
    })

    if (!payment) {
      unmatched++
      discrepancies.push({ reference: txn.reference, expected: txn.amount })
    } else if (Number(payment.amount) !== txn.amount) {
      unmatched++
      discrepancies.push({
        reference: txn.reference,
        expected: txn.amount,
        actual: Number(payment.amount),
      })
    } else {
      matched++
      // Update if status differs
      if (payment.status !== txn.status) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: txn.status as 'PENDING' | 'COMPLETED' | 'FAILED' },
        })
      }
    }
  }

  return { matched, unmatched, discrepancies }
}

// --- Re-export ---
export { MTNMoMoProvider, BankTransferProvider, CashProvider }