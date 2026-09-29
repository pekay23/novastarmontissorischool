import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { InvoiceStatus } from '@novastar/database'
import { z } from 'zod'

// List all fee invoices for the current school/tenant
export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    await requirePermission('finance:read')

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
    console.error('Finance invoices GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
  }
}

const GenerateInvoiceSchema = z.object({
  classId: z.string(),
  termId: z.string(),
  academicYearId: z.string(),
  dueDate: z.string().transform((val) => new Date(val)),
  description: z.string().optional(),
})

// Generate fee invoices for all students in a class for a term
export async function POST(req: NextRequest) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    await requirePermission('finance:invoice:create')

    const body = await req.json()
    const parseResult = GenerateInvoiceSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { classId, termId, academicYearId, dueDate, description } = parseResult.data

    // Find the FeeStructure for this class level + academic year + term
    const feeStructure = await prisma.feeStructure.findFirst({
      where: { schoolId, academicYearId, termId, classLevel: { classes: { some: { id: classId } } } },
      include: { lineItems: { include: { category: true } } },
    })

    if (!feeStructure || feeStructure.lineItems.length === 0) {
      return NextResponse.json({ error: 'No active fee structure found for this class' }, { status: 400 })
    }

    // Find all students enrolled in this class for this term
    const enrollments = await prisma.enrollment.findMany({
      where: { tenantId, classId, termId, isActive: true },
      include: { student: true },
    })

    if (enrollments.length === 0) {
      return NextResponse.json({ error: 'No students enrolled in this class for this term' }, { status: 400 })
    }

    const invoicePrefix = `INV-${new Date().getFullYear()}-${String(enrollments.length).padStart(3, '0')}`

    const result = await prisma.$transaction(async (tx) => {
      const createdInvoices = []
      let counter = 1

      for (const enrollment of enrollments) {
        const totalAmount = feeStructure.lineItems.reduce(
          (sum, item) => sum + Number(item.amount),
          0,
        )

        const invoiceNumber = `${invoicePrefix}-${String(counter).padStart(4, '0')}`
        counter++

        const invoice = await tx.feeInvoice.create({
          data: {
            tenantId,
            schoolId,
            studentId: enrollment.studentId,
            termId,
            invoiceNumber,
            totalAmount,
            balance: totalAmount,
            status: InvoiceStatus.PENDING,
            dueDate,
            issuedAt: new Date(),
            lineItems: {
              create: feeStructure.lineItems.map((item) => ({
                tenantId,
                categoryId: item.categoryId,
                amount: Number(item.amount),
                isMandatory: item.isMandatory,
                description: description || undefined,
              })),
            },
          },
        })
        createdInvoices.push(invoice)
      }

      return createdInvoices
    })

    return NextResponse.json({
      success: true,
      count: result.length,
      invoices: result,
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
    console.error('Finance invoices POST error:', error)
    return NextResponse.json({ error: 'Failed to generate invoices' }, { status: 500 })
  }
}
