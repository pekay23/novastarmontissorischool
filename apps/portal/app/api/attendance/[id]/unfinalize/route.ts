import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { resolveVisibility, visibilityDeniesAll } from '@/lib/visibility'
import { isReasonGated, planAmendments, readAmendmentReason } from '@/lib/amendments'
import {
  ATTENDANCE_MODEL,
  scopedAttendanceWhere,
  writeAttendanceCorrection,
} from '../../correction'
import { logError } from '@/lib/logger'

/**
 * Lifting the reason-gated lock on one attendance record, with a written reason.
 *
 * ## WHY THIS IS A SEPARATE ENDPOINT AND NOT A FIELD
 *
 * The lock migration is explicit that unlocking is "clearing the two columns",
 * and that a locked row is still editable — it just cannot be edited SILENTLY.
 * That makes the two columns look like ordinary fields, and `PATCH
 * /api/attendance/[id]` used to accept and drop them without a word, so a caller
 * could send `finalizedAt: null`, get a 200, and leave believing a settled
 * register had been reopened. That route now REFUSES a body naming either
 * column, which leaves this as the only way to move them.
 *
 * ## WHY `attendance:delete` AND NOT `attendance:edit`
 *
 * The unlock needs strictly more authority than the correction it enables, and it
 * cannot be given a new key: `packages/shared-types/permission-keys.ts` is not
 * this route's to change. `attendance:delete` already is that step above
 * `attendance:edit` — the grant rules withhold every `delete` action from
 * `ASSISTANT_HEAD` and `CLASSROOM_TEACHER`, so only `HEADMASTER` holds it — and
 * `DELETE /api/attendance/[id]` already treats it as "the correction permission a
 * Head of School uses to fix a teacher's mistake". A caller who may erase the
 * record outright may therefore also lift its lock; nobody else may.
 *
 * ## WHY A REASON IS OWED HERE RATHER THAN MERELY ACCEPTED
 *
 * Clearing `finalizedAt` is a change to a reason-gated row, so `planAmendments`
 * refuses it without a usable reason and this returns the library's
 * `MISSING_AMENDMENT_REASON`. The amendment row records the lock's own timestamp
 * as the value being removed, so the trail answers "when was this settled" as
 * well as "who reopened it and why" — the answer a school needs after an unlock,
 * because afterwards the lock columns read as if the record had never been
 * settled at all.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // The higher key. Same reason as DELETE in the same directory.
    if (!(await hasPermission(userId, 'attendance:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope under the delete key, so an unlock cannot reach a register the
    // caller could not have corrected even with the key.
    const visibility = await resolveVisibility(ctx, 'attendance:delete')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const reason = readAmendmentReason(body)

    // The lock columns are NOT read from the body. This route derives the unlock
    // itself and writes `null` to both, so there is nothing in a body it could
    // smuggle — a caller who sends `finalizedById: 'user-x'` gets the same unlock,
    // and the amendment row records the finaliser being removed rather than
    // replaced. `PATCH /api/attendance/[id]` is the one that must refuse a body
    // naming them, because there the values would otherwise be dropped silently.
    const where = scopedAttendanceWhere({ id, tenantId, schoolId, visibility })
    const existing = await prisma.attendanceStudent.findFirst({ where })
    if (!existing) return NextResponse.json({ error: 'Attendance record not found' }, { status: 404 })

    // Already unlocked: stated, not silently accepted. A 200 here would claim a
    // correction was recorded for an unlock that never happened, and the trail
    // would carry a row describing a change to a `finalizedAt` that was already
    // null.
    if (!isReasonGated(existing)) {
      return NextResponse.json({ error: 'Attendance record is not locked' }, { status: 409 })
    }

    const unlockData = { finalizedAt: null, finalizedById: null }
    const plan = planAmendments({
      reason,
      write: unlockData,
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

    const updated = await writeAttendanceCorrection({ where, data: unlockData, plan })
    return NextResponse.json({ success: true, attendance: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Attendance unfinalize', error)
    return NextResponse.json({ error: 'Failed to unlock attendance record' }, { status: 500 })
  }
}