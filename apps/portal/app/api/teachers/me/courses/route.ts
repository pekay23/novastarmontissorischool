import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { logError } from '@/lib/logger'

/**
 * One `AttendanceTaker` row as the grant decision needs it.
 */
export interface AttendanceGrantRow {
  classId: string | null
  isActive?: boolean | null
}

/**
 * Whether the staff member behind `grantRows` may mark attendance
 * for `classId`.
 *
 * This is the entire grant rule in one place — deliberately pure,
 * with no Prisma in it, so it is provable without a database:
 *
 * - a school-wide grant (`classId: null`) allows any class;
 * - a class-specific grant allows only that class;
 * - no matching grant — or an inactive one — denies.
 *
 * `isActive` treats an absent value as active: the schema
 * defaults the column to true, so a projection that omits it
 * must not read as a denial.
 *
 * The route pre-filters with an indexed `findMany` (rows for
 * this staff member covering the teacher's classes or the
 * school) and then applies THIS function to what it read, so
 * the rule that runs is the rule that is tested.
 */
export function decideCanTakeAttendance(
  grantRows: ReadonlyArray<AttendanceGrantRow>,
  classId: string,
): boolean {
  return grantRows.some(
    (row) =>
      row.isActive !== false &&
      (row.classId === null || row.classId === classId),
  )
}

/**
 * The teacher's own course list — the data behind the
 * "My Workspace" hub.
 *
 * The route resolves from the session only. There is no `id`
 * (or any other) parameter and none may be added: the Staff
 * identity comes from the authenticated `User` via the
 * `User.staff` relation, so a teacher can never request
 * another teacher's workspace, and a URL can never name one.
 *
 * Gated on `timetable:read`. That key exists in the catalog
 * and is granted to `CLASSROOM_TEACHER` (the academic
 * category, minus deletes), and `ROLE_READ_SCOPE` narrows it
 * to `class` — "the classes this teacher teaches" — which is
 * exactly the row set this endpoint returns, since a course is
 * a `ClassSubject` row keyed on `ClassSubject.teacherId`.
 * `teacher:read`, the alternative, is granted with the same
 * narrowing but exists to gate the staff *directory*, not a
 * teacher's own assignments. The workspace is the timetable
 * hub (its primary action opens the timetable), so
 * `timetable:read` is the semantically correct gate. Roles
 * without it (`PARENT`, `ACCOUNTANT`, `ADMIN_STAFF`) are
 * refused with 403.
 */
export async function GET(_req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'timetable:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Session user → Staff, via the `User.staff` relation.
    const staff = await prisma.staff.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    })

    // A user with no Staff row teaches nothing. That is an
    // empty workspace, not an error: 200 with an empty list.
    if (!staff) return NextResponse.json({ data: [] })

    // Self-scoped by the resolved Staff id: a teacher can only
    // ever see their own courses, never another teacher's.
    const classSubjects = await prisma.classSubject.findMany({
      where: { tenantId, teacherId: staff.id },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            level: { select: { name: true } },
          },
        },
        subject: { select: { name: true, code: true, color: true } },
      },
      orderBy: [{ class: { name: 'asc' } }, { subject: { name: 'asc' } }],
    })

    // A teacher with no ClassSubject rows gets 200 with [].
    if (classSubjects.length === 0) return NextResponse.json({ data: [] })

    // Attendance grants for this staff member: one query for
    // rows covering any of the teacher's classes, plus the
    // school-wide row (`classId: null`) when one exists.
    const grants = await prisma.attendanceTaker.findMany({
      where: {
        tenantId,
        schoolId,
        staffId: staff.id,
        OR: [
          { classId: { in: classSubjects.map((cs) => cs.classId) } },
          { classId: null },
        ],
      },
      select: { classId: true, isActive: true },
    })

    const courses = classSubjects.map((cs) => ({
      classSubjectId: cs.id,
      class: {
        id: cs.class.id,
        name: cs.class.name,
        level: { name: cs.class.level.name },
      },
      subject: {
        name: cs.subject.name,
        code: cs.subject.code,
        color: cs.subject.color,
      },
      periodsPerWeek: cs.periodsPerWeek,
      canTakeAttendance: decideCanTakeAttendance(grants, cs.classId),
    }))

    return NextResponse.json({ data: courses })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Teacher Courses GET', error)
    return NextResponse.json({ error: 'Failed to fetch courses' }, { status: 500 })
  }
}
