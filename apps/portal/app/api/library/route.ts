import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { resolveVisibility, visibilityDeniesAll } from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

const BookSchema = z.object({
  title: z.string().min(1),
  author: z.string().optional(),
  isbn: z.string().optional(),
  publisher: z.string().optional(),
  publishYear: z.number().int().optional(),
  categoryId: z.string().optional(),
  totalCopies: z.number().int().positive().default(1),
  shelfLocation: z.string().optional(),
  language: z.string().optional(),
  edition: z.string().optional(),
  description: z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'library:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'library:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')
    const categoryId = searchParams.get('categoryId')

    const where: Prisma.BookWhereInput = { schoolId, tenantId }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { author: { contains: search, mode: 'insensitive' } },
        { isbn: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (categoryId) where.categoryId = categoryId

    const books = await prisma.book.findMany({
      where,
      include: {
        category: { select: { name: true } },
        bookLoans: {
          where: { status: 'ACTIVE' },
          include: {
            student: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { title: 'asc' },
    })

    return NextResponse.json({ data: books })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Library books GET', error)
    return NextResponse.json({ error: 'Failed to fetch books' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'library:book:create', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = BookSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    const book = await prisma.book.create({
      data: {
        tenantId,
        schoolId,
        title: data.title,
        author: data.author || null,
        isbn: data.isbn || null,
        publisher: data.publisher || null,
        publishYear: data.publishYear || null,
        categoryId: data.categoryId || null,
        totalCopies: data.totalCopies,
        availableCopies: data.totalCopies,
        shelfLocation: data.shelfLocation || null,
        language: data.language || null,
        edition: data.edition || null,
        description: data.description || null,
      },
    })

    return NextResponse.json(book, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Library books POST', error)
    return NextResponse.json({ error: 'Failed to create book' }, { status: 500 })
  }
}

