import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { NextRequest } from 'next/server'

/**
 * Mutation handlers apply the same row-level visibility their read sibling
 * applies.
 *
 * The defect this file exists for was a class, not an incident: a mutation
 * handler gated on a permission key and then wrote, while the `GET` in the same
 * file resolved visibility and composed it under `AND`. A permission gate answers
 * "may this caller do this at all"; it never answers "which rows". For
 * `CLASSROOM_TEACHER` that gap is real, because `ROLE_DEFAULT_SCOPE` resolves
 * every unmapped key to `class` — so a teacher holding `attendance:edit`,
 * `class:edit`, `timetable:update` or `academic:create` could act on any class in
 * the school by id.
 *
 * The doubles here HONOUR the `where` they are given, including the `AND` clause
 * the visibility builder produces. A double that ignored it would let an unscoped
 * handler answer 200 and every assertion below would still pass, because the mock
 * rather than the handler would be doing the narrowing.
 *
 * `@/lib/visibility` is deliberately NOT mocked: the builders are what is under
 * test, so they run for real and the `where` clauses asserted below are the ones
 * production would send.
 */

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? 'mutation-scope-test-secret'

interface Row {
  [key: string]: unknown
}

interface QueryArgs {
  where?: Row
  select?: Row
  include?: Row
  data?: Row
  orderBy?: Row
}

const USER_ID = 'user-teacher'
const TENANT_ID = 'tenant-main'
const SCHOOL_ID = 'school-main'
const STAFF_ID = 'staff-teacher'

/** The class the caller teaches as class teacher. */
const OWN_CLASS = 'class-own'
/** A second class they teach a subject in. */
const OWN_SUBJECT_CLASS = 'class-own-subject'
/** A class in the same school they do not teach. */
const OTHER_CLASS = 'class-other'

interface Session {
  tenantId: string
  schoolId: string | null
  userId: string
  role: string | null
  user: Row
}

const TEACHER: Session = {
  tenantId: TENANT_ID,
  schoolId: SCHOOL_ID,
  userId: USER_ID,
  role: 'CLASSROOM_TEACHER',
  user: { id: USER_ID },
}

let session: Session = TEACHER
let sessionError: Error | null = null

/** Permission keys the caller holds. Derived from the real grant rule, in spirit. */
let grants: string[] = [
  'attendance:edit',
  'attendance:delete',
  'attendance:mark',
  'class:create',
  'class:edit',
  'class:delete',
  'event:create',
  'event:edit',
  'event:delete',
  'timetable:update',
  'academic:create',
  'config:write',
]

/**
 * Locally defined, not imported from `@/lib/tenant`: Bun's module mock registry is
 * global and outlives a test file, so importing the real classes would make this
 * file depend on load order. Every handler identifies these by `error.name`, so
 * the name is the whole contract.
 *
 * BOTH are exported. `api-response.ts` imports both, and a factory that omits one
 * makes that module throw `SyntaxError: Export named ... not found` for every
 * test file loaded after this one.
 */
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

const getTenantContext = mock(async (): Promise<Session> => {
  if (sessionError) throw sessionError
  return session
})

const hasPermission = mock(
  async (_userId: string, key: string): Promise<boolean> => grants.includes(key),
)

// Registered with the rest further down, once the Prisma delegates they depend on exist.

// --- Where-clause matching ---------------------------------------------------

/**
 * `true` when `row` satisfies `where`, for the field shapes these routes use.
 *
 * Handles scalar equality, `in` filters, one level of relation (`class`), and the
 * `AND` array the visibility builders produce. Anything it does not recognise
 * matches, so a test only has to describe the clauses it cares about.
 */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'AND') {
      const clauses = Array.isArray(condition) ? condition : [condition]
      if (!clauses.every((clause) => matches(row, clause as Row))) return false
      continue
    }
    if (condition === undefined) continue
    if (key === 'class') {
      // `AttendanceStudent` and `ClassSubject` carry no `schoolId` of their own,
      // so school scope arrives through this relation.
      const nested = condition as Row
      const classRow = { schoolId: SCHOOL_ID, id: row.classId }
      if (!matches(classRow, nested)) return false
      continue
    }
    const value = row[key]
    if (condition !== null && typeof condition === 'object' && 'in' in condition) {
      const allowed = (condition as { in: unknown[] }).in
      if (!Array.isArray(allowed) || !allowed.includes(value)) return false
      continue
    }
    if (condition !== null && typeof condition === 'object') continue
    if (value !== condition) return false
  }
  return true
}

function find<T extends Row>(rows: T[], args: QueryArgs): T | null {
  return rows.find((row) => matches(row, args.where)) ?? null
}

// --- Prisma doubles ----------------------------------------------------------

const CLASSES: Row[] = [
  { id: OWN_CLASS, tenantId: TENANT_ID, schoolId: SCHOOL_ID, name: 'Basic 1A', classTeacherId: STAFF_ID },
  {
    id: OWN_SUBJECT_CLASS,
    tenantId: TENANT_ID,
    schoolId: SCHOOL_ID,
    name: 'Basic 1B',
    classTeacherId: 'staff-other',
  },
  {
    id: OTHER_CLASS,
    tenantId: TENANT_ID,
    schoolId: SCHOOL_ID,
    name: 'Basic 9Z',
    classTeacherId: 'staff-other',
  },
]

const CLASS_SUBJECTS: Row[] = [
  { id: 'cs-own', tenantId: TENANT_ID, classId: OWN_CLASS, teacherId: STAFF_ID },
  {
    id: 'cs-own-subject',
    tenantId: TENANT_ID,
    classId: OWN_SUBJECT_CLASS,
    teacherId: STAFF_ID,
  },
  { id: 'cs-other', tenantId: TENANT_ID, classId: OTHER_CLASS, teacherId: 'staff-other' },
]

const ATTENDANCE: Row[] = [
  { id: 'att-own', tenantId: TENANT_ID, classId: OWN_CLASS, studentId: 'stu-own' },
  { id: 'att-other', tenantId: TENANT_ID, classId: OTHER_CLASS, studentId: 'stu-other' },
]

const TERMS: Row[] = [{ id: 'term-1', tenantId: TENANT_ID, schoolId: SCHOOL_ID }]

const STUDENTS: Row[] = [
  { id: 'stu-own', tenantId: TENANT_ID, classId: OWN_CLASS },
  { id: 'stu-other', tenantId: TENANT_ID, classId: OTHER_CLASS },
]

/** `null` makes the matching `Staff` lookup report a broken identity link. */
let callerStaffId: string | null = STAFF_ID

const staffFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  if (callerStaffId === null) return null
  return (args.where as Row)?.userId === USER_ID ? { id: callerStaffId } : null
})
const parentFindFirst = mock(async (_args: QueryArgs): Promise<Row | null> => null)

// `resolveVisibility` derives the caller's classes from these two reads, so the
// doubles have to honour `classTeacherId` / `teacherId` or every scoped test
// would see an empty class set and 403 for the wrong reason.
const classFindMany = mock(async (args: QueryArgs): Promise<Row[]> =>
  CLASSES.filter((row) => matches(row, args.where)),
)
const classSubjectFindMany = mock(async (args: QueryArgs): Promise<Row[]> =>
  CLASS_SUBJECTS.filter((row) => matches(row, args.where)),
)
const classFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const row = find(CLASSES, args)
  if (!row) return null
  // `POST /api/attendance` reads the class's roster to reject a student who is
  // not in the class being marked.
  return { ...row, students: STUDENTS.filter((s) => s.classId === row.id).map((s) => ({ id: s.id })) }
})
const classSubjectFindFirst = mock(
  async (args: QueryArgs): Promise<Row | null> => find(CLASS_SUBJECTS, args),
)

const attendanceFindFirst = mock(async (args: QueryArgs): Promise<Row | null> =>
  find(ATTENDANCE, args),
)
const attendanceUpdate = mock(async (args: QueryArgs): Promise<Row> => ({ ...args.data }))
const attendanceDelete = mock(async (_args: QueryArgs): Promise<Row> => ({}))

const classUpdate = mock(async (args: QueryArgs): Promise<Row> => ({ ...args.data }))
const classCreate = mock(async (args: QueryArgs): Promise<Row> => ({ id: 'class-new', ...args.data }))
const classLevelFindFirst = mock(async (_args: QueryArgs): Promise<Row | null> => ({ id: 'level-1' }))

const eventFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const rows: Row[] = [
    { id: 'evt-1', tenantId: TENANT_ID, schoolId: SCHOOL_ID, title: 'Sports Day' },
  ]
  return find(rows, args)
})
const eventUpdate = mock(async (args: QueryArgs): Promise<Row> => ({ ...args.data }))
const eventCreate = mock(async (args: QueryArgs): Promise<Row> => ({ id: 'evt-new', ...args.data }))

const termFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => find(TERMS, args))
const syllabusCreate = mock(async (args: QueryArgs): Promise<Row> => ({ id: 'syl-new', ...args.data }))

const timetableCreate = mock(async (args: QueryArgs): Promise<Row> => ({ id: 'tt-new', ...args.data }))
const timetableFindUnique = mock(async (_args: QueryArgs): Promise<Row | null> => ({ id: 'tt-new' }))
const timetableEntryCreateMany = mock(async (_args: QueryArgs): Promise<Row> => ({ count: 0 }))

const attendanceTakerFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  // The route's pre-filter is `OR: [{ classId }, { classId: null }]` — the second
  // clause is always present, because it is how a school-wide grant is *asked
  // for*. So its presence says nothing; only an actual school-wide row counts.
  const or = ((args.where as Row | undefined)?.OR ?? []) as Row[]
  if (schoolWideGrant && or.some((clause) => clause.classId === null)) {
    return { classId: null, canMarkStudent: true, isActive: true }
  }
  const asked = or
    .filter((clause) => clause.classId !== null)
    .map((clause) => clause.classId)
  const hit = grantedClassIds.find((id) => asked.includes(id))
  return hit === undefined ? null : { classId: hit, canMarkStudent: true, isActive: true }
})
const attendanceTakerCreate = mock(async (args: QueryArgs): Promise<Row> => ({ id: 'take-new', ...args.data }))

/** The classes the caller holds a live `AttendanceTaker` grant for. */
let grantedClassIds: string[] = []
/** Whether the caller holds the school-wide (`classId: null`) grant. */
let schoolWideGrant = false

const attendanceCreate = mock(async (args: QueryArgs): Promise<Row> => ({
  id: 'att-created',
  ...args.data,
}))

/** Set by a test to make `$transaction` reject, e.g. with Prisma's P2002. */
let transactionError: unknown = null

const TX_CLIENT = {
  timetable: { create: timetableCreate, findUnique: timetableFindUnique },
  timetableEntry: { createMany: timetableEntryCreateMany },
  attendanceTaker: { findFirst: attendanceTakerFindFirst, create: attendanceTakerCreate },
  attendanceStudent: {
    findFirst: attendanceFindFirst,
    update: attendanceUpdate,
    create: attendanceCreate,
  },
}

const $transaction = mock(
  async (fn: (tx: typeof TX_CLIENT) => Promise<unknown>): Promise<unknown> => {
    if (transactionError) throw transactionError
    return fn(TX_CLIENT)
  },
)

/** `logSystemError` writes through this when `toErrorResponse` persists a failure. */
const systemErrorCreate = mock(async (_args: QueryArgs): Promise<Row> => ({ id: 'err-1' }))

// ---------------------------------------------------------------------------
// Module-mock lifetime: snapshot before registering, restore after
// ---------------------------------------------------------------------------
// `mock.module` patches the LIVE namespace for the whole process and never reverts, so a
// registration made at module scope is what every file loaded afterwards binds to. All five
// boundaries are put back. `server-only` goes first and alone because the real
// `@/lib/tenant` imports it and the package is not installed here, so nothing else is
// capturable until that specifier resolves.
//
// The remaining snapshots are read HERE, before the first real registration. That is the
// load-bearing part: a `beforeEach` capture would run after these registrations had
// already overwritten the namespace, so it would record this file's own factory and hand
// the double straight back to the next file.
//
// Every factory SPREADS the namespace it replaces and then overrides, making each fake
// both a superset and a subset — which is what makes the restore complete, since
// `mock.module` merges and an added key could never be removed again. The `@/lib/tenant`
// spread is what makes this file work in ISOLATION: the real module also exports
// `TenantSuspendedError`, which `@/lib/api-response` imports, and a factory listing only
// four names left it absent for every import resolved after this one.
mock.module('server-only', () => ({}))

const previousNamespaces = new Map<string, Record<string, unknown>>()
previousNamespaces.set('server-only', { ...(await import('server-only')) })
previousNamespaces.set('@novastar/auth', { ...(await import('@novastar/auth')) })
previousNamespaces.set('@/lib/tenant', { ...(await import('@/lib/tenant')) })
previousNamespaces.set('@/lib/auth/session-context', {
  ...(await import('@/lib/auth/session-context')),
})
previousNamespaces.set('@/lib/prisma', { ...(await import('@/lib/prisma')) })

const base = (specifier: string): Record<string, unknown> =>
  previousNamespaces.get(specifier) ?? {}

const FAKES = [
  { specifier: '@novastar/auth', factory: () => ({ ...base('@novastar/auth'), hasPermission }) },
  {
    specifier: '@/lib/tenant',
    factory: () => ({
      ...base('@/lib/tenant'),
      UnauthorizedError,
      ForbiddenError,
      getTenantContext,
      getTenantContextOrNull: async () => (sessionError ? null : session),
    }),
  },
  {
    specifier: '@/lib/auth/session-context',
    factory: () => ({
      ...base('@/lib/auth/session-context'),
      getCachedSessionAndTenant: async () => {
        if (sessionError) throw sessionError
        return { ...session, roleName: session.role }
      },
      getTokenTenantId: async () => (sessionError ? null : TENANT_ID),
    }),
  },
  {
    specifier: '@/lib/prisma',
    factory: () => ({
      ...base('@/lib/prisma'),
      prisma: {
        staff: { findFirst: staffFindFirst },
        parent: { findFirst: parentFindFirst },
        class: {
          findFirst: classFindFirst,
          findMany: classFindMany,
          create: classCreate,
          update: classUpdate,
        },
        classSubject: {
          findFirst: classSubjectFindFirst,
          findMany: classSubjectFindMany,
        },
        classLevel: { findFirst: classLevelFindFirst },
        attendanceStudent: {
          findFirst: attendanceFindFirst,
          update: attendanceUpdate,
          delete: attendanceDelete,
        },
        attendanceTaker: { findFirst: attendanceTakerFindFirst },
        event: { create: eventCreate, findFirst: eventFindFirst, update: eventUpdate },
        term: { findFirst: termFindFirst },
        syllabus: { create: syllabusCreate },
        systemError: { create: systemErrorCreate },
        auditLog: { findFirst: mock(async () => null) },
        $transaction,
      },
    }),
  },
] as const

// Also registered at load time, so the route imports below resolve these specifiers
// through the doubles and the file is correct in a run that never reaches `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

const { PATCH: attendancePATCH, DELETE: attendanceDELETE } = await import(
  '@/app/portal/api/attendance/[id]/route'
)
const { PATCH: classPATCH } = await import('@/app/portal/api/classes/[id]/route')
const { POST: classesPOST } = await import('@/app/portal/api/classes/route')
const { PATCH: eventPATCH } = await import('@/app/portal/api/events/[id]/route')
const { POST: eventsPOST } = await import('@/app/portal/api/events/route')
const { POST: timetablePOST } = await import('@/app/portal/api/timetable/route')
const { POST: syllabiPOST } = await import('@/app/portal/api/syllabi/route')
const { POST: takersPOST } = await import('@/app/portal/api/attendance-takers/route')
const { POST: attendancePOST } = await import('@/app/portal/api/attendance/route')

// --- Helpers -----------------------------------------------------------------

function json(method: string, path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function params<T>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) }
}

function whereOf(m: { mock: { calls: Array<Array<unknown>> } }, index = 0): Row {
  const call = m.mock.calls[index]
  if (!call) throw new Error('expected the delegate to have been called')
  return ((call[0] as QueryArgs).where ?? {}) as Row
}

/** The `AND` clauses a `where` carries, flattened for assertion. */
function andClauses(where: Row): Row[] {
  const clauses = where.AND
  if (!Array.isArray(clauses)) return []
  return clauses as Row[]
}

beforeEach(() => {
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
  session = { ...TEACHER }
  sessionError = null
  grants = [
    'attendance:edit',
    'attendance:delete',
    'attendance:mark',
    'class:create',
    'class:edit',
    'class:delete',
    'event:create',
    'event:edit',
    'event:delete',
    'timetable:update',
    'academic:create',
    'config:write',
  ]
  callerStaffId = STAFF_ID
  grantedClassIds = []
  schoolWideGrant = false
  transactionError = null

  // `mockClear`, never `mockReset`: the behaviour of these doubles IS what is
  // under test, and `mockReset` would replace each implementation with a stub
  // that returns nothing.
  for (const m of [
    staffFindFirst,
    parentFindFirst,
    classFindMany,
    classSubjectFindMany,
    classFindFirst,
    classSubjectFindFirst,
    attendanceFindFirst,
    attendanceUpdate,
    attendanceDelete,
    attendanceCreate,
    classUpdate,
    classCreate,
    classLevelFindFirst,
    eventFindFirst,
    eventUpdate,
    eventCreate,
    termFindFirst,
    syllabusCreate,
    timetableCreate,
    timetableFindUnique,
    timetableEntryCreateMany,
    attendanceTakerFindFirst,
    attendanceTakerCreate,
    $transaction,
  ]) {
    m.mockClear()
  }
})

// ---------------------------------------------------------------------------
// Defect 1 -- PATCH /api/attendance/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/attendance/[id] - the write carries the read scope', () => {
  it('refuses to edit a record in a class the caller does not teach', async () => {
    const res = await attendancePATCH(
      json('PATCH', '/api/attendance/att-other', { status: 'ABSENT' }),
      params({ id: 'att-other' }),
    )

    // The gate passes -- CLASSROOM_TEACHER holds attendance:edit -- so only the
    // row scope can refuse this. Before the fix the handler answered 200 and
    // rewrote another teacher's register.
    expect(res.status).toBe(404)
    expect(attendanceUpdate).toHaveBeenCalledTimes(0)
  })

  it('does not leak existence: an out-of-scope record reads as absent', async () => {
    const denied = await attendancePATCH(
      json('PATCH', '/api/attendance/att-other', { status: 'ABSENT' }),
      params({ id: 'att-other' }),
    )
    const missing = await attendancePATCH(
      json('PATCH', '/api/attendance/att-does-not-exist', { status: 'ABSENT' }),
      params({ id: 'att-does-not-exist' }),
    )

    expect(denied.status).toBe(missing.status)
  })

  it('carries the class scope into the existence check', async () => {
    await attendancePATCH(
      json('PATCH', '/api/attendance/att-own', { status: 'LATE' }),
      params({ id: 'att-own' }),
    )

    const where = whereOf(attendanceFindFirst)
    expect(where.id).toBe('att-own')
    expect(where.tenantId).toBe(TENANT_ID)
    // AttendanceStudent has no schoolId column; school scope arrives through
    // the class relation, and this must survive alongside the row scope.
    expect(where.class).toEqual({ schoolId: SCHOOL_ID })
    expect(andClauses(where)).toEqual([
      { classId: { in: [OWN_CLASS, OWN_SUBJECT_CLASS] } },
    ])
  })

  it('carries the same scope into the update, not just the read', async () => {
    await attendancePATCH(
      json('PATCH', '/api/attendance/att-own', { status: 'LATE' }),
      params({ id: 'att-own' }),
    )

    // THE regression. A handler that scoped the read and then wrote with
    // `{ id, tenantId }` would pass every assertion above and still rewrite
    // whatever the id named.
    expect(attendanceUpdate).toHaveBeenCalledTimes(1)
    const writeWhere = whereOf(attendanceUpdate)
    expect(writeWhere.tenantId).toBe(TENANT_ID)
    expect(andClauses(writeWhere)).toEqual([
      { classId: { in: [OWN_CLASS, OWN_SUBJECT_CLASS] } },
    ])
  })

  it('still edits a record in a class the caller does teach', async () => {
    const res = await attendancePATCH(
      json('PATCH', '/api/attendance/att-own', { status: 'EXCUSED' }),
      params({ id: 'att-own' }),
    )

    expect(res.status).toBe(200)
    expect(attendanceUpdate).toHaveBeenCalledTimes(1)
  })

  it('fails closed for a teacher whose identity link is broken', async () => {
    callerStaffId = null

    const res = await attendancePATCH(
      json('PATCH', '/api/attendance/att-own', { status: 'ABSENT' }),
      params({ id: 'att-own' }),
    )

    // `resolveVisibility` resolves a missing Staff row to an empty class set
    // rather than to `null`, so a broken link narrows instead of widening.
    expect(res.status).toBe(403)
    expect(attendanceFindFirst).toHaveBeenCalledTimes(0)
    expect(attendanceUpdate).toHaveBeenCalledTimes(0)
  })

  it('refuses before any query when the permission is absent', async () => {
    grants = ['student:read']

    const res = await attendancePATCH(
      json('PATCH', '/api/attendance/att-own', { status: 'ABSENT' }),
      params({ id: 'att-own' }),
    )

    expect(res.status).toBe(403)
    expect(attendanceFindFirst).toHaveBeenCalledTimes(0)
  })

  it('leaves an unrestricted role unrestricted', async () => {
    // The counterpart to the tests above. If the scope were applied
    // unconditionally, a Head of School could not correct a teacher's register.
    session = { ...TEACHER, role: 'HEADMASTER' }

    const res = await attendancePATCH(
      json('PATCH', '/api/attendance/att-other', { status: 'ABSENT' }),
      params({ id: 'att-other' }),
    )

    expect(res.status).toBe(200)
    expect(andClauses(whereOf(attendanceUpdate))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Defect 1, DELETE -- same class, same shape
// ---------------------------------------------------------------------------

describe('DELETE /api/attendance/[id] - the delete carries the scope too', () => {
  it('refuses to delete a record in a class the caller does not teach', async () => {
    const res = await attendanceDELETE(new NextRequest('http://localhost/x'), params({
      id: 'att-other',
    }))

    expect(res.status).toBe(404)
    expect(attendanceDelete).toHaveBeenCalledTimes(0)
  })

  it('carries the class scope into the delete itself', async () => {
    await attendanceDELETE(new NextRequest('http://localhost/x'), params({ id: 'att-own' }))

    expect(attendanceDelete).toHaveBeenCalledTimes(1)
    expect(andClauses(whereOf(attendanceDelete))).toEqual([
      { classId: { in: [OWN_CLASS, OWN_SUBJECT_CLASS] } },
    ])
  })
})

// ---------------------------------------------------------------------------
// Defect 2 -- the same class of defect, elsewhere
// ---------------------------------------------------------------------------

describe('PATCH /api/classes/[id] - a teacher cannot rename a class they do not teach', () => {
  it('refuses the write and the school/tenant filter both survive', async () => {
    const res = await classPATCH(
      json('PATCH', `/api/classes/${OTHER_CLASS}`, { name: 'Mine now' }),
      params({ id: OTHER_CLASS }),
    )

    expect(res.status).toBe(404)
    expect(classUpdate).toHaveBeenCalledTimes(0)
    const where = whereOf(classFindFirst)
    expect(where.schoolId).toBe(SCHOOL_ID)
    expect(where.tenantId).toBe(TENANT_ID)
    expect(andClauses(where)).toEqual([{ id: { in: [OWN_CLASS, OWN_SUBJECT_CLASS] } }])
  })

  it('carries the scope into the update', async () => {
    await classPATCH(
      json('PATCH', `/api/classes/${OWN_CLASS}`, { name: 'Basic 1A renamed' }),
      params({ id: OWN_CLASS }),
    )

    expect(classUpdate).toHaveBeenCalledTimes(1)
    expect(andClauses(whereOf(classUpdate))).toEqual([
      { id: { in: [OWN_CLASS, OWN_SUBJECT_CLASS] } },
    ])
  })

  it('leaves an unrestricted role unrestricted', async () => {
    session = { ...TEACHER, role: 'HEADMASTER' }

    const res = await classPATCH(
      json('PATCH', `/api/classes/${OTHER_CLASS}`, { name: 'Renamed' }),
      params({ id: OTHER_CLASS }),
    )

    expect(res.status).toBe(200)
    expect(andClauses(whereOf(classUpdate))).toEqual([])
  })
})

describe('POST /api/timetable - the body classId is narrowed to what the caller may write', () => {
  const payload = (classId: string) => ({
    classId,
    termId: 'term-1',
    name: 'Weekly',
    entries: [],
  })

  it('refuses a class the caller does not teach', async () => {
    const res = await timetablePOST(json('POST', '/api/timetable', payload(OTHER_CLASS)))

    // `timetable:update` resolves to `class` for a classroom teacher, so before
    // the fix the class lookup only asked "is this class in my school" and any
    // class in the school passed.
    expect(res.status).toBe(404)
    expect($transaction).toHaveBeenCalledTimes(0)
  })

  it('narrows the class lookup by membership, without dropping the school check', async () => {
    await timetablePOST(json('POST', '/api/timetable', payload(OWN_CLASS)))

    const where = whereOf(classFindFirst)
    expect(where.id).toBe(OWN_CLASS)
    expect(where.schoolId).toBe(SCHOOL_ID)
    expect(where.tenantId).toBe(TENANT_ID)
    expect(andClauses(where)).toEqual([{ id: { in: [OWN_CLASS, OWN_SUBJECT_CLASS] } }])
  })

  it('still writes the schedule of a class the caller does teach', async () => {
    const res = await timetablePOST(json('POST', '/api/timetable', payload(OWN_CLASS)))

    expect(res.status).toBe(201)
    expect($transaction).toHaveBeenCalledTimes(1)
  })

  it('leaves an unrestricted role unrestricted', async () => {
    session = { ...TEACHER, role: 'HEADMASTER' }

    const res = await timetablePOST(json('POST', '/api/timetable', payload(OTHER_CLASS)))

    expect(res.status).toBe(201)
    expect(andClauses(whereOf(classFindFirst))).toEqual([])
  })
})

describe('POST /api/syllabi - the body classSubject is narrowed too', () => {
  const payload = (classSubjectId: string) => ({
    classSubjectId,
    termId: 'term-1',
    title: 'Number bonds to 10',
    topics: ['Counting to five'],
  })

  it('refuses a class subject in a class the caller does not teach', async () => {
    const res = await syllabiPOST(json('POST', '/api/syllabi', payload('cs-other')))

    expect(res.status).toBe(404)
    expect(syllabusCreate).toHaveBeenCalledTimes(0)
  })

  it('narrows by class membership while keeping the school relation check', async () => {
    await syllabiPOST(json('POST', '/api/syllabi', payload('cs-own')))

    const where = whereOf(classSubjectFindFirst)
    expect(where.id).toBe('cs-own')
    expect(where.tenantId).toBe(TENANT_ID)
    // Two separate conditions on the same relation: the school it belongs to,
    // and whether the caller may write for it. Both must be present.
    expect(where.class).toEqual({ schoolId: SCHOOL_ID })
    expect(andClauses(where)).toEqual([{ class: { id: { in: [OWN_CLASS, OWN_SUBJECT_CLASS] } } }])
    expect(syllabusCreate).toHaveBeenCalledTimes(1)
  })

  it('leaves an unrestricted role unrestricted', async () => {
    session = { ...TEACHER, role: 'HEAD_TEACHER' }

    const res = await syllabiPOST(json('POST', '/api/syllabi', payload('cs-other')))

    expect(res.status).toBe(201)
    expect(andClauses(whereOf(classSubjectFindFirst))).toEqual([])
  })
})

describe('POST /api/attendance - the AttendanceTaker grant is per class, and every class in the request is checked', () => {
  const mark = (classId: string, studentId: string, status = 'PRESENT') => ({
    studentId,
    classId,
    date: '2026-03-02',
    status,
  })

  it('writes the register of a class the caller is assigned to', async () => {
    // Baseline. The caller is a CLASSROOM_TEACHER, not a leader, so the
    // `LEADERSHIP_ATTENDANCE_ROLES` fallback cannot be what authorises this.
    grantedClassIds = [OWN_CLASS]

    const res = await attendancePOST(json('POST', '/api/attendance', mark(OWN_CLASS, 'stu-own')))

    expect(res.status).toBe(201)
    expect(attendanceCreate).toHaveBeenCalledTimes(1)
    const written = attendanceCreate.mock.calls[0]![0].data as Row
    expect(written.classId).toBe(OWN_CLASS)
  })

  it('refuses a class the caller holds no grant for', async () => {
    grantedClassIds = [OWN_CLASS]

    const res = await attendancePOST(
      json('POST', '/api/attendance', mark(OTHER_CLASS, 'stu-other')),
    )

    expect(res.status).toBe(403)
    expect(attendanceCreate).toHaveBeenCalledTimes(0)
  })

  it('refuses a bulk array that carries a class the caller holds no grant for', async () => {
    // THE FINDING. `POST /api/attendance` accepts a bulk array, and each element
    // carries its own `classId`. If the permission is decided once from the first
    // element, then a caller assigned to class A can put class B in the second
    // element of the same request and have it written — the single gate was
    // never asked about class B at all.
    grantedClassIds = [OWN_CLASS]

    const res = await attendancePOST(
      json('POST', '/api/attendance', [
        mark(OWN_CLASS, 'stu-own'),
        mark(OTHER_CLASS, 'stu-own'),
      ]),
    )

    expect(res.status).toBe(403)
    // Nothing may be written against the unauthorised class, even alongside a
    // legitimate record for the authorised one.
    const writtenClasses = attendanceCreate.mock.calls.map((c) => (c[0].data as Row).classId)
    expect(writtenClasses).not.toContain(OTHER_CLASS)
  })

  it('still allows a bulk array that stays inside the granted class', async () => {
    // The fix must not turn the bulk path into "one record per request".
    grantedClassIds = [OWN_CLASS]

    const res = await attendancePOST(
      json('POST', '/api/attendance', [
        mark(OWN_CLASS, 'stu-own', 'PRESENT'),
        mark(OWN_CLASS, 'stu-own', 'ABSENT'),
      ]),
    )

    expect(res.status).toBe(201)
  })

  it('checks each distinct class named by the request, not only the first', async () => {
    // If the route collects the distinct `classId`s and asks about each, then
    // `attendanceTaker.findFirst` is consulted for the unauthorised class too.
    // Asserted on the query rather than the status so a fix that simply rejects
    // every multi-class bulk array would fail here: the authorised class must
    // still be honoured on its own.
    grantedClassIds = [OWN_CLASS]

    await attendancePOST(
      json('POST', '/api/attendance', [mark(OWN_CLASS, 'stu-own'), mark(OTHER_CLASS, 'stu-own')]),
    )

    const askedAbout = attendanceTakerFindFirst.mock.calls.map(
      (c) => (((c[0] as QueryArgs).where as Row).OR as Row[])[0]!.classId,
    )
    expect(askedAbout).toContain(OTHER_CLASS)
  })
})

describe('creates with no row dimension still fail closed', () => {
  it('POST /api/classes refuses a caller whose reach resolves to nothing', async () => {
    callerStaffId = null

    const res = await classesPOST(
      json('POST', '/api/classes', { name: 'New 1A', levelId: 'level-1', capacity: 30 }),
    )

    expect(res.status).toBe(403)
    expect(classCreate).toHaveBeenCalledTimes(0)
  })

  it('POST /api/events refuses a caller whose reach resolves to nothing', async () => {
    callerStaffId = null

    const res = await eventsPOST(
      json('POST', '/api/events', {
        title: 'Sports Day',
        descriptionEn: 'Whole school',
        startDate: '2026-03-04T09:00:00.000Z',
        endDate: '2026-03-04T17:00:00.000Z',
        audience: ['ALL'],
        isAllDay: true,
      }),
    )

    expect(res.status).toBe(403)
    expect(eventCreate).toHaveBeenCalledTimes(0)
  })

  it('PATCH /api/events/[id] refuses a caller whose reach resolves to nothing', async () => {
    callerStaffId = null

    const res = await eventPATCH(
      json('PATCH', '/api/events/evt-1', { title: 'Renamed' }),
      params({ id: 'evt-1' }),
    )

    expect(res.status).toBe(403)
    expect(eventUpdate).toHaveBeenCalledTimes(0)
  })

  it('still lets an unrestricted role through all three', async () => {
    session = { ...TEACHER, role: 'HEADMASTER' }
    callerStaffId = null

    const eventRes = await eventPATCH(
      json('PATCH', '/api/events/evt-1', { title: 'Renamed' }),
      params({ id: 'evt-1' }),
    )
    expect(eventRes.status).toBe(200)

    const classRes = await classesPOST(
      json('POST', '/api/classes', { name: 'New 1A', levelId: 'level-1', capacity: 30 }),
    )
    expect(classRes.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// Defect 3 -- a concurrent duplicate grant is a 409, not a 500
// ---------------------------------------------------------------------------

describe('POST /api/attendance-takers - the compound unique answers 409', () => {
  /** Prisma's duplicate-key error, as the driver raises it. */
  function p2002(): Error {
    const error = new Error('Unique constraint failed on the compound key')
    error.name = 'PrismaClientKnownRequestError'
    ;(error as unknown as { code: string }).code = 'P2002'
    return error
  }

  it('maps a concurrent duplicate grant to 409 rather than an unlogged 500', async () => {
    // The read-modify-write is not atomic: two operators saving the same cell
    // both miss the `findFirst` and both reach `create`.
    transactionError = p2002()

    const res = await takersPOST(
      json('POST', '/api/attendance-takers', {
        staffId: STAFF_ID,
        classId: OWN_CLASS,
        canMarkStudent: true,
      }),
    )

    expect(res.status).toBe(409)
  })

  it('does not report an unrelated driver failure as a duplicate', async () => {
    transactionError = new Error('connection reset')

    const res = await takersPOST(
      json('POST', '/api/attendance-takers', {
        staffId: STAFF_ID,
        classId: OWN_CLASS,
        canMarkStudent: true,
      }),
    )

    // Only P2002 from a Prisma known-request error is a duplicate. Matching on
    // `code` alone would also swallow this one.
    expect(res.status).toBe(500)
  })

  it('does not report an error carrying P2002 but not the Prisma class as a duplicate', async () => {
    const error = new Error('someone else sent P2002')
    ;(error as unknown as { code: string }).code = 'P2002'

    transactionError = error

    const res = await takersPOST(
      json('POST', '/api/attendance-takers', {
        staffId: STAFF_ID,
        classId: OWN_CLASS,
        canMarkStudent: true,
      }),
    )

    expect(res.status).toBe(500)
  })

  it('still creates the grant when nothing collides', async () => {
    const res = await takersPOST(
      json('POST', '/api/attendance-takers', {
        staffId: STAFF_ID,
        classId: OWN_CLASS,
        canMarkStudent: true,
      }),
    )

    expect(res.status).toBe(200)
    expect(attendanceTakerCreate).toHaveBeenCalledTimes(1)
  })
})