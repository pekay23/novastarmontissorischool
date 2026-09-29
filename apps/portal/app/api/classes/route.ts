import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
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
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const classes = await prisma.class.findMany({
      where: { schoolId, tenantId },
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
    logError('Classes GET', error)
    return NextResponse.json({ error: 'Failed to fetch classes' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission('class:create')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

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

