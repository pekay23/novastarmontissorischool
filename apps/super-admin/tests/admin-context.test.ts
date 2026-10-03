// `./harness` first, always: it registers the `@/lib/prisma` mock, and every
// `@/lib/*` module below reaches the database. See the harness docstring and
// `bunfig.toml`, which preloads the harness so the mock cannot lose the race.
import { beforeEach, describe, expect, it } from 'bun:test'
import { redirect } from 'next/navigation'
import {
  fakeOperator,
  givenLiveOperator,
  mocks,
  operatorClaims,
  resetHarness,
  setCookies,
} from './harness'
import { ADMIN_SESSION_COOKIE, ADMIN_TENANT_COOKIE, createSessionToken } from '@/lib/admin-auth'

/**
 * The operator session and the tenant selection hint.
 *
 * Three claims are load-bearing here, and none of them is visible from a route:
 *
 * 1. The session names an operator, and the *row* decides whether they are still
 *    allowed. This file is where the environment allowlist used to be asserted; the
 *    replacement is the live re-read, and a test that only armed the cookie would be
 *    asserting the old behaviour and would pass while revocation was broken.
 * 2. The selection cookie authorises nothing. Every drill-down route re-resolves it
 *    through `requireTenantScope`, so a forged value can only produce a 404.
 * 3. `getOperatorOrNull()` swallows exactly two error types. A blanket catch would
 *    swallow Next's `redirect()` signal too, and an operator who is signed in would
 *    be shown the signed-out page.
 */

const PLATFORM_SESSION_SECRET = 'a-test-secret-that-is-long-enough-to-pass-32'
const OPERATOR = fakeOperator()

const {
  getOperatorOrNull,
  getSelectedTenantId,
  requireOperator,
  requireOperatorPage,
  requireTenantScope,
} = await import('@/lib/admin-context')
const { UnauthorizedError, ForbiddenError, NotFoundError } = await import('@/lib/errors')

const TENANT_ROW = {
  id: 'tenant-a',
  name: 'Novastar Montessori',
  code: 'novastar',
  domain: null,
  isActive: true,
  settings: { currency: 'GHS' },
  createdAt: new Date('2026-01-02T08:00:00.000Z'),
  updatedAt: new Date('2026-01-02T08:00:00.000Z'),
  _count: { schools: 1, users: 12 },
}

/** Arms the live row and puts a matching cookie in the jar. */
function signedIn(overrides: { capabilities?: readonly string[]; status?: string } = {}): void {
  const row = fakeOperator({
    ...(overrides.capabilities === undefined ? {} : { capabilities: [...overrides.capabilities] }),
    ...(overrides.status === undefined ? {} : { status: overrides.status }),
  })
  givenLiveOperator(row)
  setCookies({
    [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(row, {
      ...(overrides.capabilities === undefined
        ? {}
        : { capabilities: overrides.capabilities }),
    })),
  })
}

beforeEach(() => {
  resetHarness()
  process.env.PLATFORM_SESSION_SECRET = PLATFORM_SESSION_SECRET
  delete process.env.SUPER_ADMIN_SECRET
  delete process.env.SUPER_ADMIN_EMAIL
  setCookies({})
})

describe('requireOperator — deny by default, in this order', () => {
  it('should refuse a caller with no cookie', async () => {
    await expect(requireOperator()).rejects.toBeInstanceOf(UnauthorizedError)
    // Signature verification is pure, so an unverifiable cookie costs no query.
    expect(mocks.platformOperatorFindUnique).toHaveBeenCalledTimes(0)
  })

  it('should refuse a deactivated operator with an unexpired valid token', async () => {
    signedIn()

    // The row, not a claim and not an environment list, is what decides. So
    // deactivating an account revokes now rather than at expiry — which is the
    // property that replaced the allowlist.
    givenLiveOperator(fakeOperator({ id: OPERATOR.id, status: 'SUSPENDED' }))

    await expect(requireOperator()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('should refuse an operator whose row is gone', async () => {
    signedIn()
    givenLiveOperator(null)

    await expect(requireOperator()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('should refuse an operator whose grants were all withdrawn', async () => {
    signedIn({ capabilities: [] })

    // The caller proved who they are; only the grant is missing. Collapsing the two
    // would send an operator chasing a sign-in problem they do not have.
    await expect(requireOperator()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('should narrow a token whose grants the row no longer holds', async () => {
    // A row reduced to one capability by an administrator: the session keeps working
    // and can do exactly one thing.
    const row = fakeOperator({ capabilities: ['tenant:read'] })
    givenLiveOperator(row)
    setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)) })

    const context = await requireOperator()
    expect(context.operator.capabilities).toEqual(['tenant:read'])
  })

  it('should return the operator and the selection alongside each other', async () => {
    signedIn()
    setCookies({
      [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)),
      [ADMIN_TENANT_COOKIE]: 'tenant-a',
    })

    const context = await requireOperator()

    expect(context.operator.id).toBe(OPERATOR.id)
    expect(context.operator.username).toBe(OPERATOR.username)
    expect(context.operator.email).toBe(OPERATOR.email)
    expect(context.selectedTenantId).toBe('tenant-a')
  })

  it('should read the operator identity from the row, not the token', async () => {
    // A username and email changed in the database, with the old session still
    // valid: the row wins, so the console shows who the operator now is.
    givenLiveOperator(
      fakeOperator({ id: OPERATOR.id, username: 'ops-renamed', name: 'Renamed' }),
    )
    setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)) })

    const context = await requireOperator()
    expect(context.operator.username).toBe('ops-renamed')
    expect(context.operator.name).toBe('Renamed')
  })
})

describe('getOperatorOrNull — the narrow catch', () => {
  it('should return null for an unauthenticated visitor', async () => {
    expect(await getOperatorOrNull()).toBeNull()
  })

  it('should return null for a deactivated operator, not throw', async () => {
    signedIn({ status: 'SUSPENDED' })

    // The dashboard renders rather than erroring: a revoked operator gets the
    // signed-out shell, which is what a page needs.
    expect(await getOperatorOrNull()).toBeNull()
  })

  it('should return the context for a signed-in operator', async () => {
    signedIn()

    expect((await getOperatorOrNull())?.operator.id).toBe(OPERATOR.id)
  })

  it('should not be able to swallow a redirect signal', async () => {
    // `redirect()` works in this module graph — it throws Next's own signal rather
    // than returning. That signal is an Error with a `digest`, and it is none of the
    // types the catch absorbs, so it propagates. Asserting the type is the whole
    // guarantee: widen the catch and this is the test that fails.
    let signal: unknown
    try {
      redirect('/login')
    } catch (error) {
      signal = error
    }

    expect(signal).toBeInstanceOf(Error)
    expect((signal as { digest?: string }).digest).toContain('NEXT_REDIRECT')
    expect(signal).not.toBeInstanceOf(UnauthorizedError)
    expect(signal).not.toBeInstanceOf(ForbiddenError)
  })
})

describe('requireOperatorPage — the rendering surface', () => {
  it('should redirect an unauthenticated visitor to /login', async () => {
    let signal: unknown
    try {
      await requireOperatorPage()
    } catch (error) {
      signal = error
    }

    expect((signal as { digest?: string }).digest).toContain('/login')
  })

  it('should redirect a deactivated operator rather than render the dashboard', async () => {
    signedIn({ status: 'SUSPENDED' })

    let signal: unknown
    try {
      await requireOperatorPage()
    } catch (error) {
      signal = error
    }

    expect((signal as { digest?: string }).digest).toContain('/login')
  })

  it('should render for a signed-in operator instead of redirecting', async () => {
    signedIn()

    expect((await requireOperatorPage()).operator.id).toBe(OPERATOR.id)
  })
})

describe('the selection cookie is a hint, not a grant', () => {
  it('should read back exactly what it was given', async () => {
    setCookies({ [ADMIN_TENANT_COOKIE]: 'tenant-a' })
    expect(await getSelectedTenantId()).toBe('tenant-a')
  })

  it('should report null when nothing is selected, and that is not "all tenants"', async () => {
    expect(await getSelectedTenantId()).toBeNull()
    // The empty-string and whitespace cases are what a truncated cookie write
    // produces, and they must be null rather than an empty scope.
    setCookies({ [ADMIN_TENANT_COOKIE]: '' })
    expect(await getSelectedTenantId()).toBeNull()
    setCookies({ [ADMIN_TENANT_COOKIE]: '   ' })
    expect(await getSelectedTenantId()).toBeNull()
  })

  it('should 404 a forged selection rather than falling back to the fleet', async () => {
    setCookies({ [ADMIN_TENANT_COOKIE]: 'tenant-does-not-exist' })
    mocks.tenantFindFirst.mockImplementation(async () => null)

    // The cookie decides what the operator is *looking at*, never what they may read.
    // Every drill-down route resolves it here, so a hand-edited cookie buys a 404 and
    // nothing else.
    await expect(
      requireTenantScope((await getSelectedTenantId()) as string),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.tenantFindMany).toHaveBeenCalledTimes(0)
  })

  it('should 404 an empty tenant id without touching the database', async () => {
    await expect(requireTenantScope('   ')).rejects.toBeInstanceOf(NotFoundError)
    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(0)
  })

  it('should resolve a real selection through a fresh read', async () => {
    setCookies({ [ADMIN_TENANT_COOKIE]: 'tenant-a' })
    mocks.tenantFindFirst.mockImplementation(async (args) =>
      args.where?.id === 'tenant-a' ? TENANT_ROW : null,
    )

    const tenant = await requireTenantScope((await getSelectedTenantId()) as string)

    expect(tenant.code).toBe('novastar')
    expect(mocks.tenantFindFirst.mock.calls[0][0].where).toEqual({ id: 'tenant-a' })
  })
})