import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { z } from 'zod'
import { logError } from '@/lib/logger'
import { FinanceService } from '@novastar/domain'

// List payments for a specific invoice
export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC: use @novastar/auth hasPermission (handles delegations + role inheritance)
    if (!(await hasPermission(userId, 'finance:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    logError('Finance payments GET', error)
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
    const ctx = await getTenantContext()
    if (!ctx.schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC: use @novastar/auth hasPermission (handles delegations + role inheritance)
    if (!(await hasPermission(ctx.userId, 'finance:payment:record', ctx.tenantId, ctx.schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = RecordPaymentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { invoiceId, amount, methodCode, reference, momoPhone, notes } = parseResult.data

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
    if (error instanceof Error && error.name === 'ServerConfigError') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Finance payments POST', error)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}

