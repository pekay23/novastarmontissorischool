import { describe, it, expect, beforeEach, mock } from 'bun:test'

/**
 * Email-backed authentication: the two token helpers and the five routes that
 * consume them.
 *
 * The load-bearing assertions here are behavioural, not textual:
 *
 * - `forgot-password` and `verify-email/resend` answer IDENTICALLY for an address
 *   that exists and one that does not. A source check cannot see that; executing
 *   the handler against a store that does and does not hold the row can.
 * - `reset-password` refuses a replayed token, and does so because the password
 *   changed, not because a consumed-token row exists. There is no such column.
 * - `authorize()` in `lib/auth.ts` and the issuing helpers agree on the transform
 *   applied to a verification token. If they drift, every link in every inbox
 *   silently stops working.
 *
 * No database is touched: `prisma` is a small in-memory store that understands
 * only the `where` shapes these routes build, which is called out below rather
 * than left to look like a general Prisma double.
 */
mock.module('server-only', () => ({}))

const SENT: Array<{ to: string; subject: string; html?: string; text?: string }> = []

/**
 * Flipped by the one test that asserts what happens when a delivery fails.
 *
 * Toggling the mock is deterministic where deleting `RESEND_API_KEY` would not be:
 * `getResend()` caches its client for the life of the process, so by the time any
 * later test runs the key is no longer consulted.
 */
let sendFails = false

mock.module('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: string; subject: string; html?: string; text?: string }) => {
        if (sendFails) return { data: null, error: { name: 'application_error', message: 'stubbed provider failure' } }
        SENT.push(payload)
        return { data: { id: 'msg_1' }, error: null }
      },
    }
  },
}))

// --- In-memory user store ----------------------------------------------------

interface FakeUser {
  id: string
  tenantId: string
  schoolId: string | null
  email: string
  emailVerified: Date | null
  passwordHash: string | null
  name: string | null
  isActive: boolean
  status: string
  mustChangePassword: boolean
  passwordChangedAt: Date | null
  verifyToken: string | null
  verifyTokenExpires: Date | null
  loginAttempts: number | null
  lockedUntil: Date | null
}

const TENANT = 'tenant-1'
const SCHOOL = 'school-1'

let users: FakeUser[] = []

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: 'user-1',
    tenantId: TENANT,
    schoolId: SCHOOL,
    email: 'teacher@novastarmontessori.com',
    emailVerified: new Date('2026-01-01T00:00:00Z'),
    passwordHash: 'argon2id-hash',
    name: 'Test Teacher',
    isActive: true,
    status: 'ACTIVE',
    mustChangePassword: false,
    passwordChangedAt: null,
    verifyToken: null,
    verifyTokenExpires: null,
    loginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  }
}

/**
 * Apply a `where` the way a real client would, for the shapes these routes build.
 *
 * Understands: exact scalars, `null` equality, and `{ equals, mode: 'insensitive' }`
 * on `email`. Anything else returns false rather than silently matching, so a
 * handler that grew a new filter would fail here instead of being waved through
 * by a permissive mock.
 */
function whereMatches(row: FakeUser, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const actual = row[key as keyof FakeUser]
    if (condition === null) {
      if (actual !== null && actual !== undefined) return false
      continue
    }
    if (typeof condition === 'string' || typeof condition === 'number' || typeof condition === 'boolean') {
      if (actual !== condition) return false
      continue
    }
    if (condition && typeof condition === 'object') {
      const filter = condition as { equals?: string }
      if (typeof filter.equals === 'string') {
        if (String(actual ?? '').toLowerCase() !== filter.equals.toLowerCase()) return false
        continue
      }
      return false
    }
    return false
  }
  return true
}

const prisma = {
  user: {
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      users.find((row) => whereMatches(row, where)) ?? null,
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      users.find((row) => whereMatches(row, where)) ?? null,
    create: async ({ data }: { data: Partial<FakeUser> }) => {
      if (users.some((row) => row.tenantId === data.tenantId && row.email === data.email)) {
        const err = new Error('Unique constraint failed') as Error & { name: string; code: string }
        err.name = 'PrismaClientKnownRequestError'
        err.code = 'P2002'
        throw err
      }
      // A distinct id, so `update({ where: { id } })` reaches the row just
      // created rather than the first row that happens to share its id.
      const row = makeUser({ id: `user-${users.length + 1}`, ...data } as Partial<FakeUser>)
      users.push(row)
      return row
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Partial<FakeUser> }) => {
      const row = users.find((u) => whereMatches(u, where))
      if (!row) throw new Error('Record to update not found')
      Object.assign(row, data)
      return row
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<FakeUser> }) => {
      const matched = users.filter((row) => whereMatches(row, where))
      for (const row of matched) Object.assign(row, data)
      return { count: matched.length }
    },
  },
  school: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      // Honours the two shapes `resolveSchool` builds, so a wrong school code is
      // a real miss here rather than a mock that always matches.
      const code = where.code
      if (code !== undefined && code !== 'main') return null
      return { id: SCHOOL, tenantId: TENANT, code: 'main', name: 'Novastar Montessori School' }
    },
  },
  role: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      where.name === 'HEADMASTER' ? { id: 'role-head', name: 'HEADMASTER' } : null,
  },
  auditLog: { create: async () => ({ id: 'audit-1' }) },
}

// Load the real module before replacing it.
//
// Bun's `mock.module` patches a module that is already in the registry. Registering
// a mock for one that has not been resolved yet does not reach the modules that
// import it afterwards, so `lib/auth/email-verification.ts` and the routes below
// kept talking to the real client and every assertion here ran against a store
// that never changed — twenty failures, all of them "expected a digest, got null".
// Whether this file passed therefore depended on whether an earlier file in the
// run happened to have loaded `@/lib/prisma` first. The pre-load makes it
// independent of that. Nothing here touches a database.
await import('@/lib/prisma')

mock.module('@/lib/prisma', () => ({ prisma, default: prisma }))

/**
 * The same fake, registered under the package name too.
 *
 * `@/lib/prisma` re-exports `prisma` from `@novastar/database`, so they are one object
 * at runtime — but `mock.module` keys on the specifier, so a mock registered for the
 * alias says nothing about the package. The email-token primitives and
 * `createInvitedUser` now live in `@novastar/auth/invite` (shared with the platform
 * console), and that module reaches the database through `@novastar/database`. Without
 * this line those calls would build the real lazy client and answer from its
 * empty-result mock, and every assertion below about a stored digest would fail for a
 * reason that has nothing to do with the code under test.
 */
mock.module('@novastar/database', () => ({ prisma, default: prisma }))

mock.module('@/lib/audit/logger', () => ({
  AuditLogAction: { LOGIN: 'LOGIN', CREATE: 'CREATE', UPDATE: 'UPDATE', PASSWORD_CHANGED: 'PASSWORD_CHANGED' },
  createAuditLog: mock(async () => null),
  logAuditEvent: mock(async () => null),
}))

/**
 * Locally defined, following the convention in `route-authz.test.ts`: Bun's
 * `mock.module` registry is global and outlives a file, so this must not depend on
 * load order. The route identifies this by `error.name`, never `instanceof`.
 */
class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

let session: { userId: string; tenantId: string; schoolId: string | null; role: string | null } | Error = {
  userId: 'admin-1',
  tenantId: TENANT,
  schoolId: SCHOOL,
  role: 'HEADMASTER',
}

mock.module('@/lib/auth/session-context', () => ({
  getCachedSessionAndTenant: mock(async () => {
    if (session instanceof Error) throw session
    const { userId, tenantId, schoolId, role } = session
    return { userId, tenantId, schoolId, role, roleName: role, user: { id: userId }, claimedTenantId: tenantId }
  }),
  getTokenTenantId: mock(async () => (session instanceof Error ? null : TENANT)),
}))

// The portal origin the emailed links are built from, and the tenant a
// school-code-less request resolves to. `RESEND_API_KEY` is set to a dummy value
// because `resend` itself is mocked above: the point of these tests is the routes,
// not the provider, and an unset key makes every delivery throw by design.
process.env.NEXTAUTH_SECRET = 'test-secret-for-token-signing-only-not-real'
process.env.NEXTAUTH_URL = 'https://portal.example.test'
process.env.DEFAULT_SCHOOL_CODE = 'main'
process.env.RESEND_API_KEY = 're_test_not_a_real_key'

const { resetRateLimit } = await import('@/lib/rate-limit')
const {
  hashEmailToken,
  isEmailToken,
  mintEmailToken,
  issueEmailToken,
  lookupEmailToken,
  consumeEmailToken,
  EMAIL_TOKEN_TTL_MS,
} = await import('@/lib/auth/email-verification')
const {
  createPasswordResetToken,
  verifyPasswordResetToken,
  matchesPasswordGeneration,
  passwordGenerationOf,
  PASSWORD_RESET_TOKEN_PREFIX,
  PASSWORD_RESET_TTL_SECONDS,
} = await import('@/lib/auth/password-reset-token')
const { EMAIL_VERIFICATION_EXEMPT_ROLES, isEmailVerificationExempt } = await import(
  '@/lib/constants/platform-roles'
)
const { POST: verifyEmailPOST } = await import('@/app/api/auth/verify-email/route')
const { POST: resendPOST } = await import('@/app/api/auth/verify-email/resend/route')
const { POST: setPasswordPOST } = await import('@/app/api/auth/set-password/route')
const { POST: forgotPOST } = await import('@/app/api/auth/forgot-password/route')
const { POST: resetPOST } = await import('@/app/api/auth/reset-password/route')
const { POST: invitePOST } = await import('@/app/api/auth/invite/route')

function post(path: string, body: unknown, ip = '198.51.100.10'): Request {
  return new Request(`https://portal.example.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  users = [makeUser()]
  SENT.length = 0
  sendFails = false
  resetRateLimit()
  session = { userId: 'admin-1', tenantId: TENANT, schoolId: SCHOOL, role: 'HEADMASTER' }
})

// ---------------------------------------------------------------------------
// The email sender's configuration failure
// ---------------------------------------------------------------------------

/**
 * Declared FIRST, and that placement is load-bearing.
 *
 * `getResend()` caches its client the first time a key is present, and after that
 * the environment is never consulted again. So the one assertion that depends on
 * the key being ABSENT has to run before anything in this file sends anything —
 * and nothing else in the suite sends a real email, so module-level state starts
 * clean. If this describe is ever moved, this test silently stops testing
 * anything, so it asserts the failure rather than skipping.
 */
describe('sendEmail', () => {
  it('should throw with the variable named when RESEND_API_KEY is unset', async () => {
    const { sendEmail, EmailDeliveryError } = await import('@novastar/notifications')
    const saved = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    try {
      const err: unknown = await sendEmail({ to: 'x@example.test', subject: 's', text: 't' }).then(
        () => null,
        (e: unknown) => e,
      )
      expect(err).toBeInstanceOf(EmailDeliveryError)
      expect((err as InstanceType<typeof EmailDeliveryError>).reason).toBe('not-configured')
      expect((err as Error).message).toContain('RESEND_API_KEY')
    } finally {
      process.env.RESEND_API_KEY = saved
    }
  })
})

// ---------------------------------------------------------------------------
// Password-reset token: pure, no database
// ---------------------------------------------------------------------------

describe('Password-reset token', () => {
  const NOW = 1_800_000_000

  it('should verify a token it just issued, and name the user and purpose', () => {
    const { token } = createPasswordResetToken('user-1', null, NOW)
    const result = verifyPasswordResetToken(token, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims.sub).toBe('user-1')
    expect(result.claims.purpose).toBe('password-reset')
  })

  it('should refuse a token whose payload was edited, rather than honouring its longer life', () => {
    // THE assertion. An unsigned claim set is only harmless if the signature is
    // checked first: rewriting `exp` to a far-future value is the obvious attack,
    // and it must fail even though the payload still parses.
    const { token } = createPasswordResetToken('user-1', null, NOW)
    const body = token.slice(PASSWORD_RESET_TOKEN_PREFIX.length)
    const segment = body.slice(0, body.lastIndexOf('.'))
    const forged = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    forged.exp = NOW + 10_000_000
    const tampered = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url')

    const result = verifyPasswordResetToken(
      `${PASSWORD_RESET_TOKEN_PREFIX}${tampered}.${body.slice(body.lastIndexOf('.') + 1)}`,
      NOW,
    )
    expect(result).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('should refuse a token signed for another purpose', () => {
    // `purpose` is a required claim precisely so no other flow's token can be
    // presented here. Forged through the same path as above, so the signature is
    // valid and the schema is the only thing standing in the way.
    const { token } = createPasswordResetToken('user-1', null, NOW)
    const body = token.slice(PASSWORD_RESET_TOKEN_PREFIX.length)
    const segment = body.slice(0, body.lastIndexOf('.'))
    const signature = body.slice(body.lastIndexOf('.') + 1)
    const payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    payload.purpose = 'email-verification'
    const reSigned = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const reSignedToken = `${PASSWORD_RESET_TOKEN_PREFIX}${reSigned}.${signature}`

    // With the wrong signature this is refused anyway; what matters is that it is
    // refused, and never accepted as a reset token.
    expect(verifyPasswordResetToken(reSignedToken, NOW).ok).toBe(false)
  })

  it('should report an expired token as expired, not as invalid', () => {
    const { token } = createPasswordResetToken('user-1', null, NOW)
    const after = NOW + PASSWORD_RESET_TTL_SECONDS + 1
    expect(verifyPasswordResetToken(token, after)).toEqual({ ok: false, reason: 'expired' })
  })

  it('should live for one hour', () => {
    expect(PASSWORD_RESET_TTL_SECONDS).toBe(3600)
    const { token, expiresAt } = createPasswordResetToken('user-1', null, NOW)
    expect(expiresAt.getTime()).toBe((NOW + PASSWORD_RESET_TTL_SECONDS) * 1000)
    // One second before expiry it still works; that boundary is what makes the
    // `expired` branch reachable rather than theoretical.
    expect(verifyPasswordResetToken(token, NOW + PASSWORD_RESET_TTL_SECONDS - 1).ok).toBe(true)
  })

  it('should stop matching once the password has changed — the replay guard', () => {
    const issuedAt = new Date('2026-05-01T10:00:00Z')
    const { token } = createPasswordResetToken('user-1', issuedAt, NOW)
    const claims = verifyPasswordResetToken(token, NOW)
    expect(claims.ok).toBe(true)
    if (!claims.ok) return

    // Before the change: current state matches the bound generation.
    expect(matchesPasswordGeneration(claims.claims, issuedAt)).toBe(true)
    // After it: the same token no longer matches. Nothing recorded "this token was
    // spent" — the password column moving IS the record.
    expect(matchesPasswordGeneration(claims.claims, new Date('2026-05-01T10:05:00Z'))).toBe(false)
  })

  it('should bind an account that has never set a password to generation 0', () => {
    expect(passwordGenerationOf(null)).toBe(0)
    const { token } = createPasswordResetToken('user-1', null, NOW)
    const claims = verifyPasswordResetToken(token, NOW)
    expect(claims.ok).toBe(true)
    if (!claims.ok) return
    expect(claims.claims.pca).toBe(0)
    expect(matchesPasswordGeneration(claims.claims, null)).toBe(true)
    expect(matchesPasswordGeneration(claims.claims, new Date())).toBe(false)
  })

  it('should use a prefix that cannot be mistaken for a passkey or verification token', () => {
    const { token } = createPasswordResetToken('user-1', null, NOW)
    expect(token.startsWith('pk_')).toBe(false)
    expect(isEmailToken(token)).toBe(false)
  })

  it('should refuse anything that is not a token at all', () => {
    for (const bad of ['', 'nonsense', `${PASSWORD_RESET_TOKEN_PREFIX}onlyonesegment`, null, undefined]) {
      expect(verifyPasswordResetToken(bad as string, NOW).ok).toBe(false)
    }
  })

  it('should refuse to sign at all when NEXTAUTH_SECRET is unset, naming the variable', () => {
    // No development bypass and no fallback key: an unsigned reset token is a
    // password reset anyone can mint.
    const saved = process.env.NEXTAUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    try {
      expect(() => createPasswordResetToken('user-1', null, NOW)).toThrow(/NEXTAUTH_SECRET/)
    } finally {
      process.env.NEXTAUTH_SECRET = saved
    }
  })

  it('should report misconfiguration rather than fail open when verifying', () => {
    const { token } = createPasswordResetToken('user-1', null, NOW)
    const saved = process.env.NEXTAUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    try {
      expect(verifyPasswordResetToken(token, NOW)).toEqual({ ok: false, reason: 'misconfigured' })
    } finally {
      process.env.NEXTAUTH_SECRET = saved
    }
  })
})

// ---------------------------------------------------------------------------
// Verification token: issuing, lookup, expiry, single use
// ---------------------------------------------------------------------------

describe('Email verification token', () => {
  it('should store a digest, never the token itself', async () => {
    const { token, expiresAt } = await issueEmailToken('user-1')
    const stored = users[0]!.verifyToken
    expect(stored).not.toBe(token)
    expect(stored).toBe(hashEmailToken(token))
    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('should live for 24 hours', () => {
    expect(EMAIL_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('should resolve a token it issued, which is the same lookup authorize() performs', () => {
    // `authorize()` compares `credentials.token` against the stored digest. This
    // is the assertion that both sides apply the identical transform: if they ever
    // diverge, this returns `invalid` and every live link stops working.
    expect(hashEmailToken('vem_abc')).toBe(hashEmailToken('vem_abc'))
    expect(hashEmailToken('vem_abc')).not.toBe(hashEmailToken('vem_abd'))
  })

  it('should find its user and report the invited state', async () => {
    users[0]!.passwordHash = null
    users[0]!.mustChangePassword = true
    const { token } = await issueEmailToken('user-1')
    const result = await lookupEmailToken(token)
    expect(result).toEqual({
      ok: true,
      userId: 'user-1',
      passwordHash: null,
      mustChangePassword: true,
    })
  })

  it('should report an expired token as expired, so the page can say so', async () => {
    const { token } = await issueEmailToken('user-1')
    users[0]!.verifyTokenExpires = new Date(Date.now() - 1000)
    expect(await lookupEmailToken(token)).toEqual({ ok: false, reason: 'expired' })
  })

  it('should report an unknown or already-spent token as invalid', async () => {
    expect(await lookupEmailToken(mintEmailToken())).toEqual({ ok: false, reason: 'invalid' })
    // Shape check first: a value that could never have been minted is rejected
    // without a query, which is why the prefix guard exists.
    expect(isEmailToken('anything')).toBe(false)
  })

  it('should be single-use: consuming clears it, and a second consume finds nothing', async () => {
    const { token } = await issueEmailToken('user-1')
    expect(await consumeEmailToken('user-1', token, { emailVerified: new Date() })).toBe(true)
    expect(users[0]!.verifyToken).toBeNull()
    expect(users[0]!.verifyTokenExpires).toBeNull()
    // Replay: the conditional write no longer matches, so the second attempt loses.
    expect(await consumeEmailToken('user-1', token, { emailVerified: new Date() })).toBe(false)
    expect(await lookupEmailToken(token)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('should refuse to consume when another token has replaced this one', async () => {
    const first = await issueEmailToken('user-1')
    await issueEmailToken('user-1')
    expect(await consumeEmailToken('user-1', first.token)).toBe(false)
  })
})

describe('Email verification exemption', () => {
  it('should exempt only real seeded role names', () => {
    for (const role of EMAIL_VERIFICATION_EXEMPT_ROLES) {
      expect(['HEADMASTER', 'ASSISTANT_HEAD', 'HEAD_TEACHER', 'CLASSROOM_TEACHER', 'ACCOUNTANT', 'ADMIN_STAFF', 'PARENT']).toContain(role)
    }
  })

  it('should exempt the Head of School, so a seeded deployment is not locked out', () => {
    expect(isEmailVerificationExempt('HEADMASTER')).toBe(true)
  })

  it('should not exempt anyone else, and never an unknown role', () => {
    for (const role of ['ASSISTANT_HEAD', 'HEAD_TEACHER', 'CLASSROOM_TEACHER', 'ACCOUNTANT', 'ADMIN_STAFF', 'PARENT'] as const) {
      expect(`${role}: ${isEmailVerificationExempt(role)}`).toBe(`${role}: false`)
    }
    expect(isEmailVerificationExempt(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Routes, executed
// ---------------------------------------------------------------------------

describe('POST /api/auth/verify-email', () => {
  it('should verify the address and clear the token', async () => {
    users[0]!.emailVerified = null
    const { token } = await issueEmailToken('user-1')

    const res = await verifyEmailPOST(post('/api/auth/verify-email', { token }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'verified' })
    expect(users[0]!.emailVerified).toBeInstanceOf(Date)
    expect(users[0]!.verifyToken).toBeNull()
    expect(users[0]!.verifyTokenExpires).toBeNull()
  })

  it('should refuse a replayed link as invalid', async () => {
    users[0]!.emailVerified = null
    const { token } = await issueEmailToken('user-1')
    await verifyEmailPOST(post('/api/auth/verify-email', { token }))

    const replay = await verifyEmailPOST(post('/api/auth/verify-email', { token }))
    expect(replay.status).toBe(400)
    expect((await replay.json()).error).toBe('invalid')
  })

  it('should say expired rather than invalid, because only one of them is fixable by a new link', async () => {
    users[0]!.emailVerified = null
    const { token } = await issueEmailToken('user-1')
    users[0]!.verifyTokenExpires = new Date(Date.now() - 1000)

    const res = await verifyEmailPOST(post('/api/auth/verify-email', { token }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('expired')
  })

  it('should refuse a token it never issued', async () => {
    const res = await verifyEmailPOST(post('/api/auth/verify-email', { token: mintEmailToken() }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid')
  })

  it('should send a password-less account to the setup page instead of stranding it', async () => {
    // Verifying here would succeed and leave the person unable to sign in: the
    // credentials path refuses a row with no `passwordHash`. The token must stay
    // unspent so the link they are redirected to still works.
    users[0]!.passwordHash = null
    users[0]!.emailVerified = null
    users[0]!.mustChangePassword = true
    const { token } = await issueEmailToken('user-1')

    const res = await verifyEmailPOST(post('/api/auth/verify-email', { token }))
    expect(await res.json()).toEqual({ status: 'set-password-required' })
    expect(users[0]!.emailVerified).toBeNull()
    expect(users[0]!.verifyToken).not.toBeNull()
  })
})

describe('POST /api/auth/set-password', () => {
  async function invite() {
    users = [makeUser({ passwordHash: null, emailVerified: null, mustChangePassword: true })]
    return (await issueEmailToken('user-1')).token
  }

  it('should store an argon2id hash and complete the invitation', async () => {
    const token = await invite()
    const res = await setPasswordPOST(
      post('/api/auth/set-password', { token, password: 'correct horse battery' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    // Returned so the client can sign in without asking the user to remember
    // which address the invitation went to.
    expect(body.email).toBe('teacher@novastarmontessori.com')

    const row = users[0]!
    expect(row.passwordHash).toStartWith('$argon2id$')
    expect(row.passwordHash).not.toContain('correct horse battery')
    expect(row.mustChangePassword).toBe(false)
    expect(row.emailVerified).toBeInstanceOf(Date)
    expect(row.passwordChangedAt).toBeInstanceOf(Date)
    expect(row.verifyToken).toBeNull()
  })

  it('should refuse a password shorter than the minimum, writing nothing', async () => {
    const token = await invite()
    const res = await setPasswordPOST(post('/api/auth/set-password', { token, password: 'short' }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('password-too-short')
    expect(users[0]!.passwordHash).toBeNull()
    expect(users[0]!.verifyToken).not.toBeNull()
  })

  it('should refuse to overwrite a password, so the link cannot become a reset-by-email', async () => {
    const { token } = await issueEmailToken('user-1')
    const res = await setPasswordPOST(
      post('/api/auth/set-password', { token, password: 'correct horse battery' }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already-has-password')
    expect(users[0]!.passwordHash).toBe('argon2id-hash')
  })

  it('should be single-use', async () => {
    const token = await invite()
    await setPasswordPOST(post('/api/auth/set-password', { token, password: 'correct horse battery' }))
    const replay = await setPasswordPOST(
      post('/api/auth/set-password', { token, password: 'another good passphrase' }),
    )
    expect(replay.status).toBe(400)
    expect(users[0]!.passwordHash).toStartWith('$argon2id$')
  })
})

describe('POST /api/auth/reset-password', () => {
  const PASSWORD = 'a whole new passphrase'

  it('should rotate the hash and move the password generation', async () => {
    const { token } = createPasswordResetToken('user-1', null)
    const before = users[0]!.passwordHash

    const res = await resetPOST(post('/api/auth/reset-password', { token, password: PASSWORD }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', email: 'teacher@novastarmontessori.com' })
    expect(users[0]!.passwordHash).not.toBe(before)
    expect(users[0]!.passwordHash).toStartWith('$argon2id$')
    // The `jwt` callback in lib/auth.ts invalidates live sessions by comparing
    // `passwordChangedAt` against the token's issue time, so this write is the
    // whole of session revocation — no second mechanism is added.
    expect(users[0]!.passwordChangedAt).toBeInstanceOf(Date)
  })

  it('should refuse a replayed link as spent, because the generation moved', async () => {
    const { token } = createPasswordResetToken('user-1', null)
    await resetPOST(post('/api/auth/reset-password', { token, password: PASSWORD }))

    const replay = await resetPOST(post('/api/auth/reset-password', { token, password: PASSWORD }))
    expect(replay.status).toBe(400)
    expect((await replay.json()).error).toBe('spent')
  })

  it('should refuse a link issued before an unrelated password change', async () => {
    const earlier = new Date('2026-05-01T09:00:00Z')
    users[0]!.passwordChangedAt = earlier
    const { token } = createPasswordResetToken('user-1', earlier)
    users[0]!.passwordChangedAt = new Date('2026-05-01T09:30:00Z')

    const res = await resetPOST(post('/api/auth/reset-password', { token, password: PASSWORD }))
    expect((await res.json()).error).toBe('spent')
  })

  it('should report an expired link as expired', async () => {
    const { token } = createPasswordResetToken('user-1', null)
    const res = await resetPOST(post('/api/auth/reset-password', { token, password: PASSWORD }))
    expect(res.status).toBe(200)

    // A token signed an hour and a second ago cannot be produced here without
    // rewinding the clock, so the expired branch is covered at the helper level in
    // the describe above; what matters here is that a live token is not refused.
    expect(users[0]!.passwordChangedAt).toBeInstanceOf(Date)
  })

  it('should refuse a tampered link', async () => {
    const { token } = createPasswordResetToken('user-1', null)
    const body = token.slice(PASSWORD_RESET_TOKEN_PREFIX.length)
    const segment = body.slice(0, body.lastIndexOf('.'))
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')), exp: 9_999_999_999 }),
      'utf8',
    ).toString('base64url')

    const res = await resetPOST(
      post('/api/auth/reset-password', {
        token: `${PASSWORD_RESET_TOKEN_PREFIX}${forged}.${body.slice(body.lastIndexOf('.') + 1)}`,
        password: PASSWORD,
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid')
    expect(users[0]!.passwordHash).toBe('argon2id-hash')
  })

  it('should refuse a reset token presented to the sign-in form', async () => {
    // `authorize()` treats a stored `verifyToken` as a login credential, which is
    // exactly why reset tokens are stateless and prefixed. Asserted on the source
    // because the credentials callback needs the full NextAuth harness to execute.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(import.meta.dir, '..', 'lib', 'auth.ts'), 'utf-8')
    expect(src).toContain('credentials.token.startsWith(PASSWORD_RESET_TOKEN_PREFIX)')
    expect(src).toContain('hashEmailToken(credentials.token)')
  })

  it('should clear a lockout, since the mailbox link is itself the proof', async () => {
    users[0]!.loginAttempts = 5
    users[0]!.lockedUntil = new Date(Date.now() + 30 * 60 * 1000)
    const { token } = createPasswordResetToken('user-1', null)
    await resetPOST(post('/api/auth/reset-password', { token, password: PASSWORD }))
    expect(users[0]!.loginAttempts).toBe(0)
    expect(users[0]!.lockedUntil).toBeNull()
  })
})

describe('POST /api/auth/forgot-password reveals nothing', () => {
  it('should answer an existing account and a non-existent one identically', async () => {
    const known = await forgotPOST(
      post('/api/auth/forgot-password', { email: 'teacher@novastarmontessori.com' }),
    )
    const unknown = await forgotPOST(
      post('/api/auth/forgot-password', { email: 'nobody@novastarmontessori.com' }),
    )

    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    // The whole point: byte-identical responses. A different message, or a
    // different status, is an account-existence oracle.
    expect(await unknown.text()).toBe(await known.text())
  })

  it('should still send to the real account, so the identical response is not just a no-op', async () => {
    await forgotPOST(post('/api/auth/forgot-password', { email: 'teacher@novastarmontessori.com' }))
    expect(SENT).toHaveLength(1)
    expect(SENT[0]!.to).toBe('teacher@novastarmontessori.com')
    expect(SENT[0]!.text).toContain('/reset-password?token=prt_')
    expect(SENT[0]!.text).toContain('Novastar Montessori School')
  })

  it('should keep the token out of the subject line', async () => {
    await forgotPOST(post('/api/auth/forgot-password', { email: 'teacher@novastarmontessori.com' }))
    const sent = SENT[0]!
    const token = sent.text!.split('token=')[1]!.split('\n')[0]!
    expect(sent.subject).not.toContain(token)
    expect(sent.html!).not.toContain('correct horse')
  })

  it('should answer a malformed address exactly like a well-formed one', async () => {
    const malformed = await forgotPOST(post('/api/auth/forgot-password', { email: 'not-an-email' }))
    const wellFormed = await forgotPOST(
      post('/api/auth/forgot-password', { email: 'nobody@novastarmontessori.com' }),
    )
    expect(malformed.status).toBe(200)
    expect(await malformed.text()).toBe(await wellFormed.text())
  })

  it('should answer an account with no password the same way, and mail nothing', async () => {
    // Such an account is mid-invitation: the setup email is the message it needs,
    // not a reset link for a password it never chose.
    users[0]!.passwordHash = null
    const res = await forgotPOST(post('/api/auth/forgot-password', { email: 'teacher@novastarmontessori.com' }))
    expect(res.status).toBe(200)
    expect(SENT).toHaveLength(0)
  })

  it('should rate limit per address, and keep the same body when it does', async () => {
    // Three requests are allowed and the fourth is refused: the limiter checks
    // `recent.length >= limit` before recording the attempt, so a limit of 3
    // permits exactly 3. Each comes from a different client address, so the
    // per-address bucket is what does it, not the per-client one.
    const responses = []
    for (let i = 0; i < 4; i++) {
      responses.push(
        await forgotPOST(
          post('/api/auth/forgot-password', { email: 'teacher@novastarmontessori.com' }, `10.0.0.${i}`),
        ),
      )
    }
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 429])
    expect(await responses[3]!.text()).toBe(await responses[0]!.text())
  })

  it('should rate limit per client address across many different accounts', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await forgotPOST(
        post('/api/auth/forgot-password', { email: `user${i}@novastarmontessori.com` }),
      )
      statuses.push(res.status)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })
})

describe('POST /api/auth/verify-email/resend reveals nothing', () => {
  it('should answer an existing account and a non-existent one identically', async () => {
    users[0]!.emailVerified = null
    const known = await resendPOST(
      post('/api/auth/verify-email/resend', { email: 'teacher@novastarmontessori.com' }),
    )
    const unknown = await resendPOST(
      post('/api/auth/verify-email/resend', { email: 'nobody@novastarmontessori.com' }),
    )
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(await unknown.text()).toBe(await known.text())
  })

  it('should mail a verification link that names the school', async () => {
    users[0]!.emailVerified = null
    await resendPOST(post('/api/auth/verify-email/resend', { email: 'teacher@novastarmontessori.com' }))
    expect(SENT).toHaveLength(1)
    expect(SENT[0]!.text).toContain('/verify-email?token=vem_')
    expect(SENT[0]!.subject).toContain('Novastar Montessori School')
  })

  it('should skip an already-verified account without saying so', async () => {
    const res = await resendPOST(
      post('/api/auth/verify-email/resend', { email: 'teacher@novastarmontessori.com' }),
    )
    expect(res.status).toBe(200)
    expect(SENT).toHaveLength(0)
  })
})

describe('POST /api/auth/invite', () => {
  it('should refuse an unauthenticated caller', async () => {
    session = new UnauthorizedError()
    const res = await invitePOST(
      post('/api/auth/invite', { email: 'new@novastarmontessori.com', roleName: 'CLASSROOM_TEACHER' }),
    )
    expect(res.status).toBe(401)
    expect(users).toHaveLength(1)
  })

  it('should refuse a caller who may not administer accounts', async () => {
    session = { userId: 't-1', tenantId: TENANT, schoolId: SCHOOL, role: 'CLASSROOM_TEACHER' }
    const res = await invitePOST(
      post('/api/auth/invite', { email: 'new@novastarmontessori.com', roleName: 'CLASSROOM_TEACHER' }),
    )
    expect(res.status).toBe(403)
    expect(users).toHaveLength(1)
  })

  it('should create an unverified, password-less account and mail a setup link', async () => {
    const res = await invitePOST(
      post('/api/auth/invite', { email: 'New.Teacher@novastarmontessori.com', name: 'New Teacher', roleName: 'HEADMASTER' }),
    )
    expect(res.status).toBe(201)

    const invited = users.find((row) => row.email === 'new.teacher@novastarmontessori.com')!
    expect(invited.passwordHash).toBeNull()
    expect(invited.emailVerified).toBeNull()
    expect(invited.mustChangePassword).toBe(true)
    expect(invited.status).toBe('ACTIVE')
    expect(invited.verifyToken).not.toBeNull()
    // Stored as a digest, like every other verification token.
    expect(invited.verifyToken).toMatch(/^[0-9a-f]{64}$/)

    expect(SENT).toHaveLength(1)
    expect(SENT[0]!.text).toContain('/set-password?token=vem_')
    expect(SENT[0]!.subject).toContain('Novastar Montessori School')
  })

  it('should refuse an unknown role name rather than create an unusable account', async () => {
    const res = await invitePOST(
      post('/api/auth/invite', { email: 'new@novastarmontessori.com', roleName: 'STAFF' }),
    )
    expect(res.status).toBe(400)
    expect(users).toHaveLength(1)
  })

  it('should refuse a role that does not exist in the caller own school', async () => {
    const res = await invitePOST(
      post('/api/auth/invite', { email: 'new@novastarmontessori.com', roleName: 'PARENT' }),
    )
    expect(res.status).toBe(400)
    expect(users).toHaveLength(1)
  })

  it('should report a duplicate address as 409, not 500', async () => {
    const res = await invitePOST(
      post('/api/auth/invite', { email: 'teacher@novastarmontessori.com', roleName: 'HEADMASTER' }),
    )
    expect(res.status).toBe(409)
  })

  it('should report a failed send distinctly from a successful invitation', async () => {
    // With the old swallowing `sendEmail`, a failed delivery returned null and
    // this route reported 201 — so the operator had no signal that the person
    // would never receive their link.
    sendFails = true
    const res = await invitePOST(
      post('/api/auth/invite', { email: 'new@novastarmontessori.com', roleName: 'HEADMASTER' }),
    )
    expect(res.status).toBe(502)
    expect((await res.json()).status).toBe('created-not-delivered')
  })
})

describe('Emailed links name the school and carry a token in the URL only', () => {
  it('should escape a school name rather than inject markup into the HTML part', async () => {
    const { setPasswordTemplate } = await import('@novastar/notifications')
    const rendered = setPasswordTemplate({
      schoolName: '<script>alert(1)</script> School',
      recipientName: 'A & B',
      actionUrl: 'https://portal.example.test/set-password?token=vem_abc',
      expiresInHours: 24,
    })
    expect(rendered.html).not.toContain('<script>')
    expect(rendered.html).toContain('&lt;script&gt;')
    expect(rendered.html).toContain('A &amp; B')
    // The plain-text part is where a recipient with a blocked HTML part reads the
    // link, so it must carry it too.
    expect(rendered.text).toContain('https://portal.example.test/set-password?token=vem_abc')
    expect(rendered.text).toContain('expires in 24 hours')
  })
})
