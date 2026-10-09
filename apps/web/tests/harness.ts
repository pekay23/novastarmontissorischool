import { mock, beforeEach } from 'bun:test'
import { NextRequest } from 'next/server'

/**
 * Mock `server-only` to prevent runtime errors in test environment.
 * In production, `server-only` throws if imported from client components.
 * In tests, we need to allow these imports to work since the test runner
 * evaluates modules in a context that isn't a Server Component.
 */
mock.module('server-only', () => ({}))

/**
 * The shared test harness.
 *
 * Bun's module-mock registry is global and outlives a test file, so a
 * `mock.module` factory in one file still applies when another file loads the same
 * module. Two consequences, and both are why this exists as a single shared
 * registration rather than per-file setup:
 *
 * 1. A factory that omits an export another loaded module imports throws
 *    `SyntaxError: Export named '...' not found` and takes down an unrelated test
 *    file. Every factory below therefore exports the *complete* surface of the
 *    module it replaces — `prisma` and `adminDatabaseSource` for `@/lib/prisma`,
 *    `provisionTenant` for the provisioning module, and nothing else for
 *    `next/headers`.
 * 2. Two files mocking the same module differently is a race with a build. Both
 *    get this one.
 *
 * 3. Because of (1), a test file must import this module BEFORE any `@/lib/*` module
 *    that reaches the database. `lib/queries.ts` imports `lib/prisma.ts`, so a file
 *    that imports `@/lib/queries` first evaluates the real Prisma handle before the
 *    factory below is registered. Import order within a test file is therefore
 *    load-bearing, and every file here puts `./harness` first with a comment saying
 *    why. This module deliberately imports no `@/lib/*` module itself, so it is
 *    always safe to load first.
 *
 * Nothing here talks to a database. Every model method is a `mock()` the test
 * controls, and the transaction handle is a distinct object from the root handle
 * so a test can assert *which* handle a query ran on.
 */

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

/** The cookie jar `next/headers` hands back. Mutated by `setCookies`. */
const jar = new Map<string, string>()

export function setCookies(entries: Record<string, string>): void {
  jar.clear()
  for (const [name, value] of Object.entries(entries)) jar.set(name, value)
}

export function clearCookies(): void {
  jar.clear()
}

/** A `RequestCookies`-shaped view. Only `get` is used by the app. */
const cookieStore = {
  get(name: string) {
    const value = jar.get(name)
    return value === undefined ? undefined : { name, value }
  },
  getAll() {
    return [...jar.entries()].map(([name, value]) => ({ name, value }))
  },
  has(name: string) {
    return jar.has(name)
  },
  set() {},
  delete() {},
  get size() {
    return jar.size
  },
  [Symbol.iterator]() {
    return jar[Symbol.iterator]()
  },
}

mock.module('next/headers', () => ({
  cookies: async () => cookieStore,
  // Full surface: `next/headers` also exports these, and another module that
  // imports one of them must not fail to load against this mock.
  headers: async () => new Headers(),
  draftMode: async () => ({ isEnabled: false, enable() {}, disable() {} }),
}))

mock.module('server-only', () => ({
  // `server-only` is a build-time guard. In tests we need the module to resolve
  // without throwing, so we replace it with a no-op.
  default: {},
}))

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export interface WhereArg {
  where?: Record<string, unknown>
  select?: Record<string, unknown>
  data?: Record<string, unknown>
  orderBy?: unknown
  take?: number
  skip?: number
}

const tenantFindMany = mock(async (_args: WhereArg): Promise<unknown[]> => [])
const tenantFindFirst = mock(async (_args: WhereArg): Promise<unknown> => null)
const tenantUpdate = mock(async (_args: WhereArg): Promise<unknown> => ({}))
const tenantCount = mock(async (_args: WhereArg): Promise<number> => 0)
const schoolFindMany = mock(async (_args: WhereArg): Promise<unknown[]> => [])
const schoolFindFirst = mock(async (_args: WhereArg): Promise<unknown> => null)
const schoolCount = mock(async (_args: WhereArg): Promise<number> => 0)
const userFindMany = mock(async (_args: WhereArg): Promise<unknown[]> => [])
const userFindFirst = mock(async (_args: WhereArg): Promise<unknown> => null)
const userCreate = mock(async (_args: WhereArg): Promise<unknown> => ({ id: 'user-created' }))
const userUpdate = mock(async (_args: WhereArg): Promise<unknown> => ({}))
const userCount = mock(async (_args: WhereArg): Promise<number> => 0)
const roleFindFirst = mock(async (_args: WhereArg): Promise<unknown> => null)
const auditFindMany = mock(async (_args: WhereArg): Promise<unknown[]> => [])
const auditFindFirst = mock(async (_args: WhereArg): Promise<unknown> => null)
const auditCount = mock(async (_args: WhereArg): Promise<number> => 0)
const auditCreate = mock(async (_args: WhereArg): Promise<unknown> => ({}))
const platformOperatorFindMany = mock(async (_args: WhereArg): Promise<unknown[]> => [])
const platformOperatorFindUnique = mock(async (_args: WhereArg): Promise<unknown> => null)
const platformOperatorUpdate = mock(async (_args: WhereArg): Promise<unknown> => ({}))
const queryRaw = mock(async (): Promise<unknown[]> => [])

/**
 * The operator row's `loginAttempts` and `lockedUntil` as the update mock believes
 * them to be.
 *
 * Simulated rather than stored on a row because `recordOperatorPasswordFailure` does
 * the increment in SQL (`SET "loginAttempts" = "loginAttempts" + 1`) and then reads
 * the result back. Without this the second statement would always see `undefined`,
 * the lockout branch would never fire, and the lockout test would pass for the wrong
 * reason — by asserting on a value nothing produced.
 *
 * `lockedUntil` is simulated too, and `givenOperators` reads it back onto the rows
 * it returns. That is what makes the lockout testable at all: the fifth wrong
 * password has to be visible to the *sixth, correct* attempt, or "the lock works"
 * would only ever mean "the fifth attempt was refused", which is true whether or not
 * an account is ever locked.
 */
let operatorLoginAttempts = 0
let operatorLockedUntil: Date | null = null

const OPERATOR_UPDATE_BEHAVIOUR = async (args: WhereArg): Promise<unknown> => {
  const data = args.data ?? {}
  const increment = (data.loginAttempts as { increment?: number } | undefined)?.increment
  if (data.lockedUntil instanceof Date) {
    operatorLockedUntil = data.lockedUntil
  } else if (data.lockedUntil === null) {
    operatorLockedUntil = null
  }
  if (increment !== undefined) {
    operatorLoginAttempts += increment
    return { loginAttempts: operatorLoginAttempts }
  }
  if (typeof data.loginAttempts === 'number') {
    operatorLoginAttempts = data.loginAttempts
  }
  return {}
}

platformOperatorUpdate.mockImplementation(OPERATOR_UPDATE_BEHAVIOUR)

/**
 * A second handle onto the same mocks, so a test can tell a pooled read from an
 * in-transaction one. Sharing one object would make every receiver assertion
 * vacuous — the pattern the portal's `system-config-route.test.ts` established.
 */
const TX = {
  tenant: { findMany: tenantFindMany, findFirst: tenantFindFirst, update: tenantUpdate, count: tenantCount },
  school: { findMany: schoolFindMany, findFirst: schoolFindFirst, count: schoolCount },
  user: {
    findMany: userFindMany,
    findFirst: userFindFirst,
    create: userCreate,
    update: userUpdate,
    count: userCount,
  },
  role: { findFirst: roleFindFirst },
  auditLog: {
    findMany: auditFindMany,
    findFirst: auditFindFirst,
    count: auditCount,
    create: auditCreate,
  },
  platformOperator: {
    findMany: platformOperatorFindMany,
    findUnique: platformOperatorFindUnique,
    update: platformOperatorUpdate,
  },
}

const $transaction = mock(
  async (fn: (tx: typeof TX) => Promise<unknown>, _bounds?: unknown): Promise<unknown> => fn(TX),
)

const ROOT = {
  tenant: { findMany: tenantFindMany, findFirst: tenantFindFirst, update: tenantUpdate, count: tenantCount },
  school: { findMany: schoolFindMany, findFirst: schoolFindFirst, count: schoolCount },
  user: {
    findMany: userFindMany,
    findFirst: userFindFirst,
    create: userCreate,
    update: userUpdate,
    count: userCount,
  },
  role: { findFirst: roleFindFirst },
  auditLog: {
    findMany: auditFindMany,
    findFirst: auditFindFirst,
    count: auditCount,
    create: auditCreate,
  },
  platformOperator: {
    findMany: platformOperatorFindMany,
    findUnique: platformOperatorFindUnique,
    update: platformOperatorUpdate,
  },
  $queryRaw: queryRaw,
  $transaction,
}

mock.module('@/lib/prisma', () => ({
  prisma: ROOT,
  adminDatabaseSource: () => 'SUPER_ADMIN_DATABASE_URL' as const,
}))

/**
 * Mock `@novastar/database` with the same ROOT prisma plus other exports.
 * We don't import the real module because it would evaluate before the mock is registered.
 * Instead, we provide the minimal surface needed by tests.
 */
mock.module('@novastar/database', () => ({
  prisma: ROOT,
  PrismaClient: class PrismaClient {},
  Prisma: {},
  DB_QUERY_TIMEOUT_MS: 30000,
  DbTimeoutError: class DbTimeoutError extends Error {},
  isDbTimeout: (e: unknown) => e instanceof Error && e.name === 'DbTimeoutError',
  withDbTimeout: async <T,>(promise: Promise<T>, _ms?: number): Promise<T> => promise,
  // Type exports are not needed at runtime
}))

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * The emails the console sent, and whether the next send should fail.
 *
 * `sendEmail` throws `EmailDeliveryError` rather than returning null, so a test that
 * wants the undelivered case has to make the throw happen — there is no way to
 * observe "it was swallowed" any more, which is the point of the change that made
 * delivery failures loud.
 *
 * The error class is declared here rather than imported from
 * `@novastar/notifications`: the mock below replaces that module, and
 * `lib/invite-user.ts` narrows with `instanceof` against the class the mock
 * exports, so the thrown instance and the checked class have to be the same object.
 */
export class EmailDeliveryError extends Error {
  readonly reason: 'not-configured' | 'provider-rejected'

  constructor(reason: 'not-configured' | 'provider-rejected', detail: string) {
    super(`[email] ${detail}`)
    this.name = 'EmailDeliveryError'
    this.reason = reason
  }
}

export const sentEmails: Array<{ to: string; subject: string; text: string; html: string }> = []

/** The reason the next `sendEmail` should reject, or null to let it through. */
let nextEmailFailure: 'not-configured' | 'provider-rejected' | null = null

/** Makes the next delivery attempt reject, as an unset key or a refused message would. */
export function failNextEmail(reason: 'not-configured' | 'provider-rejected' = 'not-configured'): void {
  nextEmailFailure = reason
}

export const sendEmail = mock(async (options: {
  to: string | string[]
  subject: string
  html?: string
  text?: string
}): Promise<{ id: string }> => {
  if (nextEmailFailure) {
    const reason = nextEmailFailure
    nextEmailFailure = null
    throw new EmailDeliveryError(
      reason,
      reason === 'not-configured'
        ? 'RESEND_API_KEY is not set, so no email can be sent.'
        : 'Resend refused the message.',
    )
  }
  sentEmails.push({
    to: Array.isArray(options.to) ? options.to.join(',') : options.to,
    subject: options.subject,
    text: options.text ?? '',
    html: options.html ?? '',
  })
  return { id: 'email-1' }
})

/** A rendered template, distinguishable per call without depending on real copy. */
function authTemplate(input: { actionUrl: string }): {
  subject: string
  html: string
  text: string
} {
  return {
    subject: 'Set your Novastar password',
    html: `<a href="${input.actionUrl}">Set my password</a>`,
    text: `Set your password: ${input.actionUrl}`,
  }
}

mock.module('@novastar/notifications', () => ({
  sendEmail,
  EmailDeliveryError,
  setPasswordTemplate: authTemplate,
  // The rest of the package's surface, for the reason in the docstring above: a
  // factory that omits an export another loaded module imports takes down a test
  // file that has nothing to do with email.
  verifyEmailTemplate: authTemplate,
  passwordResetTemplate: authTemplate,
  createNotification: async () => {},
  savePushSubscription: async () => {},
  sendBulkNotifications: async () => {},
  fillTemplate: (template: string) => template,
  NOTIFICATION_TEMPLATES: {},
}))

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/** What the harness reports a provisioning run produced. Tests override per case. */
export interface FakeProvisionResult {
  created: boolean
  tenant: {
    id: string
    name: string
    code: string
    domain: string | null
    isActive: boolean
    createdAt: Date
    updatedAt: Date
  }
  school: { id: string; code: string; name: string }
  admin: { id: string; email: string; roleName: string; created: boolean } | null
  permissionsCreated: number
  rolesCreated: number
}

export function fakeProvisionResult(overrides: Partial<FakeProvisionResult> = {}): FakeProvisionResult {
  return {
    created: true,
    tenant: {
      id: 'tenant-new',
      name: 'Riverside Montessori',
      code: 'riverside',
      domain: null,
      isActive: true,
      createdAt: new Date('2026-03-01T09:00:00.000Z'),
      updatedAt: new Date('2026-03-01T09:00:00.000Z'),
    },
    school: { id: 'school-new', code: 'riverside', name: 'Riverside Montessori' },
    admin: { id: 'user-new', email: 'head@riverside.test', roleName: 'HEADMASTER', created: true },
    permissionsCreated: 84,
    rolesCreated: 7,
    ...overrides,
  }
}

export const provisionTenant = mock(async (_input: unknown): Promise<FakeProvisionResult> =>
  fakeProvisionResult(),
)

mock.module('@novastar/tenant-cli/provision', () => ({
  provisionTenant,
  // The full surface `tools/tenant-cli/provision.ts` exports. Omitting any of
  // these makes a module that imports them fail to load with
  // `SyntaxError: Export named '...' not found`.
  DEFAULT_ADMIN_ROLE: 'HEADMASTER',
  MIN_ADMIN_PASSWORD_LENGTH: 8,
  ADMIN_PASSWORD_ENV_VAR: 'TENANT_ADMIN_PASSWORD',
  ProvisionInputError: class ProvisionInputError extends Error {},
  assertAdminPassword: (admin?: { password?: string } | null): string => {
    const password = admin?.password ?? ''
    if (password.length < 8) throw new Error('The administrator password must be at least 8 characters.')
    return password
  },
  normalizeProvisionInput: (input: unknown): unknown => input,
  hashPassword: async (password: string): Promise<string> => `argon2id$${password.length}`,
}))

// ---------------------------------------------------------------------------
// Platform operators
// ---------------------------------------------------------------------------

/**
 * A `PlatformOperator` row as the app reads it.
 *
 * Two facts about how the app reads operators are encoded here rather than in each
 * test, because getting either wrong makes a test pass for the wrong reason:
 *
 * - `passwordHash` is a real argon2id PHC string, not a stub. The sign-in path runs
 *   `argon2.verify` for every attempt — including attempts against no account — and
 *   a stub hash would make "the password verified" mean nothing.
 * - `capabilities` defaults to the whole vocabulary, so a test that is not about
 *   grants is not accidentally testing an operator who holds nothing.
 */
export interface FakeOperator {
  id: string
  username: string
  email: string
  name: string | null
  passwordHash: string
  status: string
  capabilities: string[]
  mustChangePassword: boolean
  lastLoginAt: Date | null
  loginAttempts: number | null
  lockedUntil: Date | null
}

/**
 * argon2id of `OPERATOR_PASSWORD`, at the console's own OWASP parameters.
 *
 * Committed rather than hashed in a `beforeAll` so the value is identical in every
 * run and a change to the console's hashing parameters cannot silently move it. Its
 * plaintext is published here, which is fine and is the point: this fixture models a
 * credential whose hash is known to the test suite and grants nobody anything.
 */
export const OPERATOR_PASSWORD = 'Correct-Horse-Battery-1!'
export const OPERATOR_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$alYyIEEl+7Bi1AhJLimOFA$wnOUmXaRVQDRmNYfvHeX7/AwCVVdOzYq+GuIy9k3AFY'

/** A second published hash, for the "right operator, wrong password" cases. */
export const OTHER_OPERATOR_PASSWORD = 'the-wrong-one-entirely'
export const OTHER_OPERATOR_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$n7R9g1Qo3L3lEAvFQUBjHA$/kZwysoVW1Ht9tahCFQqaMJYitlSEhW0We0h+EIkEzA'

/** A hash that is not a valid argon2 PHC string, for the malformed-row case. */
export const MALFORMED_HASH = 'argon2id$not-a-real-phc-string'

export function fakeOperator(overrides: Partial<FakeOperator> = {}): FakeOperator {
  return {
    id: 'operator-1',
    username: 'ops',
    email: 'ops@novastar.test',
    name: 'Platform Operations',
    passwordHash: OPERATOR_HASH,
    status: 'ACTIVE',
    capabilities: [
      'platform:read',
      'platform:audit',
      'tenant:read',
      'tenant:update',
      'tenant:provision',
      'tenant:config',
      'tenant:user:read',
      'tenant:user:create',
      'tenant:user:update',
      'tenant:school:create',
      'tenant:school:update',
      'tenant:school:delete',
    ],
    mustChangePassword: false,
    lastLoginAt: null,
    loginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  }
}

/**
 * Arms the sign-in lookup with real rows.
 *
 * The mock *matches* the identifier against `username` and `email` rather than
 * returning the rows unconditionally, so a test asserting that a username works and
 * an email works is asserting the `OR` in `findOperatorByIdentifier` really resolves
 * each half — not that a stub hands back a row whatever it is asked. Matching is
 * case-insensitive, matching the query it stands in for.
 */
export function givenOperators(...rows: readonly FakeOperator[]): void {
  platformOperatorFindMany.mockImplementation(async (args) => {
    const clause = args.where?.OR as
      | Array<{ username?: { equals?: string }; email?: { equals?: string } }>
      | undefined
    if (!Array.isArray(clause)) return []
    const matched = rows.filter((row) =>
      clause.some(
        (branch) =>
          branch.username?.equals?.toLowerCase() === row.username.toLowerCase() ||
          branch.email?.equals?.toLowerCase() === row.email.toLowerCase(),
      ),
    )
    // Overlay the lockout the update mock has simulated, so a lock written by one
    // attempt is read by the next — see `OPERATOR_UPDATE_BEHAVIOUR`.
    return matched.map((row) => ({
      ...row,
      loginAttempts: operatorLoginAttempts > 0 ? operatorLoginAttempts : row.loginAttempts,
      lockedUntil: operatorLockedUntil ?? row.lockedUntil,
    }))
  })
}

/**
 * Arms the per-request live read that backs `resolveLiveOperator`.
 *
 * Separate from `givenOperators` on purpose: the live read is by primary key and is
 * the immediate-revocation mechanism, so a test that only arms the sign-in lookup has
 * modelled a console nobody can hold a session in. Most tests that need an operator
 * want both.
 */
export function givenLiveOperator(row: FakeOperator | null): void {
  platformOperatorFindUnique.mockImplementation(async (args) =>
    row && args.where?.id === row.id ? row : null,
  )
}

/**
 * The `AdminOperator` a session token is minted from for `row`.
 *
 * A plain object rather than a `signedInAs` helper that also sets the cookie,
 * because this module must not import `@/lib/admin-auth`: it registers the
 * `mock.module('@/lib/prisma')` factory, and `admin-auth` reaches `queries` reaches
 * `prisma`, so importing it here would evaluate the real Prisma handle before the
 * mock is registered. Each test file imports `./harness` first and mints its own
 * token, which is also how the previous version of these tests were written.
 */
export function operatorClaims(
  row: FakeOperator,
  overrides: {
    issuedAt?: number
    expiresAt?: number
    capabilities?: readonly string[]
    id?: string
  } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: overrides.id ?? row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    issuedAt: overrides.issuedAt ?? now,
    expiresAt: overrides.expiresAt ?? now + 3600,
    capabilities: overrides.capabilities ?? row.capabilities,
    mustChangePassword: row.mustChangePassword,
  }
}

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

const MODEL_MOCKS = [
  tenantFindMany,
  tenantFindFirst,
  tenantUpdate,
  tenantCount,
  schoolFindMany,
  schoolFindFirst,
  schoolCount,
  userFindMany,
  userFindFirst,
  userCreate,
  userUpdate,
  userCount,
  roleFindFirst,
  auditFindMany,
  auditFindFirst,
  auditCount,
  auditCreate,
  platformOperatorFindMany,
  platformOperatorFindUnique,
  platformOperatorUpdate,
  queryRaw,
  $transaction,
]

/**
 * Resets every mock and clears the cookie jar.
 *
 * Reset rather than only clear: a leaked implementation from one test would let
 * the next pass on data it did not set up.
 */
export function resetHarness(): void {
  clearCookies()
  for (const m of [...MODEL_MOCKS, provisionTenant]) m.mockReset()
  tenantFindMany.mockImplementation(async () => [])
  tenantFindFirst.mockImplementation(async () => null)
  tenantUpdate.mockImplementation(async () => ({}))
  tenantCount.mockImplementation(async () => 0)
  schoolFindMany.mockImplementation(async () => [])
  schoolFindFirst.mockImplementation(async () => null)
  schoolCount.mockImplementation(async () => 0)
  userFindMany.mockImplementation(async () => [])
  userFindFirst.mockImplementation(async () => null)
  userCreate.mockImplementation(async () => ({ id: 'user-created' }))
  userUpdate.mockImplementation(async () => ({}))
  userCount.mockImplementation(async () => 0)
  roleFindFirst.mockImplementation(async () => null)
  auditFindMany.mockImplementation(async () => [])
  auditFindFirst.mockImplementation(async () => ({ hash: null }))
  auditCount.mockImplementation(async () => 0)
  auditCreate.mockImplementation(async () => ({}))
operatorLoginAttempts = 0
  operatorLockedUntil = null
  platformOperatorFindMany.mockImplementation(async () => [])
  platformOperatorFindUnique.mockImplementation(async () => null)
  platformOperatorUpdate.mockImplementation(OPERATOR_UPDATE_BEHAVIOUR)
  queryRaw.mockImplementation(async () => [])
  $transaction.mockImplementation(async (fn: (tx: typeof TX) => Promise<unknown>) => fn(TX))
  provisionTenant.mockImplementation(async () => fakeProvisionResult())
  sentEmails.length = 0
  nextEmailFailure = null
  sendEmail.mockImplementation(async (options) => {
    if (nextEmailFailure) {
      const reason = nextEmailFailure
      nextEmailFailure = null
      throw new EmailDeliveryError(reason, 'delivery refused by the test harness')
    }
    sentEmails.push({
      to: Array.isArray(options.to) ? options.to.join(',') : options.to,
      subject: options.subject,
      text: options.text ?? '',
      html: options.html ?? '',
    })
    return { id: 'email-1' }
  })
}

/** Every database call made since the last reset, so a refusal can be proven inert. */
export function databaseCalls(): number {
  return MODEL_MOCKS.reduce((total, m) => total + m.mock.calls.length, 0)
}

export const mocks = {
  tenantFindMany,
  tenantFindFirst,
  tenantUpdate,
  tenantCount,
  schoolFindMany,
  schoolFindFirst,
  schoolCount,
  userFindMany,
  userFindFirst,
  userCreate,
  userUpdate,
  userCount,
  roleFindFirst,
  auditFindMany,
  auditFindFirst,
  auditCount,
  auditCreate,
  platformOperatorFindMany,
  platformOperatorFindUnique,
  platformOperatorUpdate,
  queryRaw,
  $transaction,
}

export { $transaction }

/** A `NextRequest` for the given path, method and body. */
export function request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...init.headers },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

/** The input the console handed `provisionTenant`, typed for the assertions. */
export interface DelegatedProvisionInput {
  readonly tenant?: {
    readonly name?: string
    readonly code?: string
    readonly domain?: string | null
    readonly settings?: unknown
  }
  readonly school?: Readonly<Record<string, unknown>>
  readonly admin?: { readonly email?: string; readonly password?: string; readonly roleName?: string }
}

/**
 * The most recent input passed to `provisionTenant`, or `undefined` if it was
 * never called.
 *
 * A named accessor rather than `mock.calls[0][0]` at every call site: the mock's
 * parameter is `unknown` by design — the harness does not claim to know the shared
 * function's signature — so every direct read is a cast, and a cast is a place a
 * test can be wrong quietly. The assertion "the console delegated exactly this"
 * stays legible instead.
 */
export function lastProvisionInput(): DelegatedProvisionInput | undefined {
  const call = provisionTenant.mock.calls.at(-1)
  return call?.[0] as DelegatedProvisionInput | undefined
}

/**
 * Re-register the complete prisma mocks before each test.
 *
 * Other test files (e.g., admissions-status-route.test.ts) overwrite the
 * `@/lib/prisma` and `@novastar/database` mocks at module scope with incomplete
 * versions that only include the models they need. This `beforeEach` restores the
 * harness's complete mock so that tests like `create-user.test.ts` always see the
 * full `prisma` surface including `platformOperator`, `auditLog.create`, etc.
 */
beforeEach(() => {
  mock.module('@/lib/prisma', () => ({
    prisma: ROOT,
    adminDatabaseSource: () => 'SUPER_ADMIN_DATABASE_URL' as const,
  }))
  mock.module('@novastar/database', () => ({
    prisma: ROOT,
    PrismaClient: class PrismaClient {},
    Prisma: {},
    DB_QUERY_TIMEOUT_MS: 30000,
    DbTimeoutError: class DbTimeoutError extends Error {},
    isDbTimeout: (e: unknown) => e instanceof Error && e.name === 'DbTimeoutError',
    withDbTimeout: async <T,>(promise: Promise<T>, _ms?: number): Promise<T> => promise,
  }))
})
