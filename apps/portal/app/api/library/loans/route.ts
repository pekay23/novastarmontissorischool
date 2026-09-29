import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'

const BorrowSchema = z.object({
  bookId: z.string().min(1),
  studentId: z.string().optional(),
  staffId: z.string().optional(),
  dueDate: z.string(),
})

export async function POST(req: NextRequest) {
  try {
    await requirePermission('library:loan:create')
    const { tenantId } = await getTenantContext()

    const body = await req.json()
    const parseResult = BorrowSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { bookId, studentId, staffId, dueDate } = parseResult.data

    if (!studentId && !staffId) {
      return NextResponse.json({ error: 'Either studentId or staffId is required' }, { status: 400 })
    }

    // Verify the book exists and is available
    const book = await prisma.book.findFirst({
      where: { id: bookId, tenantId },
    })
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 })
    }
    if (book.availableCopies <= 0) {
      return NextResponse.json({ error: 'No available copies of this book' }, { status: 409 })
    }

    // Verify student or staff exists
    if (studentId) {
      const student = await prisma.student.findFirst({
        where: { id: studentId, tenantId },
      })
      if (!student) {
        return NextResponse.json({ error: 'Student not found' }, { status: 404 })
      }
    }
    if (staffId) {
      const staff = await prisma.staff.findFirst({
        where: { id: staffId, tenantId },
      })
      if (!staff) {
        return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
      }
    }

    const loan = await prisma.$transaction(async (tx) => {
      const newLoan = await tx.bookLoan.create({
        data: {
          tenantId,
          bookId,
          studentId: studentId || null,
          staffId: staffId || null,
          dueDate: new Date(dueDate),
        },
        include: {
          book: { select: { title: true, author: true } },
          student: { select: { firstName: true, lastName: true, studentId: true } },
          staff: { select: { firstName: true, lastName: true } },
        },
      })

      // Decrement available copies
      await tx.book.update({
        where: { id: bookId },
        data: { availableCopies: { decrement: 1 } },
      })

      return newLoan
    })

    return NextResponse.json(loan, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Library loan POST error:', error)
    return NextResponse.json({ error: 'Failed to borrow book' }, { status: 500 })
  }
}
