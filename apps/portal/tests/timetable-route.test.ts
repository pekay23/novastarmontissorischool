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
    // Deliberately stored out of order. `selectTimetable` applies the
    // `orderBy` the handler asked for, so the expected sequence below
    // is only reachable by a handler that actually asked.
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
  const requested = (args.include?.entries as Row | undefined)?.orderBy
  const clauses: Row[] = Array.isArray(requested)
    ? requested
    : requested
      ? [requested]
      : []
  return [...entries].sort((a, b) => {
    for (const clause of clauses) {
      for (const key of Object.keys(clause)) {
        const cmp = compareValues(a[key], b[key])
        if (cmp !== 0) return cmp
      }
    }
    return 0
  })
}

/**
 * The timetable lookup. Honours `tenantId`, `classId`, `termId`,
 * the `class: { schoolId }` relation filter and the visibility
 * `AND: [{ id: { in: [...] } }]` clause, so a caller outside the
 * visibility scope — or in another tenant — gets no row rather
 * than the mock being cooperative.
 */
function selectTimetable(args: QueryArgs): Row | null {
  const where = args.where ?? {}
  const and = where.AND as Array<{ classId?: { in?: string[] } }> | undefined
  const row = TIMETABLES.find((candidate) => {
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

mock.module('@/lib/prisma', () => ({
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
}))

const { GET, POST, validateCreateTimetable } = await import(
  '@/app/api/timetable/route'
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

  it('refuses a caller without the timetable:read key', async () => {
    grants = ['attendance:read']
    const res = await GET(timetableRequest('?classId=class-own&termId=term-1'))
    expect(res.status).toBe(403)
    expect(timetableFindFirst).not.toHaveBeenCalled()
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

  it('refuses a caller without the timetable:update key', async () => {
    grants = ['timetable:read']
    const res = await POST(jsonRequest(createPayload()))
    expect(res.status).toBe(403)
    expect($transaction).not.toHaveBeenCalled()
  })

  it('answers 401 when the session is missing', async () => {
    sessionError = new UnauthorizedError()
    const res = await POST(jsonRequest(createPayload()))
    expect(res.status).toBe(401)
  })
})
