import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { resolveVisibility, visibilityDeniesAll } from '@/lib/visibility'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'library:loan:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'library:loan:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    // `BookLoan` carries no `schoolId` column (see prisma/schema.prisma), so
    // school scope is applied through the borrowers' own relations instead.
    // `book` is required on the model, so that clause alone matches every row;
    // the nullable `student`/`staff` clauses only widen the set for rows whose
    // book belongs elsewhere, which cannot happen, and are kept so a future
    // nullable `book` cannot silently unscoped the query again.
    const where: Prisma.BookLoanWhereInput = {
      tenantId,
      AND: [
        {
          OR: [
            { book: { schoolId } },
            { student: { schoolId } },
            { staff: { schoolId } },
          ],
        },
      ],
    }
    if (status) where.status = status as Prisma.BookLoanWhereInput['status']

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
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'library:loan:return', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    // `BookLoan` has no `schoolId`, so the lookup is scoped through the book's
    // school rather than by tenant alone.
    const loan = await prisma.bookLoan.findFirst({
      where: { id, tenantId, book: { schoolId } },
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
        where: { id },
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