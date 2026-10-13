import { InvoiceStatus, toInvoiceStatus, PENDING, PARTIAL, PAID, OVERDUE, COMPLETED } from './enums';
import { PaymentStatus } from './enums';
/**
 * Finance domain service.
 *
 * Replaces the two divergent payment-record endpoints with a single
 * authoritative `recordPayment()` method that handles:
 *
 * - Idempotency (via the `reference` field)
 * - Atomic invoice-balance updates (no lost updates)
 * - Audit trail on every mutation
 *
 * Also provides `generateInvoicesForClass()` (fee-structure → invoices),
 * `calculateOutstandingBalance()` (computed view), and
 * `getInvoiceById()` (detailed invoice view).
 *
 * Payment status rules:
 * - CASH and other instant/irreversible methods → COMPLETED immediately
 * - MTN MoMo, bank transfer, and other async/transfer methods → PENDING until provider verification
 */

import {
  type Prisma,
} from '@novastar/database'
import { BaseService, type ServiceContext } from './base'

const INSTANT_SETTLEMENT_METHODS = new Set(['cash', 'CASH']);

export interface PaymentInput {
  invoiceId: string
  amount: number
  methodCode: string
  reference: string
  /**
   * The provider reference the collection call was issued under. Persisted on
   * the row so `settlePayment` has something to ask the provider about; a
   * mobile money payment recorded without one can never verify.
   */
  transactionId?: string
  momoPhone?: string
  notes?: string
}

export interface InvoiceLineItemInput {
  categoryId: string
  amount: number
  isMandatory?: boolean
  description?: string
}

export interface InvoiceInput {
  studentId: string
  termId: string
  totalAmount: number
  dueDate: Date
  lineItems?: InvoiceLineItemInput[]
}

export interface PaymentResult {
  payment: {
    id: string
    amount: number
    reference: string
    status: string
    /** Null until the money actually arrived — see `settlePayment`'s snapshot. */
    paidAt: Date | null
  }
  invoice: {
    id: string
    invoiceNumber: string
    totalAmount: number
    paidAmount: number
    balance: number
    status: string
  }
  idempotencySkipped: boolean
}

/** What the provider said when it was asked whether the money arrived. */
export type SettlementOutcome =
  | { status: 'COMPLETED'; transactionId?: string; note?: string }
  | { status: 'FAILED'; reason?: string }
  | { status: 'PENDING' }

/** The payment facts a verifier is allowed to see before it answers. */
export interface SettlementQuery {
  paymentId: string
  amount: number
  methodCode: string
  currentStatus: string
}

export class FinanceService extends BaseService {
  constructor(ctx: ServiceContext) {
    super(ctx)
  }

  /**
   * Record a payment against an invoice.
   *
   * Atomicity: creates the Payment and decrements the invoice balance
   * in a single Prisma transaction ”— prevents lost updates and the
   * "balance never updated" bug from the legacy endpoints.
   *
   * Idempotency: if a payment with the same `reference` already exists
   * for the same invoice, returns the existing payment instead of
   * creating a duplicate.
   */
  async recordPayment(input: PaymentInput): Promise<PaymentResult> {
    const { tenantId, schoolId } = this.schoolScope()

    return this.withTransaction(async (tx: Prisma.TransactionClient) => {
      // --- Idempotency: prevent duplicate payments ---
      const existingPayment = await tx.payment.findFirst({
        where: {
          tenantId,
          schoolId,
          invoiceId: input.invoiceId,
          reference: input.reference,
        },
      })
      if (existingPayment) {
        return {
          payment: {
            id: existingPayment.id,
            amount: Number(existingPayment.amount),
            reference: existingPayment.reference,
            status: existingPayment.status,
            paidAt: existingPayment.paidAt,
          },
          invoice: null as unknown as PaymentResult['invoice'],
          idempotencySkipped: true,
        } as PaymentResult
      }

      // --- Fetch invoice (visible within the transaction context) ---
      const invoice = await tx.feeInvoice.findFirst({
        where: {
          id: input.invoiceId,
          tenantId,
          schoolId,
        },
        select: {
          id: true,
          studentId: true,
          invoiceNumber: true,
          totalAmount: true,
          paidAmount: true,
          balance: true,
          status: true,
        },
      })
      if (!invoice) {
        throw new Error('Invoice not found')
      }

      // --- Resolve or provision payment method ---
      const paymentMethod = await this.resolvePaymentMethod(
        tx,
        tenantId,
        schoolId,
        input.methodCode
      )

      // --- Validate amount does not exceed balance ---
      const currentBalance = Number(invoice.balance)
      if (input.amount > currentBalance) {
        throw new Error(
          `Payment amount (${input.amount}) exceeds remaining balance (${currentBalance})`
        )
      }

      // --- Create the payment ---
      // Only methods that settle instantly and irreversibly may land COMPLETED.
      // Everything else ”— mobile money, bank transfer ”— starts PENDING and is
      // settled by `settlePayment` once the provider confirms.
      const initialPaymentStatus = INSTANT_SETTLEMENT_METHODS.has(input.methodCode)
        ? PaymentStatus.COMPLETED
        : PaymentStatus.PENDING

      // --- Compute new values ---
      // The invoice balance only ever counts SETTLED money. A PENDING payment
      // (mobile money awaiting provider verification, bank transfer awaiting
      // reconciliation) is recorded for audit and receipt purposes but must not
      // reduce what the student owes until the money is confirmed ”— otherwise a
      // staff member with `finance:payment:record` could mark any invoice paid by
      // recording an unsettled transfer. `settlePayment` applies the balance
      // change at the moment verification succeeds.
      const settlesImmediately = initialPaymentStatus === PaymentStatus.COMPLETED

      const payment = await tx.payment.create({
        data: {
          tenantId,
          schoolId,
          invoiceId: invoice.id,
          studentId: invoice.studentId,
          amount: input.amount,
          methodId: paymentMethod.id,
          reference: input.reference,
          status: initialPaymentStatus,
          transactionId: input.transactionId,
          momoPhone: input.momoPhone ?? undefined,
          recordedById: this.ctx.userId,
          notes: input.notes ?? undefined,
        },
      })

      // --- Apply the balance movement in the same transaction, settlement only.
      //
      // The money columns move with `increment`/`decrement` rather than with
      // absolute values computed from the snapshot above: under the default
      // isolation level two concurrent recordings on one invoice both read the
      // same base and the later absolute write erases the earlier amount. The
      // atomic form cannot lose a movement, and the returned row is the state
      // the status is derived from — not a guess made before the write.
      let paidAmount = Number(invoice.paidAmount)
      let balance = Number(invoice.balance)
      let newStatus: InvoiceStatus = toInvoiceStatus(invoice.status)

      if (settlesImmediately) {
        const updated = await tx.feeInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: { increment: input.amount },
            balance: { decrement: input.amount },
          },
        })
        paidAmount = Number(updated.paidAmount)
        balance = Number(updated.balance)
        newStatus =
          balance <= 0 ? PAID : balance < Number(updated.totalAmount) ? PARTIAL : toInvoiceStatus(updated.status)
        await tx.feeInvoice.update({
          where: { id: invoice.id },
          data: { status: newStatus, paidAt: balance <= 0 ? new Date() : undefined },
        })
      }

      // --- Audit trail ---
      await tx.auditLog.create({
        data: {
          tenantId,
          schoolId,
          userId: this.ctx.userId,
          action: 'payment.record',
          entity: 'Payment',
          entityId: payment.id,
          oldData: { balance: invoice.balance, status: invoice.status },
          newData: {
            balance,
            paidAmount,
            status: newStatus,
          },
        },
      })

      return {
        payment: {
          id: payment.id,
          amount: Number(payment.amount),
          reference: payment.reference,
          status: payment.status,
          paidAt: payment.paidAt,
        },
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          totalAmount: Number(invoice.totalAmount),
          paidAmount,
          balance,
          status: newStatus,
        },
        idempotencySkipped: false,
      }
    })
  }

  /**
   * Settle a payment that was recorded PENDING: ask the provider whether the
   * money arrived, and only if it says COMPLETED move the invoice balance.
   *
   * This is the only path by which an async payment (mobile money, bank
   * transfer) becomes settled. The provider consult is injected so the domain
   * layer owns the transition invariants ”— tenant-scoped lookup, single-writer
   * update, re-read inside the transaction against a concurrent settle ”— while
   * the provider HTTP details stay in `@novastar/payments`.
   *
   * Idempotent: an already-settled payment is reported as-is without
   * consulting the provider again, and the invoice balance moves exactly once.
   */
  async settlePayment(
    reference: string,
    verify: (query: SettlementQuery) => Promise<SettlementOutcome>
  ): Promise<PaymentResult | null> {
    const { tenantId, schoolId } = this.schoolScope()

    // --- Phase 1: load the payment and consult the provider outside any
    // transaction, so a slow provider call never holds a row lock open.
    const payment = await this.prisma.payment.findFirst({
      where: { tenantId, schoolId, reference },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            totalAmount: true,
            paidAmount: true,
            balance: true,
            status: true,
          },
        },
        method: { select: { code: true } },
      },
    })
    if (!payment) return null

    const snapshot = (
      row: { id: string; amount: unknown; reference: string; status: string; paidAt: Date | null },
      invoice: PaymentResult['invoice'] | null,
      alreadySettled: boolean
    ): PaymentResult => ({
      payment: {
        id: row.id,
        amount: Number(row.amount),
        reference: row.reference,
        status: row.status,
        // An unsettled payment has no payment date, and reporting "now" makes an
        // uncollected transfer read as paid on whatever screen renders it.
        paidAt: row.paidAt,
      },
      invoice: invoice ?? (null as unknown as PaymentResult['invoice']),
      idempotencySkipped: alreadySettled,
    })

    // Loose on purpose: the snapshot carries the values the post-settlement
    // view computed (numbers), while the phase-1/phase-2 reads carry the
    // Prisma row's own Decimals. Both are coerced by the view below.
    const invoiceView = (
      row: {
        invoice: {
          id: string
          invoiceNumber: string
          totalAmount: unknown
          paidAmount: unknown
          balance: unknown
          status: unknown
        } | null
      }
    ): PaymentResult['invoice'] | null =>
      row.invoice
        ? {
            id: row.invoice.id,
            invoiceNumber: row.invoice.invoiceNumber,
            totalAmount: Number(row.invoice.totalAmount),
            paidAmount: Number(row.invoice.paidAmount),
            balance: Number(row.invoice.balance),
            status: toInvoiceStatus(row.invoice.status as string),
          }
        : null

    if (payment.status === PaymentStatus.COMPLETED) {
      return snapshot(payment, invoiceView(payment), true)
    }

    const outcome = await verify({
      paymentId: payment.id,
      amount: Number(payment.amount),
      methodCode: payment.method?.code ?? '',
      currentStatus: payment.status,
    })
    if (outcome.status === 'PENDING') return snapshot(payment, invoiceView(payment), false)

    // --- Phase 2: apply the transition atomically.
    return this.withTransaction(async (tx: Prisma.TransactionClient) => {
      const fresh = await tx.payment.findFirst({
        where: { id: payment.id },
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              totalAmount: true,
              paidAmount: true,
              balance: true,
              status: true,
            },
          },
          method: { select: { code: true } },
        },
      })
      if (!fresh) return null

      if (outcome.status === 'FAILED') {
        const failed = await tx.payment.update({
          where: { id: fresh.id },
          data: { status: PaymentStatus.FAILED, notes: outcome.reason },
        })
        await tx.auditLog.create({
          data: {
            tenantId,
            schoolId,
            userId: this.ctx.userId,
            action: 'payment.verify.failed',
            entity: 'Payment',
            entityId: fresh.id,
            oldData: { status: fresh.status },
            newData: { status: failed.status, reason: outcome.reason },
          },
        })
        return snapshot(failed, invoiceView(fresh), false)
      }

      // A concurrent settle may have completed this payment between phase 1 and
      // here; settling twice would move the balance twice.
      if (fresh.status === PaymentStatus.COMPLETED) {
        return snapshot(fresh, invoiceView(fresh), true)
      }

      const amount = Number(fresh.amount)
      const settled = await tx.payment.update({
        where: { id: fresh.id },
        data: {
          status: PaymentStatus.COMPLETED,
          paidAt: new Date(),
          // Only a provider's own reference overwrites the column: a
          // reconciliation confirms the row, it does not replace the provider
          // reference a dispute would need. The reconciliation's own reference
          // is recorded in the audit entry below.
          transactionId: outcome.transactionId,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId,
          schoolId,
          userId: this.ctx.userId,
          action: 'payment.verify.completed',
          entity: 'Payment',
          entityId: fresh.id,
          oldData: { status: fresh.status, amount },
          newData: {
            status: settled.status,
            amount,
            transactionId: outcome.transactionId ?? fresh.transactionId,
            note: outcome.note,
          },
        },
      })

      if (fresh.invoice) {
        // Atomic movement, same reasoning as `recordPayment`: absolute values
        // computed from a snapshot lose a concurrent settlement's amount, and
        // the status is derived from the row the database actually landed on.
        const updatedInvoice = await tx.feeInvoice.update({
          where: { id: fresh.invoice.id },
          data: {
            paidAmount: { increment: amount },
            balance: { decrement: amount },
          },
        })
        const paidAmount = Number(updatedInvoice.paidAmount)
        const balance = Number(updatedInvoice.balance)
        const status: InvoiceStatus =
          balance <= 0
            ? PAID
            : balance < Number(updatedInvoice.totalAmount)
              ? PARTIAL
              : toInvoiceStatus(updatedInvoice.status)
        await tx.feeInvoice.update({
          where: { id: fresh.invoice.id },
          data: { status, paidAt: balance <= 0 ? new Date() : undefined },
        })
        return snapshot(
          settled,
          invoiceView({
            ...fresh,
            invoice: { ...updatedInvoice, paidAmount, balance, status },
          }),
          false
        )
      }

      return snapshot(settled, null, false)
    })
  }

  /**
   * Generate fee invoices for all students in a class for a given term.
   * Creates one FeeInvoice per student, derived from the class's FeeStructure.
   */
  async generateInvoicesForClass(
    classId: string,
    termId: string,
    academicYearId: string
  ): Promise<{
    count: number
    invoices: { id: string; studentId: string; invoiceNumber: string }[]
  }> {
    const { tenantId, schoolId } = this.schoolScope()

    const classRec = await this.prisma.class.findFirst({
      where: { id: classId, tenantId, schoolId },
      select: {
        levelId: true,
        students: { select: { id: true } },
      },
    })
    if (!classRec) throw new Error('Class not found')

    const feeStructure = await this.prisma.feeStructure.findFirst({
      where: {
        tenantId,
        schoolId,
        termId,
        classLevelId: classRec.levelId,
        isActive: true,
        academicYearId,
      },
      include: {
        lineItems: {
          include: { category: true },
        },
      },
    })
    if (!feeStructure) throw new Error('No active fee structure for this class level')

    const totalAmount = feeStructure.lineItems.reduce(
      (sum, li) => sum + Number(li.amount),
      0
    )

    const lineItems: InvoiceLineItemInput[] = feeStructure.lineItems.map(
      (li) => ({
        categoryId: li.categoryId,
        amount: Number(li.amount),
        isMandatory: li.isMandatory,
        description: li.category?.name ?? undefined,
      })
    )

    return this.withTransaction(async (tx: Prisma.TransactionClient) => {
      const invoices: { id: string; studentId: string; invoiceNumber: string }[] =
        []

      for (const student of classRec.students) {
        const invoice = await tx.feeInvoice.create({
          data: {
            tenantId,
            schoolId,
            studentId: student.id,
            termId,
            invoiceNumber: await this.generateInvoiceNumber(tx, tenantId, schoolId),
            totalAmount,
            paidAmount: 0,
            balance: totalAmount,
            status: PENDING,
            dueDate: new Date(),
            lineItems: {
              create: lineItems.map((li) => ({
                tenantId,
                categoryId: li.categoryId,
                amount: li.amount,
                isMandatory: li.isMandatory ?? true,
                description: li.description ?? undefined,
              })),
            },
          },
          select: { id: true, studentId: true, invoiceNumber: true },
        })

        invoices.push(invoice)

        await tx.auditLog.create({
          data: {
            tenantId,
            schoolId,
            userId: this.ctx.userId,
            action: 'invoice.create',
            entity: 'FeeInvoice',
            entityId: invoice.id,
            newData: { studentId: student.id, termId, totalAmount },
          },
        })
      }

      return { count: invoices.length, invoices }
    })
  }

  /**
   * Calculate the total outstanding balance for a student.
   * Sums the balance of all unpaid invoices (PENDING, PARTIAL, OVERDUE).
   */
  async calculateOutstandingBalance(studentId: string): Promise<number> {
    const { tenantId, schoolId } = this.schoolScope()

    const result = await this.prisma.feeInvoice.aggregate({
      where: {
        studentId,
        tenantId,
        schoolId,
        status: {
          in: [PENDING, PARTIAL, OVERDUE],
        },
      },
      _sum: { balance: true },
    })

    return Number(result._sum.balance ?? 0)
  }

  /**
   * Fetch a single invoice with its line items and payment history.
   */
  async getInvoiceById(invoiceId: string): Promise<unknown> {
    const { tenantId, schoolId } = this.schoolScope()

    const invoice = await this.prisma.feeInvoice.findFirst({
      where: { id: invoiceId, tenantId, schoolId },
      include: {
        lineItems: {
          include: { category: { select: { name: true, code: true } } },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            reference: true,
            status: true,
            paidAt: true,
            method: { select: { name: true, code: true } },
          },
          orderBy: { paidAt: 'desc' },
        },
      },
    })
    if (!invoice) throw new Error('Invoice not found')
    return invoice
  }

  // --- Private helpers ---

  /**
   * Generate a unique invoice number: INV-YYYY-NNN.
   */
  private async generateInvoiceNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
    schoolId: string
  ): Promise<string> {
    const year = new Date().getFullYear()
    const count = await tx.feeInvoice.count({
      where: {
        tenantId,
        schoolId,
        issuedAt: { gte: new Date(`${year}-01-01`) },
      },
    })
    const sequence = count + 1
    return `INV-${year}-${String(sequence).padStart(4, '0')}`
  }

  /**
   * Resolve a payment method by code. For cash/bank methods,
   * auto-provision a minimal PaymentMethodConfig if one doesn't
   * exist yet for this school.
   */
  private async resolvePaymentMethod(
    tx: Prisma.TransactionClient,
    tenantId: string,
    schoolId: string,
    methodCode: string
  ) {
    let paymentMethod = await tx.paymentMethodConfig.findFirst({
      where: {
        tenantId,
        schoolId,
        code: methodCode,
        isEnabled: true,
      },
    })

    if (!paymentMethod) {
      paymentMethod = await tx.paymentMethodConfig.create({
        data: {
          tenantId,
          schoolId,
          code: methodCode,
          name: methodCode,
          isEnabled: true,
          sortOrder: 99,
        },
      })
    }

    return paymentMethod
  }
}

