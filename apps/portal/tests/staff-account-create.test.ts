import { describe, it, expect, beforeEach, mock } from 'bun:test'

/**
 * `POST /api/teachers/invite` — the one request that gives somebody a login AND a
 * staff profile.
 *
 * The properties asserted here are the ones a response-only test cannot see:
 *
 * - **Atomicity.** `$transaction` in the double snapshots both tables and restores
 *   them if the callback throws, so "the `User` exists and the `Staff` row does
 *   not" is a state these tests can actually be in. Without the restore it could
 *   not be observed at all, which is precisely the half-finished state the route
 *   exists to make impossible.
 * - **The privilege ceiling is the shared one.** The escalation case runs through
 *   the real `createInvitedUser` and the real `mayGrantRole`, with a positive
 *   control beside it: the same `ADMIN_STAFF` caller is refused `HEADMASTER` and
 *   allowed `CLASSROOM_TEACHER`, so a passing refusal cannot be a blanket denial.
 * - **Delivery is not silent.** `sendEmail` rejects; the route must report that
 *   distinctly while the rows stay.
 *
 * No database is touched. `prisma` is a small in-memory store that understands
 * only the `where` shapes this route and the shared function build; anything else
 * matches nothing rather than matching everything, so an unscoped handler fails
 * here instead of being waved through.
 *
 * NOTE ON THE DOUBLE-REGISTERED DATABASE MOCK
 * -------------------------------------------
 * `mock.module('@novastar/database', ...)` is registered because the house rule
 * requires it, but this suite does not depend on it: the route hands its
 * transaction client to `createInvitedUser` explicitly, so every call the shared
 * function makes goes through `tx` and never through its module-scope default.
 * That also makes these assertions immune to whichever other suite most recently
 * registered a fake under that specifier.
 */
mock.module('server-only', () => ({}))

// --- Email -------------------------------------------------------------------

/**
 * Delivery is observed at the `sendEmail` seam, not at `resend`.
 *
 * `resend` is the obvious thing to mock and it is what `email-auth-tokens.test.ts`
 * does — but that file's own header records why that is fragile: `getResend()`
 * caches its client for the life of the process, so whichever suite first sent
 * anything decided the provider every later suite used. Mocking `resend` here would
 * make these assertions depend on file order: green alone, red in the full run.
 *
 * So `sendEmail` itself is replaced, with a double that rejects using the REAL
 * `EmailDeliveryError` class. The route's catch is therefore exercised against the
 * error it will actually see in production, and the assertion no longer depends on
 * module load order. What is given up is `sendEmail`'s own behaviour when
 * `RESEND_API_KEY` is unset, which `email-auth-tokens.test.ts` asserts directly
 * against the real module; that property is not re-derived here.
 *
 * `setPasswordTemplate` is the real one, loaded before the mock is registered, so
 * the link and the subject line in these assertions are the ones a recipient would
 * really receive.
 */
const realNotifications = await import('@novastar/notifications')
const { EmailDeliveryError } = realNotifications

const SENT: Array<{ to: string; subject: string; html?: string; text?: string }> = []

/** Flipped by the tests that assert what a failed delivery looks like. */
let sendFails = false

const sendEmail = mock(async (options: { to: string; subject: string; html?: string; text?: string }) => {
  if (sendFails) {
    throw new EmailDeliveryError('provider-rejected', 'stubbed provider failure')
  }
  SENT.push(options)
  return { id: 'msg_1' }
})

mock.module('@novastar/notifications', () => ({
  sendEmail,
  setPasswordTemplate: realNotifications.setPasswordTemplate,
}))

// --- Store -------------------------------------------------------------------

const TENANT = 'tenant-1'
const SCHOOL = 'school-1'
const OTHER_TENANT = 'tenant-2'
const OTHER_SCHOOL = 'school-2'

interface StoredUser {
  id: string
  tenantId: string
  schoolId: string | null
  email: string
  name: string | null
  roleId: string | null
  passwordHash: string | null
  emailVerified: Date | null
  mustChangePassword: boolean
  isActive: boolean
  status: string
  verifyToken: string | null
  verifyTokenExpires: Date | null
}

interface StoredStaff {
  id: string
  tenantId: string
  schoolId: string
  userId: string
  employeeId: string
  firstName: string
  lastName: string
  otherNames: string | null
  gender: string
  phone: string
  email: string
  address: string | null
  hireDate: Date
  roleId: string | null
}

let users: StoredUser[] = []
let staffs: StoredStaff[] = []

/**
 * `@@unique([tenantId, schoolId, name])` on `Role`.
 *
 * The two tenants hold DIFFERENT sets on purpose. `Role` is the model that makes
 * role resolution scannable rather than a name lookup: a name that resolves in one
 * school must not resolve in another, and a fixture where every school has every
 * role cannot demonstrate that.
 */
const ROLES: Array<{ tenantId: string; schoolId: string; name: string }> = [
  { tenantId: TENANT, schoolId: SCHOOL, name: 'HEADMASTER' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'ASSISTANT_HEAD' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'HEAD_TEACHER' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'CLASSROOM_TEACHER' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'ACCOUNTANT' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'ADMIN_STAFF' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'PARENT' },
  // A real role row in the other school, and the only role it has.
  { tenantId: OTHER_TENANT, schoolId: OTHER_SCHOOL, name: 'CLASSROOM_TEACHER' },
]

/** Every write that was attempted, in order, whether or not it was rolled back. */
let writes: string[] = []

/** Set by a test to make the `Staff` insert fail for a reason other than a duplicate. */
let staffCreateError: unknown = null

function whereMatches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (row[key] !== condition) return false
  }
  return true
}

function uniqueViolation(): Error {
  const err = new Error('Unique constraint failed') as Error & { name: string; code: string }
  err.name = 'PrismaClientKnownRequestError'
  err.code = 'P2002'
  return err
}

const userFindFirst = async (args: { where: Record<string, unknown> }) =>
  users.find((row) => whereMatches(row as unknown as Record<string, unknown>, args.where)) ?? null

const roleFindFirst = async (args: { where: Record<string, unknown> }) => {
  const row = ROLES.find((r) => whereMatches(r as unknown as Record<string, unknown>, args.where))
  return row ? { id: `role-${row.tenantId}-${row.name}` } : null
}

const userCreate = async (args: { data: Partial<StoredUser> }) => {
  if (users.some((row) => row.tenantId === args.data.tenantId && row.email === args.data.email)) {
    throw uniqueViolation()
  }
  writes.push('user.create')
  const row: StoredUser = {
    id: `user-${users.length + 1}`,
    tenantId: TENANT,
    schoolId: SCHOOL,
    email: '',
    name: null,
    roleId: null,
    passwordHash: null,
    emailVerified: null,
    mustChangePassword: false,
    isActive: true,
    status: 'ACTIVE',
    verifyToken: null,
    verifyTokenExpires: null,
    ...args.data,
  }
  users.push(row)
  return row
}

const userUpdate = async (args: { where: { id: string }; data: Partial<StoredUser> }) => {
  const row = users.find((u) => u.id === args.where.id)
  if (!row) throw new Error('Record to update not found')
  Object.assign(row, args.data)
  return row
}

const staffCreate = async (args: { data: Partial<StoredStaff> }) => {
  if (staffCreateError) {
    writes.push('staff.create(failed)')
    throw staffCreateError
  }
  if (
    staffs.some(
      (row) =>
        row.tenantId === args.data.tenantId &&
        row.schoolId === args.data.schoolId &&
        row.employeeId === args.data.employeeId,
    )
  ) {
    writes.push('staff.create(duplicate)')
    throw uniqueViolation()
  }
  writes.push('staff.create')
  const row: StoredStaff = {
    id: `staff-${staffs.length + 1}`,
    tenantId: TENANT,
    schoolId: SCHOOL,
    userId: '',
    employeeId: '',
    firstName: '',
    lastName: '',
    otherNames: null,
    gender: 'OTHER',
    phone: '',
    email: '',
    address: null,
    hireDate: new Date(),
    roleId: null,
    ...args.data,
  }
  staffs.push(row)
  return row
}

/** The transaction client. Deliberately not the module client: that is the point. */
const TX = {
  user: { findFirst: userFindFirst, create: userCreate, update: userUpdate },
  role: { findFirst: roleFindFirst },
  staff: { create: staffCreate },
}

/**
 * Snapshots both tables and restores them when the callback throws.
 *
 * Without the restore, "the account exists but the staff row does not" would be
 * unreachable in this suite and the atomicity claim would be unfalsifiable — the
 * store would keep whatever the callback managed to write before it gave up.
 */
const $transaction = async (fn: (tx: typeof TX) => Promise<unknown>): Promise<unknown> => {
  const usersSnapshot = structuredClone(users)
  const staffsSnapshot = structuredClone(staffs)
  try {
    return await fn(TX)
  } catch (error) {
    users.length = 0
    users.push(...usersSnapshot)
    staffs.length = 0
    staffs.push(...staffsSnapshot)
    throw error
  }
}

const prisma = {
  ...TX,
  school: {
    findFirst: async (args: { where: Record<string, unknown> }) => {
      writes.push('school.findFirst')
      return whereMatches({ id: SCHOOL, tenantId: TENANT }, args.where)
        ? { id: SCHOOL, tenantId: TENANT, name: 'Novastar Montessori School' }
        : null
    },
  },
  auditLog: { findFirst: async () => null, create: async () => ({ id: 'audit-1' }) },
  $transaction,
}

// Load the real module before replacing it: Bun's `mock.module` patches a module
// already in the registry, so registering for one that has not resolved yet does
// not reach the modules that import it afterwards.
await import('@/lib/prisma')

mock.module('@/lib/prisma', () => ({ prisma, default: prisma }))
mock.module('@novastar/database', () => ({ prisma, default: prisma }))

// --- Session, permission, audit ---------------------------------------------

interface Session {
  userId: string
  tenantId: string
  schoolId: string | null
  role: string | null
}

let session: Session | Error = {
  userId: 'head-1',
  tenantId: TENANT,
  schoolId: SCHOOL,
  role: 'HEADMASTER',
}

/**
 * Defined locally, following `route-authz.test.ts`: Bun's `mock.module` registry
 * is global and outlives this file, so this must not depend on load order. The
 * route identifies it by `error.name`, never `instanceof`.
 */
class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

let grants: string[] = ['teacher:create']

const hasPermission = mock(
  async (_userId: string, key: string): Promise<boolean> => grants.includes(key),
)

mock.module('@novastar/auth', () => ({ hasPermission }))

mock.module('@/lib/auth/session-context', () => ({
  getCachedSessionAndTenant: mock(async () => {
    if (session instanceof Error) throw session
    return { ...session, roleName: session.role, user: { id: session.userId } }
  }),
  getTokenTenantId: mock(async () => (session instanceof Error ? null : TENANT)),
}))

let auditWrites: Array<{ params: Record<string, unknown>; viaTransaction: boolean }> = []

const createAuditLog = mock(
  async (params: Record<string, unknown>, tx?: unknown): Promise<null> => {
    auditWrites.push({ params, viaTransaction: tx !== undefined })
    return null
  },
)

mock.module('@/lib/audit/logger', () => ({
  AuditLogAction: { CREATE: 'CREATE', UPDATE: 'UPDATE' },
  createAuditLog,
  logAuditEvent: createAuditLog,
}))

// The origin an emailed link is built from. The provider is not reached —
// `sendEmail` is replaced above — so no key is needed and none is set.
process.env.NEXTAUTH_SECRET = 'test-secret-for-staff-invite-only-not-real'
process.env.NEXTAUTH_URL = 'https://portal.example.test'

const { resetRateLimit } = await import('@/lib/rate-limit')
const { GET, POST } = await import('@/app/api/teachers/invite/route')

// --- Helpers -----------------------------------------------------------------

function post(body: unknown, ip = '198.51.100.30'): Request {
  return new Request('https://portal.example.test/api/teachers/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify(body),
  })
}

const validBody = {
  email: 'new.teacher@novastarmontessori.com',
  roleName: 'CLASSROOM_TEACHER',
  employeeId: 'EMP-100',
  firstName: 'Ama',
  lastName: 'Mensah',
  otherNames: 'Serwaa',
  gender: 'FEMALE' as const,
  phone: '+233201234567',
  hireDate: '2026-09-01',
}

beforeEach(() => {
  users = [
    {
      id: 'user-existing',
      tenantId: TENANT,
      schoolId: SCHOOL,
      email: 'existing@novastarmontessori.com',
      name: 'Existing Colleague',
      roleId: `role-${TENANT}-HEADMASTER`,
      passwordHash: 'argon2id-hash',
      emailVerified: new Date(),
      mustChangePassword: false,
      isActive: true,
      status: 'ACTIVE',
      verifyToken: null,
      verifyTokenExpires: null,
    },
  ]
  staffs = []
  SENT.length = 0
  sendFails = false
  writes = []
  staffCreateError = null
  auditWrites = []
  grants = ['teacher:create']
  session = { userId: 'head-1', tenantId: TENANT, schoolId: SCHOOL, role: 'HEADMASTER' }
  resetRateLimit()
})

const invited = () => users.find((row) => row.email === 'new.teacher@novastarmontessori.com')
const staffFor = (userId: string) => staffs.find((row) => row.userId === userId)

/** The Head of School of the other tenant, so a cross-scope caller is expressible. */
function asOtherSchool(): void {
  session = { userId: 'head-2', tenantId: OTHER_TENANT, schoolId: OTHER_SCHOOL, role: 'HEADMASTER' }
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('POST /api/teachers/invite - authorization', () => {
  it('refuses a caller without teacher:create and writes nothing', async () => {
    grants = []
    const res = await POST(post(validBody))

    expect(res.status).toBe(403)
    expect(users).toHaveLength(1)
    expect(staffs).toHaveLength(0)
    expect(writes).toEqual([])
    expect(SENT).toHaveLength(0)
  })

  it('answers an unauthenticated caller with 401, not 500', async () => {
    session = new UnauthorizedError()
    const res = await POST(post(validBody))

    expect(res.status).toBe(401)
    expect(users).toHaveLength(1)
  })

  it('refuses a caller with no school rather than writing a schoolless staff row', async () => {
    session = { userId: 'head-1', tenantId: TENANT, schoolId: null, role: 'HEADMASTER' }
    const res = await POST(post(validBody))

    expect(res.status).toBe(400)
    expect(users).toHaveLength(1)
  })

  it('rate limits the 21st attempt from one client', async () => {
    const statuses: number[] = []
    // One client address, so the bucket under test is the per-client one. Each
    // attempt is otherwise a valid, distinct creation: a refusal would consume the
    // budget just as well, and the point is that the 21st never reaches the handler.
    for (let i = 0; i < 21; i++) {
      const res = await POST(
        post({
          ...validBody,
          email: `staff${i}@novastarmontessori.com`,
          employeeId: `EMP-${200 + i}`,
        }),
      )
      statuses.push(res.status)
    }

    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true)
    expect(statuses[20]).toBe(429)
    expect(users).toHaveLength(21)
  })
})

// ---------------------------------------------------------------------------
// The privilege ceiling — the shared one, not a local copy
// ---------------------------------------------------------------------------

describe('POST /api/teachers/invite - the privilege ceiling', () => {
  it('refuses an ADMIN_STAFF caller minting a HEADMASTER, and writes nothing', async () => {
    // The escalation. ADMIN_STAFF is a user-security admin in
    // `USER_SECURITY_ADMIN_ROLES`, so before `mayGrantRole` existed it passed every
    // other check on this page and took the school over.
    session = { userId: 'admin-1', tenantId: TENANT, schoolId: SCHOOL, role: 'ADMIN_STAFF' }
    const res = await POST(post({ ...validBody, roleName: 'HEADMASTER' }))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('HEADMASTER')
    expect(users).toHaveLength(1)
    expect(staffs).toHaveLength(0)
    expect(SENT).toHaveLength(0)
    expect(auditWrites).toHaveLength(0)
  })

  it('allows the same ADMIN_STAFF caller the one role at its rank, so the refusal is the ceiling', async () => {
    // The control beside the refusal above. Without it, "403" could only mean
    // "ADMIN_STAFF is refused everything here", which would pass for the wrong
    // reason.
    //
    // Note what the control has to be: ADMIN_STAFF ranks 2, so the roles it may
    // grant are ADMIN_STAFF itself and PARENT. It CANNOT grant a
    // CLASSROOM_TEACHER — the ceiling is "at or below your own rank", not "any role
    // you can see".
    session = { userId: 'admin-1', tenantId: TENANT, schoolId: SCHOOL, role: 'ADMIN_STAFF' }
    const res = await POST(post({ ...validBody, roleName: 'ADMIN_STAFF' }))

    expect(res.status).toBe(201)
    expect(invited()).toBeDefined()
    expect(staffFor(invited()!.id)).toBeDefined()
  })

  it('refuses a Head Teacher minting an Assistant Head', async () => {
    session = { userId: 'head-t-1', tenantId: TENANT, schoolId: SCHOOL, role: 'HEAD_TEACHER' }
    const res = await POST(post({ ...validBody, roleName: 'ASSISTANT_HEAD' }))

    expect(res.status).toBe(403)
    expect(users).toHaveLength(1)
  })

  it('lets a Head Teacher mint a Classroom Teacher, the everyday case', async () => {
    // The other direction of the same control: the ceiling permits what it should,
    // so a teacher onboarding a colleague is not blocked by the fix.
    session = { userId: 'head-t-1', tenantId: TENANT, schoolId: SCHOOL, role: 'HEAD_TEACHER' }
    const res = await POST(post(validBody))

    expect(res.status).toBe(201)
    expect(invited()?.roleId).toBe(`role-${TENANT}-CLASSROOM_TEACHER`)
  })

  it('refuses an unknown role name rather than creating an unusable account', async () => {
    const res = await POST(post({ ...validBody, roleName: 'STAFF' }))

    expect(res.status).toBe(400)
    expect(users).toHaveLength(1)
    expect(staffs).toHaveLength(0)
  })

  it('refuses a role name that resolves only in the caller own school', async () => {
    // `ACCOUNTANT` exists in TENANT/SCHOOL and nowhere in OTHER_SCHOOL. Resolution
    // is under `{ tenantId, schoolId, name }`, so the caller cannot borrow it.
    asOtherSchool()
    const res = await POST(
      post({ ...validBody, roleName: 'ACCOUNTANT', email: 'a@novastarmontessori.com' }),
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('does not exist in your school')
    expect(users).toHaveLength(1)
  })

  it('does grant the one role the other school does have', async () => {
    // The positive control beside the refusal above: the refusal is about scoping,
    // not about refusing a caller whose school is unfamiliar.
    asOtherSchool()
    const res = await POST(
      post({ ...validBody, roleName: 'CLASSROOM_TEACHER', email: 'b@novastarmontessori.com' }),
    )

    expect(res.status).toBe(201)
    const user = users.find((row) => row.email === 'b@novastarmontessori.com')!
    expect(user.schoolId).toBe(OTHER_SCHOOL)
    expect(user.tenantId).toBe(OTHER_TENANT)
    expect(staffFor(user.id)?.schoolId).toBe(OTHER_SCHOOL)
  })
})

// ---------------------------------------------------------------------------
// What the body may not say
// ---------------------------------------------------------------------------

describe('POST /api/teachers/invite - the body is not trusted with scope', () => {
  it('refuses a body that names another tenant or school', async () => {
    const res = await POST(post({ ...validBody, tenantId: OTHER_TENANT, schoolId: OTHER_SCHOOL }))

    expect(res.status).toBe(400)
    expect(users).toHaveLength(1)
    expect(staffs).toHaveLength(0)
  })

  it('refuses a body that supplies a userId, so no staff row can name a foreign login', async () => {
    const res = await POST(post({ ...validBody, userId: 'user-existing' }))

    expect(res.status).toBe(400)
    expect(staffs).toHaveLength(0)
  })

  it('refuses a roleId in place of a role name', async () => {
    const res = await POST(
      post({ email: validBody.email, roleId: 'role-1', employeeId: validBody.employeeId,
        firstName: 'A', lastName: 'B', gender: 'OTHER', phone: '1', hireDate: '2026-09-01' }),
    )

    expect(res.status).toBe(400)
    expect(users).toHaveLength(1)
  })

  it('refuses a password outright — the recipient sets their own', async () => {
    const res = await POST(post({ ...validBody, password: 'correct horse battery' }))

    expect(res.status).toBe(400)
    expect(users).toHaveLength(1)
    expect(SENT).toHaveLength(0)
  })

  it('refuses an invalid email address and writes nothing', async () => {
    const res = await POST(post({ ...validBody, email: 'not-an-email' }))

    expect(res.status).toBe(400)
    expect(users).toHaveLength(1)
    expect(staffs).toHaveLength(0)
    expect(SENT).toHaveLength(0)
  })

  it('normalises the address it stores, so both rows name the same person', async () => {
    const res = await POST(post({ ...validBody, email: 'New.Teacher@Novastarmontessori.com' }))

    expect(res.status).toBe(201)
    expect(invited()?.email).toBe('new.teacher@novastarmontessori.com')
    expect(staffs[0]?.email).toBe('new.teacher@novastarmontessori.com')
  })

  it('refuses a malformed hire date rather than storing an Invalid Date', async () => {
    const res = await POST(post({ ...validBody, hireDate: '01/09/2026' }))

    expect(res.status).toBe(400)
    expect(staffs).toHaveLength(0)
  })

  it('writes both rows into the caller own tenant and school, whatever the body claimed', async () => {
    await POST(post(validBody))
    const user = invited()!
    const staff = staffFor(user.id)!

    expect([user.tenantId, user.schoolId]).toEqual([TENANT, SCHOOL])
    expect([staff.tenantId, staff.schoolId]).toEqual([TENANT, SCHOOL])
  })
})

// ---------------------------------------------------------------------------
// Both rows, or neither
// ---------------------------------------------------------------------------

describe('POST /api/teachers/invite - one transaction', () => {
  it('creates both rows, linked to each other', async () => {
    const res = await POST(post(validBody))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.status).toBe('invited')

    const user = invited()!
    const staff = staffFor(user.id)!
    expect(staff.employeeId).toBe('EMP-100')
    expect(staff.firstName).toBe('Ama')
    expect(staff.lastName).toBe('Mensah')
    expect(staff.otherNames).toBe('Serwaa')
    expect(staff.gender).toBe('FEMALE')
    expect(staff.phone).toBe('+233201234567')
    expect(staff.hireDate).toBeInstanceOf(Date)
    expect(staff.hireDate.toISOString().slice(0, 10)).toBe('2026-09-01')
    // `Staff.roleId` points at `StaffRole`, a job title, not at the access `Role`
    // this route resolved. Leaving it null keeps two same-named columns apart.
    expect(staff.roleId).toBeNull()
    // Exactly one pass through the database, in this order.
    expect(writes).toEqual(['user.create', 'staff.create', 'school.findFirst'])
  })

  it('leaves the account invited, with no password and a live setup token', async () => {
    await POST(post(validBody))
    const user = invited()!

    expect(user.passwordHash).toBeNull()
    expect(user.mustChangePassword).toBe(true)
    expect(user.emailVerified).toBeNull()
    expect(user.status).toBe('ACTIVE')
    expect(user.isActive).toBe(true)
    // Stored as a digest, like every other verification token.
    expect(user.verifyToken).toMatch(/^[0-9a-f]{64}$/)
    expect(user.verifyTokenExpires).toBeInstanceOf(Date)
  })

  it('names the account for the person and writes no password anywhere', async () => {
    await POST(post(validBody))
    const user = invited()!

    expect(user.name).toBe('Ama Serwaa Mensah')
    expect(user.passwordHash).toBeNull()
    expect(JSON.stringify(user)).not.toContain('correct horse')
    for (const sent of SENT) {
      expect(sent.text).not.toContain('correct horse')
      expect(sent.html).not.toContain('correct horse')
    }
    // And the account that already existed is untouched: this route creates one
    // person, it does not touch anybody else.
    expect(users.find((row) => row.id === 'user-existing')?.passwordHash).toBe('argon2id-hash')
  })

  it('writes neither row when the staff insert fails', async () => {
    // The state the whole route exists to prevent: a login that exists with no
    // staff profile, or a person half created and nobody able to finish.
    staffCreateError = new Error('staff insert blew up')
    const res = await POST(post(validBody))

    expect(res.status).toBe(500)
    expect(users).toHaveLength(1)
    expect(invited()).toBeUndefined()
    expect(staffs).toHaveLength(0)
    expect(SENT).toHaveLength(0)
    // And nothing claims to have happened.
    expect(auditWrites).toHaveLength(0)
  })

  it('writes neither row when the employee ID is already in use', async () => {
    const first = await POST(post(validBody))
    expect(first.status).toBe(201)
    expect(users).toHaveLength(2)
    expect(staffs).toHaveLength(1)

    // A different person, the same employee number. `@@unique([tenantId, schoolId,
    // employeeId])` refuses the second insert, and the `User` created earlier in the
    // same transaction goes with it.
    const second = await POST(post({ ...validBody, email: 'impostor@novastarmontessori.com' }))

    expect(second.status).toBe(409)
    expect((await second.json()).error).toContain('employee ID')
    expect(users).toHaveLength(2)
    expect(users.some((row) => row.email === 'impostor@novastarmontessori.com')).toBe(false)
    expect(staffs).toHaveLength(1)
    expect(SENT).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

describe('POST /api/teachers/invite - duplicates', () => {
  it('refuses an address that already has an account, and writes nothing', async () => {
    const res = await POST(post({ ...validBody, email: 'existing@novastarmontessori.com' }))

    expect(res.status).toBe(409)
    expect(users).toHaveLength(1)
    expect(staffs).toHaveLength(0)
    expect(SENT).toHaveLength(0)
  })

  it('refuses the same address twice in a row', async () => {
    expect((await POST(post(validBody))).status).toBe(201)

    const res = await POST(post({ ...validBody, employeeId: 'EMP-999' }))

    expect(res.status).toBe(409)
    expect(staffs).toHaveLength(1)
    expect(users).toHaveLength(2)
  })

  it('treats the same address in another tenant as a different person', async () => {
    // `User @@unique([tenantId, email])`, not `@@unique([email])`. A school that has
    // already onboarded someone must not stop another school from onboarding them.
    expect((await POST(post(validBody))).status).toBe(201)

    asOtherSchool()
    const res = await POST(post(validBody))

    expect(res.status).toBe(201)
    const sameAddress = users.filter((row) => row.email === 'new.teacher@novastarmontessori.com')
    expect(sameAddress).toHaveLength(2)
    expect(sameAddress.map((row) => row.tenantId).sort()).toEqual([OTHER_TENANT, TENANT].sort())
  })
})

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

describe('POST /api/teachers/invite - the setup email', () => {
  it('attempts exactly one setup email, addressed to the account', async () => {
    await POST(post(validBody))

    expect(SENT).toHaveLength(1)
    expect(SENT[0]!.to).toBe('new.teacher@novastarmontessori.com')
    expect(SENT[0]!.text).toContain('/set-password?token=vem_')
    expect(SENT[0]!.subject).toContain('Novastar Montessori School')
    // The link carries the raw token; the row carries its digest.
    const token = SENT[0]!.text!.split('token=')[1]!.split('\n')[0]!
    expect(invited()?.verifyToken).not.toBe(token)
  })

  it('reports a failed delivery distinctly, and says the account exists', async () => {
    sendFails = true
    const res = await POST(post(validBody))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.status).toBe('created-not-delivered')
    // Both rows survive, because the send happens after the commit.
    expect(invited()).toBeDefined()
    expect(staffs).toHaveLength(1)
    expect(body.email).toBe('new.teacher@novastarmontessori.com')
    expect(body.staffId).toBe(staffs[0]?.id)
    expect(body.userId).toBe(invited()?.id)
    // Never a success.
    expect(res.status).not.toBe(201)
  })

  it('still audits the creation when the delivery failed', async () => {
    sendFails = true
    await POST(post(validBody))

    expect(auditWrites).toHaveLength(1)
  })

  it('makes no second delivery attempt for an account that already exists', async () => {
    // The recovery path for `created-not-delivered` is a password-reset request by
    // the recipient, not a retry: the address is now taken, so a retry is a 409 and
    // the operator would learn nothing new.
    sendFails = true
    await POST(post(validBody))
    const retry = await POST(post({ ...validBody, employeeId: 'EMP-300' }))

    expect(retry.status).toBe(409)
    expect(SENT).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

describe('POST /api/teachers/invite - the audit entry', () => {
  it('writes one CREATE entry inside the transaction', async () => {
    await POST(post(validBody))

    expect(auditWrites).toHaveLength(1)
    expect(auditWrites[0]!.viaTransaction).toBe(true)
    expect(auditWrites[0]!.params).toMatchObject({
      userId: 'head-1',
      action: 'CREATE',
      entity: 'users',
      entityId: invited()!.id,
      tenantId: TENANT,
      schoolId: SCHOOL,
    })
    expect(auditWrites[0]!.params.description).toContain('new.teacher@novastarmontessori.com')
    expect(auditWrites[0]!.params.description).toContain('CLASSROOM_TEACHER')
    expect(auditWrites[0]!.params.description).toContain('EMP-100')
  })

  it('writes no entry for a refusal', async () => {
    await POST(post({ ...validBody, email: 'not-an-email' }))
    expect(auditWrites).toHaveLength(0)

    session = { userId: 'admin-1', tenantId: TENANT, schoolId: SCHOOL, role: 'ADMIN_STAFF' }
    await POST(post({ ...validBody, roleName: 'HEADMASTER', employeeId: 'EMP-300' }))
    expect(auditWrites).toHaveLength(0)

    grants = []
    await POST(post({ ...validBody, employeeId: 'EMP-400' }))
    expect(auditWrites).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// The capability probe the page uses
// ---------------------------------------------------------------------------

describe('GET /api/teachers/invite', () => {
  it('offers a Head of School every seeded role, because the ceiling is their own rank', async () => {
    const body = await (await GET()).json()

    expect(body.data.canCreate).toBe(true)
    expect(body.data.grantableRoleNames).toEqual([
      'HEADMASTER',
      'ASSISTANT_HEAD',
      'HEAD_TEACHER',
      'CLASSROOM_TEACHER',
      'ACCOUNTANT',
      'ADMIN_STAFF',
      'PARENT',
      'ADMISSIONS_OFFICER',
    ])
  })

  it('narrows the list for a caller who cannot grant the top roles', async () => {
    session = { userId: 't-1', tenantId: TENANT, schoolId: SCHOOL, role: 'CLASSROOM_TEACHER' }
    const body = await (await GET()).json()

    // Rank 5, so everything at or below it — which includes ACCOUNTANT and
    // ADMIN_STAFF, whose grants are disjoint from a teacher's. The ranking is a
    // total order precisely because it still has to answer here.
    expect(body.data.grantableRoleNames).toEqual([
      'CLASSROOM_TEACHER',
      'ACCOUNTANT',
      'ADMIN_STAFF',
      'PARENT',
      'ADMISSIONS_OFFICER',
    ])
    expect(body.data.grantableRoleNames).not.toContain('HEADMASTER')
  })

  it('reports canCreate false, with no roles, for a caller without the key', async () => {
    grants = []
    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { canCreate: false, grantableRoleNames: [] } })
  })

  it('grants nothing to an unrecognised role rather than treating it as unranked', async () => {
    // `mayGrantRole` fails closed on an unknown caller role. A probe that listed the
    // whole catalog here would offer the Head of School's own role to nobody.
    session = { userId: 'x-1', tenantId: TENANT, schoolId: SCHOOL, role: 'NOT_A_ROLE' }
    const body = await (await GET()).json()

    expect(body.data.canCreate).toBe(true)
    expect(body.data.grantableRoleNames).toEqual([])
  })

  it('answers an unauthenticated caller with 401', async () => {
    session = new UnauthorizedError()
    expect((await GET()).status).toBe(401)
  })

  it('answers a caller with no school with 400', async () => {
    session = { userId: 'head-1', tenantId: TENANT, schoolId: null, role: 'HEADMASTER' }
    expect((await GET()).status).toBe(400)
  })
})