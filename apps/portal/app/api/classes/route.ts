import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  classVisibilityWhere,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

const ClassSchema = z.object({
  name: z.string().min(1),
  levelId: z.string(),
  stream: z.string().optional(),
  capacity: z.number().int().positive().default(30),
  classTeacherId: z.string().optional(),
})

export async function GET(_req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'class:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'class:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const where: Prisma.ClassWhereInput = {
      schoolId,
      tenantId,
      ...classVisibilityWhere(visibility),
    }

    const classes = await prisma.class.findMany({
      where,
      include: {
        _count: { select: { students: true } },
        level: { select: { name: true } },
        classTeacher: { select: { firstName: true, lastName: true } },
      },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json({ data: classes })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Classes GET', error)
    return NextResponse.json({ error: 'Failed to fetch classes' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'class:create', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = ClassSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    // Verify class level belongs to this tenant
    const level = await prisma.classLevel.findFirst({
      where: { id: data.levelId, tenantId, schoolId },
    })
    if (!level) {
      return NextResponse.json({ error: 'Class level not found' }, { status: 404 })
    }

    const cls = await prisma.class.create({
      data: {
        tenantId,
        schoolId,
        name: data.name,
        levelId: data.levelId,
        stream: data.stream || null,
        capacity: data.capacity,
        classTeacherId: data.classTeacherId || null,
      },
    })
    return NextResponse.json(cls, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Classes POST', error)
    return NextResponse.json({ error: 'Failed to create class' }, { status: 500 })
  }
}

