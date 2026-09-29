import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { InvoiceStatus, PaymentStatus } from '@novastar/database'
import { z } from 'zod'

// List payments for a specific invoice
export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    await requirePermission('finance:read')

    const { searchParams } = new URL(req.url)
    const invoiceId = searchParams.get('invoiceId')
    const studentId = searchParams.get('studentId')

    const where: Record<string, unknown> = { schoolId, tenantId }
    if (invoiceId) where.invoiceId = invoiceId
    if (studentId) where.studentId = studentId

    const payments = await prisma.payment.findMany({
      where,
      include: {
        invoice: { select: { invoiceNumber: true, totalAmount: true, balance: true } },
        student: { select: { firstName: true, lastName: true, studentId: true } },
        method: { select: { name: true, code: true } },
        recordedBy: { select: { name: true, email: true } },
      },
      orderBy: { paidAt: 'desc' },
    })

    return NextResponse.json({ data: payments })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Finance payments GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}

const RecordPaymentSchema = z.object({
  invoiceId: z.string(),
  amount: z.number().positive(),
  methodCode: z.string(), // e.g., 'cash', 'bank', 'mtn_momo'
  reference: z.string(),
  transactionId: z.string().optional(),
  momoPhone: z.string().optional(),
  notes: z.string().optional(),
})

// Record a payment against an invoice
export async function POST(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    await requirePermission('finance:payment:record')

    const body = await req.json()
    const parseResult = RecordPaymentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { invoiceId, amount, methodCode, reference, transactionId, momoPhone, notes } = parseResult.data

    // Verify the invoice belongs to this school/tenant
    const invoice = await prisma.feeInvoice.findFirst({
      where: { id: invoiceId, schoolId, tenantId },
      include: { lineItems: true },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Verify payment method is enabled for this school
    // For cash/bank, create a minimal PaymentMethodConfig if it doesn't exist
    let paymentMethod = await prisma.paymentMethodConfig.findFirst({
      where: { schoolId, tenantId, code: methodCode, isEnabled: true },
    })

    if (!paymentMethod) {
      if (methodCode === 'cash' || methodCode === 'bank') {
        paymentMethod = await prisma.paymentMethodConfig.create({
          data: {
            tenantId,
            schoolId,
            code: methodCode,
            name: methodCode === 'cash' ? 'Cash' : 'Bank Transfer',
            isEnabled: true,
          },
        })
      } else {
        return NextResponse.json({ error: 'Payment method not available' }, { status: 400 })
      }
    }

    const methodId = paymentMethod.id

    // Calculate new balance
    const currentPaid = Number(invoice.paidAmount)
    const currentBalance = Number(invoice.balance)
    const newPaidAmount = currentPaid + amount
    const newBalance = currentBalance - amount

    if (amount > currentBalance) {
      return NextResponse.json(
        { error: `Payment amount (${amount}) exceeds remaining balance (${currentBalance})` },
        { status: 400 },
      )
    }

    // Create payment and update invoice in a transaction
    const [payment] = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.payment.create({
        data: {
          tenantId,
          schoolId,
          invoiceId,
          studentId: invoice.studentId,
          amount,
          methodId,
          reference,
          transactionId,
          momoPhone,
          status: PaymentStatus.COMPLETED,
          notes,
          recordedById: userId,
        },
      })

      // Determine new invoice status
      let newStatus: InvoiceStatus = invoice.status
      if (newBalance <= 0) {
        newStatus = InvoiceStatus.PAID
      } else if (newPaidAmount > 0) {
        newStatus = InvoiceStatus.PARTIAL
      }

      await tx.feeInvoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: newPaidAmount,
          balance: Math.max(newBalance, 0),
          status: newStatus,
          paidAt: newBalance <= 0 ? new Date() : undefined,
        },
      })

      // Record audit log
      await tx.auditLog.create({
        data: {
          tenantId,
          schoolId,
          userId,
          action: 'payment_recorded',
          entity: 'Payment',
          entityId: newPayment.id,
          newData: JSON.stringify({
            amount,
            methodCode,
            invoiceId,
            reference,
            newStatus,
          }),
        },
      })

      return [newPayment]
    })

    return NextResponse.json({
      success: true,
      payment,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        paidAmount: newPaidAmount,
        balance: Math.max(newBalance, 0),
        status: newBalance <= 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ServerConfigError') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Finance payments POST error:', error)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}
