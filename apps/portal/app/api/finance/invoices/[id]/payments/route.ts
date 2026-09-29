import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'

// GET /api/finance/invoices/[id]/payments — List payments for a specific invoice
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    await requirePermission('finance:read')

    const { id: invoiceId } = await params

    // Verify invoice belongs to this school/tenant
    const invoice = await prisma.feeInvoice.findFirst({
      where: { id: invoiceId, schoolId, tenantId },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const payments = await prisma.payment.findMany({
      where: { invoiceId, schoolId, tenantId },
      include: {
        student: { select: { firstName: true, lastName: true, studentId: true } },
        method: { select: { name: true, code: true } },
        recordedBy: { select: { name: true, email: true } },
      },
      orderBy: { paidAt: 'desc' },
    })

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: Number(invoice.totalAmount),
        paidAmount: Number(invoice.paidAmount),
        balance: Number(invoice.balance),
        status: invoice.status,
      },
      payments,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Finance invoice payments GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}

const RecordPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  methodCode: z.string().min(1),
  reference: z.string().min(1),
  notes: z.string().optional(),
  momoPhone: z.string().optional(),
  transactionId: z.string().optional(),
})

// POST /api/finance/invoices/[id]/payments — Record a payment for an invoice
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('finance:payment')
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const { id: invoiceId } = await params

    const invoice = await prisma.feeInvoice.findFirst({
      where: { id: invoiceId, schoolId, tenantId },
      include: { student: { select: { id: true } } },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const body = await req.json()
    const parseResult = RecordPaymentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    const method = await prisma.paymentMethodConfig.findFirst({
      where: { tenantId, schoolId, code: data.methodCode, isEnabled: true },
    })

    if (!method) {
      return NextResponse.json({ error: `Payment method ${data.methodCode} not found or disabled` }, { status: 400 })
    }

    const payment = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.payment.create({
        data: {
          tenantId,
          schoolId,
          invoiceId: invoice.id,
          studentId: invoice.studentId,
          amount: data.amount,
          methodId: method.id,
          reference: data.reference,
          momoPhone: data.momoPhone || null,
          transactionId: data.transactionId || null,
          notes: data.notes || null,
          recordedById: userId,
        },
        include: {
          method: { select: { name: true, code: true } },
        },
      })

      await tx.feeInvoice.update({
        where: { id: invoice.id, tenantId, schoolId },
        data: {
          paidAmount: { increment: data.amount },
          status:
            data.amount >= Number(invoice.balance)
              ? 'PAID'
              : Number(invoice.paidAmount) + data.amount > 0
              ? 'PARTIAL'
              : invoice.status,
          paidAt:
            data.amount >= Number(invoice.balance)
              ? new Date()
              : invoice.paidAt,
        },
      })

      return newPayment
    })

    return NextResponse.json(payment, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Finance invoice payments POST error:', error)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}
