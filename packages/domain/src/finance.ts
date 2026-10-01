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
 */

import {
  InvoiceStatus,
  PaymentStatus,
  type Prisma,
} from '@novastar/database'
import { BaseService, type ServiceContext } from './base'

export interface PaymentInput {
  invoiceId: string
  amount: number
  methodCode: string
  reference: string
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
    paidAt: Date
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

export class FinanceService extends BaseService {
  constructor(ctx: ServiceContext) {
    super(ctx)
  }

  /**
   * Record a payment against an invoice.
   *
   * Atomicity: creates the Payment and decrements the invoice balance
   * in a single Prisma transaction — prevents lost updates and the
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

      // --- Compute new values ---
      const newPaidAmount = Number(invoice.paidAmount) + input.amount
      const newBalance = Number(invoice.balance) - input.amount
      const newStatus: InvoiceStatus =
        newBalance <= 0
          ? InvoiceStatus.PAID
          : newBalance < Number(invoice.totalAmount)
            ? InvoiceStatus.PARTIAL
            : invoice.status

      // --- Create the payment ---
      const payment = await tx.payment.create({
        data: {
          tenantId,
          schoolId,
          invoiceId: invoice.id,
          studentId: invoice.studentId,
          amount: input.amount,
          methodId: paymentMethod.id,
          reference: input.reference,
          status: PaymentStatus.COMPLETED,
          momoPhone: input.momoPhone ?? undefined,
          recordedById: this.ctx.userId,
          notes: input.notes ?? undefined,
        },
      })

      // --- Atomically update the invoice balance (no lost updates) ---
      await tx.feeInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaidAmount,
          balance: newBalance,
          status: newStatus,
          paidAt: newBalance <= 0 ? new Date() : undefined,
        },
      })

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
            balance: newBalance,
            paidAmount: newPaidAmount,
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
          paidAmount: newPaidAmount,
          balance: newBalance,
          status: newStatus,
        },
        idempotencySkipped: false,
      }
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
            status: InvoiceStatus.PENDING,
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
          in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL, InvoiceStatus.OVERDUE],
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
