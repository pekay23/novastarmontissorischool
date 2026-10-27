import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  studentVisibilityWhere,
  classVisibilityWhere,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'
import { applyAmendmentWrite, planAmendments, readAmendmentReason } from '@/lib/amendments'

const UpdateStudentSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional(),
  otherNames: z.string().nullable().optional(),
  admissionNumber: z.string().min(1).optional(),
  studentId: z.string().min(1).optional(),
  dateOfBirth: z.iso.date().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  classId: z.string().nullable().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'student:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'student:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    // The visibility filter is part of the lookup, not a check after it, so an
    // out-of-scope row is indistinguishable from a row that does not exist.
    // A 403 here would confirm that the id resolves to a real student.
    const where: Prisma.StudentWhereInput = {
      id,
      schoolId,
      tenantId,
      ...studentVisibilityWhere(visibility),
    }
    const student = await prisma.student.findFirst({
      where,
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
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
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

    const visibility = await resolveVisibility(ctx, 'student:edit')
    if (visibilityDeniesAll(visibility)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const where: Prisma.StudentWhereUniqueInput = { id, schoolId, tenantId, AND: [studentVisibilityWhere(visibility)] }
    const existing = await prisma.student.findFirst({ where })
    if (!existing) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

    const data = parseResult.data
    if (data.classId) {
      const cls = await prisma.class.findFirst({
        where: { id: data.classId, tenantId, schoolId, AND: [classVisibilityWhere(visibility)] },
        select: { id: true },
      })
      if (!cls) return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }
    const updateData: Prisma.StudentUncheckedUpdateInput = {}
    if (data.firstName !== undefined) updateData.firstName = data.firstName
    if (data.lastName !== undefined) updateData.lastName = data.lastName
    if (data.otherNames !== undefined) updateData.otherNames = data.otherNames || null
    if (data.admissionNumber !== undefined) updateData.admissionNumber = data.admissionNumber
    if (data.studentId !== undefined) updateData.studentId = data.studentId
    if (data.dateOfBirth !== undefined) {
      updateData.dateOfBirth = new Date(data.dateOfBirth)
    }
    if (data.gender !== undefined) updateData.gender = data.gender
    if (data.classId !== undefined) updateData.classId = data.classId ?? null

    const plan = planAmendments({
      reason: readAmendmentReason(body),
      write: { ...updateData },
      stored: { ...existing },
      model: 'student',
      entityId: id,
      tenantId,
      schoolId,
      userId,
    })
    if (plan.refusal) return NextResponse.json({ error: 'A valid amendment reason is required', issues: plan.refusal }, { status: 400 })
    const updated = plan.required
      ? await applyAmendmentWrite({ model: 'student', where, data: { ...updateData }, rows: plan.rows })
      : await prisma.student.update({ where, data: updateData })
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
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'student:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const visibility = await resolveVisibility(ctx, 'student:delete')
    if (visibilityDeniesAll(visibility)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const where: Prisma.StudentWhereUniqueInput = { id, schoolId, tenantId, AND: [studentVisibilityWhere(visibility)] }
    const existing = await prisma.student.findFirst({ where })
    if (!existing) return NextResponse.json({ error: 'Student not found' }, { status: 404 })
    if (existing.finalizedAt) return NextResponse.json({ error: 'Finalized students cannot be deleted. Use the amendment workflow to record corrections.' }, { status: 409 })

    await prisma.student.delete({ where })
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
