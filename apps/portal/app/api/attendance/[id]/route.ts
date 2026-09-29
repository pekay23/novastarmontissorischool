import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'

const UpdateAttendanceSchema = z.object({
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'HALF_DAY']).optional(),
  period: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { id } = await params
    const record = await prisma.attendanceStudent.findFirst({
      where: { id, tenantId },
      include: {
        student: { select: { firstName: true, lastName: true, studentId: true } },
        class: { select: { name: true } },
        markedBy: { select: { name: true } },
      },
    })
    if (!record) return NextResponse.json({ error: 'Attendance record not found' }, { status: 404 })
    return NextResponse.json(record)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Attendance GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch attendance record' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('attendance:edit')
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateAttendanceSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }

    const existing = await prisma.attendanceStudent.findFirst({
      where: { id, tenantId },
    })
    if (!existing) return NextResponse.json({ error: 'Attendance record not found' }, { status: 404 })

    const data = parseResult.data
    const updateData: Record<string, unknown> = {}
    if (data.status !== undefined) updateData.status = data.status
    if (data.period !== undefined) updateData.period = data.period
    if (data.notes !== undefined) updateData.notes = data.notes
    updateData.markedById = userId

    const updated = await prisma.attendanceStudent.update({
      where: { id, tenantId },
      data: updateData,
    })
    return NextResponse.json({ success: true, attendance: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Attendance PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update attendance' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('attendance:delete')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { id } = await params
    const existing = await prisma.attendanceStudent.findFirst({ where: { id, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Attendance record not found' }, { status: 404 })

    await prisma.attendanceStudent.delete({ where: { id, tenantId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Attendance DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete attendance' }, { status: 500 })
  }
}
