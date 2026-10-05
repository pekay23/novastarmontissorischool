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
 * EVERY CLIENT IS LABELLED, BOTH READS AND WRITES
 * ----------------------------------------------
 * The module client and the transaction client are two different objects, and each
 * records whether it was `tx` or `module`. They used to be one object (`{ ...TX }`),
 * so the atomicity claim at the centre of this file was unfalsifiable: writing the
 * `User` and its setup token outside `$transaction` produced exactly the same
 * observable store as writing them inside it. The same applies to the permission
 * gate, which is evaluated for a `(tenantId, schoolId)` and used to have that pair
 * discarded by its double.
 *
 * NOTE ON THE DOUBLE-REGISTERED DATABASE MOCK
 * -------------------------------------------
 * `mock.module('@novastar/database', ...)` is registered because the house rule
 * requires it, but this suite does not depend on it: the route hands its
 * transaction client to `createInvitedUser` explicitly, so every call the shared
 * function makes goes through `tx` and never through its module-scope default —
 * which `writes` below now records rather than assumes.
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

// `@novastar/notifications` is registered with the rest further down.

// --- Store -------------------------------------------------------------------

const TENANT = 'tenant-1'
const SCHOOL = 'school-1'
const OTHER_TENANT = 'tenant-2'
const OTHER_SCHOOL = 'school-2'
/**
 * A second school in the CALLER's own tenant.
 *
 * Without it, every tenant in this file holds exactly one school, so a `where` that
 * dropped `schoolId` from the role lookup would still refuse the cross-TENANT cases
 * and the school-scoped one would never be expressed. It is the only way to prove
 * the lookup is scoped to the caller's school and not merely to their tenant.
 */
const SIBLING_SCHOOL = 'school-1b'

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
 * The two tenants hold DIFFERENT sets on purpose, and so do the two schools of the
 * first tenant. `Role` is the model that makes role resolution scannable rather than
 * a name lookup: a name that resolves in one school must not resolve in another, and
 * a fixture where every school has every role cannot demonstrate that — for a
 * cross-TENANT case and for a cross-SCHOOL one alike.
 */
const ROLES: Array<{ tenantId: string; schoolId: string; name: string }> = [
  { tenantId: TENANT, schoolId: SCHOOL, name: 'HEADMASTER' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'ASSISTANT_HEAD' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'HEAD_TEACHER' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'CLASSROOM_TEACHER' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'ACCOUNTANT' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'ADMIN_STAFF' },
  { tenantId: TENANT, schoolId: SCHOOL, name: 'PARENT' },
  // The sibling school of the SAME tenant: one role, and it is not the one the
  // cross-school tests below try to borrow.
  { tenantId: TENANT, schoolId: SIBLING_SCHOOL, name: 'CLASSROOM_TEACHER' },
  // A real role row in the other tenant, and the only role it has.
  { tenantId: OTHER_TENANT, schoolId: OTHER_SCHOOL, name: 'CLASSROOM_TEACHER' },
]

/**
 * Every write that was attempted, in order, whether or not it was rolled back, and
 * through WHICH client.
 *
 * The module-level `prisma` and the transaction client `tx` are deliberately
 * separate objects here, each carrying its own label. They used to be one object
 * (`{ ...TX }`), which made a write enlisted in the transaction indistinguishable
 * from a write made outside it — so dropping the `tx` argument from
 * `createInvitedUser`, which is the defect this route exists to prevent, left every
 * test in this file green.
 */
type ClientScope = 'tx' | 'module'
let writes: string[] = []
/** The reads the route made, with the `where` it built, so scoping is observable. */
let reads: Array<{ scope: ClientScope; op: string; where: Record<string, unknown> | undefined }> = []

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

const userFindFirst = (scope: ClientScope) =>
  mock(async (args: { where: Record<string, unknown> }) => {
    reads.push({ scope, op: 'user.findFirst', where: args.where })
    return users.find((row) => whereMatches(row as unknown as Record<string, unknown>, args.where)) ?? null
  })

const roleFindFirst = (scope: ClientScope) =>
  mock(async (args: { where: Record<string, unknown> }) => {
    reads.push({ scope, op: 'role.findFirst', where: args.where })
    const row = ROLES.find((r) => whereMatches(r as unknown as Record<string, unknown>, args.where))
    return row ? { id: `role-${row.tenantId}-${row.name}` } : null
  })

const userCreate = (scope: ClientScope) =>
  mock(async (args: { data: Partial<StoredUser> }) => {
    if (users.some((row) => row.tenantId === args.data.tenantId && row.email === args.data.email)) {
      throw uniqueViolation()
    }
    writes.push(`${scope}:user.create`)
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
  })

const userUpdate = (scope: ClientScope) =>
  mock(async (args: { where: { id: string }; data: Partial<StoredUser> }) => {
    const row = users.find((u) => u.id === args.where.id)
    if (!row) throw new Error('Record to update not found')
    // The token write is inside the transaction too, so it is recorded: a user row
    // enlisted with its setup token left outside is exactly the half-created state.
    writes.push(`${scope}:user.update`)
    Object.assign(row, args.data)
    return row
  })

const staffCreate = (scope: ClientScope) =>
  mock(async (args: { data: Partial<StoredStaff> }) => {
    if (staffCreateError) {
      writes.push(`${scope}:staff.create(failed)`)
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
      writes.push(`${scope}:staff.create(duplicate)`)
      throw uniqueViolation()
    }
    writes.push(`${scope}:staff.create`)
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
  })

/** The transaction client, labelled. */
const TX = {
  user: {
    findFirst: userFindFirst('tx'),
    create: userCreate('tx'),
    update: userUpdate('tx'),
  },
  role: { findFirst: roleFindFirst('tx') },
  staff: { create: staffCreate('tx') },
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

/**
 * The module-level client: a DIFFERENT object from `TX`, so every write says which
 * one it went through. `{ ...TX }` made them the same object, and a file that
 * cannot tell the two apart cannot assert that anything was enlisted at all.
 */
const prisma = {
  user: {
    findFirst: userFindFirst('module'),
    create: userCreate('module'),
    update: userUpdate('module'),
  },
  role: { findFirst: roleFindFirst('module') },
  staff: { create: staffCreate('module') },
  school: {
    findFirst: mock(async (args: { where: Record<string, unknown> }) => {
      writes.push('module:school.findFirst')
      return whereMatches({ id: SCHOOL, tenantId: TENANT }, args.where)
        ? { id: SCHOOL, tenantId: TENANT, name: 'Novastar Montessori School' }
        : null
    }),
  },
  auditLog: { findFirst: async () => null, create: async () => ({ id: 'audit-1' }) },
  $transaction,
}

// Load the real modules before replacing them: Bun's `mock.module` patches a module
// already in the registry, so registering for one that has not resolved yet does
// not reach the modules that import it afterwards.

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

/**
 * Every gate check, with the scope it was evaluated against.
 *
 * The double used to accept `(_userId, key)` and throw the tenant and school away,
 * which is the same as accepting any scope: `hasPermission(userId, key,
 * 'attacker-tenant', 'attacker-school')` was indistinguishable from the correct
 * call and every test here stayed green. Recording the arguments is what makes the
 * gate's scope assertable.
 */
interface PermissionCheck {
  userId: string
  key: string
  tenantId: string | undefined
  schoolId: string | undefined
}
let permissionChecks: PermissionCheck[] = []

const hasPermission = mock(
  async (
    userId: string,
    key: string,
    tenantId?: string,
    schoolId?: string,
  ): Promise<boolean> => {
    permissionChecks.push({ userId, key, tenantId, schoolId })
    return grants.includes(key)
  },
)

/**
 * The gate's scope for `teacher:create`, whatever the caller decided.
 */
const teacherCreateChecks = (): PermissionCheck[] =>
  permissionChecks.filter((check) => check.key === 'teacher:create')

let auditWrites: Array<{ params: Record<string, unknown>; viaTransaction: boolean }> = []

const createAuditLog = mock(
  async (params: Record<string, unknown>, tx?: unknown): Promise<null> => {
    auditWrites.push({ params, viaTransaction: tx !== undefined })
    return null
  },
)

// ---------------------------------------------------------------------------
// Module-mock lifetime: register before the route import
// ---------------------------------------------------------------------------
// `mock.module` patches the module registry for the whole process. Each test
// file re-registers its own mocks in `beforeEach`, so the namespace from the
// last-registered file wins. `server-only` goes first because `@/lib/audit/logger`
// imports it and the package is not installed in this workspace.
//
// The snapshots are read HERE, before the first real registration. That is the
// load-bearing part: a `beforeEach` capture would run after these registrations had already
// overwritten the namespace, so it would record this file's own factory and hand the double
// straight back to the next file.
//
// Every factory SPREADS the namespace it replaces and then overrides, making each fake both
// a superset and a subset — which is what makes the restore complete, since `mock.module`
// merges and an added key could never be removed again. The `@novastar/auth` spread is the
// sharpest case: a factory exporting only `hasPermission` leaves every other export
// `undefined` for every file that resolves the module afterwards.
const previousNamespaces = new Map<string, Record<string, unknown>>()
previousNamespaces.set('server-only', { ...(await import('server-only')) })
previousNamespaces.set('@novastar/notifications', { ...(await import('@novastar/notifications')) })
previousNamespaces.set('@/lib/prisma', { ...(await import('@/lib/prisma')) })
previousNamespaces.set('@novastar/database', { ...(await import('@novastar/database')) })
previousNamespaces.set('@novastar/auth', { ...(await import('@novastar/auth')) })
previousNamespaces.set('@/lib/auth/session-context', {
  ...(await import('@/lib/auth/session-context')),
})
previousNamespaces.set('@/lib/audit/logger', { ...(await import('@/lib/audit/logger')) })

const base = (specifier: string): Record<string, unknown> =>
  previousNamespaces.get(specifier) ?? {}

const FAKES = [
  {
    specifier: '@novastar/notifications',
    factory: () => ({
      ...base('@novastar/notifications'),
      sendEmail,
      setPasswordTemplate: realNotifications.setPasswordTemplate,
    }),
  },
  { specifier: '@/lib/prisma', factory: () => ({ ...base('@/lib/prisma'), prisma, default: prisma }) },
  {
    specifier: '@novastar/database',
    factory: () => ({ ...base('@novastar/database'), prisma, default: prisma }),
  },
  { specifier: '@novastar/auth', factory: () => ({ ...base('@novastar/auth'), hasPermission }) },
  {
    // `getTokenTenantId` is exported although nothing on this route's import graph reaches
    // it, and the factory spreads the namespace anyway: a partial replacement would break
    // whatever resolved the module afterwards rather than this file.
    specifier: '@/lib/auth/session-context',
    factory: () => ({
      ...base('@/lib/auth/session-context'),
      getCachedSessionAndTenant: mock(async () => {
        if (session instanceof Error) throw session
        return { ...session, roleName: session.role, user: { id: session.userId } }
      }),
      getTokenTenantId: mock(async () => (session instanceof Error ? null : TENANT)),
    }),
  },
  {
    specifier: '@/lib/audit/logger',
    factory: () => ({
      ...base('@/lib/audit/logger'),
      AuditLogAction: { CREATE: 'CREATE', UPDATE: 'UPDATE' },
      createAuditLog,
      logAuditEvent: createAuditLog,
    }),
  },
] as const

// Also registered at load time, so the route import below resolves these specifiers through
// the doubles and the file is correct in a run that never reaches `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

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
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
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
  reads = []
  permissionChecks = []
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

/** The Head of School of the other school of THIS tenant. */
function asSiblingSchool(): void {
  session = { userId: 'head-3', tenantId: TENANT, schoolId: SIBLING_SCHOOL, role: 'HEADMASTER' }
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('POST /api/teachers/invite - authorization', () => {
  it('evaluates the gate against the CALLER\'S tenant and school', async () => {
    // The claim is about scope, and the double used to discard it. Both handlers
    // must pass the session's own pair: a gate evaluated for any other tenant is a
    // gate this suite would have called a pass.
    await POST(post(validBody))

    expect(teacherCreateChecks()).toEqual([
      { userId: 'head-1', key: 'teacher:create', tenantId: TENANT, schoolId: SCHOOL },
    ])
    // And the body cannot redirect it, because the body is never consulted for scope.
    await POST(
      post({ ...validBody, email: 'b@novastarmontessori.com', tenantId: OTHER_TENANT, schoolId: OTHER_SCHOOL }),
    )
    expect(teacherCreateChecks()).toHaveLength(2)
    for (const check of teacherCreateChecks()) {
      expect([check.tenantId, check.schoolId]).toEqual([TENANT, SCHOOL])
    }
  })

  it('evaluates the gate against the caller\'s own pair even when they are elsewhere', async () => {
    asOtherSchool()
    await POST(post({ ...validBody, email: 'c@novastarmontessori.com' }))

    expect(teacherCreateChecks()).toEqual([
      { userId: 'head-2', key: 'teacher:create', tenantId: OTHER_TENANT, schoolId: OTHER_SCHOOL },
    ])

    asSiblingSchool()
    await POST(post({ ...validBody, email: 'd@novastarmontessori.com', employeeId: 'EMP-101' }))

    expect(teacherCreateChecks()[1]).toEqual({
      userId: 'head-3',
      key: 'teacher:create',
      tenantId: TENANT,
      schoolId: SIBLING_SCHOOL,
    })
  })

  it('refuses a caller without teacher:create and writes nothing', async () => {
    grants = []
    const res = await POST(post(validBody))

    expect(res.status).toBe(403)
    expect(users).toHaveLength(1)
    expect(staffs).toHaveLength(0)
    expect(writes).toEqual([])
    expect(SENT).toHaveLength(0)
    // The gate was reached, for the caller's own scope, before the refusal.
    expect(teacherCreateChecks()).toEqual([
      { userId: 'head-1', key: 'teacher:create', tenantId: TENANT, schoolId: SCHOOL },
    ])
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

    // All twenty, as twenty distinct answers rather than one collapsed predicate: a
    // single 403 or 500 in the middle would satisfy `.every(s => s === 201)`.
    expect(statuses).toEqual([...Array(20).fill(201), 429])
    expect(users).toHaveLength(21)
    // Nothing was written outside the transaction by any of the twenty.
    expect(writes.filter((write) => !write.startsWith('tx:'))).toEqual([
      ...Array(20).fill('module:school.findFirst'),
    ])
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

  it('refuses a role name that resolves only in a SIBLING school of the same tenant', async () => {
    // The same refusal one level in, and the only case in this file that a lookup
    // scoped by tenant alone cannot pass: the role and the caller share a tenant.
    asSiblingSchool()
    const res = await POST(
      post({ ...validBody, roleName: 'ACCOUNTANT', email: 'e@novastarmontessori.com' }),
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('does not exist in your school')
    expect(users).toHaveLength(1)
    expect(staffs).toHaveLength(0)
    // The lookup really did carry the caller's school, rather than the refusal
    // coming from somewhere else in the handler.
    expect(
      reads.filter((read) => read.op === 'role.findFirst').map((read) => [read.scope, read.where]),
    ).toEqual([['tx', { tenantId: TENANT, schoolId: SIBLING_SCHOOL, name: 'ACCOUNTANT' }]])
  })

  it('does grant the one role the sibling school does have', async () => {
    // The positive control for the refusal above, in the same tenant and the same
    // session shape, so a passing refusal cannot be "this caller is refused
    // everything".
    asSiblingSchool()
    const res = await POST(
      post({ ...validBody, roleName: 'CLASSROOM_TEACHER', email: 'f@novastarmontessori.com' }),
    )

    expect(res.status).toBe(201)
    const user = users.find((row) => row.email === 'f@novastarmontessori.com')!
    expect(user.schoolId).toBe(SIBLING_SCHOOL)
    expect(staffFor(user.id)?.schoolId).toBe(SIBLING_SCHOOL)
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

  it('refuses a hire date that is shaped like one but does not exist', async () => {
    // The shape test above cannot see these: all of them match `^\d{4}-\d{2}-\d{2}$`.
    // `new Date('2026-02-31')` is the 3rd of March and `new Date('2026-04-31')` is
    // the 1st of May, so a shape-only guard stores a date nobody entered; and a
    // month of 13 or 45 is an Invalid Date, which Prisma writes as-is. The real
    // date beside them, so the refusal cannot be "the schema refuses everything".
    for (const hireDate of ['2026-02-31', '2026-04-31', '2026-13-45', '2026-02-30', '2026-11-31']) {
      const res = await POST(
        post({ ...validBody, hireDate, email: `c${hireDate}@novastarmontessori.com` }),
      )

      expect(res.status).toBe(400)
      expect(staffs).toHaveLength(0)
      expect(invited()).toBeUndefined()
      expect(writes).toEqual([])
    }

    const real = await POST(
      post({ ...validBody, hireDate: '2026-02-28', email: 'leap@novastarmontessori.com' }),
    )
    expect(real.status).toBe(201)
    const leap = users.find((row) => row.email === 'leap@novastarmontessori.com')!
    expect(staffFor(leap.id)?.hireDate.toISOString().slice(0, 10)).toBe('2026-02-28')
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
    // Exactly one pass through the database, in this order, and every write is
    // labelled with the client that made it. `tx:` on all three — the `User`, its
    // setup token and the `Staff` row — is the atomicity claim, stated where it can
    // be falsified: a write through the module client is a row that survives a
    // rollback. Only the school-name read afterwards is `module:`, and that is
    // after the commit by design.
    expect(writes).toEqual([
      'tx:user.create',
      'tx:user.update',
      'tx:staff.create',
      'module:school.findFirst',
    ])
    // Nothing went through the module client but the post-commit read.
    expect(writes.filter((write) => write.startsWith('module:'))).toEqual([
      'module:school.findFirst',
    ])
    // Every read inside the creation was too, with the scope the session carried.
    for (const read of reads) {
      expect(read.scope).toBe('tx')
    }
    expect(reads.map((read) => read.op)).toEqual(['role.findFirst', 'user.findFirst'])
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
    // The rollback was real because the writes were enlisted: the `User` row and
    // its token were attempted through `tx`, so restoring the snapshot is what
    // undoes them. A `module:` write here would have survived the rollback and this
    // assertion is where that shows.
    expect(writes).toEqual(['tx:user.create', 'tx:user.update', 'tx:staff.create(failed)'])
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
    // The link's ORIGIN, not just its path: `toContain('/set-password?token=vem_')`
    // passed for a link pointing anywhere on the internet, and a link built from
    // the wrong host is a 404 in the recipient's browser for a token that expires in
    // a day.
    expect(SENT[0]!.text).toContain('https://portal.example.test/set-password?token=vem_')
    expect(SENT[0]!.html).toContain('https://portal.example.test/set-password?token=vem_')
    // No other host appears anywhere in the message, so a second link cannot be the
    // one the recipient follows.
    const hosts = [...`${SENT[0]!.text} ${SENT[0]!.html}`.matchAll(/https?:\/\/[^/\s"'<>]+/g)].map(
      (match) => match[0],
    )
    expect([...new Set(hosts)]).toEqual(['https://portal.example.test'])
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
    // Never a success, as a claim about the body rather than about the status the
    // line above already pinned.
    expect(body.status).not.toBe('invited')
    expect(body).not.toHaveProperty('roleName')
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
  it('probes the gate for the caller\'s own tenant and school, not an arbitrary one', async () => {
    // The probe and the POST are separate call sites and either could be the one
    // that evaluates the gate against the wrong pair, so both are pinned.
    await GET()
    expect(teacherCreateChecks()).toEqual([
      { userId: 'head-1', key: 'teacher:create', tenantId: TENANT, schoolId: SCHOOL },
    ])

    asSiblingSchool()
    await GET()
    expect(teacherCreateChecks()[1]).toEqual({
      userId: 'head-3',
      key: 'teacher:create',
      tenantId: TENANT,
      schoolId: SIBLING_SCHOOL,
    })
  })

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