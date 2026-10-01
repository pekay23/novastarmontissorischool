import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { z } from 'zod'
import { logError } from '@/lib/logger'

const UpdateStudentSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional(),
  studentId: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  classId: z.string().nullable().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { id } = await params
    const student = await prisma.student.findFirst({
      where: { id, schoolId, tenantId },
      include: {
        class: { select: { name: true, id: true } },
        parent: { select: { firstName: true, lastName: true, phone: true, email: true } },
      },
    })
    if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 })
    return NextResponse.json(student)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logError('Student GET', error)
    return NextResponse.json({ error: 'Failed to fetch student' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'student:edit', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateStudentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }

    const existing = await prisma.student.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

    const data = parseResult.data
    const updateData: Record<string, unknown> = {}
    if (data.firstName !== undefined) updateData.firstName = data.firstName
    if (data.lastName !== undefined) updateData.lastName = data.lastName
    if (data.studentId !== undefined) updateData.studentId = data.studentId
    if (data.dateOfBirth !== undefined) {
      updateData.dateOfBirth = new Date(data.dateOfBirth)
    }
    if (data.gender !== undefined) updateData.gender = data.gender
    if (data.classId !== undefined) updateData.classId = data.classId ?? null

    const updated = await prisma.student.update({
      where: { id, schoolId, tenantId },
      data: updateData,
    })
    return NextResponse.json({ success: true, student: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Student PATCH', error)
    return NextResponse.json({ error: 'Failed to update student' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'student:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.student.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

    await prisma.student.delete({ where: { id, schoolId, tenantId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Student DELETE', error)
    return NextResponse.json({ error: 'Failed to delete student' }, { status: 500 })
  }
}
