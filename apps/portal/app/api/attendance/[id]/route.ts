import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  attendanceVisibilityWhere,
  visibilityDeniesAll,
  type Visibility,
} from '@/lib/visibility'
import { normaliseNullableText, normalisePeriod } from '../route'
import { isUniqueConstraintViolation, duplicateResponse } from '@/lib/prisma-conflict'
import { z } from 'zod'
import { logError } from '@/lib/logger'

/**
 * The one predicate every handler in this file reads and writes through.
 *
 * Two things have to be in it, and the mutation handlers used to carry only the
 * first:
 *
 * - school scope, which for `AttendanceStudent` arrives through the `class`
 *   relation because the model has no `schoolId` column of its own;
 * - row scope, which is the caller's resolved `Visibility`.
 *
 * The row scope composes under `AND` rather than as a spread. A spread lets any
 * later property on the object silently overwrite the scope, so the filter a
 * caller can be trusted with stops being the filter that runs; under `AND` an
 * out-of-scope record simply does not match.
 *
 * Built once and shared by GET, PATCH and DELETE so the three cannot drift: the
 * defect this exists to close was that the mutation handlers applied a weaker
 * `where` than the read handler in the same file, and a single builder makes
 * that divergence impossible to reintroduce silently. The returned type is the
 * unique-where input, so the same object can be handed to `findFirst`, `update`
 * and `delete` — the write carries the scope rather than merely trusting the
 * read that preceded it.
 */
function scopedAttendanceWhere(input: {
  id: string
  tenantId: string
  schoolId: string
  visibility: Visibility
}): Prisma.AttendanceStudentWhereUniqueInput {
  const where: Prisma.AttendanceStudentWhereUniqueInput = {
    id: input.id,
    tenantId: input.tenantId,
    class: { schoolId: input.schoolId },
  }
  const scope = attendanceVisibilityWhere(input.visibility)
  if (Object.keys(scope).length > 0) where.AND = [scope]
  return where
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
    const record = await prisma.attendanceStudent.findFirst({
      where: scopedAttendanceWhere({ id, tenantId, schoolId, visibility }),
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
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'attendance:edit', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope, under the key the write itself is gated on. `hasPermission`
    // answers "may this caller edit attendance at all"; `attendance:edit` is a
    // key a classroom teacher holds, and for that role `scopeFor` resolves to
    // `class` — so without this a teacher can edit any record in the school by
    // id. The action's own key is used rather than the read key because the
    // catalog's scope is a property of the permission, and the role default
    // narrows an unmapped key rather than falling through to the catalog's `all`.
    const visibility = await resolveVisibility(ctx, 'attendance:edit')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateAttendanceSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }

    const where = scopedAttendanceWhere({ id, tenantId, schoolId, visibility })
    const existing = await prisma.attendanceStudent.findFirst({ where })
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

    // The same scoped predicate, not `{ id, tenantId }`. An existence check that
    // was scoped but a write that was not is the defect this closes: the record
    // would have been proved in scope and then rewritten regardless.
    const updated = await prisma.attendanceStudent.update({
      where,
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
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'attendance:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope under the delete key, same reason as PATCH above. No role that
    // resolves to a limited scope holds `attendance:delete` today, so this
    // clause is inert for the seeded roles — but it is the gate that would hold
    // if one were granted, and a mutation handler that resolves no visibility is
    // exactly the shape that made this defect a class rather than an incident.
    const visibility = await resolveVisibility(ctx, 'attendance:delete')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const where = scopedAttendanceWhere({ id, tenantId, schoolId, visibility })
    const existing = await prisma.attendanceStudent.findFirst({ where })
    if (!existing) return NextResponse.json({ error: 'Attendance record not found' }, { status: 404 })

    await prisma.attendanceStudent.delete({ where })
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
