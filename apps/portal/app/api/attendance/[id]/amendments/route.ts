import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { resolveVisibility, visibilityDeniesAll } from '@/lib/visibility'
import { ATTENDMENT_ENTITY, scopedAttendanceWhere } from '../../correction'
import { logError } from '@/lib/logger'

/**
 * One attendance record's amendment trail: who changed what, when, and why.
 *
 * ## THE SCOPE IS TWO CHECKS, AND BOTH ARE NEEDED
 *
 * The permission answers "may this caller read attendance at all" and the
 * visibility answers "which rows", exactly as `GET /api/attendance/[id]` does —
 * this route reuses the same `scopedAttendanceWhere` rather than trusting a
 * caller-supplied id, because `RecordAmendment` is entity-agnostic and its
 * `entityId` column is an ordinary string with no referential integrity. A trail
 * keyed only by `entityId` would answer for any record in any school, so the
 * attendance row is proved in scope first and the trail is read only after it
 * matched. That is why this is a 404 on an out-of-scope record rather than an
 * empty list: an empty trail and an invisible record are different facts, and
 * collapsing them would tell a caller probing another school's register that the
 * id does not exist.
 *
 * ## WHY `schoolId` IS NOT PART OF THE TRAIL FILTER
 *
 * `RecordAmendment.schoolId` is nullable — a cross-tenant operator action has no
 * school to name — so filtering on it would silently drop a row whose school was
 * never recorded. The record itself has just been proved to belong to this
 * school through its class, and the trail rows name that record by id, so the
 * tenant plus entity plus entityId triple is the scope; adding the nullable
 * column could only make the answer less complete, not less leaky.
 *
 * ## WHY THE ACTOR'S NAME TRAVELS WITH THE ROW
 *
 * `groupAmendments` on the client falls back to the raw `userId` when it cannot
 * resolve a name, which prints a cuid into a register dispute. Selecting the
 * name here costs one join the client would otherwise make per row anyway, and
 * `userId` is still returned so a reader can see the exact account even if the
 * person has since been renamed.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    if (!(await hasPermission(userId, 'attendance:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Read key, not the edit key: the trail is evidence about a register, so it
    // follows whoever may read the register rather than whoever may change it.
    const visibility = await resolveVisibility(ctx, 'attendance:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const record = await prisma.attendanceStudent.findFirst({
      where: scopedAttendanceWhere({ id, tenantId, schoolId, visibility }),
      select: { id: true },
    })
    if (!record) return NextResponse.json({ error: 'Attendance record not found' }, { status: 404 })

    // Scoped in the query, never filtered in JS, and newest first so the reader
    // is not sorting a disputed register by hand. The index
    // `(tenantId, entity, entityId, createdAt)` serves exactly this shape.
    const rows = await prisma.recordAmendment.findMany({
      where: { tenantId, entity: ATTENDMENT_ENTITY, entityId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        groupId: true,
        field: true,
        oldValue: true,
        newValue: true,
        reason: true,
        userId: true,
        operatorId: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    })
    return NextResponse.json({ data: rows })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logError('Attendance amendments GET', error)
    return NextResponse.json({ error: 'Failed to fetch amendment history' }, { status: 500 })
  }
}