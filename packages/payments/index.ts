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
  verifyPayment(reference: string): Promise<VerificationResult>
  generateQR? (input: QRInput): Promise<string>
  getFees(amount: number): FeeBreakdown
}

export type PaymentProviderType = 'mtn-momo' | 'bank-transfer' | 'cash' | 'mtn-bulk'

export interface PaymentInput {
  amount: number
  currency: 'GHS'
  payer: {
    phone?: string
    name?: string
    email?: string
  }
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

  async verifyPayment(reference: string): Promise<VerificationResult> {
    // Verify with MTN MoMo API
    // In production: call MTN MoMo transaction status API
    // This is a stub - replace with actual MTN API call
    try {
      // Check if payment exists in database
      const payment = await prisma.payment.findFirst({ where: { reference } })
      
      if (payment && payment.status === 'COMPLETED') {
        return {
          success: true,
          status: 'COMPLETED',
          amount: Number(payment.amount),
          paidAt: payment.paidAt,
          transactionId: payment.transactionId || undefined,
        }
      }

      // If not in DB, return PENDING (would call MTN API in production)
      return {
        success: true,
        status: 'PENDING',
        amount: 0,
      }
    } catch (error) {
      return {
        success: false,
        status: 'FAILED',
        amount: 0,
        error: error instanceof Error ? error.message : 'Verification failed',
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

  async verifyPayment(reference: string): Promise<VerificationResult> {
    // Bank reconciliation handled manually
    // Check if payment exists in database
    const payment = await prisma.payment.findFirst({ where: { reference } })
    
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
      amount: 0,
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

  async verifyPayment(reference: string): Promise<VerificationResult> {
    // Check if cash payment was recorded
    const invoice = await prisma.feeInvoice.findFirst({
      where: { payments: { some: { reference } } },
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
      // Record payment in database
      await prisma.payment.create({
        data: {
          tenantId: input.metadata.tenantId as string,
          schoolId: input.metadata.schoolId as string,
          invoiceId: input.metadata.invoiceId ? (input.metadata.invoiceId as unknown as string) : undefined,
          studentId: input.metadata.studentId as unknown as string,
          amount: input.amount,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma relation field
          method: { connect: { code: providerType } } as any,
          reference: result.reference,
          transactionId: result.providerReference,
          status: 'PENDING',
          paidAt: new Date(),
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

  static async verifyPayment(
    providerType: PaymentProviderType,
    reference: string
  ): Promise<VerificationResult> {
    const provider = getProvider(providerType)
    const result = await provider.verifyPayment(reference)

    if (result.success && result.status === 'COMPLETED') {
      // Update payment status
      await prisma.payment.updateMany({
        where: { reference },
        data: { 
          status: 'COMPLETED',
          transactionId: result.transactionId,
        },
      })

      // Send confirmation email
      const payment = await prisma.payment.findFirst({ where: { reference } })
      if (payment) {
        const student = await prisma.student.findUnique({
          where: { id: payment.studentId },
          include: { parent: true, class: true },
        })
        if (student?.parent?.email) {
          // Best-effort: the payment is already recorded above, so a failed
          // receipt email must not turn a settled payment into a thrown error at
          // the caller. `sendEmail` throws by design (a silent drop strands any
          // credential email), so this path opts out explicitly instead of
          // relying on a swallow.
          await sendEmail({
            to: student.parent.email,
            subject: 'Payment Confirmation',
            html: `<p>Dear Parent,</p><p>We confirm receipt of your payment of ₵${result.amount} via ${provider.name}.</p><p>Thank you.</p>`,
          }).catch((error) => {
            console.error('[payments] payment receipt email was not delivered:', error)
          })
        }
      }
    }

    return result
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