import { describe, it, expect, beforeEach, mock } from 'bun:test'

/**
 * The one-time setup link, end to end, through the two places that decide
 * whether it is a link or a login.
 *
 * `lib/auth.ts` is the whole story and it was wrong twice in the same direction:
 *
 * - The `jwt` callback's revalidation branch assigned `token.mustChangePassword
 *   = false` without reading the column, so the flag was wiped on the first
 *   revalidation — within five minutes of the sign-in that had just set it. Every
 *   writer of that flag (`tools/tenant-cli`, the invitation route) was therefore
 *   writing to a value nothing consumed.
 * - The email-token branch of `authorize()` completed a sign-in for an account
 *   with no `passwordHash`, so an intercepted invitation was a complete login as
 *   the invited role and no password was ever chosen.
 *
 * Both are executed here rather than asserted in the source, because a text
 * assertion against `token.mustChangePassword = false` would have been just as
 * green as the defect it was standing in for.
 *
 * No database is touched: `prisma` is the same small in-memory store shape
 * `tests/email-auth-tokens.test.ts` uses, which understands only the `where`
 * shapes these two call sites build.
 */
mock.module('server-only', () => ({}))

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
  twoFactorEnabled: boolean
  twoFactorSecret: string | null
  settings: Record<string, unknown> | null
}

let users: FakeUser[] = []

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    schoolId: 'school-1',
    email: 'teacher@novastarmontessori.com',
    emailVerified: new Date('2026-01-01T00:00:00Z'),
    passwordHash: '$argon2id$not-a-real-hash',
    name: 'Test Teacher',
    isActive: true,
    status: 'ACTIVE',
    mustChangePassword: false,
    passwordChangedAt: null,
    verifyToken: null,
    verifyTokenExpires: null,
    loginAttempts: 0,
    lockedUntil: null,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    settings: {},
    ...overrides,
  }
}

/**
 * Apply a `where` the way a real client would, for the shapes these two call
 * sites build: exact scalars and `null` equality. Anything else matches nothing
 * rather than everything, so a filter that grew a new shape fails here instead of
 * being waved through.
 */
function whereMatches(row: FakeUser, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const actual = row[key as keyof FakeUser]
    if (condition === null) {
      if (actual !== null && actual !== undefined) return false
      continue
    }
    if (condition && typeof condition === 'object') return false
    if (actual !== condition) return false
  }
  return true
}

const prisma = {
  user: {
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      users.find((row) => whereMatches(row, where)) ?? null,
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      users.find((row) => whereMatches(row, where)) ?? null,
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
}

// Load the real modules before replacing them. Bun's `mock.module` patches a module
// that is already in the registry; registering a mock for one that has not been
// resolved yet does not reach the modules that import it afterwards, and
// `authorize()` then quietly talks to the real client. Nothing here touches a
// database — the pre-load only forces the module graph to resolve.
//
// The same fake, registered under the package name too. `issueEmailToken` now lives
// in `@novastar/auth/invite` — shared with the platform console, which mints setup
// links through the same code — and that module reaches the database through
// `@novastar/database`. `mock.module` keys on the specifier, so without this the
// token would be written through the real lazy client and `authorize()` would find
// no token to carry the flag from.
//
// ---------------------------------------------------------------------------
// Module-mock lifetime: snapshot before registering, restore after
// ---------------------------------------------------------------------------
// `mock.module` patches the LIVE namespace for the whole process and never reverts, so a
// registration made at module scope is what every file loaded afterwards binds to. All three
// boundaries registered here are put back.
//
// The snapshots are read HERE, before the first registration. That is the load-bearing part:
// a `beforeEach` capture would run after these registrations had already overwritten the
// namespace, so it would record this file's own factory and hand the double straight back to
// the next file.
//
// Every factory SPREADS the namespace it replaces and then overrides, making each fake both
// a superset and a subset — which is what makes the restore complete, since `mock.module`
// merges and an added key could never be removed again.
const previousNamespaces = new Map<string, Record<string, unknown>>()
previousNamespaces.set('@/lib/prisma', { ...(await import('@/lib/prisma')) })
previousNamespaces.set('@novastar/database', { ...(await import('@novastar/database')) })
previousNamespaces.set('@/lib/audit/logger', { ...(await import('@/lib/audit/logger')) })

const base = (specifier: string): Record<string, unknown> =>
  previousNamespaces.get(specifier) ?? {}

const FAKES = [
  { specifier: '@/lib/prisma', factory: () => ({ ...base('@/lib/prisma'), prisma, default: prisma }) },
  {
    specifier: '@novastar/database',
    factory: () => ({ ...base('@novastar/database'), prisma, default: prisma }),
  },
  {
    specifier: '@/lib/audit/logger',
    factory: () => ({
      ...base('@/lib/audit/logger'),
      AuditLogAction: { LOGIN: 'LOGIN', PASSWORD_CHANGED: 'PASSWORD_CHANGED' },
      createAuditLog: mock(async () => null),
    }),
  },
] as const

// Also registered at load time, so the imports below resolve these specifiers through the
// doubles and the file is correct in a run that never reaches `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

// `withAuth` reads the secret off the environment because the proxy passes only
// `pages`, and `NEXTAUTH_URL` over https is what selects the `__Secure-` cookie
// name the middleware looks for.
process.env.NEXTAUTH_SECRET = 'must-change-password-test-secret-not-real'
process.env.NEXTAUTH_URL = 'https://portal.example.test'

const { resetRateLimit } = await import('@/lib/rate-limit')
const { issueEmailToken, lookupEmailToken } = await import('@/lib/auth/email-verification')
const { authOptions } = await import('@/lib/auth')
const { encode } = await import('next-auth/jwt')
const proxy = (await import('@/proxy')).default

/**
 * The `jwt` callback, revalidation call only.
 *
 * NextAuth's own parameter type demands the adapter's `user` and `account` on
 * every call, which is true of a sign-in and false of a revalidation — the exact
 * shape under test here — so the input is narrowed to what this callback actually
 * reads rather than padded out to satisfy it.
 */
type Revalidate = (input: {
  token: Record<string, unknown>
  trigger?: 'signIn' | 'signUp' | 'update'
}) => Promise<Record<string, unknown>>

type Authorize = (credentials: Record<string, unknown> | undefined) => Promise<unknown>

const revalidate = authOptions.callbacks!.jwt as unknown as Revalidate
// The credentials provider keeps the options it was constructed with, including
// the real `authorize`.
const authorize = (authOptions.providers[0] as { options: { authorize: Authorize } }).options
  .authorize

beforeEach(() => {
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
  users = [makeUser()]
  resetRateLimit()
})

// ---------------------------------------------------------------------------
// The jwt callback: the database is the authority on the flag
// ---------------------------------------------------------------------------

describe('jwt callback carries mustChangePassword from the database', () => {
  /** A token as it looks mid-life: signed long ago, so revalidation is due. */
  function staleToken(overrides: Record<string, unknown> = {}) {
    return { id: 'user-1', role: 'CLASSROOM_TEACHER', lastChecked: 0, issuedAt: 1_000, ...overrides }
  }

  it('should keep a flag the database still holds, across a revalidation', async () => {
    users[0]!.mustChangePassword = true

    const token = await revalidate({ token: staleToken() })

    expect(token.mustChangePassword).toBe(true)
  })

  it('should still hold on the revalidation after that one', async () => {
    // THE regression. The old branch assigned a constant, so the second pass —
    // and every pass after — cleared a flag the database had not changed. This
    // feeds the callback's own output back in, with `trigger: 'update'` to force
    // the interval out, which is what an active session does every five minutes.
    users[0]!.mustChangePassword = true
    const first = await revalidate({ token: staleToken() })
    const second = await revalidate({ token: { ...first }, trigger: 'update' })

    expect(second.mustChangePassword).toBe(true)
    expect(first.lastChecked).toBeGreaterThan(0)
  })

  it('should take a flag the database no longer holds, rather than preserving the claim', async () => {
    // The other direction, and the one that makes this a read rather than a
    // default: a session that carries `true` into a row that has since been
    // cleared must lose it, or a password change made from another session would
    // keep the user confined to the setup page.
    users[0]!.mustChangePassword = false
    const token = await revalidate({ token: staleToken({ mustChangePassword: true }), trigger: 'update' })

    expect(token.mustChangePassword).toBe(false)
  })

  it('should still invalidate the session when the password changed after issue', async () => {
    users[0]!.mustChangePassword = true
    users[0]!.passwordChangedAt = new Date(2_000)

    const token = await revalidate({ token: staleToken() })

    expect(token.id).toBe('')
    expect(token.role).toBe('')
    expect(token.status).toBe('')
  })

  it('should still invalidate the session for a suspended account', async () => {
    users[0]!.status = 'SUSPENDED'

    const token = await revalidate({ token: staleToken() })

    expect(token.id).toBe('')
  })

  it('should not revalidate a token with no user id', async () => {
    const token = await revalidate({ token: { lastChecked: 0 } })
    expect(token.mustChangePassword).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// authorize(): an emailed link is a setup link, not a session
// ---------------------------------------------------------------------------

describe('authorize() with an email verification token', () => {
  async function invited() {
    users = [
      makeUser({ passwordHash: null, emailVerified: null, mustChangePassword: true }),
    ]
    return (await issueEmailToken('user-1')).token
  }

  it('should refuse a session for an account with no password, and name the setup page', async () => {
    const token = await invited()

    const error: Error = await authorize({ token }).then(
      () => {
        throw new Error('authorize() returned a user for an account with no password')
      },
      (e: Error) => e,
    )

    // The message is the whole of the instruction: next-auth hands a thrown
    // message back to the caller as the callback error, and there is no UI in
    // this app that posts a `vem_` token at the credentials endpoint.
    expect(error.message).toContain('SET_PASSWORD_REQUIRED')
    expect(error.message).toContain(`/set-password?token=${encodeURIComponent(token)}`)
  })

  it('should leave the token unspent and the address unverified, so the setup page still works', async () => {
    // If either were consumed here, the page named in the error would be dead on
    // arrival and the account could never choose a password at all.
    const token = await invited()
    await authorize({ token }).catch(() => null)

    expect(users[0]!.verifyToken).not.toBeNull()
    expect(users[0]!.emailVerified).toBeNull()
    expect(await lookupEmailToken(token)).toEqual({
      ok: true,
      userId: 'user-1',
      passwordHash: null,
      mustChangePassword: true,
    })
  })

  it('should still complete the sign-in for an account that already has a password', async () => {
    // The other direction. Verification links are also the delivery for accounts
    // that already chose a password — a resend to a verified address, and the
    // token branch is what the passkey bridge and every other verification link
    // still routes through.
    const { token } = await issueEmailToken('user-1')

    const user = (await authorize({ token })) as { id: string; email: string }

    expect(user.id).toBe('user-1')
    expect(user.email).toBe('teacher@novastarmontessori.com')
    expect(users[0]!.emailVerified).toBeInstanceOf(Date)
    expect(users[0]!.verifyToken).toBeNull()
  })

  it('should reach the token as the database holds it, for the accounts the CLI provisions', async () => {
    // The tenant CLI writes `mustChangePassword: true` together with a
    // provisional hash AND `passwordChangedAt`, so the `&& !user.passwordChangedAt`
    // clause on every `authorize()` return value suppresses the flag at sign-in
    // for exactly those accounts. The revalidation is what re-reads the column,
    // which is why the flag has to come from the database and not from a
    // constant: without this, "It must be changed at first sign-in" is a message
    // with nothing behind it.
    const provisionedAt = new Date('2026-02-01T09:00:00Z')
    users[0]!.mustChangePassword = true
    users[0]!.passwordChangedAt = provisionedAt
    const { token } = await issueEmailToken('user-1')

    const user = (await authorize({ token })) as { mustChangePassword: boolean }
    expect(user.mustChangePassword).toBe(false)

    const revalidated = await revalidate({
      token: { id: 'user-1', role: 'CLASSROOM_TEACHER', lastChecked: 0 },
    })
    expect(revalidated.mustChangePassword).toBe(true)
  })

  it('should refuse an expired link as expired, not as a setup instruction', async () => {
    const { token } = await issueEmailToken('user-1')
    users[0]!.verifyTokenExpires = new Date(Date.now() - 1000)

    await expect(authorize({ token })).rejects.toThrow('Verification link has expired')
  })

  it('should refuse a token it never issued', async () => {
    await expect(authorize({ token: 'vem_' + 'x'.repeat(43) })).rejects.toThrow(
      'Invalid verification token',
    )
  })
})

// ---------------------------------------------------------------------------
// proxy: the flag is an obligation, not a badge
// ---------------------------------------------------------------------------

const COOKIE_NAME = '__Secure-next-auth.session-token'
const ORIGIN = 'https://portal.example.test'

/**
 * A `nextUrl` shaped the way Next's is.
 *
 * Not `URL`: `withAuth` composes `${basePath}${pathname}` and compares it to the
 * auth path, so an absent `basePath` stringifies to `"undefined/…"`, which starts
 * with everything and short-circuits the whole middleware before the proxy's own
 * code runs.
 */
function fakeNextUrl(path: string) {
  const parsed = new URL(path, ORIGIN)
  return {
    basePath: '',
    origin: parsed.origin,
    pathname: parsed.pathname,
    search: parsed.search,
    href: parsed.href,
    searchParams: parsed.searchParams,
    clone: () => fakeNextUrl(parsed.href),
    toString: () => parsed.href,
  }
}

/**
 * A session cookie carrying `claims`, minted the way NextAuth mints one.
 *
 * The empty salt is deliberate and load-bearing: `withAuth` reads the token with
 * `getToken({ req, secret })`, which derives the encryption key with the default
 * salt, and next-auth's own cookie writer does the same. Deriving it from the
 * cookie name instead would produce a cookie the middleware cannot read, and the
 * tests below would be asserting against a session no request could hold.
 */
async function sessionCookie(claims: Record<string, unknown>): Promise<string> {
  return encode({
    token: { id: 'user-1', role: 'CLASSROOM_TEACHER', schoolId: 'school-1', ...claims },
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: 8 * 60 * 60,
  })
}

/**
 * A cookie bag shaped like Next's `RequestCookies`.
 *
 * `getToken` reads the session through `cookies.getAll()` when it is present and
 * falls back to a `for...in` walk otherwise, so both shapes are offered and the
 * keyed property is kept as a third. The CSRF check reads the same bag through
 * `get(name)`, the way a real `NextRequest` does.
 */
function fakeCookies(cookie: string) {
  return Object.assign(
    {
      get(name: string) {
        return name === COOKIE_NAME && cookie ? { name, value: cookie } : undefined
      },
      getAll() {
        return cookie ? [{ name: COOKIE_NAME, value: cookie }] : []
      },
    },
    { [COOKIE_NAME]: cookie }
  )
}

/**
 * The shape `withAuth` needs: a `nextUrl` with a `basePath`, a cookie bag it can
 * read the session off, headers for the rate limiter, and an absolute `url` for
 * the redirects.
 */
function request(path: string, cookie: string) {
  return {
    url: `${ORIGIN}${path}`,
    // The proxy reads this to decide whether the double-submit check applies;
    // GET is the safe default these assertions were written against.
    method: 'GET',
    cookies: fakeCookies(cookie),
    headers: new Headers({ 'x-real-ip': '198.51.100.20' }),
    nextUrl: fakeNextUrl(path),
  }
}

/**
 * The proxy's own response type. `withAuth` answers `undefined` for the paths it
 * short-circuits — the sign-in page and everything under the auth path — so the
 * calls that must reach the proxy body are narrowed through `respond`, and the
 * two that must not are asserted to be `undefined` on purpose.
 */
type ProxyResponse = Awaited<ReturnType<typeof proxy>>

async function callProxy(path: string, cookie: string): Promise<ProxyResponse> {
  return proxy(request(path, cookie) as never, {} as never)
}

async function run(path: string, claims: Record<string, unknown>) {
  const res = await callProxy(path, await sessionCookie(claims))
  if (!res) throw new Error(`${path} produced no response; it never reached the proxy body`)
  return { res, location: res.headers.get('location') }
}

describe('proxy sends a session that owes a password change to the setup page', () => {
  it('should redirect a flagged session away from the portal', async () => {
    const { res, location } = await run('/dashboard', { mustChangePassword: true })

    expect(res.status).toBe(307)
    expect(location).toBe(`${ORIGIN}/set-password`)
  })

  it('should redirect the API too, so the flag is not a page-only badge', async () => {
    const { res, location } = await run('/api/students', { mustChangePassword: true })

    expect(res.status).toBe(307)
    expect(location).toBe(`${ORIGIN}/set-password`)
  })

  it('should not redirect the setup page itself, which is what would make this a loop', async () => {
    // The redirect target is itself exempt, so the second request terminates
    // instead of bouncing forever.
    const { res } = await run('/set-password?token=vem_abc', { mustChangePassword: true })

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('should leave every recovery route reachable, so a flagged session is never locked out', async () => {
    for (const path of [
      '/set-password',
      '/set-password?token=vem_abc',
      '/forgot-password',
      '/reset-password?token=prt_abc',
      '/verify-email?token=vem_abc',
    ]) {
      const { res, location } = await run(path, { mustChangePassword: true })
      expect(`${path}: ${res.status} ${location}`).toBe(`${path}: 200 null`)
    }

    // `/login` and all of `/api/auth/*` never reach the proxy body at all:
    // `withAuth` returns before the handler runs for the sign-in page and the
    // auth path. So the sign-in the setup page performs after setting a password
    // is unaffected by anything asserted here.
    for (const path of ['/login', '/api/auth/session']) {
      expect(`${path}: ${await callProxy(path, '')}`).toBe(`${path}: undefined`)
    }
  })

  it('should drop the query string, which the setup page has no use for', async () => {
    const { location } = await run('/dashboard?schoolId=other&callbackUrl=/students', {
      mustChangePassword: true,
    })

    expect(location).toBe(`${ORIGIN}/set-password`)
  })

  it('should let an unflagged session through untouched', async () => {
    const { res } = await run('/dashboard', { mustChangePassword: false })
    expect(res.status).toBe(200)
  })

  it('should let a session with no flag claim through untouched', async () => {
    // A token minted before the claim existed must not be treated as flagged;
    // `undefined` is not `true`.
    const { res } = await run('/dashboard', {})
    expect(res.status).toBe(200)
  })

  it('should still rate limit before the flag is read', async () => {
    // Ordering, not just presence. A flagged session must not be a way around the
    // limiter: every request below is answered with the redirect until the bucket
    // runs out, and the 429 that follows proves the limiter ran first.
    resetRateLimit()
    const cookie = await sessionCookie({ mustChangePassword: true })

    const statuses: number[] = []
    for (let i = 0; i < 302; i++) {
      // Every request carries the same `x-real-ip`, so they all share one client
      // bucket, and a page path so the budget is the 300/min page limit.
      const res = await callProxy('/dashboard', cookie)
      statuses.push(res?.status ?? 0)
    }

    expect(new Set(statuses.slice(0, 300))).toEqual(new Set([307]))
    expect(statuses.slice(300)).toEqual([429, 429])
  })
})
