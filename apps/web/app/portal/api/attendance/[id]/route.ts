import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { normaliseNullableText, normalisePeriod } from '../route'
import {
  AMENDMENT_REASON_KEY,
  planAmendments,
  readAmendmentReason,
} from '@/lib/amendments'
import {
  ATTENDANCE_MODEL,
  lockFieldRefusal,
  scopedAttendanceWhere,
  unfinalizePath,
  writeAttendanceCorrection,
} from '../correction'
import { isUniqueConstraintViolation, duplicateResponse } from '@/lib/prisma-conflict'
import { z } from 'zod'
import { logError } from '@/lib/logger'

/**
 * The fields a correction may carry, and nothing else.
 *
 * `AMENDMENT_REASON_KEY` is NOT one of them, and it is stripped from the body
 * before this schema runs rather than relied on to be dropped: the difference
 * between "this route decided the body carries no reason" and "the schema
 * happened not to mention the key" is the difference between a decision and an
 * accident. The lock columns are refused outright before this point — see
 * `lockFieldRefusal` — so that a settled register cannot be unlocked by a body
 * that zod would quietly drop.
 */
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

    // A body that tries to move the lock itself is REFUSED, not stripped. zod
    // would drop `finalizedAt` without a word and the caller would leave
    // believing they unlocked a settled register; the unlock is a deliberate act
    // with its own authority and its own written reason, so this says where that
    // is instead of quietly discarding the request.
    const lockRefusal = lockFieldRefusal(body, unfinalizePath(id))
    if (lockRefusal) {
      return NextResponse.json({ error: 'Invalid input', details: lockRefusal }, { status: 400 })
    }

    // The amendment reason is parsed HERE, at the boundary, and REFUSED below
    // beside the other refusals. Parsing now is what keeps an operator's free
    // text out of everything downstream: by the time the plan is built the value
    // is either a trimmed string this codebase minted a bound for, or nothing.
    const amendmentReason = readAmendmentReason(body)

    // Strip the reserved key before the schema sees it, so it can never become a
    // column. `AttendanceStudent` has no `amendmentReason` column, and relying on
    // zod to drop an unknown key is the difference between a decision and an
    // accident.
    const { [AMENDMENT_REASON_KEY]: _reservedReason, ...patch } = body as Record<string, unknown>
    const parseResult = UpdateAttendanceSchema.safeParse(patch)
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

    // `markedById` is DELIBERATELY ABSENT. It used to be set to `userId` here,
    // which is the whole defect: a correction overwrote the only attribution the
    // row had, so "changed after the fact" became indistinguishable from "always
    // wrong". Who changed this, and when, is answered by the `RecordAmendment`
    // rows written below — a place that holds the correction without destroying
    // the author.
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'Invalid input', details: ['A correction must change at least one of: status, period, notes'] },
        { status: 400 },
      )
    }

    // What this edit owes the trail, and whether it is owed at all. Pure, and
    // judged against the stored row because that is what decides whether the row
    // is reason-gated — a body cannot unlock itself by submitting a blank
    // `finalizedAt`, and `lockFieldRefusal` above already refused that.
    //
    // The refusal this returns for a settled record is `MISSING_AMENDMENT_REASON`,
    // which is the lock doing its job: "cannot be edited SILENTLY", not "cannot be
    // edited". A correction to a settled register is legitimate and carries its
    // justification; a correction with no justification is what the lock exists to
    // refuse.
    const plan = planAmendments({
      reason: amendmentReason,
      write: updateData,
      stored: existing as Record<string, unknown>,
      model: ATTENDANCE_MODEL,
      entityId: id,
      tenantId,
      schoolId,
      userId,
    })
    if (plan.refusal) {
      return NextResponse.json({ error: 'Invalid input', details: plan.refusal }, { status: 400 })
    }

    // The same scoped predicate, not `{ id, tenantId }`. An existence check that
    // was scoped but a write that was not is the defect this closes: the record
    // would have been proved in scope and then rewritten regardless. Both
    // branches below go through `writeAttendanceCorrection`, so this `where` is
    // the only clause either of them can issue.
    const updated = await writeAttendanceCorrection({ where, data: updateData, plan })
    return NextResponse.json({
      success: true,
      attendance: updated,
      // The fields the trail now carries, so a client can tell an amended edit
      // from a plain one without reading the trail back. Empty for an unlocked
      // edit with no reason, which is the correct answer for that request.
      amendedFields: plan.rows.map((row) => row.field),
    })
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
