import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { InvoiceStatus } from '@novastar/database'
import { z } from 'zod'
import { logError } from '@/lib/logger'
import { FinanceService } from '@novastar/domain'

// List all fee invoices for the current school/tenant
export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC: use @novastar/auth hasPermission
    if (!(await hasPermission(userId, 'finance:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const studentId = searchParams.get('studentId')
    const status = searchParams.get('status')
    const page = Number(searchParams.get('page') || '1')
    const limit = Number(searchParams.get('limit') || '50')
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = { schoolId, tenantId }
    if (studentId) where.studentId = studentId
    if (status) where.status = status as InvoiceStatus

    const [invoices, total] = await Promise.all([
      prisma.feeInvoice.findMany({
        where,
        include: {
          student: { select: { firstName: true, lastName: true, studentId: true } },
          term: { select: { name: true } },
          payments: { select: { amount: true, paidAt: true, method: true } },
        },
        orderBy: { dueDate: 'asc' },
        skip,
        take: limit,
      }),
      prisma.feeInvoice.count({ where }),
    ])

    return NextResponse.json({
      data: invoices,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Finance invoices GET', error)
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
  }
}

const GenerateInvoiceSchema = z.object({
  classId: z.string(),
  termId: z.string(),
  academicYearId: z.string(),
  dueDate: z.string().optional(),
  description: z.string().optional(),
})

// Generate fee invoices for all students in a class for a term
export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx.schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC: use @novastar/auth hasPermission
    if (!(await hasPermission(ctx.userId, 'finance:invoice:create', ctx.tenantId, ctx.schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = GenerateInvoiceSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { classId, termId, academicYearId } = parseResult.data

    // Delegate to the FinanceService domain service
    const finance = new FinanceService(ctx)
    const result = await finance.generateInvoicesForClass(classId, termId, academicYearId)

    return NextResponse.json({
      success: true,
      count: result.count,
      invoices: result.invoices,
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
    logError('Finance invoices POST', error)
    return NextResponse.json({ error: 'Failed to generate invoices' }, { status: 500 })
  }
}

