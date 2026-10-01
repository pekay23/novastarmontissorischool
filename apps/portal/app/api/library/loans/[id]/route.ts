import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await getTenantContext()

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    const where: Record<string, unknown> = { tenantId }
    if (status) where.status = status

    const loans = await prisma.bookLoan.findMany({
      where,
      include: {
        book: { select: { title: true, author: true, isbn: true } },
        student: { select: { firstName: true, lastName: true, studentId: true } },
        staff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { borrowedAt: 'desc' },
    })

    return NextResponse.json({ data: loans })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logError('Library loans GET', error)
    return NextResponse.json({ error: 'Failed to fetch loans' }, { status: 500 })
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { tenantId, userId } = await getTenantContext()

    // RBAC
    if (!(await hasPermission(userId, 'library:loan:return', tenantId, undefined))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const loan = await prisma.bookLoan.findFirst({
      where: { id, tenantId },
    })

    if (!loan) {
      return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
    }

    if (loan.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: `Loan is already ${loan.status.toLowerCase()}` },
        { status: 400 },
      )
    }

    const updatedLoan = await prisma.$transaction(async (tx) => {
      const returned = await tx.bookLoan.update({
        where: { id, tenantId },
        data: {
          status: new Date(loan.dueDate) < new Date() ? 'OVERDUE' : 'RETURNED',
          returnedAt: new Date(),
        },
      })

      // Increment available copies
      await tx.book.update({
        where: { id: loan.bookId },
        data: { availableCopies: { increment: 1 } },
      })

      return returned
    })

    return NextResponse.json({ success: true, loan: updatedLoan })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Library loan return', error)
    return NextResponse.json({ error: 'Failed to return book' }, { status: 500 })
  }
}
