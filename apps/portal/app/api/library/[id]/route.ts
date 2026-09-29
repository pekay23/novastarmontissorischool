import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'

const UpdateBookSchema = z.object({
  title: z.string().min(1).optional(),
  author: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  publishYear: z.number().int().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  totalCopies: z.number().int().positive().optional(),
  shelfLocation: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  edition: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const { id } = await params
    const book = await prisma.book.findFirst({
      where: { id, schoolId, tenantId },
      include: {
        category: { select: { name: true } },
        bookLoans: {
          include: {
            student: { select: { firstName: true, lastName: true, studentId: true } },
            staff: { select: { firstName: true, lastName: true } },
          },
        },
      },
    })

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 })
    }

    return NextResponse.json(book)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Library book GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch book' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('library:book:edit')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const { id } = await params
    const existing = await prisma.book.findFirst({
      where: { id, schoolId, tenantId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 })
    }

    const body = await req.json()
    const parseResult = UpdateBookSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    const updateData: Record<string, unknown> = {}
    if (data.title !== undefined) updateData.title = data.title
    if (data.author !== undefined) updateData.author = data.author
    if (data.isbn !== undefined) updateData.isbn = data.isbn
    if (data.publisher !== undefined) updateData.publisher = data.publisher
    if (data.publishYear !== undefined) updateData.publishYear = data.publishYear
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId
    if (data.shelfLocation !== undefined) updateData.shelfLocation = data.shelfLocation
    if (data.language !== undefined) updateData.language = data.language
    if (data.edition !== undefined) updateData.edition = data.edition
    if (data.description !== undefined) updateData.description = data.description
    if (data.totalCopies !== undefined) {
      const newTotal = data.totalCopies
      const activeLoans = await prisma.bookLoan.count({
        where: { bookId: id, status: 'ACTIVE' },
      })
      if (newTotal < activeLoans) {
        return NextResponse.json(
          { error: `Cannot set total copies below active loans (${activeLoans})` },
          { status: 400 },
        )
      }
      updateData.totalCopies = newTotal
      updateData.availableCopies = newTotal - activeLoans
    }

    const updated = await prisma.book.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ success: true, book: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Library book PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update book' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('library:book:delete')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const { id } = await params
    const existing = await prisma.book.findFirst({
      where: { id, schoolId, tenantId },
      include: { bookLoans: { where: { status: 'ACTIVE' } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 })
    }

    if (existing.bookLoans.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete book with active loans' },
        { status: 409 },
      )
    }

    await prisma.book.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Library book DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete book' }, { status: 500 })
  }
}
