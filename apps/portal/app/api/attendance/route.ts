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
import { z } from 'zod'
import { logError } from '@/lib/logger'
// `P2002` handling, shared. `AttendanceStudent` carries
// `@@unique([tenantId, studentId, date, period])` and the write path's
// read-then-write is not atomic against a concurrent marker, so two POSTs for
// the same student, day and period can both miss the `findFirst` and both reach
// `create` — the loser gets a P2002 and must see a 409, not a 500.
import { isUniqueConstraintViolation, duplicateResponse } from '@/lib/prisma-conflict'

/**
 * Normalise nullable text once, at the boundary.
 *
 * `undefined`, `null`, `''` and whitespace-only strings all mean "no
 * value" and map to `null`; anything else becomes a trimmed non-empty
 * string. Every write path for a still-nullable text column (`notes`
 * on both attendance models) funnels through here.
 *
 * NB: this is NOT the normaliser for `period` — that column is
 * `String @default("")`, NOT NULL, so use `normalisePeriod`.
 */
export function normaliseNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Normalise `AttendanceStudent.period` / `AttendanceStaff.period`.
 *
 * The column is `String @default("")` — NOT NULL — and `''` is the
 * whole-day sentinel. `undefined`, `null`, `''` and whitespace-only
 * input all mean "whole day" and map to `''`; anything else becomes
 * the trimmed string. The lookup key AND every write branch must
 * funnel through here and agree: while the column was nullable, the
 * read used `''` while the write used `null`, `'x' = NULL` is never
 * true, the unique index on `(tenantId, studentId, date, period)`
 * never matched, and every re-save of the same student/day inserted
 * a duplicate row. Writing `null` now throws against the NOT NULL
 * column — one canonical value, both sides of the upsert.
 */
export function normalisePeriod(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value.trim()
}

const MS_PER_DAY = 86_400_000

/**
 * The single canonical day representation for attendance keys.
 *
 * `new Date('YYYY-MM-DD')` is UTC midnight by specification, so that
 * is what the write path stores. The read path must bound the same
 * day in UTC as well: a local-midnight range (`setHours`) shifts
 * with the server's time zone, so a server west of UTC starts its
 * range after the stored midnight and misses every row of the day,
 * while a server east of UTC ends its range after the next local
 * midnight and double-counts. Pinning both the upsert key and the
 * query range to the parsed instant's UTC calendar day makes the key
 * machine-independent — the same calendar day maps to the same
 * `Date` on every server, so the unique constraint sees one day.
 */
export function normaliseAttendanceDate(value: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return parsed
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  )
}

/**
 * The Neon adapter turns every statement into a network round trip, so
 * an unbounded interactive transaction holds a pooled connection — and
 * this request — open for however long the database feels like answering.
 */
const ATTENDANCE_TRANSACTION_BOUNDS = { maxWait: 2_000, timeout: 30_000 } as const

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC. Previously missing entirely: any authenticated caller reaching
    // this path could read any class's attendance in the tenant. The
    // mutation handler below guards on its own key; this is the read
    // equivalent, same idiom.
    if (!(await hasPermission(userId, 'attendance:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope. The permission gate answers "may they read attendance at
    // all"; this answers "which rows". A classroom teacher must see only
    // their own classes, a parent only their own children.
    const visibility = await resolveVisibility(ctx, 'attendance:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const classId = searchParams.get('classId')
    const date = searchParams.get('date')
    // The UI already sends `period` (`page.tsx` sets it from the period
    // filter); the route previously ignored it, so a period view and the
    // whole-day view returned the same rows.
    const period = searchParams.get('period')

    // AttendanceStudent has no schoolId column, so school scope arrives
    // through the class relation. The visibility filter composes under
    // `AND` rather than as a spread: the `?classId=` parameter must
    // NARROW the visible set, never replace the scope. Spread first and
    // the parameter overwrote `classId: { in: [...] }` with the raw
    // string, so a classroom teacher could read any class by id. Under
    // `AND`, an out-of-scope classId yields an unsatisfiable predicate
    // and zero rows — indistinguishable from an empty register.
    const where: Prisma.AttendanceStudentWhereInput = {
      tenantId,
      class: { schoolId },
    }
    const scope = attendanceVisibilityWhere(visibility)
    if (Object.keys(scope).length > 0) where.AND = [scope]
    if (classId) where.classId = classId
    if (date) {
      // The same UTC-midnight canonical day the write path stores.
      const start = normaliseAttendanceDate(date)
      const end = new Date(start.getTime() + MS_PER_DAY - 1)
      where.date = { gte: start, lte: end }
    }
    // An absent parameter means no filter; `?period=` (empty) means the
    // whole-day sentinel, stored as `''`.
    if (period !== null) where.period = normalisePeriod(period)

    const records = await prisma.attendanceStudent.findMany({
      where,
      include: {
        student: { select: { firstName: true, lastName: true, studentId: true } },
        class: { select: { name: true } },
        markedBy: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
    })
    return NextResponse.json({ data: records })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logError('Attendance GET', error)
    return NextResponse.json({ error: 'Failed to fetch attendance' }, { status: 500 })
  }
}

const MarkAttendanceSchema = z.object({
  studentId: z.string(),
  classId: z.string(),
  date: z.string(),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'HALF_DAY']),
  period: z.string().optional(),
  notes: z.string().optional(),
})

/**
 * One `AttendanceTaker` row as the grant decision needs it.
 */
export interface AttendanceTakerGrantRow {
  classId: string | null
  canMarkStudent?: boolean | null
  isActive?: boolean | null
}

/**
 * Whether the staff member `staffId` may mark student attendance for
 * `classId`, given that member's grant rows.
 *
 * This is the entire grant rule in one place — deliberately pure, with
 * no Prisma in it, so it is provable without a database:
 *
 * - a school-wide grant (`classId: null`) allows any class;
 * - a class-specific grant allows only that class;
 * - no matching grant — or an inactive one, or one with
 *   `canMarkStudent: false` — denies;
 * - a caller with no `Staff` row can hold no grant at all (the table
 *   is keyed on `Staff`), so they are denied unless the admin bypass
 *   applies.
 *
 * The route pre-filters with an indexed `findFirst` (active rows for
 * this staff member covering the class or the school) and then applies
 * THIS function to what it read, so the rule that runs is the rule
 * that is tested, not a re-implementation inside a where clause.
 * `canMarkStudent`/`isActive` treat an absent value as granted: the
 * schema defaults both to true, so a projection or fixture that omits
 * them must not read as a denial.
 *
 * `options.adminBypass` is the explicit no-Staff-row path: a leadership
 * role, or a holder of `attendance:delete` — the correction permission
 * a Head of School uses to fix a teacher's mistake — may mark any
 * class.
 */
export function decideAttendanceTakerAccess(
  grantRows: readonly AttendanceTakerGrantRow[],
  staffId: string | null,
  classId: string,
  options: { adminBypass?: boolean } = {},
): boolean {
  if (options.adminBypass) return true
  if (staffId === null) return false
  return grantRows.some(
    (row) =>
      row.isActive !== false &&
      row.canMarkStudent !== false &&
      (row.classId === null || row.classId === classId),
  )
}

/**
 * Roles that keep the temporary fallback in `mayMarkAttendance`.
 *
 * The seed creates no `AttendanceTaker` rows yet, so without this the
 * platform could not mark attendance at all until assignments are
 * configured. Remove once the seed writes grants.
 */
const LEADERSHIP_ATTENDANCE_ROLES: ReadonlySet<string> = new Set([
  'HEADMASTER',
  'ASSISTANT_HEAD',
  'HEAD_TEACHER',
])

/**
 * Whether the caller may mark student attendance for `classId`.
 *
 * `AttendanceTaker` models exactly this — who may mark attendance for
 * which class, with `classId` null meaning school-wide — but the grant
 * is keyed on `Staff` while the caller is a `User`, so the identity is
 * resolved first, and a user with no staff record (an admin) is
 * handled explicitly rather than falling through to "allowed" or
 * "denied" by accident.
 */
async function mayMarkAttendance(input: {
  tenantId: string
  schoolId: string
  userId: string
  role: string | null
  classId: string
}): Promise<boolean> {
  const { tenantId, schoolId, userId, role, classId } = input

  const staff = await prisma.staff.findFirst({
    where: { tenantId, userId },
    select: { id: true },
  })

  if (!staff) {
    // Explicit admin policy. A user without a Staff row can hold no
    // grant, so the matrix cannot authorise them; instead, leadership
    // keeps the temporary fallback above, and a holder of
    // `attendance:delete` may correct any register — without this a
    // Head of School could not fix a teacher's mistake. Everyone else
    // is denied, with the same clear message as any other denial.
    const bypass =
      LEADERSHIP_ATTENDANCE_ROLES.has(role ?? '') ||
      (await hasPermission(userId, 'attendance:delete', tenantId, schoolId))
    return decideAttendanceTakerAccess([], null, classId, { adminBypass: bypass })
  }

  // The indexed pre-filter: active rows for this staff member covering
  // the target class or the school. The authoritative rule — including
  // the `canMarkStudent` flag and the class match — is applied by
  // `decideAttendanceTakerAccess` below, not by this where clause.
  const assignment = await prisma.attendanceTaker.findFirst({
    where: {
      tenantId,
      schoolId,
      staffId: staff.id,
      isActive: true,
      // `classId` null on the row means school-wide.
      OR: [{ classId }, { classId: null }],
    },
    select: { classId: true, canMarkStudent: true, isActive: true },
  })

  // A row that came back from the class-or-school-wide lookup with no
  // `classId` IS the school-wide row; normalising the projection keeps
  // that explicit for the decision function.
  const grantRows: AttendanceTakerGrantRow[] = assignment
    ? [{ classId: assignment.classId ?? null, canMarkStudent: assignment.canMarkStudent, isActive: assignment.isActive }]
    : []

  if (decideAttendanceTakerAccess(grantRows, staff.id, classId)) return true

  // Deliberate, temporary policy — not an oversight. See
  // LEADERSHIP_ATTENDANCE_ROLES above.
  return LEADERSHIP_ATTENDANCE_ROLES.has(role ?? '')
}

export async function POST(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId, role } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'attendance:mark', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()

    // Support both single record and bulk array
    let records: Array<z.infer<typeof MarkAttendanceSchema>>
    if (Array.isArray(body)) {
      const parseResult = z.array(MarkAttendanceSchema).safeParse(body)
      if (!parseResult.success) {
        return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
      }
      records = parseResult.data
    } else {
      const parseResult = MarkAttendanceSchema.safeParse(body)
      if (!parseResult.success) {
        return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
      }
      records = [parseResult.data]
    }

    // Every distinct class the request names is checked, not just the first
    // record's. A bulk array is one request but each element carries its own
    // `classId` and its own `studentId`, and each is written independently below.
    // Deciding once from `records[0]` would mean a caller assigned to class A
    // could put class B in the second element of the same call and have it
    // written — the grant question would never be asked about class B.
    const requestedClassIds = [...new Set(records.map((record) => record.classId))]

    // Roster per requested class, and the attendance grant per requested class.
    // Both are keyed by class id so a record is authorised against the class it
    // actually writes to, not against whichever class happened to be first.
    const rosters = new Map<string, Set<string>>()

    for (const requestedClassId of requestedClassIds) {
      // Verify the students are in the specified class
      const classCheck = await prisma.class.findFirst({
        where: { id: requestedClassId, schoolId, tenantId },
        include: { students: { select: { id: true } } },
      })
      if (!classCheck) {
        return NextResponse.json({ error: 'Class not found' }, { status: 404 })
      }
      rosters.set(requestedClassId, new Set(classCheck.students.map((s) => s.id)))

      // AttendanceTaker enforcement: an active assignment for this class
      // (or school-wide), or the leadership role fallback above.
      const mayMark = await mayMarkAttendance({ tenantId, schoolId, userId, role, classId: requestedClassId })
      if (!mayMark) {
        return NextResponse.json(
          {
            error: `You are not assigned to mark attendance for class ${requestedClassId}`,
          },
          { status: 403 },
        )
      }
    }

    const results = []
    for (const record of records) {
      if (!rosters.get(record.classId)?.has(record.studentId)) {
        results.push({ studentId: record.studentId, error: 'Student not in this class' })
        continue
      }

      // One normalisation, used for the lookup key AND both write
      // branches: `''` is the whole-day sentinel the NOT NULL column
      // defaults to, so a second identical POST finds the first row
      // and updates it instead of inserting a duplicate.
      const recordDate = normaliseAttendanceDate(record.date)
      const period = normalisePeriod(record.period)
      const notes = normaliseNullableText(record.notes)

      // A plain `upsert` on the compound key is not sufficient: the
      // unique constraint includes `period`, and Prisma's compound
      // unique `where` input cannot express "the row for this exact
      // key" robustly across the class of callers. The read and the
      // write therefore share one transaction, keyed on the same
      // normalised value: the `findFirst` matches the existing row for
      // the exact key, so a re-save updates instead of inserting.
      const attendance = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.attendanceStudent.findFirst({
            where: { tenantId, studentId: record.studentId, date: recordDate, period },
          })
          if (existing) {
            return tx.attendanceStudent.update({
              where: { id: existing.id },
              data: {
                classId: record.classId,
                status: record.status,
                period,
                notes,
                markedById: userId,
              },
            })
          }
          return tx.attendanceStudent.create({
            data: {
              tenantId,
              studentId: record.studentId,
              classId: record.classId,
              date: recordDate,
              status: record.status,
              period,
              notes,
              markedById: userId,
            },
          })
        },
        ATTENDANCE_TRANSACTION_BOUNDS,
      )
      results.push({ studentId: record.studentId, success: true, attendance })
    }

    return NextResponse.json({ success: true, results }, { status: 201 })
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
    logError('Attendance POST', error)
    return NextResponse.json({ error: 'Failed to mark attendance' }, { status: 500 })
  }
}
