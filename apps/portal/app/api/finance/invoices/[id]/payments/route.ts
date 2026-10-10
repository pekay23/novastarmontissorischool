import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { z } from 'zod'
import { logError } from '@/lib/logger'
import { FinanceService } from '@novastar/domain'

// GET /api/finance/invoices/[id]/payments — List payments for a specific invoice
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'finance:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    logError('Finance invoice payments GET', error)
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
    const ctx = await getTenantContext()
    if (!ctx.schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(ctx.userId, 'finance:payment', ctx.tenantId, ctx.schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: invoiceId } = await params

    const body = await req.json()
    const parseResult = RecordPaymentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { amount, methodCode, reference, notes, momoPhone } = parseResult.data

    // Delegate to the FinanceService domain service
    const finance = new FinanceService(ctx)
    const result = await finance.recordPayment({
      invoiceId,
      amount,
      methodCode,
      reference,
      momoPhone,
      notes,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Finance invoice payments POST', error)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}
