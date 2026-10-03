import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  attendanceVisibilityWhere,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { normaliseNullableText, normalisePeriod } from '../route'
import { z } from 'zod'
import { logError } from '@/lib/logger'

/**
 * Prisma `P2002` is a unique-constraint violation.
 *
 * `period` is part of `@@unique([tenantId, studentId, date, period])`,
 * so a PATCH that moves a record onto a period another row of the same
 * student and day already holds is an expected client outcome — the
 * row it wants exists — and is a 409, not a server fault. See the same
 * helper and rationale in `api/attendance/route.ts`, which it duplicates
 * rather than sharing across a new module.
 */
function isUniqueConstraintViolation(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

/** The 409 body. Same `{ error }` shape as every other response here. */
function duplicateResponse() {
  return NextResponse.json(
    { error: 'A record with these values already exists' },
    { status: 409 },
  )
}

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
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC. Previously missing entirely: any authenticated caller could
    // read any attendance record in the tenant by id.
    if (!(await hasPermission(userId, 'attendance:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'attendance:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    // School scope arrives through the class relation (AttendanceStudent
    // has no schoolId column) and row scope through the visibility filter.
    // The visibility filter composes under `AND` rather than as a spread,
    // the same idiom as `GET /api/attendance`: a spread lets any later
    // property on this `where` silently overwrite the scope, so the filter
    // a caller can be trusted with stops being the filter that runs. Under
    // `AND` an out-of-scope record is simply not found.
    const where: Prisma.AttendanceStudentWhereInput = {
      id,
      tenantId,
      class: { schoolId },
    }
    const scope = attendanceVisibilityWhere(visibility)
    if (Object.keys(scope).length > 0) where.AND = [scope]

    const record = await prisma.attendanceStudent.findFirst({
      where,
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
    logError('Attendance GET', error)
    return NextResponse.json({ error: 'Failed to fetch attendance record' }, { status: 500 })
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
    if (!(await hasPermission(userId, 'attendance:edit', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    // Route through the same normalisers as the POST path: a
    // caller-supplied '' must land as the same `''` whole-day
    // sentinel the write path stores, or a PATCH could fork a
    // second row for the same student/day.
    if (data.period !== undefined) updateData.period = normalisePeriod(data.period)
    if (data.notes !== undefined) updateData.notes = normaliseNullableText(data.notes)
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
    if (isUniqueConstraintViolation(error)) {
      return duplicateResponse()
    }
    logError('Attendance PATCH', error)
    return NextResponse.json({ error: 'Failed to update attendance' }, { status: 500 })
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
    if (!(await hasPermission(userId, 'attendance:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    logError('Attendance DELETE', error)
    return NextResponse.json({ error: 'Failed to delete attendance' }, { status: 500 })
  }
}
