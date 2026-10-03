import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { NextRequest } from 'next/server'

/**
 * Cover for `GET /api/teachers/me/courses` — the teacher's own
 * course list and the `canTakeAttendance` derivation.
 *
 * `decideCanTakeAttendance` is exported pure precisely so the
 * grant rule (class-specific, school-wide, inactive, absent) is
 * provable without a database; the route tests then prove the
 * route applies it to what it read, and that the query is
 * self-scoped to the session's Staff row and tenant.
 */

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? 'courses-test-secret'

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

interface Row {
  [key: string]: unknown
}

interface QueryArgs {
  where?: Row
  select?: Row
  include?: Row
  data?: Row
}

const USER_ID = 'user-teacher'
const TENANT_ID = 'tenant-school'
const OTHER_TENANT_ID = 'tenant-other'
const SCHOOL_ID = 'school-main'

/** The session user's Staff row. */
const STAFF_ID = 'staff-1'

/** ClassSubjects the where-honouring mock filters against. */
const CLASS_SUBJECTS: Row[] = [
  {
    id: 'cs-1',
    tenantId: TENANT_ID,
    classId: 'class-1',
    subjectId: 'subj-math',
    teacherId: STAFF_ID,
    periodsPerWeek: 4,
    class: { id: 'class-1', name: 'Math 101', level: { name: 'Primary 4' } },
    subject: { name: 'Mathematics', code: 'MTH', color: '#059669' },
  },
  {
    id: 'cs-2',
    tenantId: TENANT_ID,
    classId: 'class-2',
    subjectId: 'subj-sci',
    teacherId: STAFF_ID,
    periodsPerWeek: 2,
    class: { id: 'class-2', name: 'Science 101', level: { name: 'Primary 5' } },
    subject: { name: 'Science', code: 'SCI', color: null },
  },
  // Same teacher, another tenant: the tenant filter must exclude
  // it, or a teacher could read a foreign school's assignments.
  {
    id: 'cs-foreign',
    tenantId: OTHER_TENANT_ID,
    classId: 'class-foreign',
    subjectId: 'subj-foreign',
    teacherId: STAFF_ID,
    periodsPerWeek: 1,
    class: { id: 'class-foreign', name: 'Foreign', level: { name: 'Foreign' } },
    subject: { name: 'Foreign', code: 'FRN', color: null },
  },
]

interface Session {
  tenantId: string
  schoolId: string | null
  userId: string
  role: string | null
  user: Row
}

const SESSION: Session = {
  tenantId: TENANT_ID,
  schoolId: SCHOOL_ID,
  userId: USER_ID,
  role: 'CLASSROOM_TEACHER',
  user: { id: USER_ID },
}

let session: Session = SESSION
let grants: string[] = ['timetable:read']

const hasPermission = mock(
  async (_userId: string, key: string): Promise< boolean> =>
    grants.includes('*') || grants.includes(key),
)

mock.module('@novastar/auth', () => ({ hasPermission }))

class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

let sessionError: Error | null = null

const getTenantContext = mock(async (): Promise<Session> => {
  if (sessionError) throw sessionError
  return session
})

mock.module('server-only', () => ({}))
mock.module('@/lib/tenant', () => ({
  UnauthorizedError,
  ForbiddenError,
  getTenantContext,
  getTenantContextOrNull: async () => (sessionError ? null : session),
}))

// --- Prisma -----------------------------------------------------------------

/** The Staff row the session user resolves to, or null for none. */
let staffRow: Row | null = { id: STAFF_ID }

const staffFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  return where.userId === USER_ID && where.tenantId === TENANT_ID
    ? staffRow
    : null
})

/**
 * The course lookup. Honours `tenantId` and `teacherId`, so a
 * teacher in another tenant — or a class assigned to another
 * teacher — is not returned.
 */
const classSubjectFindMany = mock(async (args: QueryArgs): Promise<Row[]> => {
  const where = args.where ?? {}
  return CLASS_SUBJECTS.filter(
    (row) =>
      row.tenantId === where.tenantId &&
      row.teacherId === where.teacherId,
  )
})

/** Attendance grants the route pre-filters, then `decideCanTakeAttendance` judges. */
let grantRows: Row[] = []

const attendanceTakerFindMany = mock(async (args: QueryArgs): Promise<Row[]> => {
  const where = args.where ?? {}
  if (
    where.tenantId !== TENANT_ID ||
    where.schoolId !== SCHOOL_ID ||
    where.staffId !== STAFF_ID
  ) {
    return []
  }
  return grantRows
})

mock.module('@/lib/prisma', () => ({
  prisma: {
    staff: { findFirst: staffFindFirst },
    classSubject: { findMany: classSubjectFindMany },
    attendanceTaker: { findMany: attendanceTakerFindMany },
  },
}))

const { GET, decideCanTakeAttendance } = await import(
  '@/app/api/teachers/me/courses/route'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function coursesRequest(): NextRequest {
  return new NextRequest('http://localhost/api/teachers/me/courses')
}

beforeEach(() => {
  session = { ...SESSION }
  sessionError = null
  grants = ['timetable:read']
  staffRow = { id: STAFF_ID }
  grantRows = []

  staffFindFirst.mockReset()
  staffFindFirst.mockImplementation(async (args: QueryArgs) => {
    const where = args.where ?? {}
    return where.userId === USER_ID && where.tenantId === TENANT_ID
      ? staffRow
      : null
  })
  classSubjectFindMany.mockReset()
  classSubjectFindMany.mockImplementation(async (args: QueryArgs) => {
    const where = args.where ?? {}
    return CLASS_SUBJECTS.filter(
      (row) =>
        row.tenantId === where.tenantId &&
        row.teacherId === where.teacherId,
    )
  })
  attendanceTakerFindMany.mockReset()
  attendanceTakerFindMany.mockImplementation(async (args: QueryArgs) => {
    const where = args.where ?? {}
    if (
      where.tenantId !== TENANT_ID ||
      where.schoolId !== SCHOOL_ID ||
      where.staffId !== STAFF_ID
    ) {
      return []
    }
    return grantRows
  })
  hasPermission.mockReset()
  hasPermission.mockImplementation(
    async (_userId: string, key: string) =>
      grants.includes('*') || grants.includes(key),
  )
})

// ---------------------------------------------------------------------------
// decideCanTakeAttendance (pure)
// ---------------------------------------------------------------------------

describe('decideCanTakeAttendance - grant rule', () => {
  it('allows a class-specific grant for that class', () => {
    expect(
      decideCanTakeAttendance([{ classId: 'class-1', isActive: true }], 'class-1'),
    ).toBe(true)
  })

  it('denies a class-specific grant for any other class', () => {
    expect(
      decideCanTakeAttendance([{ classId: 'class-1', isActive: true }], 'class-2'),
    ).toBe(false)
  })

  it('allows a school-wide grant (classId null) for any class', () => {
    expect(decideCanTakeAttendance([{ classId: null, isActive: true }], 'class-1')).toBe(true)
    expect(decideCanTakeAttendance([{ classId: null, isActive: true }], 'class-2')).toBe(true)
    expect(decideCanTakeAttendance([{ classId: null, isActive: true }], 'class-anything')).toBe(
      true,
    )
  })

  it('denies when there is no matching grant', () => {
    expect(decideCanTakeAttendance([], 'class-1')).toBe(false)
    expect(
      decideCanTakeAttendance([{ classId: 'class-other', isActive: true }], 'class-1'),
    ).toBe(false)
  })

  it('denies an inactive grant, class-specific or school-wide', () => {
    expect(
      decideCanTakeAttendance([{ classId: 'class-1', isActive: false }], 'class-1'),
    ).toBe(false)
    expect(decideCanTakeAttendance([{ classId: null, isActive: false }], 'class-1')).toBe(false)
  })

  it('treats an absent isActive as active, matching the column default', () => {
    expect(decideCanTakeAttendance([{ classId: 'class-1' }], 'class-1')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// GET — self-scoped course list
// ---------------------------------------------------------------------------

describe('GET /api/teachers/me/courses', () => {
  it('returns only the session teacher’s own courses', async () => {
    const res = await GET(coursesRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Row[] }

    expect(body.data).toHaveLength(2)
    expect(body.data.map((c) => c.classSubjectId)).toEqual(['cs-1', 'cs-2'])

    const first = body.data[0]
    expect(first.class).toEqual({
      id: 'class-1',
      name: 'Math 101',
      level: { name: 'Primary 4' },
    })
    expect(first.subject).toEqual({ name: 'Mathematics', code: 'MTH', color: '#059669' })
    expect(first.periodsPerWeek).toBe(4)
    expect(first.canTakeAttendance).toBe(false)
  })

  it('queries by the session’s Staff id and tenantId only — never a URL param', async () => {
    await GET(coursesRequest())
    const where = (classSubjectFindMany.mock.calls[0][0] as QueryArgs).where ?? {}
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.teacherId).toBe(STAFF_ID)
    // The route takes no parameters at all, so no caller can name
    // another teacher.
    expect(classSubjectFindMany.mock.calls[0][0]).not.toHaveProperty('params')
  })

  it('answers 200 with an empty list for a teacher with no ClassSubject rows', async () => {
    classSubjectFindMany.mockReset()
    classSubjectFindMany.mockImplementation(async () => [])
    const res = await GET(coursesRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toEqual([])
  })

  it('answers 200 with an empty list for a user with no Staff row', async () => {
    staffRow = null
    const res = await GET(coursesRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toEqual([])
    // No Staff row means no courses were even queried.
    expect(classSubjectFindMany).not.toHaveBeenCalled()
  })

  it('derives canTakeAttendance from a school-wide grant for every class', async () => {
    grantRows = [{ classId: null, isActive: true }]
    const res = await GET(coursesRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ canTakeAttendance: boolean }> }
    expect(body.data.every((c) => c.canTakeAttendance)).toBe(true)
  })

  it('derives canTakeAttendance from a class-specific grant for that class only', async () => {
    grantRows = [{ classId: 'class-1', isActive: true }]
    const res = await GET(coursesRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: Array<{ class: { id: string }; canTakeAttendance: boolean }>
    }
    expect(body.data.find((c) => c.class.id === 'class-1')?.canTakeAttendance).toBe(true)
    expect(body.data.find((c) => c.class.id === 'class-2')?.canTakeAttendance).toBe(false)
  })

  it('derives canTakeAttendance as false for an inactive grant', async () => {
    grantRows = [
      { classId: 'class-1', isActive: true },
      { classId: null, isActive: false },
    ]
    const res = await GET(coursesRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: Array<{ class: { id: string }; canTakeAttendance: boolean }>
    }
    expect(body.data.find((c) => c.class.id === 'class-1')?.canTakeAttendance).toBe(true)
    // The school-wide row is inactive, so it grants nothing.
    expect(body.data.find((c) => c.class.id === 'class-2')?.canTakeAttendance).toBe(false)
  })

  it('pre-filters grants by tenant, school and staff', async () => {
    await GET(coursesRequest())
    const where = (attendanceTakerFindMany.mock.calls[0][0] as QueryArgs).where ?? {}
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.schoolId).toBe(SCHOOL_ID)
    expect(where.staffId).toBe(STAFF_ID)

    // `in` is an operator object, not a bare array. `classId: ['a','b']`
    // is not a valid `StringNullableFilter` — Prisma rejects the query at
    // runtime — so the whole predicate list is asserted, not just a
    // membership test on the school-wide half. An unfiltered or
    // half-filtered read would widen a teacher's grants across tenants.
    const or = where.OR as Array<Record<string, unknown>>
    expect(or).toEqual([
      { classId: { in: ['class-1', 'class-2'] } },
      { classId: null },
    ])
  })

  it('refuses a caller without the timetable:read key', async () => {
    grants = ['attendance:read']
    const res = await GET(coursesRequest())
    expect(res.status).toBe(403)
    expect(classSubjectFindMany).not.toHaveBeenCalled()
  })

  it('answers 401 when the session is missing', async () => {
    sessionError = new UnauthorizedError()
    const res = await GET(coursesRequest())
    expect(res.status).toBe(401)
  })
})
