import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test'
import { NextRequest } from 'next/server'

/**
 * Behavioural cover for the route-level authorization work.
 *
 * `tests/middleware.test.ts` pins the wiring: that a handler mentions
 * `hasPermission`, `resolveVisibility` and the right permission key. That kind
 * of assertion passes just as happily against a gate that is present but never
 * reached, so everything load-bearing lives here instead.
 *
 * The critical property under test is that `hasPermission` and
 * `resolveVisibility` are *different* questions. `PARENT` holds
 * `student:read`, so a route gated on that key alone returns the whole school
 * roster to every parent. `@/lib/visibility` is therefore deliberately NOT
 * mocked here — it runs for real against the mocked Prisma client, so the
 * `where` clauses asserted below are the ones production would send.
 */

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? 'route-authz-test-secret'

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
  orderBy?: Row
}

const PARENT_ID = 'parent-session'
const USER_ID = 'user-session'
const TENANT_ID = 'tenant-session'
const SCHOOL_ID = 'school-session'
const VICTIM_ID = 'user-victim'

/** The school roster the mocked client filters, so `where` really is honoured. */
const ROSTER: Row[] = [
  { id: 'stu-own', studentId: 'S001', firstName: 'Ada', lastName: 'Own', parentId: PARENT_ID },
  { id: 'stu-other', studentId: 'S002', firstName: 'Brah', lastName: 'Other', parentId: 'parent-other' },
]

/** Every column `User` carries, secrets included. See `userFindFirst`. */
const USER_ROW: Row = {
  id: USER_ID,
  tenantId: TENANT_ID,
  schoolId: SCHOOL_ID,
  email: 'session@example.test',
  emailVerified: null,
  passwordHash: 'argon2-hash',
  name: 'Session User',
  image: null,
  roleId: 'role-parent',
  isActive: true,
  status: 'ACTIVE',
  twoFactorEnabled: true,
  twoFactorSecret: 'salt:iv:tag:cipher',
  passkeyBridgeToken: 'pk_deadbeef',
  passkeyBridgeExpires: new Date(Date.now() + 60_000),
  verifyToken: 'verify-hash',
  verifyTokenExpires: new Date(Date.now() + 60_000),
  mustChangePassword: false,
  settings: { lastTotpCounter: 12345 },
  role: { name: 'PARENT' },
}

/** Parent record the caller's `User` row links to, or `null` for a broken link. */
let callerParentId: string | null = PARENT_ID

// --- Prisma -----------------------------------------------------------------

const studentFindMany = mock(async (_args: QueryArgs): Promise<Row[]> => [])
const studentFindFirst = mock(async (_args: QueryArgs): Promise<Row | null> => null)

const staffFindMany = mock(async (_args: QueryArgs): Promise<Row[]> => [])
const staffFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  if (where.userId === USER_ID) return { id: 'staff-session' }
  return null
})
const classFindMany = mock(async (_args: QueryArgs): Promise<Row[]> => [])
const classSubjectFindMany = mock(async (_args: QueryArgs): Promise<Row[]> => [])
const parentFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  if (where.userId === USER_ID && callerParentId) return { id: callerParentId }
  return null
})

const userFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  if (where.id !== USER_ID) return null
  if (where.tenantId !== undefined && where.tenantId !== TENANT_ID) return null
  // Deliberately every column, including the four secrets. A real Prisma client
  // honours `select`; this one does not, so the only thing standing between the
  // browser and `twoFactorSecret` is the route building its response from an
  // explicit allow-list. That makes the leak assertion in the session describe
  // real behaviour rather than the mock's cooperation.
  return { ...USER_ROW }
})
const userUpdate = mock(async (_args: QueryArgs): Promise<Row> => ({}))

/** The registration challenge `register-verify` will consume, when one exists. */
let storedChallenge: Row | null = null
const challengeFindUnique = mock(async (_args: QueryArgs): Promise<Row | null> => storedChallenge)
const challengeDelete = mock(async (_args: QueryArgs): Promise<Row> => ({}))
const passkeyCreate = mock(async (_args: QueryArgs): Promise<Row> => ({ id: 'pk-new' }))

const TX_CLIENT = {
  passkeyChallenge: { findUnique: challengeFindUnique, delete: challengeDelete },
  passkey: { create: passkeyCreate },
  user: { findFirst: userFindFirst, update: userUpdate },
}
const $transaction = mock(
  async (fn: (tx: typeof TX_CLIENT) => Promise<unknown>): Promise<unknown> => fn(TX_CLIENT),
)

mock.module('server-only', () => ({}))
mock.module('@/lib/prisma', () => ({
  prisma: {
    student: { findMany: studentFindMany, findFirst: studentFindFirst },
    staff: { findMany: staffFindMany, findFirst: staffFindFirst },
    class: { findMany: classFindMany },
    classSubject: { findMany: classSubjectFindMany },
    parent: { findFirst: parentFindFirst },
    user: { findFirst: userFindFirst, update: userUpdate },
    passkey: { create: passkeyCreate },
    passkeyChallenge: {
      findUnique: challengeFindUnique,
      delete: challengeDelete,
      deleteMany: mock(async (_args: QueryArgs): Promise<Row> => ({})),
    },
    $transaction,
  },
}))

// --- Session and permission -------------------------------------------------

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
  role: 'PARENT',
  user: { id: USER_ID },
}

let session: Session | Error = SESSION
/** Permission keys the caller holds. A `*` grants everything. */
let grants: string[] = ['student:read']

const hasPermission = mock(
  async (_userId: string, key: string): Promise<boolean> =>
    grants.includes('*') || grants.includes(key),
)

mock.module('@novastar/auth', () => ({ hasPermission }))

/**
 * Locally defined rather than imported from `@/lib/tenant`.
 *
 * Bun's `mock.module` registry is global and outlives a test file, so by the
 * time this file loads `@/lib/tenant` may already be another test's mock. Every
 * handler identifies these errors by `error.name`, never by `instanceof`, so a
 * local class with the right name is behaviourally identical — and it means this
 * file does not depend on load order.
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

const getTenantContext = mock(async () => {
  if (session instanceof Error) throw session
  return session
})

mock.module('@/lib/tenant', () => ({
  UnauthorizedError,
  ForbiddenError,
  getTenantContext,
  getTenantContextOrNull: async () => (session instanceof Error ? null : session),
}))

const getCachedSessionAndTenant = mock(async () => {
  if (session instanceof Error) throw session
  const { tenantId, schoolId, userId, role } = session
  return {
    userId,
    tenantId,
    schoolId,
    role,
    roleName: role,
    user: session.user,
    claimedTenantId: tenantId,
  }
})

mock.module('@/lib/auth/session-context', () => ({
  getCachedSessionAndTenant,
  getTokenTenantId: async () => (session instanceof Error ? null : TENANT_ID),
}))

// The audit logger is only reached on a passkey login, which this file does not
// exercise; stubbed so its own imports never load.
mock.module('@/lib/audit/logger', () => ({
  AuditLogAction: { PASSKEY_LOGIN: 'PASSKEY_LOGIN' },
  createAuditLog: mock(async () => null),
  logAuditEvent: mock(async () => null),
}))

const { GET: studentsGET } = await import('@/app/api/students/route')
const { GET: studentGET } = await import('@/app/api/students/[id]/route')
const { GET: teachersGET } = await import('@/app/api/teachers/route')
const { POST: totpPOST } = await import('@/app/api/auth/totp/route')
const { POST: registerVerifyPOST } = await import(
  '@/app/api/auth/passkey/register-verify/route'
)
const { GET: sessionGET } = await import('@/app/api/session/route')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function studentsRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/students${query}`)
}

function studentRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/students/${id}`)
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Every database call this file can observe, so a refusal can be shown to be total. */
function dbCalls(): number {
  return (
    studentFindMany.mock.calls.length +
    studentFindFirst.mock.calls.length +
    staffFindMany.mock.calls.length +
    staffFindFirst.mock.calls.length +
    classFindMany.mock.calls.length +
    classSubjectFindMany.mock.calls.length +
    parentFindFirst.mock.calls.length +
    userFindFirst.mock.calls.length +
    userUpdate.mock.calls.length +
    passkeyCreate.mock.calls.length +
    $transaction.mock.calls.length
  )
}

/** The `where` the students list handed to Prisma. */
function studentListWhere(): Row {
  expect(studentFindMany).toHaveBeenCalledTimes(1)
  return (studentFindMany.mock.calls[0][0] as QueryArgs).where ?? {}
}

beforeEach(() => {
  session = { ...SESSION }
  grants = ['student:read']
  callerParentId = PARENT_ID
  storedChallenge = null

  studentFindMany.mockReset()
  studentFindMany.mockImplementation(async (args: QueryArgs) => filterRoster(args))

  studentFindFirst.mockReset()
  studentFindFirst.mockImplementation(studentFindFirstBody)

  staffFindMany.mockReset()
  staffFindMany.mockImplementation(async () => [])
  staffFindFirst.mockReset()
  staffFindFirst.mockImplementation(async (args: QueryArgs) =>
    (args.where ?? {}).userId === USER_ID ? { id: 'staff-session' } : null,
  )
  classFindMany.mockReset()
  classFindMany.mockImplementation(async () => [])
  classSubjectFindMany.mockReset()
  classSubjectFindMany.mockImplementation(async () => [])
  parentFindFirst.mockReset()
  parentFindFirst.mockImplementation(async (args: QueryArgs) =>
    (args.where ?? {}).userId === USER_ID && callerParentId ? { id: callerParentId } : null,
  )
  userFindFirst.mockReset()
  userFindFirst.mockImplementation(async (args: QueryArgs) =>
    (args.where ?? {}).id === USER_ID ? { ...USER_ROW } : null,
  )
  userUpdate.mockReset()
  userUpdate.mockImplementation(async () => ({}))
  challengeFindUnique.mockReset()
  challengeFindUnique.mockImplementation(async () => storedChallenge)
  challengeDelete.mockReset()
  challengeDelete.mockImplementation(async () => ({}))
  passkeyCreate.mockReset()
  passkeyCreate.mockImplementation(async () => ({ id: 'pk-new' }))
  $transaction.mockReset()
  $transaction.mockImplementation(async (fn: (tx: typeof TX_CLIENT) => Promise<unknown>) =>
    fn(TX_CLIENT),
  )
})

/**
 * The roster, filtered the way a real client would honour the `where` it was
 * given.
 *
 * A mock that ignored `where` would let an unfiltered handler answer 200 with
 * the whole roster and every "only their own children" assertion here would
 * still pass, because the mock — not the handler — would be doing the
 * narrowing.
 */
async function filterRoster(args: QueryArgs): Promise<Row[]> {
  const where = args.where ?? {}
  return ROSTER.filter((row) => {
    if (typeof where.parentId === 'string' && row.parentId !== where.parentId) return false
    if (typeof where.id === 'string' && row.id !== where.id) return false
    return true
  }).map((row) => ({ ...row }))
}

/** The `where`-honouring `student.findFirst` implementation, shared with `beforeEach`. */
async function studentFindFirstBody(args: QueryArgs): Promise<Row | null> {
  const matches = await filterRoster(args)
  return matches[0] ?? null
}

// ---------------------------------------------------------------------------
// GET /api/students — permission narrows by role, visibility narrows by row
// ---------------------------------------------------------------------------

describe('GET /api/students - a parent sees only their own children', () => {
  it('should carry the parent filter in the where clause, so Prisma cannot return the roster', async () => {
    session = { ...SESSION, role: 'PARENT' }

    await studentsGET(studentsRequest())

    // THE regression. Gating on `student:read` alone passes this test's caller
    // (PARENT holds the key) and still returns every student in the school.
    expect(studentListWhere().parentId).toBe(PARENT_ID)
  })

  it('should scope by tenant and school as well as by parent', async () => {
    await studentsGET(studentsRequest())

    const where = studentListWhere()
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.schoolId).toBe(SCHOOL_ID)
  })

  it('should return exactly the rows the filter selected', async () => {
    const res = await studentsGET(studentsRequest())

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Row[] }
    // The mocked client honours `where.parentId`, so an unfiltered handler comes
    // back with both rows and this length assertion fails.
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.id).toBe('stu-own')
  })

  it('should intersect a classId filter with the parent filter rather than replace it', async () => {
    await studentsGET(studentsRequest('?classId=class-1'))

    const where = studentListWhere()
    expect(where.parentId).toBe(PARENT_ID)
    expect(where.classId).toBe('class-1')
  })
})

describe('GET /api/students - a headmaster sees the whole school', () => {
  it('should send no parent filter for an unrestricted role', async () => {
    // THE counterpart to the test above. If the filter were applied
    // unconditionally this would be a parent-shaped query for everyone.
    session = { ...SESSION, role: 'HEADMASTER' }

    const res = await studentsGET(studentsRequest())

    expect(res.status).toBe(200)
    const where = studentListWhere()
    expect(where.parentId).toBeUndefined()
    expect(where.enrollments).toBeUndefined()
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.schoolId).toBe(SCHOOL_ID)
    const body = (await res.json()) as { data: Row[] }
    expect(body.data).toHaveLength(2)
  })
})

describe('GET /api/students - the permission gate refuses before any query', () => {
  it('should answer 403 for a role without student:read and never read a row', async () => {
    grants = ['term:read']

    const res = await studentsGET(studentsRequest())

    expect(res.status).toBe(403)
    // A denial that reached the database would still have described the caller's
    // reach in the response timing and in any audit of the attempt.
    expect(dbCalls()).toBe(0)
  })

  it('should answer 401 with no session, and never read a row', async () => {
    session = new UnauthorizedError()

    const res = await studentsGET(studentsRequest())

    expect(res.status).toBe(401)
    expect(dbCalls()).toBe(0)
  })

  it('should answer 400 when the session has no school, before any query', async () => {
    session = { ...SESSION, schoolId: null }

    const res = await studentsGET(studentsRequest())

    expect(res.status).toBe(400)
    expect(dbCalls()).toBe(0)
  })

  it('should answer 403 for a parent whose Parent record is missing, not an empty list', async () => {
    // `visibilityDeniesAll` exists for exactly this: a broken identity link must
    // not be indistinguishable from "you have no children".
    callerParentId = null

    const res = await studentsGET(studentsRequest())

    expect(res.status).toBe(403)
    expect(studentFindMany).toHaveBeenCalledTimes(0)
  })

  it('should let a parent holding student:read through, so the 403 above is not vacuous', async () => {
    grants = ['student:read']

    const res = await studentsGET(studentsRequest())

    expect(res.status).toBe(200)
    expect(studentFindMany).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// GET /api/students/[id] — out of scope is 404, not 403
// ---------------------------------------------------------------------------

describe('GET /api/students/[id] - an out-of-scope record is indistinguishable from a missing one', () => {
  it('should answer 404 for a student outside the caller\'s scope', async () => {
    session = { ...SESSION, role: 'PARENT' }

    const res = await studentGET(studentRequest('stu-other'), {
      params: Promise.resolve({ id: 'stu-other' }),
    })

    // 403 here would confirm that `stu-other` resolves to a real student.
    expect(res.status).toBe(404)
  })

  it('should answer 200 for the caller\'s own child, so the 404 above is not vacuous', async () => {
    const res = await studentGET(studentRequest('stu-own'), {
      params: Promise.resolve({ id: 'stu-own' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Row
    expect(body.id).toBe('stu-own')
  })

  it('should fold the visibility filter into the lookup, not check it afterwards', async () => {
    await studentGET(studentRequest('stu-other'), {
      params: Promise.resolve({ id: 'stu-other' }),
    })

    expect(studentFindFirst).toHaveBeenCalledTimes(1)
    const where = (studentFindFirst.mock.calls[0][0] as QueryArgs).where ?? {}
    expect(where.parentId).toBe(PARENT_ID)
    expect(where.id).toBe('stu-other')
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.schoolId).toBe(SCHOOL_ID)
  })

  it('should answer 404, not 403, for a record that does not exist at all', async () => {
    const res = await studentGET(studentRequest('stu-missing'), {
      params: Promise.resolve({ id: 'stu-missing' }),
    })

    expect(res.status).toBe(404)
  })

  it('should answer 403 before the lookup for a role without student:read', async () => {
    grants = []

    const res = await studentGET(studentRequest('stu-own'), {
      params: Promise.resolve({ id: 'stu-own' }),
    })

    expect(res.status).toBe(403)
    expect(studentFindFirst).toHaveBeenCalledTimes(0)
  })
})

// ---------------------------------------------------------------------------
// GET /api/teachers — the staff directory narrows for a classroom teacher
// ---------------------------------------------------------------------------

/** A class this teacher owns, and the colleague who co-teaches it. */
const CLASS_ROW: Row = {
  classTeacherId: 'staff-session',
  subjects: [{ teacherId: 'staff-colleague' }],
}

describe('GET /api/teachers - narrowed to the caller and their own colleagues', () => {
  it('should send a staff restriction for a classroom teacher', async () => {
    // `ROLE_READ_SCOPE.CLASSROOM_TEACHER['teacher:read'] = 'class'`, so
    // `resolveVisibility` returns a `class` scope and `staffVisibilityWhere`
    // narrows the directory. Before that entry existed nothing resolved to
    // `class` for this key, the builder was unreachable, and the handler sent
    // the whole directory — every employee's phone and email — to any teacher.
    session = { ...SESSION, role: 'CLASSROOM_TEACHER' }
    grants = ['teacher:read']
    // `resolveVisibility` asks for the caller's classes with `select: {id}`;
    // `staffVisibilityWhere` then asks for the same classes with a richer
    // `select`. One mock has to answer both.
    classFindMany.mockImplementation(async (args: QueryArgs) =>
      args.select ? [CLASS_ROW] : [{ id: 'class-1' }],
    )

    await teachersGET(new NextRequest('http://localhost/api/teachers'))

    expect(staffFindMany).toHaveBeenCalledTimes(1)
    const where = (staffFindMany.mock.calls[0][0] as QueryArgs).where ?? {}
    // Themselves plus the colleague who teaches the class they own — not the
    // rest of the staff directory.
    expect(where.id).toEqual({ in: ['staff-session', 'staff-colleague'] })
    // Tenant and school scope is layered on top of the visibility filter.
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.schoolId).toBe(SCHOOL_ID)
  })

  it('should answer 403, not the directory, for a teacher assigned to no class', async () => {
    // Fail closed. An empty `classIds` means "no classes", and must not be read
    // as "no restriction".
    session = { ...SESSION, role: 'CLASSROOM_TEACHER' }
    grants = ['teacher:read']

    const res = await teachersGET(new NextRequest('http://localhost/api/teachers'))

    expect(res.status).toBe(403)
    expect(staffFindMany).toHaveBeenCalledTimes(0)
  })

  it('should send no staff restriction for an unrestricted role', async () => {
    session = { ...SESSION, role: 'HEADMASTER' }
    grants = ['teacher:read']

    await teachersGET(new NextRequest('http://localhost/api/teachers'))

    const where = (staffFindMany.mock.calls[0][0] as QueryArgs).where ?? {}
    expect(where.id).toBeUndefined()
  })

  it('should answer 403 without a query for a role without teacher:read', async () => {
    grants = ['student:read']

    const res = await teachersGET(new NextRequest('http://localhost/api/teachers'))

    expect(res.status).toBe(403)
    expect(staffFindMany).toHaveBeenCalledTimes(0)
  })

  it('should answer 401 with no session and without reading the directory', async () => {
    session = new UnauthorizedError()

    const res = await teachersGET(new NextRequest('http://localhost/api/teachers'))

    expect(res.status).toBe(401)
    expect(staffFindMany).toHaveBeenCalledTimes(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/totp — the subject comes from the session, not the body
// ---------------------------------------------------------------------------

describe('POST /api/auth/totp - enrolment applies to the caller', () => {
  it('should ignore a userId in the body and update the session user', async () => {
    const res = await totpPOST(
      jsonRequest('/api/auth/totp', { userId: VICTIM_ID }),
    )

    expect(res.status).toBe(200)
    expect(userUpdate).toHaveBeenCalledTimes(1)
    const args = userUpdate.mock.calls[0][0] as QueryArgs
    // THE defect: `where: { id: userId }` with `userId` read from the body let an
    // unauthenticated caller overwrite any account's second factor.
    expect((args.where as Row).id).toBe(USER_ID)
    expect(JSON.stringify(args)).not.toContain(VICTIM_ID)
  })

  it('should read the enrolment subject scoped to the session tenant', async () => {
    await totpPOST(jsonRequest('/api/auth/totp', { userId: VICTIM_ID }))

    expect(userFindFirst).toHaveBeenCalledTimes(1)
    const where = (userFindFirst.mock.calls[0][0] as QueryArgs).where ?? {}
    expect(where).toEqual({ id: USER_ID, tenantId: TENANT_ID })
  })

  it('should refuse to start enrolment without a session, writing nothing', async () => {
    session = new UnauthorizedError()

    const res = await totpPOST(jsonRequest('/api/auth/totp', { userId: USER_ID }))

    expect(res.status).toBe(401)
    expect(userUpdate).toHaveBeenCalledTimes(0)
    expect(userFindFirst).toHaveBeenCalledTimes(0)
  })

  it('should keep two-factor disabled until verification, so enrolment alone does not arm it', async () => {
    await totpPOST(jsonRequest('/api/auth/totp', {}))

    const data = (userUpdate.mock.calls[0][0] as QueryArgs).data ?? {}
    expect(data.twoFactorEnabled).toBe(false)
    expect(typeof data.twoFactorSecret).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/passkey/register-verify — no session, no enrolment
// ---------------------------------------------------------------------------

describe('POST /api/auth/passkey/register-verify - registration requires a session', () => {
  it('should answer 401 when unauthenticated and never create a passkey', async () => {
    session = new UnauthorizedError()
    storedChallenge = {
      id: 'challenge-1',
      userId: VICTIM_ID,
      challenge: 'c',
      type: 'registration',
      expiresAt: new Date(Date.now() + 60_000),
    }

    const res = await registerVerifyPOST(
      jsonRequest('/api/auth/passkey/register-verify', {
        credential: { id: 'cred-1', response: { clientDataJSON: '' } },
        email: 'victim@example.test',
      }),
    )

    expect(res.status).toBe(401)
    // THE defect: an unauthenticated caller who knew an address could attach an
    // authenticator they control to that account, then exchange it for a `pk_`
    // bridge token through the login handler.
    expect(passkeyCreate).toHaveBeenCalledTimes(0)
    expect($transaction).toHaveBeenCalledTimes(0)
  })

  it('should reach the signature check only for a challenge bound to the session user', async () => {
    const clientDataJSON = Buffer.from(JSON.stringify({ challenge: 'c' }), 'utf8').toString(
      'base64',
    )
    storedChallenge = {
      id: 'challenge-1',
      userId: USER_ID,
      challenge: 'c',
      type: 'registration',
      expiresAt: new Date(Date.now() + 60_000),
    }

    // The authenticator signature is the one thing this file does not fake: it
    // needs the private key. So a handler that reached `passkey.create` would be
    // proven by its absence here — the credential cannot verify, and nothing is
    // stored. `console.error` is swallowed because the route's catch logs the
    // WebAuthn rejection, which is the expected outcome of this test.
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await registerVerifyPOST(
        jsonRequest('/api/auth/passkey/register-verify', {
          credential: { id: 'cred-1', response: { clientDataJSON, transports: [] } },
          email: 'victim@example.test',
          name: 'My key',
        }),
      )

      expect(res.status).toBe(500)
      expect(passkeyCreate).toHaveBeenCalledTimes(0)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('should refuse a challenge minted for another user', async () => {
    const clientDataJSON = Buffer.from(JSON.stringify({ challenge: 'c' }), 'utf8').toString(
      'base64',
    )
    storedChallenge = {
      id: 'challenge-1',
      userId: VICTIM_ID,
      challenge: 'c',
      type: 'registration',
      expiresAt: new Date(Date.now() + 60_000),
    }

    const res = await registerVerifyPOST(
      jsonRequest('/api/auth/passkey/register-verify', {
        credential: { id: 'cred-1', response: { clientDataJSON, transports: [] } },
      }),
    )

    expect(res.status).toBe(401)
    expect(passkeyCreate).toHaveBeenCalledTimes(0)
  })
})

// ---------------------------------------------------------------------------
// GET /api/session — self-read with no secret in the body
// ---------------------------------------------------------------------------

describe('GET /api/session - an allow-list, tenant-scoped, status-aware', () => {
  it('should answer 401 and touch no user row without a session', async () => {
    session = new UnauthorizedError()

    const res = await sessionGET()

    expect(res.status).toBe(401)
    expect(userFindFirst).toHaveBeenCalledTimes(0)
  })

  it('should scope the user read to the session tenant', async () => {
    // `getToken` plus `prisma.user.findUnique({ where: { id } })` read whatever
    // row the token named, in whatever tenant it named.
    await sessionGET()

    const where = (userFindFirst.mock.calls[0][0] as QueryArgs).where ?? {}
    expect(where).toEqual({ id: USER_ID, tenantId: TENANT_ID })
  })

  it('should select an explicit allow-list and return no secret field', async () => {
    session = { ...SESSION }

    const res = await sessionGET()
    const body = await res.json()

    expect(res.status).toBe(200)
    const serialised = JSON.stringify(body)
    for (const secret of [
      'twoFactorSecret',
      'passkeyBridgeToken',
      'verifyToken',
      'passwordHash',
    ]) {
      // A bare `include` serialises the whole `User` row, all four included.
      expect(serialised).not.toContain(secret)
    }
    expect((body as { authenticated: boolean }).authenticated).toBe(true)
  })
})