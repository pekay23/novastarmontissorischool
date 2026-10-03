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

const hasPermission = mock(
  async (_userId: string, key: string): Promise<boolean> => grants.includes(key),
)

mock.module('server-only', () => ({}))
mock.module('@novastar/auth', () => ({ hasPermission }))
mock.module('@/lib/tenant', () => ({
  UnauthorizedError,
  ForbiddenError: class extends Error {},
  getTenantContext,
  getTenantContextOrNull: async () => (sessionError ? null : session),
}))

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

const syllabusFindMany = mock(async (_args: QueryArgs): Promise<Row[]> => [])

/** `logSystemError` writes through this when `toErrorResponse` persists. */
const systemErrorCreate = mock(async (_args: QueryArgs): Promise<Row> => ({ id: 'err-1' }))

mock.module('@/lib/prisma', () => ({
  prisma: {
    syllabus: { create: syllabusCreate, findMany: syllabusFindMany },
    classSubject: { findFirst: classSubjectFindFirst, findMany: mock(async () => []) },
    term: { findFirst: termFindFirst, findMany: mock(async () => []) },
    class: { findMany: mock(async () => []) },
    systemError: { create: systemErrorCreate },
    auditLog: { findFirst: mock(async () => null) },
  },
}))

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
  it('refuses a caller without the academic read key', async () => {
    grants = []
    const res = await GET(getRequest())

    expect(res.status).toBe(403)
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
    syllabusFindMany.mockImplementationOnce(async () => [
      {
        id: 'syl-1',
        title: 'Number bonds to 10',
        topics: ['Counting to five', 'Making ten'],
      },
    ])

    const res = await GET(getRequest())
    const payload = await res.json()

    expect(payload.data[0].topics).toEqual(['Counting to five', 'Making ten'])
  })
})