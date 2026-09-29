import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'

const UpdateClassSchema = z.object({
  name: z.string().min(1).optional(),
  levelId: z.string().optional(),
  stream: z.string().nullable().optional(),
  capacity: z.number().int().positive().optional(),
  classTeacherId: z.string().nullable().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { id } = await params
    const cls = await prisma.class.findFirst({
      where: { id, schoolId, tenantId },
      include: {
        _count: { select: { students: true } },
        level: { select: { name: true } },
        classTeacher: { select: { firstName: true, lastName: true } },
      },
    })
    if (!cls) return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    return NextResponse.json(cls)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Class GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch class' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('class:edit')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateClassSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }

    const existing = await prisma.class.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

    const data = parseResult.data
    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.levelId !== undefined) updateData.levelId = data.levelId
    if (data.stream !== undefined) updateData.stream = data.stream
    if (data.capacity !== undefined) updateData.capacity = data.capacity
    if (data.classTeacherId !== undefined) updateData.classTeacherId = data.classTeacherId ?? null

    const updated = await prisma.class.update({
      where: { id },
      data: updateData,
    })
    return NextResponse.json({ success: true, class: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Class PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update class' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('class:delete')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { id } = await params
    const existing = await prisma.class.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

    await prisma.class.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Class DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete class' }, { status: 500 })
  }
}
