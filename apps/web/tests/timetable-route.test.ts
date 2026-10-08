import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

/**
 * Cover for `GET/POST /api/timetable`.
 *
 * Follows the `route-authz.test.ts` idiom: `mock.module` the
 * session, permission and Prisma boundaries before the dynamic
 * `import()` of the route, and let `@/lib/visibility` run for
 * real against the mocked client so the `where` clauses asserted
 * below are the ones production sends. The mocked `findFirst`
 * honours the `where` it is given — a mock that ignored it would
 * let an unscoped handler answer 200 and every isolation
 * assertion would still pass.
 */

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? 'timetable-test-secret'

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
  data?: Row | Row[]
  orderBy?: Row | Row[]
}

const USER_ID = 'user-teacher'
const TENANT_ID = 'tenant-school'
const OTHER_TENANT_ID = 'tenant-other'
const SCHOOL_ID = 'school-main'

/** Classes the where-honouring mocks filter against. */
const CLASSES: Row[] = [
  { id: 'class-own', tenantId: TENANT_ID, schoolId: SCHOOL_ID },
  { id: 'class-other', tenantId: TENANT_ID, schoolId: SCHOOL_ID },
  { id: 'class-shared', tenantId: TENANT_ID, schoolId: SCHOOL_ID },
  { id: 'class-foreign', tenantId: OTHER_TENANT_ID, schoolId: 'school-other' },
]

/** Timetables, keyed by the row the GET handler asks for. */
const TIMETABLES: Row[] = [
  {
    id: 'tt-own',
    tenantId: TENANT_ID,
    classId: 'class-own',
    termId: 'term-1',
    name: 'Autumn',
    isPublished: true,
    // Deliberately stored out of order. These are not sorted by the
    // top-level `orderBy` — that orders whole timetable rows, not the
    // entries hanging off one — but by `include.entries.orderBy` via
    // `orderEntries`, so the expected sequence below is only reachable by
    // a handler that actually asked.
    entries: [
      { id: 'e2', dayOfWeek: 1, startTime: '10:00', endTime: '11:00' },
      { id: 'e1', dayOfWeek: 1, startTime: '08:00', endTime: '09:00' },
      { id: 'e3', dayOfWeek: 3, startTime: '08:00', endTime: '09:00' },
    ],
  },
  {
    id: 'tt-other',
    tenantId: TENANT_ID,
    classId: 'class-other',
    termId: 'term-1',
    name: 'Autumn',
    isPublished: false,
    entries: [],
  },
  // Same class/term ids as a real collision would look like, but
  // another tenant's row: must never be returned to this tenant's
  // caller even when the exact class and term are named.
  {
    id: 'tt-foreign',
    tenantId: OTHER_TENANT_ID,
    classId: 'class-foreign',
    termId: 'term-foreign',
    name: 'Autumn',
    isPublished: true,
    entries: [],
  },
  // Two named timetables for ONE class/term pair, stored in the wrong
  // order. `Timetable` is unique on `(tenantId, classId, termId, name)`
  // and not on `(classId, termId)`, so this pair is exactly the case the
  // route's `orderBy: { name: 'asc' }` exists for: two rows match, and
  // nothing but the requested ordering picks between them. If a
  // `findFirst` double answered with fixture order, 'Zebra' would win and
  // the route's determinism claim would be untested.
  {
    id: 'tt-zebra',
    tenantId: TENANT_ID,
    classId: 'class-shared',
    termId: 'term-shared',
    name: 'Zebra',
    isPublished: true,
    entries: [],
  },
  {
    id: 'tt-apple',
    tenantId: TENANT_ID,
    classId: 'class-shared',
    termId: 'term-shared',
    name: 'Apple',
    isPublished: true,
    entries: [],
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
  role: 'HEADMASTER',
  user: { id: USER_ID },
}

let session: Session = SESSION
let grants: string[] = ['*']

const hasPermission = mock(
  async (_userId: string, key: string): Promise<boolean> =>
    grants.includes('*') || grants.includes(key),
)

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

// --- Prisma -----------------------------------------------------------------

const staffFindFirst = mock(async (_args: QueryArgs): Promise<Row | null> => ({
  id: 'staff-teacher',
}))
const parentFindFirst = mock(async (_args: QueryArgs): Promise<Row | null> => null)

/** The teacher's classes: they teach `class-own` (and are its class teacher). */
const classFindMany = mock(async (_args: QueryArgs): Promise<Row[]> => [
  { id: 'class-own' },
])
const classSubjectFindMany = mock(async (_args: QueryArgs): Promise<Row[]> => [
  { id: 'cs-own', classId: 'class-own' },
])

const classFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  return (
    CLASSES.find(
      (c) =>
        c.id === where.id &&
        c.tenantId === where.tenantId &&
        c.schoolId === where.schoolId,
    ) ?? null
  )
})

const termFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  return where.id === 'term-1' && where.tenantId === TENANT_ID
    ? { id: 'term-1' }
    : null
})

/** Compare two column values the way SQL would for an `asc` order. */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const as = String(a)
  const bs = String(b)
  return as < bs ? -1 : as > bs ? 1 : 0
}

/**
 * Apply an `orderBy` clause the way Prisma does.
 *
 * `requested` is whatever the handler put in the clause: one
 * `{ field: 'asc' }`, an ordered list of them, or absent. It is typed
 * `unknown` because it arrives through the mocked client boundary, not
 * from a call site TypeScript checked. Absent means the caller
 * expressed no preference, so the incoming order survives untouched —
 * which is what a real `findFirst` without `orderBy` returns.
 * Otherwise rows are compared clause by clause and field by field, in
 * the order the handler listed them, so the first difference decides.
 */
function sortByOrderBy(rows: ReadonlyArray<Row>, requested: unknown): Row[] {
  const clauses: Row[] = Array.isArray(requested)
    ? requested
    : typeof requested === 'object' && requested !== null
      ? [requested as Row]
      : []
  if (clauses.length === 0) return [...rows]
  // `Array.prototype.sort` is stable, so rows that compare equal keep
  // the order they arrived in — a tie in the requested key leaves the
  // outcome as it was, rather than reordering rows arbitrarily.
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      for (const key of Object.keys(clause)) {
        const descending = String(clause[key]).toLowerCase() === 'desc'
        const cmp = compareValues(a[key], b[key]) * (descending ? -1 : 1)
        if (cmp !== 0) return cmp
      }
    }
    return 0
  })
}

/**
 * Apply the `include.entries.orderBy` the handler asked for.
 *
 * This is what makes the ordering assertion mean something. The
 * fixtures store their entries deliberately out of order, so the
 * expected sequence is only produced by a handler that really asked
 * for `dayOfWeek` then `startTime`. A mock that ignored `orderBy`
 * would hand back fixture order and the assertion would pass for a
 * route that ordered nothing.
 */
function orderEntries(args: QueryArgs, entries: ReadonlyArray<Row>): Row[] {
  return sortByOrderBy(entries, (args.include?.entries as Row | undefined)?.orderBy)
}

/**
 * The timetable lookup. Honours `tenantId`, `classId`, `termId`,
 * the `class: { schoolId }` relation filter and the visibility
 * `AND: [{ id: { in: [...] } }]` clause, so a caller outside the
 * visibility scope — or in another tenant — gets no row rather
 * than the mock being cooperative.
 *
 * Every row that satisfies `where` is collected before the top-level
 * `orderBy` is applied, because `findFirst` orders the whole match set
 * and then takes one row. Returning the first fixture match instead
 * would ignore `orderBy` outright and answer whichever row happened to
 * be written first, which is the behaviour the route's
 * `orderBy: { name: 'asc' }` is there to prevent.
 */
function selectTimetable(args: QueryArgs): Row | null {
  const where = args.where ?? {}
  const and = where.AND as Array<{ classId?: { in?: string[] } }> | undefined
  const matches = TIMETABLES.filter((candidate) => {
    if (where.tenantId !== undefined && candidate.tenantId !== where.tenantId) {
      return false
    }
    if (typeof where.classId === 'string' && candidate.classId !== where.classId) {
      return false
    }
    if (typeof where.termId === 'string' && candidate.termId !== where.termId) {
      return false
    }
    if (where.class && typeof where.class === 'object') {
      const classRow = CLASSES.find((c) => c.id === candidate.classId)
      if (!classRow) return false
      if (
        (where.class as Row).schoolId !== undefined &&
        classRow.schoolId !== (where.class as Row).schoolId
      ) {
        return false
      }
    }
    if (and) {
      for (const clause of and) {
        // The visibility clause narrows `Timetable.classId`, so it is
        // read as a Timetable predicate. Reading it as `{ id: { in } }`
        // would model a Class-shaped clause — a shape `TimetableWhereInput`
        // rejects, and one that in production compares the timetable's own
        // id against class ids, matching nothing.
        const ids = clause.classId?.in
        if (ids && !ids.includes(candidate.classId as string)) return false
      }
    }
    return true
  })
  const row = sortByOrderBy(matches, args.orderBy)[0]
  if (!row) return null
  return { ...row, entries: orderEntries(args, (row.entries as Row[]) ?? []) }
}

const timetableFindFirst = mock(async (args: QueryArgs): Promise<Row | null> =>
  selectTimetable(args),
)

/** Rows the POST transaction creates, so its re-read finds them. */
let createdTimetables: Row[] = []

const timetableCreate = mock(async (args: QueryArgs): Promise<Row> => {
  const row = { id: 'tt-new', entries: [], ...args.data }
  createdTimetables.push(row)
  return row
})

const timetableEntryCreateMany = mock(async (_args: QueryArgs): Promise<Row> => ({
  count: 0,
}))

const timetableFindUnique = mock(async (args: QueryArgs): Promise<Row | null> => {
  const id = (args.where as Row | undefined)?.id
  return createdTimetables.find((r) => r.id === id) ?? null
})

/** Set by a test to make the transaction fail, e.g. with a P2002. */
let transactionError: unknown = null

const TX_CLIENT = {
  timetable: { create: timetableCreate, findUnique: timetableFindUnique },
  timetableEntry: { createMany: timetableEntryCreateMany },
}

const $transaction = mock(
  async (fn: (tx: typeof TX_CLIENT) => Promise<unknown>): Promise<unknown> => {
    if (transactionError) throw transactionError
    return fn(TX_CLIENT)
  },
)

// ---------------------------------------------------------------------------
// Module-mock lifetime: snapshot before registering, restore after
// ---------------------------------------------------------------------------
// `mock.module` patches the LIVE namespace for the whole process and never reverts, so a
// registration made at module scope is what every file loaded afterwards binds to. All four
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
// both a superset (no caller can fail on a name this file did not list) and a subset
// (`mock.module` merges, so an added key could never be removed by the restore). The
// `@novastar/auth` spread matters most: a factory exporting only `hasPermission` left every
// other export `undefined` for every file that resolved the module afterwards.
mock.module('server-only', () => ({}))

const previousNamespaces = new Map<string, Record<string, unknown>>()
previousNamespaces.set('server-only', { ...(await import('server-only')) })
previousNamespaces.set('@novastar/auth', { ...(await import('@novastar/auth')) })
previousNamespaces.set('@/lib/tenant', { ...(await import('@/lib/tenant')) })
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
    specifier: '@/lib/prisma',
    factory: () => ({
      ...base('@/lib/prisma'),
      prisma: {
        staff: { findFirst: staffFindFirst },
        parent: { findFirst: parentFindFirst },
        class: { findFirst: classFindFirst, findMany: classFindMany },
        term: { findFirst: termFindFirst },
        classSubject: { findMany: classSubjectFindMany },
        timetable: {
          findFirst: timetableFindFirst,
          findUnique: timetableFindUnique,
          create: timetableCreate,
        },
        timetableEntry: { createMany: timetableEntryCreateMany },
        $transaction,
      },
    }),
  },
] as const

// Also registered at load time, so the route import below resolves these specifiers
// through the doubles and the file is correct in a run that never reaches `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

const { GET, POST, validateCreateTimetable } = await import(
  '@/app/portal/api/timetable/route'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timetableRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/timetable${query}`)
}

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/timetable', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A valid create payload; tests override what they need. */
function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    classId: 'class-own',
    termId: 'term-1',
    name: 'Spring',
    entries: [
      {
        classSubjectId: 'cs-own',
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '09:00',
        room: 'Room 4',
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
  session = { ...SESSION }
  sessionError = null
  grants = ['*']
  createdTimetables = []
  transactionError = null

  staffFindFirst.mockReset()
  staffFindFirst.mockImplementation(async () => ({ id: 'staff-teacher' }))
  parentFindFirst.mockReset()
  parentFindFirst.mockImplementation(async () => null)
  classFindMany.mockReset()
  classFindMany.mockImplementation(async () => [{ id: 'class-own' }])
  classSubjectFindMany.mockReset()
  classSubjectFindMany.mockImplementation(async () => [
    { id: 'cs-own', classId: 'class-own' },
  ])
  classFindFirst.mockReset()
  classFindFirst.mockImplementation(async (args: QueryArgs) => {
    const where = args.where ?? {}
    return (
      CLASSES.find(
        (c) =>
          c.id === where.id &&
          c.tenantId === where.tenantId &&
          c.schoolId === where.schoolId,
      ) ?? null
    )
  })
  termFindFirst.mockReset()
  termFindFirst.mockImplementation(async (args: QueryArgs) => {
    const where = args.where ?? {}
    return where.id === 'term-1' && where.tenantId === TENANT_ID
      ? { id: 'term-1' }
      : null
  })
  timetableFindFirst.mockReset()
  timetableFindFirst.mockImplementation(async (args: QueryArgs) => selectTimetable(args))
  timetableCreate.mockReset()
  timetableCreate.mockImplementation(async (args: QueryArgs) => {
    const row = { id: 'tt-new', entries: [], ...args.data }
    createdTimetables.push(row)
    return row
  })
  timetableEntryCreateMany.mockReset()
  timetableEntryCreateMany.mockImplementation(async () => ({ count: 0 }))
  timetableFindUnique.mockReset()
  timetableFindUnique.mockImplementation(async (args: QueryArgs) => {
    const id = (args.where as Row | undefined)?.id
    return createdTimetables.find((r) => r.id === id) ?? null
  })
  $transaction.mockReset()
  $transaction.mockImplementation(
    async (fn: (tx: typeof TX_CLIENT) => Promise<unknown>) => {
      // Same throw as the module-scope double. Resetting without this
      // would leave every P2002 test with a transaction that always
      // succeeds, so the route would answer 201 and the duplicate-write
      // path would go unexercised.
      if (transactionError) throw transactionError
      return fn(TX_CLIENT)
    },
  )
  hasPermission.mockReset()
  hasPermission.mockImplementation(
    async (_userId: string, key: string) =>
      grants.includes('*') || grants.includes(key),
  )
})

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

describe('validateCreateTimetable - entry validation', () => {
  it('accepts a well-formed entry', () => {
    const result = validateCreateTimetable(createPayload())
    expect(result.success).toBe(true)
  })

  it('rejects dayOfWeek outside 1-7', () => {
    for (const dayOfWeek of [0, 8, -1]) {
      const result = validateCreateTimetable(
        createPayload({
          entries: [{ classSubjectId: 'cs-own', dayOfWeek, startTime: '08:00', endTime: '09:00' }],
        }),
      )
      expect(result.success).toBe(false)
    }
  })

  it('rejects a malformed HH:mm start or end time', () => {
    for (const startTime of ['9:00', '24:00', '08:60', '8:00', '0800', '08:00:00']) {
      const result = validateCreateTimetable(
        createPayload({
          entries: [{ classSubjectId: 'cs-own', dayOfWeek: 1, startTime, endTime: '09:00' }],
        }),
      )
      expect(result.success).toBe(false)
    }
    const result = validateCreateTimetable(
      createPayload({
        entries: [{ classSubjectId: 'cs-own', dayOfWeek: 1, startTime: '08:00', endTime: '9:30' }],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects endTime equal to or before startTime', () => {
    const equal = validateCreateTimetable(
      createPayload({
        entries: [{ classSubjectId: 'cs-own', dayOfWeek: 1, startTime: '09:00', endTime: '09:00' }],
      }),
    )
    expect(equal.success).toBe(false)

    const inverted = validateCreateTimetable(
      createPayload({
        entries: [{ classSubjectId: 'cs-own', dayOfWeek: 1, startTime: '10:00', endTime: '09:00' }],
      }),
    )
    expect(inverted.success).toBe(false)
  })

  it('rejects a missing class, term or name', () => {
    expect(validateCreateTimetable(createPayload({ classId: '' })).success).toBe(false)
    expect(validateCreateTimetable(createPayload({ termId: '' })).success).toBe(false)
    expect(validateCreateTimetable(createPayload({ name: '' })).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GET — tenant isolation and visibility
// ---------------------------------------------------------------------------

describe('GET /api/timetable', () => {
  it('returns the matching timetable with its entries ordered by day then start time', async () => {
    const res = await GET(timetableRequest('?classId=class-own&termId=term-1'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Row }
    expect(body.data.id).toBe('tt-own')

    // The fixture stores these as e2, e1, e3. Getting e1, e2, e3 back
    // is the mock's doing and only happens because the handler asked
    // for this ordering — asserted below so a mock that started
    // ignoring `orderBy` could not keep this test green.
    expect((body.data.entries as Row[]).map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])

    const include = (timetableFindFirst.mock.calls[0][0] as QueryArgs).include ?? {}
    expect((include.entries as Row).orderBy).toEqual([
      { dayOfWeek: 'asc' },
      { startTime: 'asc' },
    ])
  })

  it('returns the name-ascending of two same-key timetables, so the answer is deterministic', async () => {
    // Two rows match this class/term pair: `tt-zebra` ("Zebra") and
    // `tt-apple` ("Apple"). The route asks for `orderBy: { name: 'asc' }`
    // precisely because `(tenantId, classId, termId, name)` is unique but
    // `(classId, termId)` is not. The fake honours the requested clause,
    // so "Apple" comes back even though it is written second — a fake that
    // answered the first fixture match would hand back `tt-zebra` here.
    const res = await GET(timetableRequest('?classId=class-shared&termId=term-shared'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Row }
    expect(body.data.id).toBe('tt-apple')
    expect(body.data.name).toBe('Apple')

    // And the clause that made it deterministic is the one the route sent,
    // so this cannot pass on a route that happened to sort for another
    // reason.
    expect((timetableFindFirst.mock.calls[0][0] as QueryArgs).orderBy).toEqual({
      name: 'asc',
    })
  })

  it('joins each entry to its subject and teacher', async () => {
    await GET(timetableRequest('?classId=class-own&termId=term-1'))
    const include = (timetableFindFirst.mock.calls[0][0] as QueryArgs).include ?? {}
    const entries = include.entries as Row
    const classSubject = (entries.include as Row).classSubject as Row
    expect(classSubject.select).toEqual({
      subject: { select: { name: true, code: true } },
      teacher: { select: { firstName: true, lastName: true } },
    })
  })

  it('returns the class and term names so the grid can label itself', async () => {
    await GET(timetableRequest('?classId=class-own&termId=term-1'))
    const include = (timetableFindFirst.mock.calls[0][0] as QueryArgs).include ?? {}
    expect(include.class).toEqual({ select: { id: true, name: true } })
    expect(include.term).toEqual({ select: { id: true, name: true } })
  })

  it('scopes every query by tenantId, so another tenant’s class yields an empty result', async () => {
    // The caller names another tenant's class and term by id. The
    // where clause carries the caller's tenantId, so the lookup
    // matches nothing and the route answers 404 — not the foreign
    // timetable.
    const res = await GET(
      timetableRequest('?classId=class-foreign&termId=term-foreign'),
    )
    expect(res.status).toBe(404)

    const where = (timetableFindFirst.mock.calls[0][0] as QueryArgs).where ?? {}
    expect(where.tenantId).toBe(TENANT_ID)
  })

  it('composes the school scope through the class relation', async () => {
    await GET(timetableRequest('?classId=class-own&termId=term-1'))
    const where = (timetableFindFirst.mock.calls[0][0] as QueryArgs).where ?? {}
    expect(where.class).toEqual({ schoolId: SCHOOL_ID })
  })

  it('narrows a classroom teacher to their own classes’ timetables', async () => {
    session = { ...SESSION, role: 'CLASSROOM_TEACHER' }

    // The teacher's own class: visible through the visibility AND.
    const own = await GET(timetableRequest('?classId=class-own&termId=term-1'))
    expect(own.status).toBe(200)

    const where = (timetableFindFirst.mock.calls[0][0] as QueryArgs).where ?? {}
    const and = where.AND as Array<{ classId?: { in?: string[] } }> | undefined
    expect(and).toBeDefined()
    // Narrowed on `Timetable.classId`, the column the timetable actually
    // hangs off — not on `Timetable.id`, which a Class-shaped clause would
    // have compared against class ids.
    expect(and?.[0].classId?.in).toEqual(['class-own'])

    // A class the teacher does not teach: the visibility predicate
    // cannot be satisfied, so the result is empty (404).
    const other = await GET(timetableRequest('?classId=class-other&termId=term-1'))
    expect(other.status).toBe(404)
  })

  it('refuses a caller with no classes at all rather than returning an empty-looking list', async () => {
    session = { ...SESSION, role: 'CLASSROOM_TEACHER' }
    classFindMany.mockReset()
    classFindMany.mockImplementation(async () => [])
    classSubjectFindMany.mockReset()
    classSubjectFindMany.mockImplementation(async () => [])

    const res = await GET(timetableRequest('?classId=class-own&termId=term-1'))
    // Holds the key but the scope resolves to nothing: 403, so a
    // misconfigured assignment is not mistaken for "no timetable".
    expect(res.status).toBe(403)
  })

  it('refuses a caller whose only timetable key is the write one', async () => {
    // A specific OTHER key from this route's own vocabulary, not an unrelated
    // one. Every other test in this file grants `'*'`, so a grant list of
    // `['attendance:read']` was denied by the read gate whether it asked for
    // `timetable:read`, `timetable:update` or anything else — the exact key was
    // never pinned. Naming the write key is the near miss that matters: it is the
    // one key a scheduler holds without being entitled to read the schedule.
    grants = ['timetable:update']
    const res = await GET(timetableRequest('?classId=class-own&termId=term-1'))
    expect(res.status).toBe(403)
    expect(timetableFindFirst).not.toHaveBeenCalled()
  })

  it('answers a caller holding only timetable:read, so the refusal above is load-bearing', async () => {
    grants = ['timetable:read']
    const res = await GET(timetableRequest('?classId=class-own&termId=term-1'))

    // Exactly the read key, no wildcard: this is the request that fails if the
    // gate asks for any other one.
    expect(res.status).toBe(200)
    expect(timetableFindFirst).toHaveBeenCalledTimes(1)
  })

  it('answers 401 when the session is missing', async () => {
    sessionError = new UnauthorizedError()
    const res = await GET(timetableRequest('?classId=class-own&termId=term-1'))
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// POST — transactional create
// ---------------------------------------------------------------------------

describe('POST /api/timetable', () => {
  it('creates the timetable and its entries in one transaction', async () => {
    const res = await POST(jsonRequest(createPayload()))
    expect(res.status).toBe(201)

    const body = (await res.json()) as { data: Row }
    expect(body.data.id).toBe('tt-new')
    expect(body.data.classId).toBe('class-own')
    expect(body.data.termId).toBe('term-1')
    expect(body.data.name).toBe('Spring')
    expect(body.data.isPublished).toBe(false)

    expect($transaction).toHaveBeenCalledTimes(1)
    expect(timetableCreate).toHaveBeenCalledTimes(1)
    expect(timetableEntryCreateMany).toHaveBeenCalledTimes(1)

    const created = (timetableCreate.mock.calls[0][0] as QueryArgs).data as Row
    expect(created.tenantId).toBe(TENANT_ID)
    expect(created.classId).toBe('class-own')
    expect(created.isPublished).toBe(false)

    const entries = (timetableEntryCreateMany.mock.calls[0][0] as QueryArgs)
      .data as Row[]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      tenantId: TENANT_ID,
      timetableId: 'tt-new',
      classSubjectId: 'cs-own',
      dayOfWeek: 1,
      startTime: '08:00',
      endTime: '09:00',
      room: 'Room 4',
    })
  })

  it('refuses an invalid entry with 400 before any write', async () => {
    const res = await POST(
      jsonRequest(
        createPayload({
          entries: [{ classSubjectId: 'cs-own', dayOfWeek: 8, startTime: '08:00', endTime: '09:00' }],
        }),
      ),
    )
    expect(res.status).toBe(400)
    expect($transaction).not.toHaveBeenCalled()
    expect(timetableCreate).not.toHaveBeenCalled()
  })

  it('refuses an endTime that is not after startTime', async () => {
    const res = await POST(
      jsonRequest(
        createPayload({
          entries: [{ classSubjectId: 'cs-own', dayOfWeek: 1, startTime: '10:00', endTime: '10:00' }],
        }),
      ),
    )
    expect(res.status).toBe(400)
    expect($transaction).not.toHaveBeenCalled()
  })

  it('refuses a class from another tenant with 404', async () => {
    const res = await POST(
      jsonRequest(createPayload({ classId: 'class-foreign' })),
    )
    expect(res.status).toBe(404)
    expect($transaction).not.toHaveBeenCalled()
  })

  it('refuses an entry whose classSubject belongs to another class', async () => {
    classSubjectFindMany.mockReset()
    classSubjectFindMany.mockImplementation(async () => [])
    const res = await POST(
      jsonRequest(
        createPayload({
          entries: [{ classSubjectId: 'cs-elsewhere', dayOfWeek: 1, startTime: '08:00', endTime: '09:00' }],
        }),
      ),
    )
    expect(res.status).toBe(400)
    expect($transaction).not.toHaveBeenCalled()
  })

  it('maps a duplicate timetable or entry (P2002) to 409, not a 500', async () => {
    transactionError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on (tenantId, classId, termId, name)',
      { code: 'P2002', clientVersion: '7.10.0' },
    )
    const res = await POST(jsonRequest(createPayload()))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('A record with these values already exists')
  })

  it('refuses a caller whose only timetable key is the read one', async () => {
    grants = ['timetable:read']
    const res = await POST(jsonRequest(createPayload()))
    expect(res.status).toBe(403)
    expect($transaction).not.toHaveBeenCalled()
  })

  it('accepts a caller holding only timetable:update, so the refusal above is load-bearing', async () => {
    // Without this, the write gate could ask for any key at all and stay green:
    // every other POST here grants `'*'`, and the refusal grants the read key.
    grants = ['timetable:update']
    const res = await POST(jsonRequest(createPayload()))

    expect(res.status).toBe(201)
    expect($transaction).toHaveBeenCalledTimes(1)
  })

  it('answers 401 when the session is missing', async () => {
    sessionError = new UnauthorizedError()
    const res = await POST(jsonRequest(createPayload()))
    expect(res.status).toBe(401)
  })
})
