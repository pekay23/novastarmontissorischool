import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { NextRequest } from 'next/server'

/**
 * `GET`/`POST /api/syllabi`.
 *
 * Follows the `route-authz.test.ts` idiom: `mock.module` the session,
 * permission and Prisma boundaries, then dynamically import the route so it
 * binds to these doubles. Every mocked finder HONOURS the `where` it is
 * given — a double that ignored it would let an unscoped handler answer 200
 * and every isolation assertion below would still pass.
 *
 * `@/lib/api-response` is deliberately NOT mocked. It is global: a mock
 * registered here outlives this file and `system-config-route.test.ts` loads
 * routes that use the real one, so replacing it would quietly weaken another
 * file's error assertions. It runs for real instead, against the mocked
 * Prisma client.
 *
 * Mock ordering: this file registers every boundary it needs before its
 * single dynamic import, so it depends on nothing another file registered and
 * nothing another file can break.
 */

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? 'syllabus-test-secret'

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
const TENANT_ID = 'tenant-school'
const OTHER_TENANT_ID = 'tenant-other'
const SCHOOL_ID = 'school-main'

const CLASS_SUBJECT_ID = 'cs-own'
const TERM_ID = 'term-1'

/** Class subjects the mocked client resolves, keyed by tenant. */
const CLASS_SUBJECTS: Row[] = [
  { id: CLASS_SUBJECT_ID, tenantId: TENANT_ID, schoolId: SCHOOL_ID },
  { id: 'cs-foreign', tenantId: OTHER_TENANT_ID, schoolId: 'school-other' },
]

const TERMS: Row[] = [
  { id: TERM_ID, tenantId: TENANT_ID, schoolId: SCHOOL_ID, name: 'Autumn', isCurrent: true },
  { id: 'term-foreign', tenantId: OTHER_TENANT_ID, schoolId: 'school-other' },
]

interface Session {
  tenantId: string
  schoolId: string | null
  userId: string
  role: string | null
  user: Row
}

let session: Session = {
  tenantId: TENANT_ID,
  schoolId: SCHOOL_ID,
  userId: USER_ID,
  role: 'HEAD_TEACHER',
  user: { id: USER_ID },
}

let sessionError: Error | null = null
let grants: string[] = ['academic:read', 'academic:create']

/**
 * Locally defined, not imported from `@/lib/tenant`: bun's module mock
 * registry is global and outlives a file, so importing the real classes would
 * make this file depend on load order. See `route-authz.test.ts`.
 */
class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

const getTenantContext = mock(async (): Promise<Session> => {
  if (sessionError) throw sessionError
  return session
})

class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

const hasPermission = mock(
  async (_userId: string, key: string): Promise<boolean> => grants.includes(key),
)

// --- Prisma ------------------------------------------------------------------

/**
 * Honours the tenant, and the nested `class: { schoolId }` relation filter the
 * route uses. `ClassSubject` has no `schoolId` column of its own, so a double
 * that only compared top-level fields would return the row for any school and
 * the cross-tenant term case below would be masked by the class subject
 * failing first.
 */
const classSubjectFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  const classFilter = where.class as Row | undefined
  return (
    CLASS_SUBJECTS.find((row) => {
      if (row.id !== where.id) return false
      if (row.tenantId !== where.tenantId) return false
      if (classFilter?.schoolId !== undefined && row.schoolId !== classFilter.schoolId) {
        return false
      }
      return true
    }) ?? null
  )
})

const termFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  return (
    TERMS.find(
      (row) => row.id === where.id && row.tenantId === where.tenantId && row.schoolId === where.schoolId,
    ) ?? null
  )
})

/** Every `where` the POST recorded, so the write's scope can be asserted. */
let createdSyllabi: Row[] = []

/** Set by a test to make the insert raise Prisma's P2002. */
let createError: unknown = null

const syllabusCreate = mock(async (args: QueryArgs): Promise<Row> => {
  if (createError) throw createError
  const row = { id: 'syl-new', ...args.data }
  createdSyllabi.push(row)
  return row
})

/**
 * The stored syllabi the list read resolves, before the projection is applied.
 * A test sets this; the double below decides what the handler actually gets back.
 */
let syllabusRows: Row[] = []

/**
 * Apply the projection the handler asked for, the way Prisma would.
 *
 * A `select` REPLACES the column list: every column the handler did not name is
 * absent from the row it returns. That is the whole reason this exists — without
 * it the double hands back the fixture whatever the handler asked for, so a route
 * that narrowed its read to `select: { id: true, title: true }` would still
 * return `topics`, `body` and `status`, and every assertion about what the list
 * response contains would pass against a query that in production returns none
 * of them.
 *
 * The relation `include` is left alone: a fixture row that already carries its
 * `classSubject` and `term` stands in for a joined result, and what the handler
 * asked for there is asserted on the arguments directly.
 */
function projectRow(row: Row, args: QueryArgs): Row {
  const select = args.select
  if (!select) return { ...row }
  const projected: Row = {}
  for (const [column, wanted] of Object.entries(select)) {
    if (wanted === true && column in row) projected[column] = row[column]
  }
  return projected
}

const syllabusFindMany = mock(async (args: QueryArgs): Promise<Row[]> =>
  syllabusRows.map((row) => projectRow(row, args)),
)

/** `logSystemError` writes through this when `toErrorResponse` persists. */
const systemErrorCreate = mock(async (_args: QueryArgs): Promise<Row> => ({ id: 'err-1' }))

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
// both a superset and a subset — which is what makes the restore complete, since
// `mock.module` merges and an added key could never be removed again. The `@/lib/tenant`
// spread is what makes this file work in ISOLATION: the real module also exports
// `TenantSuspendedError`, which `@/lib/api-response` imports, and a factory listing only
// four names left it absent for every import resolved after this one — which is why this
// file used to pass only when some earlier file had happened to load the real module.
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
        syllabus: { create: syllabusCreate, findMany: syllabusFindMany },
        classSubject: { findFirst: classSubjectFindFirst, findMany: mock(async () => []) },
        term: { findFirst: termFindFirst, findMany: mock(async () => []) },
        class: { findMany: mock(async () => []) },
        systemError: { create: systemErrorCreate },
        auditLog: { findFirst: mock(async () => null) },
      },
    }),
  },
] as const

// Also registered at load time, so the route import below resolves these specifiers
// through the doubles and the file is correct in a run that never reaches `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

const { GET, POST } = await import('@/app/api/syllabi/route')

// --- Helpers -----------------------------------------------------------------

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/syllabi', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as unknown as NextRequest
}

function getRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/syllabi${query}`) as unknown as NextRequest
}

const validBody = {
  classSubjectId: CLASS_SUBJECT_ID,
  termId: TERM_ID,
  title: 'Number bonds to 10',
  topics: ['Counting to five', 'Making ten'],
}

/** Prisma's duplicate-key error, as the driver raises it. */
function p2002(): Error {
  const error = new Error('Unique constraint failed')
  error.name = 'PrismaClientKnownRequestError'
  ;(error as unknown as { code: string }).code = 'P2002'
  return error
}

beforeEach(() => {
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
  session = {
    tenantId: TENANT_ID,
    schoolId: SCHOOL_ID,
    userId: USER_ID,
    role: 'HEAD_TEACHER',
    user: { id: USER_ID },
  }
  sessionError = null
  grants = ['academic:read', 'academic:create']
  createdSyllabi = []
  createError = null
  syllabusRows = []
})

// --- Tests -------------------------------------------------------------------

describe('POST /api/syllabi - validation', () => {
  it('creates a syllabus and scopes the write to the caller tenant', async () => {
    const res = await POST(postRequest(validBody))

    expect(res.status).toBe(201)
    expect(createdSyllabi).toHaveLength(1)
    expect(createdSyllabi[0]).toMatchObject({
      tenantId: TENANT_ID,
      schoolId: SCHOOL_ID,
      classSubjectId: CLASS_SUBJECT_ID,
      termId: TERM_ID,
      title: 'Number bonds to 10',
    })
    expect(await res.json()).toMatchObject({ data: { id: 'syl-new' } })
  })

  it('rejects an empty title', async () => {
    const res = await POST(postRequest({ ...validBody, title: '' }))

    expect(res.status).toBe(400)
    expect(createdSyllabi).toHaveLength(0)
  })

  it('rejects a whitespace-only title, which would otherwise store a blank row', async () => {
    const res = await POST(postRequest({ ...validBody, title: '   ' }))

    expect(res.status).toBe(400)
    expect(createdSyllabi).toHaveLength(0)
  })

  it('rejects an empty topics array', async () => {
    const res = await POST(postRequest({ ...validBody, topics: [] }))

    expect(res.status).toBe(400)
    expect(createdSyllabi).toHaveLength(0)
  })

  it('rejects a topics array whose entries are empty strings', async () => {
    // The generic `POST /api/config/syllabus` schema accepts this, because
    // `SyllabusSchema` only types the column. A syllabus with no topics is
    // not a syllabus, so this route is stricter.
    const res = await POST(postRequest({ ...validBody, topics: ['Counting', '   '] }))

    expect(res.status).toBe(400)
    expect(createdSyllabi).toHaveLength(0)
  })

  it('trims topics before storing them', async () => {
    await POST(postRequest({ ...validBody, topics: ['  Counting  ', 'Patterns'] }))

    expect(createdSyllabi[0].topics).toEqual(['Counting', 'Patterns'])
  })

  it('stores a new syllabus as DRAFT when the body says nothing about status', async () => {
    // `validBody` carries no `status`, so this is the create form's own payload.
    // The default is what an unpublished draft looks like on the list page, and
    // a default flipped to PUBLISHED would publish every syllabus the moment it
    // was written, with nothing in a test noticing.
    await POST(postRequest(validBody))

    expect(createdSyllabi[0].status).toBe('DRAFT')
  })

  it('stores the status the body names rather than the default', async () => {
    await POST(postRequest({ ...validBody, status: 'PUBLISHED' }))

    expect(createdSyllabi[0].status).toBe('PUBLISHED')
  })

  it('rejects a status outside the enum instead of storing it', async () => {
    const res = await POST(postRequest({ ...validBody, status: 'published' }))

    // Lower-case is the spelling a hand-written client reaches for; the column
    // stores the enum, so accepting it would store a value the list page cannot
    // map to a badge.
    expect(res.status).toBe(400)
    expect(createdSyllabi).toHaveLength(0)
  })

  it('reports a duplicate title as 409, not as a server fault', async () => {
    // The `@@unique([tenantId, classSubjectId, termId, title])` constraint is
    // an expected client outcome. It must be checked before the generic error
    // response, which would log it as an outage and file it on the
    // platform-errors page.
    createError = p2002()
    const res = await POST(postRequest(validBody))

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('already exists')
  })

  it('rejects a class subject from another tenant without writing', async () => {
    const res = await POST(postRequest({ ...validBody, classSubjectId: 'cs-foreign' }))

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Class subject not found')
    expect(createdSyllabi).toHaveLength(0)
  })

  it('rejects a term from another tenant without writing', async () => {
    const res = await POST(postRequest({ ...validBody, termId: 'term-foreign' }))

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Term not found')
    expect(createdSyllabi).toHaveLength(0)
  })
})

describe('POST /api/syllabi - authorization', () => {
  it('refuses a caller without the academic create key', async () => {
    grants = ['academic:read']
    const res = await POST(postRequest(validBody))

    expect(res.status).toBe(403)
    expect(createdSyllabi).toHaveLength(0)
  })

  it('answers an unauthenticated caller with 401 rather than 500', async () => {
    sessionError = new UnauthorizedError()
    const res = await POST(postRequest(validBody))

    expect(res.status).toBe(401)
    expect(createdSyllabi).toHaveLength(0)
  })

  it('refuses a caller with no school assigned', async () => {
    session = { ...session, schoolId: null }
    const res = await POST(postRequest(validBody))

    expect(res.status).toBe(400)
    expect(createdSyllabi).toHaveLength(0)
  })
})

describe('GET /api/syllabi', () => {
  it('refuses a caller whose only academic key is the create one', async () => {
    // A specific OTHER key, not an empty grant list. `grants = []` would deny
    // every key the route could possibly ask about, so the test would still pass
    // if the read were gated on `academic:create`, `attendance:read`, or a key
    // nobody has heard of. Granting the one real near-miss pins the exact key.
    grants = ['academic:create']
    const res = await GET(getRequest())

    expect(res.status).toBe(403)
  })

  it('answers a caller holding only the academic read key, so the refusal above is load-bearing', async () => {
    grants = ['academic:read']
    const res = await GET(getRequest())

    expect(res.status).toBe(200)
  })

  it('answers an unauthenticated caller with 401', async () => {
    sessionError = new UnauthorizedError()
    const res = await GET(getRequest())

    expect(res.status).toBe(401)
  })

  it('narrows by classSubjectId and termId and orders by title', async () => {
    // The arguments the handler sent, captured by the where-honouring double.
    let seen: QueryArgs | null = null
    syllabusFindMany.mockImplementationOnce(async (args: QueryArgs) => {
      seen = args
      return []
    })

    const res = await GET(getRequest(`?classSubjectId=${CLASS_SUBJECT_ID}&termId=${TERM_ID}`))

    expect(res.status).toBe(200)
    expect(seen!.where).toMatchObject({
      tenantId: TENANT_ID,
      classSubjectId: CLASS_SUBJECT_ID,
      termId: TERM_ID,
    })
    expect(seen!.orderBy).toEqual({ title: 'asc' })
  })

  it('scopes to the caller tenant and never to a sibling school', async () => {
    let seen: QueryArgs | null = null
    syllabusFindMany.mockImplementationOnce(async (args: QueryArgs) => {
      seen = args
      return []
    })

    await GET(getRequest())

    // `Syllabus.schoolId` is nullable, so this is an explicit OR rather than
    // an equality: rows from another school in the same tenant must not come
    // back, and rows that never recorded a school still should.
    expect(seen!.where).toMatchObject({
      tenantId: TENANT_ID,
      OR: [{ schoolId: SCHOOL_ID }, { schoolId: null }],
    })
  })

  it('returns the topics with the list', async () => {
    // Served through the projection-honouring double, so this is a statement
    // about the columns the handler asked for. With the fixture's own topics
    // returned regardless of the query, the assertion held even for a handler
    // that narrowed its read and got no `topics` column at all.
    syllabusRows = [
      {
        id: 'syl-1',
        title: 'Number bonds to 10',
        topics: ['Counting to five', 'Making ten'],
      },
    ]

    const res = await GET(getRequest())
    const payload = await res.json()

    expect(payload.data[0].topics).toEqual(['Counting to five', 'Making ten'])
  })

  it('asks for the class, subject and term names the list renders, in one query', async () => {
    let seen: QueryArgs | null = null
    syllabusFindMany.mockImplementationOnce(async (args: QueryArgs) => {
      seen = args
      return []
    })

    await GET(getRequest())

    // The row has to arrive with its relations or the table renders nothing for
    // every row but the title: the list is one call, with no client-side resolve
    // of the class subject ids behind it.
    expect(seen!.include).toEqual({
      classSubject: {
        include: {
          class: { select: { id: true, name: true } },
          subject: { select: { id: true, name: true, code: true } },
        },
      },
      term: { select: { id: true, name: true, academicYear: { select: { name: true } } } },
    })
    // Not narrowed with `select` at the same time: Prisma rejects the two
    // together, so a route that added one would 500 in production.
    expect(seen!.select).toBeUndefined()
  })
})