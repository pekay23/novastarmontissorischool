// `./harness` first, always: it registers the `@/lib/prisma` mock, and every
// `@/lib/*` module below reaches the database. See the harness docstring.
import { beforeEach, describe, expect, it } from 'bun:test'
import { createHmac, hkdfSync } from 'node:crypto'
import { permissionMatches } from '@novastar/shared-types'
import {
  MALFORMED_HASH,
  OPERATOR_HASH,
  OPERATOR_PASSWORD,
  OTHER_OPERATOR_HASH,
  OTHER_OPERATOR_PASSWORD,
  fakeOperator,
  givenLiveOperator,
  givenOperators,
  mocks,
  operatorClaims,
  request,
  resetHarness,
  setCookies,
  type FakeOperator,
} from './harness'
import {
  hasOperatorCapability,
  listOperatorCapabilities,
  OPERATOR_CAPABILITIES,
  OPERATOR_GRANTS,
  parseOperatorCapability,
} from '@/lib/permissions'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_TENANT_COOKIE,
  adminAuthConfigured,
  authenticateOperator,
  createSessionToken,
  isLoginThrottled,
  LOGIN_FAILURE,
  MAX_OPERATOR_LOGIN_ATTEMPTS,
  MIN_SESSION_SECRET_LENGTH,
  resolveLiveOperator,
  verifySessionToken,
  type AdminOperator,
} from '@/lib/admin-auth'
import {
  MIN_OPERATOR_PASSWORD_LENGTH,
  hashOperatorPassword,
  isAcceptableOperatorPassword,
  verifyOperatorPassword,
} from '@/lib/operator-password'
import {
  getOperatorOrNull,
  getSelectedTenantId,
  requireCapability,
  requireOperator,
} from '@/lib/admin-context'
import { ForbiddenError, UnauthorizedError } from '@/lib/errors'

/**
 * The operator gate.
 *
 * The tests that matter most are the ones that would fail if the gate were
 * permissive: a school-level credential refused, an operator deactivated mid-session
 * refused before its cookie expires, an unconfigured deployment refusing everybody,
 * and a tampered token granting nothing. Each asserts the refusal *and*, wherever
 * the shape of the code allows, that a neighbouring positive case still passes — so
 * a refusal cannot pass for the wrong reason.
 *
 * The sign-in tests share one `PlatformOperator` fixture whose `passwordHash` is a
 * real argon2id hash, because `authenticateOperator` runs a real verify on every
 * attempt. A stub hash would make "the password verified" mean nothing here.
 */

/** 39 characters, so it clears `MIN_SESSION_SECRET_LENGTH` with room to spare. */
const SESSION_SECRET = 'a-test-secret-that-is-long-enough-to-pass-32'
const ROTATED_SESSION_SECRET = 'a-rotated-secret-that-is-also-long-enough-here'

const OPERATOR = fakeOperator()

/**
 * A distinct client address per request.
 *
 * The login throttle keys on the client address and holds its window for fifteen
 * minutes, and that window is module state in `admin-auth` rather than harness
 * state — so a suite of refusal tests that all claimed to come from `unknown` would
 * eventually start being refused with a 429, and each test would be asserting
 * throttle behaviour while intending to assert authentication. The counter is
 * deliberately *not* reset in `beforeEach`: an address used by an earlier test is a
 * window that earlier test already spent.
 */
let nextClientAddress = 0
function clientAddress(): string {
  nextClientAddress += 1
  return `203.0.113.${nextClientAddress}`
}

beforeEach(() => {
  resetHarness()
  process.env.PLATFORM_SESSION_SECRET = SESSION_SECRET
  delete process.env.NEXTAUTH_SECRET
  delete process.env.SUPER_ADMIN_SECRET
  delete process.env.SUPER_ADMIN_EMAIL
})

/** Signs `row` in: the live row armed, and a matching cookie in the jar. */
function signedIn(row: FakeOperator = OPERATOR): void {
  givenLiveOperator(row)
  setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(row)) })
}

async function login(body: Record<string, unknown>, address = clientAddress()): Promise<Response> {
  const { POST } = await import('@/app/api/auth/login/route')
  return POST(
    request('/api/auth/login', {
      method: 'POST',
      body,
      headers: { 'x-forwarded-for': address },
    }),
  )
}

/** The `data` of the last audit entry written. */
function lastAuditEntry(): Record<string, unknown> {
  return mocks.auditCreate.mock.calls.at(-1)?.[0].data as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

describe('operator credentials — a username, an email, and a password', () => {
  it('should accept a username with the right password', async () => {
    givenOperators(OPERATOR)

    const operator = await authenticateOperator({
      identifier: OPERATOR.username,
      password: OPERATOR_PASSWORD,
    })

    expect(operator?.id).toBe(OPERATOR.id)
    expect(operator?.username).toBe(OPERATOR.username)
    expect(operator?.email).toBe(OPERATOR.email)
    expect(operator?.capabilities).toEqual(listOperatorCapabilities())
  })

  it('should accept an email with the right password', async () => {
    givenOperators(OPERATOR)

    const operator = await authenticateOperator({
      identifier: OPERATOR.email,
      password: OPERATOR_PASSWORD,
    })
    expect(operator?.id).toBe(OPERATOR.id)
  })

  it('should resolve either identifier case-insensitively', async () => {
    givenOperators(OPERATOR)

    for (const identifier of ['OPS', 'Ops', 'oPs@Novastar.TEST', '  ops@novastar.test  ']) {
      const operator = await authenticateOperator({ identifier, password: OPERATOR_PASSWORD })
      expect(operator?.id).toBe(OPERATOR.id)
    }
  })

  it('should refuse an identifier no operator holds', async () => {
    givenOperators(OPERATOR)

    expect(
      await authenticateOperator({ identifier: 'nobody', password: OPERATOR_PASSWORD }),
    ).toBeNull()
    expect(
      await authenticateOperator({
        identifier: 'nobody@novastar.test',
        password: OPERATOR_PASSWORD,
      }),
    ).toBeNull()
  })

  it('should refuse a blank identifier, and a blank password', async () => {
    givenOperators(OPERATOR)

    expect(await authenticateOperator({ identifier: '   ', password: OPERATOR_PASSWORD })).toBeNull()
    expect(await authenticateOperator({ identifier: OPERATOR.username, password: '' })).toBeNull()
  })

  it('should refuse a wrong password on the right operator', async () => {
    givenOperators(OPERATOR)

    expect(
      await authenticateOperator({
        identifier: OPERATOR.username,
        password: OTHER_OPERATOR_PASSWORD,
      }),
    ).toBeNull()
    // One character off, so this is not a substring or prefix test either.
    expect(
      await authenticateOperator({
        identifier: OPERATOR.username,
        password: `${OPERATOR_PASSWORD}x`,
      }),
    ).toBeNull()
  })

  it('should refuse a malformed stored hash rather than trusting it', async () => {
    givenOperators(fakeOperator({ passwordHash: MALFORMED_HASH }))

    // `argon2.verify` throws on a hash it cannot parse. A corrupt row must be a
    // refused sign-in, not a 500 that tells the caller their account is broken.
    expect(
      await authenticateOperator({ identifier: OPERATOR.username, password: OPERATOR_PASSWORD }),
    ).toBeNull()
  })

  it('should refuse a school-level HEADMASTER without consulting the portal', async () => {
    // A Head of School is a real `User` row in a real tenant with a real `Role`. The
    // sign-in path reads only `PlatformOperator`, so a school address is simply not
    // an operator. Asserting the read counts is the point: the refusal cannot be an
    // artefact of a stub returning nothing for a query the code should not have made.
    givenOperators(OPERATOR)

    expect(
      await authenticateOperator({
        identifier: 'head@novastar.test',
        password: OPERATOR_PASSWORD,
      }),
    ).toBeNull()
    expect(mocks.userFindMany).toHaveBeenCalledTimes(0)
    expect(mocks.userCount).toHaveBeenCalledTimes(0)
    expect(mocks.tenantFindMany).toHaveBeenCalledTimes(0)
    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(0)
  })

  it('should refuse an identifier matching two operators rather than pick one', async () => {
    // `username` and `email` are each `@unique` independently, but nothing forbids
    // one operator's username being another's email. Refusing is the only answer
    // that cannot be arranged by whoever chose the two names — a `findFirst` would
    // resolve to whichever row the planner reached first.
    givenOperators(
      fakeOperator({ id: 'operator-1', username: 'shared', email: 'one@novastar.test' }),
      fakeOperator({ id: 'operator-2', username: 'two', email: 'shared' }),
    )

    expect(
      await authenticateOperator({ identifier: 'shared', password: OPERATOR_PASSWORD }),
    ).toBeNull()
  })

  it('should refuse a suspended operator, however good the password', async () => {
    givenOperators(fakeOperator({ status: 'SUSPENDED' }))

    expect(
      await authenticateOperator({ identifier: OPERATOR.username, password: OPERATOR_PASSWORD }),
    ).toBeNull()
  })

  it('should refuse a locked operator, however good the password', async () => {
    givenOperators(
      fakeOperator({
        loginAttempts: MAX_OPERATOR_LOGIN_ATTEMPTS,
        lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
      }),
    )

    // A correct password does not open a lock, or "guess until it locks" would be a
    // strategy and the lock a speed bump rather than a control.
    expect(
      await authenticateOperator({ identifier: OPERATOR.username, password: OPERATOR_PASSWORD }),
    ).toBeNull()
  })

  it('should refuse nobody when the operator table is empty', async () => {
    givenOperators()

    expect(
      await authenticateOperator({ identifier: OPERATOR.username, password: OPERATOR_PASSWORD }),
    ).toBeNull()
  })

  it('should count a wrong password, lock at the threshold, and keep the lock', async () => {
    givenOperators(OPERATOR)

    for (let attempt = 1; attempt <= MAX_OPERATOR_LOGIN_ATTEMPTS; attempt += 1) {
      expect(
        await authenticateOperator({
          identifier: OPERATOR.username,
          password: OTHER_OPERATOR_PASSWORD,
        }),
      ).toBeNull()
      // Two writes per failure: the increment, then the lock decision that reads it.
      expect(mocks.platformOperatorUpdate).toHaveBeenCalledTimes(attempt * 2)
    }

    const lockingWrite = mocks.platformOperatorUpdate.mock.calls.at(-1)?.[0].data as Record<
      string,
      unknown
    >
    expect((lockingWrite.lockedUntil as Date).getTime()).toBeGreaterThan(Date.now())

    // And now the correct password is refused too, because the lock the wrong
    // passwords earned is read back by the next attempt. Without the lockout being
    // visible to the sign-in lookup, this assertion would fail — which is the whole
    // reason the harness simulates `lockedUntil` rather than only the counter.
    expect(
      await authenticateOperator({ identifier: OPERATOR.username, password: OPERATOR_PASSWORD }),
    ).toBeNull()
  })

  it('should clear the counter, unlock, and stamp the sign-in on success', async () => {
    givenOperators(fakeOperator({ loginAttempts: 3, mustChangePassword: true }))

    const operator = await authenticateOperator({
      identifier: OPERATOR.username,
      password: OPERATOR_PASSWORD,
    })
    expect(operator).not.toBeNull()
    expect(operator?.mustChangePassword).toBe(true)

    const write = mocks.platformOperatorUpdate.mock.calls.at(-1)?.[0].data as Record<string, unknown>
    expect(write.loginAttempts).toBe(0)
    expect(write.lockedUntil).toBeNull()
    expect(write.lastLoginAt).toBeInstanceOf(Date)
  })

  it('should drop a stored capability that is not in the vocabulary', async () => {
    givenOperators(
      fakeOperator({ capabilities: ['tenant:read', 'tenant:teleport', 'platform:audit'] }),
    )

    const operator = await authenticateOperator({
      identifier: OPERATOR.username,
      password: OPERATOR_PASSWORD,
    })
    expect(operator?.capabilities).toEqual(['tenant:read', 'platform:audit'])
  })

  it('should give the same failure for every kind of wrong credential', async () => {
    // A distinguishable "no such operator" is a free oracle for enumerating which
    // accounts hold the platform, and a distinguishable "locked" is a free oracle for
    // finding one to attack while nobody is watching.
    const responses: Response[] = []

    givenOperators()
    responses.push(
      await login({ identifier: 'nobody', password: OTHER_OPERATOR_PASSWORD }),
    )

    givenOperators(OPERATOR)
    responses.push(
      await login({ identifier: OPERATOR.username, password: OTHER_OPERATOR_PASSWORD }),
    )

    givenOperators(fakeOperator({ status: 'SUSPENDED' }))
    responses.push(
      await login({ identifier: OPERATOR.username, password: OPERATOR_PASSWORD }),
    )

    givenOperators(
      fakeOperator({ lockedUntil: new Date(Date.now() + 60 * 60 * 1000) }),
    )
    responses.push(
      await login({ identifier: OPERATOR.username, password: OPERATOR_PASSWORD }),
    )

    givenOperators(fakeOperator({ passwordHash: MALFORMED_HASH }))
    responses.push(
      await login({ identifier: OPERATOR.username, password: OPERATOR_PASSWORD }),
    )

    const bodies = await Promise.all(responses.map(async (r) => r.json()))
    for (const body of bodies) {
      expect(body).toEqual({ error: LOGIN_FAILURE })
    }
    for (const response of responses) {
      expect(response.status).toBe(401)
    }
    // And no refusal ever set a session cookie.
    for (const response of responses) {
      expect(response.headers.get('set-cookie')).toBeNull()
    }
  })

  it('should throttle a flood from one address without naming the credential', async () => {
    const address = clientAddress()

    // Ten refused attempts. The route records one failure per refusal, so the window
    // fills here without the test recording anything itself — anything else would be
    // asserting a throttle that the code never produced.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(isLoginThrottled(address)).toBe(false)
      const response = await login(
        { identifier: 'nobody', password: OTHER_OPERATOR_PASSWORD },
        address,
      )
      expect(response.status).toBe(401)
    }
    expect(mocks.platformOperatorFindMany).toHaveBeenCalledTimes(10)

    // The eleventh is refused without a body read or a lookup, so it costs at most a
    // hash comparison, and the 429 says nothing about whether any account exists.
    expect(isLoginThrottled(address)).toBe(true)
    const throttled = await login(
      { identifier: OPERATOR.username, password: OPERATOR_PASSWORD },
      address,
    )
    expect(throttled.status).toBe(429)
    expect(await throttled.json()).toEqual({
      error: 'Too many sign-in attempts. Try again later.',
    })
    // No eleventh credential lookup, and no audit entry either — a throttle is not
    // a credential guess worth recording, or the audit table fills with noise.
    expect(mocks.platformOperatorFindMany).toHaveBeenCalledTimes(10)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(10)
  })
})

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

describe('operator password hashing — argon2id on the Node runtime', () => {
  it('should refuse a password below the minimum and hash nothing', async () => {
    expect(MIN_OPERATOR_PASSWORD_LENGTH).toBe(12)
    expect('elevenchars'.length).toBe(11)
    expect(isAcceptableOperatorPassword('elevenchars')).toBe(false)
    expect(isAcceptableOperatorPassword('twelvechars!')).toBe(true)

    // A refusal rather than a warning: a weak hash that exists is a credential
    // somebody can eventually guess.
    await expect(hashOperatorPassword('elevenchars')).rejects.toThrow(/at least 12 characters/)
  })

  it('should write an argon2id hash carrying the OWASP parameters', async () => {
    const hash = await hashOperatorPassword(OPERATOR_PASSWORD)

    // A self-describing PHC string, which is why a hash written by the Bun CLI
    // verifies here and one written here verifies there: verification reads the
    // parameters back out of the stored value.
    expect(hash.startsWith('$argon2id$v=19$')).toBe(true)
    expect(hash).toContain('m=19456')
    expect(hash).toContain('t=2')
    expect(hash).toContain('p=1')
    expect(hash).not.toContain(OPERATOR_PASSWORD)
  })

  it('should verify a hash it wrote and refuse one it did not', async () => {
    const hash = await hashOperatorPassword(OPERATOR_PASSWORD)

    expect(await verifyOperatorPassword(OPERATOR_PASSWORD, hash)).toBe(true)
    expect(await verifyOperatorPassword(OTHER_OPERATOR_PASSWORD, hash)).toBe(false)
    // A malformed hash is a `false`, never a throw reaching a route.
    expect(await verifyOperatorPassword(OPERATOR_PASSWORD, MALFORMED_HASH)).toBe(false)
    expect(await verifyOperatorPassword(OPERATOR_PASSWORD, '')).toBe(false)
  })

  it('should verify the committed fixture hashes, so the suite is not self-referential', async () => {
    // Guards against the harness being edited to agree with a broken
    // `verifyOperatorPassword`: these strings are fixed here rather than produced by
    // the code under test, so this test can only pass if argon2 really checks them.
    expect(await verifyOperatorPassword(OPERATOR_PASSWORD, OPERATOR_HASH)).toBe(true)
    expect(await verifyOperatorPassword(OPERATOR_PASSWORD, OTHER_OPERATOR_HASH)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Session token
// ---------------------------------------------------------------------------

describe('session token — signature, expiry, vocabulary', () => {
  it('should round-trip a freshly minted token', () => {
    const claims = verifySessionToken(createSessionToken(operatorClaims(OPERATOR)))

    expect(claims?.id).toBe(OPERATOR.id)
    expect(claims?.username).toBe(OPERATOR.username)
    expect(claims?.capabilities).toEqual(listOperatorCapabilities())
  })

  it('should refuse a token whose payload was edited', () => {
    const token = createSessionToken(operatorClaims(OPERATOR))
    const [payload, signature] = token.split('.')
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >

    // The strongest attack available: the operator keeps their own signature and
    // swaps the subject for someone else's.
    decoded.sub = 'someone-else'
    const forged = `${Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')}.${signature}`

    expect(verifySessionToken(forged)).toBeNull()
    expect(verifySessionToken(token)).not.toBeNull()
  })

  it('should refuse a token signed with the portal secret', async () => {
    // The scenario the "do not reuse NEXTAUTH_SECRET" requirement exists for: a bug
    // in the portal would produce exactly this, and the console must not honour it.
    process.env.NEXTAUTH_SECRET = SESSION_SECRET
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        sub: OPERATOR.id,
        username: OPERATOR.username,
        email: OPERATOR.email,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        caps: listOperatorCapabilities(),
      }),
      'utf8',
    ).toString('base64url')
    const signature = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')

    expect(verifySessionToken(`${payload}.${signature}`)).toBeNull()
  })

  it('should refuse a token signed with the raw secret, and with a rotated one', () => {
    const token = createSessionToken(operatorClaims(OPERATOR))
    const [payload, signature] = token.split('.') as [string, string]

    // The signing key is HKDF-derived, so the configured secret is not the key. A
    // deployment that leaked the secret therefore could not mint a token from it.
    const withRawSecret = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')
    expect(withRawSecret).not.toBe(signature)
    expect(verifySessionToken(`${payload}.${withRawSecret}`)).toBeNull()

    // The derived key is stable, which is what makes the console work at all.
    const derived = Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(SESSION_SECRET, 'utf8'),
        Buffer.from('novastar-super-admin/session', 'utf8'),
        Buffer.from('hmac-v1', 'utf8'),
        32,
      ),
    )
    expect(createHmac('sha256', derived).update(payload).digest('base64url')).toBe(signature)

    // And rotation invalidates every issued session at once, which is the point of
    // giving the key its own variable.
    process.env.PLATFORM_SESSION_SECRET = ROTATED_SESSION_SECRET
    expect(verifySessionToken(token)).toBeNull()
    expect(verifySessionToken(createSessionToken(operatorClaims(OPERATOR)))).not.toBeNull()
  })

  it('should refuse an expired token', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = createSessionToken(
      operatorClaims(OPERATOR, { issuedAt: now - 7200, expiresAt: now - 3600 }),
    )
    expect(verifySessionToken(token)).toBeNull()
  })

  it('should drop a capability that is no longer in the vocabulary', () => {
    const token = createSessionToken(
      operatorClaims(OPERATOR, { capabilities: ['tenant:read', 'tenant:teleport'] }),
    )
    expect(verifySessionToken(token)?.capabilities).toEqual(['tenant:read'])
  })

  it('should refuse a structurally wrong token rather than throwing', () => {
    for (const bad of ['', 'nodot', 'a.b.c', '....', 'not-base64!.sig', '.', 'a.']) {
      expect(verifySessionToken(bad)).toBeNull()
    }
    expect(verifySessionToken(undefined)).toBeNull()
    expect(verifySessionToken(null)).toBeNull()
  })

  it('should use a cookie name the portal does not', () => {
    // Two cookies under two keys, so neither app's token replays into the other.
    // `admin-context` reads the same constant, so the name has exactly one source.
    expect(ADMIN_SESSION_COOKIE).toBe('super_admin_session')
    expect(ADMIN_SESSION_COOKIE).not.toBe('next-auth.session-token')
    expect(ADMIN_TENANT_COOKIE).toBe('super_admin_tenant')
  })
})

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe('configuration — deny by default, and no fallback', () => {
  it('should refuse everything when the session secret is unset', async () => {
    givenOperators(OPERATOR)

    // Legitimately authenticated while configured, then the secret is withdrawn: the
    // cookie stops verifying and nothing new can be minted.
    const operator = await authenticateOperator({
      identifier: OPERATOR.username,
      password: OPERATOR_PASSWORD,
    })
    const token = createSessionToken(operator as AdminOperator)
    expect(verifySessionToken(token)).not.toBeNull()
    expect(adminAuthConfigured()).toBe(true)

    delete process.env.PLATFORM_SESSION_SECRET

    expect(adminAuthConfigured()).toBe(false)
    expect(verifySessionToken(token)).toBeNull()
    // Minting throws rather than producing an unsigned token. Fail closed.
    expect(() => createSessionToken(operator as AdminOperator)).toThrow(
      /PLATFORM_SESSION_SECRET/,
    )

    // The route reports it as a misconfiguration rather than a bad credential, which
    // is the one distinction an unauthenticated caller may be given: "the password
    // is wrong" would be false.
    const response = await login({
      identifier: OPERATOR.username,
      password: OPERATOR_PASSWORD,
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'The control plane is not configured' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('should refuse everything when the session secret is shorter than the minimum', () => {
    process.env.PLATFORM_SESSION_SECRET = 'too-short'

    expect(MIN_SESSION_SECRET_LENGTH).toBe(32)
    expect('too-short'.length).toBeLessThan(MIN_SESSION_SECRET_LENGTH)
    expect(adminAuthConfigured()).toBe(false)
    expect(() => createSessionToken(operatorClaims(OPERATOR))).toThrow(/at least 32 characters/)
  })

  it('should not fall back to the portal secret or any operator password', () => {
    // A fallback to `NEXTAUTH_SECRET` would mean one key signing two apps' cookies; a
    // fallback to an operator's password would couple that operator's password
    // rotation to every other operator's session. Neither exists.
    delete process.env.PLATFORM_SESSION_SECRET
    process.env.NEXTAUTH_SECRET = SESSION_SECRET
    expect(() => createSessionToken(operatorClaims(OPERATOR))).toThrow(/PLATFORM_SESSION_SECRET/)

    process.env.PLATFORM_SESSION_SECRET = OPERATOR_PASSWORD
    expect(() => createSessionToken(operatorClaims(OPERATOR))).toThrow(/at least 32 characters/)
  })

  it('should refuse everybody when the database holds no operator', async () => {
    // The old "empty allowlist" case, in its new shape: no rows means nobody to
    // authenticate, and there is no environment list left to fall back to. An
    // unprovisioned console refuses every sign-in, which is the correct answer.
    givenOperators()

    const response = await login({
      identifier: OPERATOR.username,
      password: OPERATOR_PASSWORD,
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: LOGIN_FAILURE })
  })
})

// ---------------------------------------------------------------------------
// Immediate revocation
// ---------------------------------------------------------------------------

describe('resolveLiveOperator — the row, not the token', () => {
  it('should resolve an active row', async () => {
    givenLiveOperator(OPERATOR)

    const operator = await resolveLiveOperator(
      verifySessionToken(createSessionToken(operatorClaims(OPERATOR)))!,
    )
    expect(operator?.id).toBe(OPERATOR.id)
  })

  it('should refuse a deactivated operator on an unexpired, correctly signed token', async () => {
    // The token is valid for another seven and a half hours. The row says otherwise
    // and the row wins: this is what replaced the environment allowlist, and it is the
    // mechanism the whole rewrite exists for.
    givenLiveOperator(fakeOperator({ id: OPERATOR.id, status: 'SUSPENDED' }))

    expect(
      await resolveLiveOperator(
        verifySessionToken(createSessionToken(operatorClaims(OPERATOR)))!,
      ),
    ).toBeNull()
  })

  it('should refuse a deleted operator', async () => {
    givenLiveOperator(null)

    expect(
      await resolveLiveOperator(
        verifySessionToken(createSessionToken(operatorClaims(OPERATOR)))!,
      ),
    ).toBeNull()
  })

  it('should narrow to the grants the row still holds', async () => {
    // The token was minted with everything; the row now holds one capability.
    givenLiveOperator(fakeOperator({ id: OPERATOR.id, capabilities: ['tenant:read'] }))

    const operator = await resolveLiveOperator(
      verifySessionToken(createSessionToken(operatorClaims(OPERATOR)))!,
    )
    expect(operator?.capabilities).toEqual(['tenant:read'])
  })

  it('should not widen a live session when the row gains a capability', async () => {
    // The intersection is the narrower of the two on purpose: a revocation takes
    // effect immediately, an escalation waits for the next sign-in, because widening
    // a live session on the strength of a database write is a smaller guarantee than
    // re-authenticating.
    givenLiveOperator(fakeOperator({ id: OPERATOR.id, capabilities: ['tenant:provision'] }))

    const operator = await resolveLiveOperator(
      verifySessionToken(
        createSessionToken(operatorClaims(OPERATOR, { capabilities: ['tenant:read'] })),
      )!,
    )
    expect(operator?.capabilities).toEqual([])
  })

  it('should take the row\'s name and password flag, not the token\'s', async () => {
    givenLiveOperator(
      fakeOperator({
        id: OPERATOR.id,
        name: 'Renamed Operator',
        mustChangePassword: true,
      }),
    )

    const operator = await resolveLiveOperator(
      verifySessionToken(
        createSessionToken(operatorClaims(OPERATOR, { id: OPERATOR.id })),
      )!,
    )
    expect(operator?.name).toBe('Renamed Operator')
    expect(operator?.mustChangePassword).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// requireOperator — the gate itself
// ---------------------------------------------------------------------------

describe('requireOperator — the gate itself', () => {
  it('should throw UnauthorizedError with no cookie, and query nothing', async () => {
    setCookies({})

    await expect(requireOperator()).rejects.toBeInstanceOf(UnauthorizedError)
    // Signature verification is pure, so an unverifiable cookie costs no query at
    // all. This is the property that keeps a scanner from turning this app into a
    // database load generator.
    expect(mocks.platformOperatorFindUnique).toHaveBeenCalledTimes(0)
  })

  it('should refuse a school-level session cookie outright', async () => {
    // A portal session token under the portal's cookie name. The console reads a
    // different name signed with a different key, so this is simply absent — and
    // "absent" must be a 401, not a degraded fallback.
    setCookies({ 'next-auth.session-token': 'portal.session.value' })

    await expect(requireOperator()).rejects.toBeInstanceOf(UnauthorizedError)
    expect(mocks.platformOperatorFindUnique).toHaveBeenCalledTimes(0)
  })

  it('should refuse a tampered session cookie without querying', async () => {
    const token = createSessionToken(operatorClaims(OPERATOR))
    setCookies({ [ADMIN_SESSION_COOKIE]: `${token.slice(0, -4)}AAAA` })

    await expect(requireOperator()).rejects.toBeInstanceOf(UnauthorizedError)
    expect(mocks.platformOperatorFindUnique).toHaveBeenCalledTimes(0)
  })

  it('should refuse an operator deactivated after signing in, before the token expires', async () => {
    signedIn()
    setCookies({
      [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR, {
        // Still valid for hours: the expiry is not what refuses this.
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      })),
    })

    // Suspended a minute later, with the cookie still valid. The live read refuses it
    // now rather than in an hour.
    givenLiveOperator(fakeOperator({ id: OPERATOR.id, status: 'SUSPENDED' }))

    await expect(requireOperator()).rejects.toBeInstanceOf(UnauthorizedError)
    expect(mocks.platformOperatorFindUnique).toHaveBeenCalledTimes(1)
  })

  it('should throw ForbiddenError for a valid session that grants nothing', async () => {
    const row = fakeOperator({ capabilities: [] })
    signedIn(row)

    await expect(requireOperator()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('should return the operator and the selection for a signed-in operator', async () => {
    givenLiveOperator(OPERATOR)
    setCookies({
      [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)),
      [ADMIN_TENANT_COOKIE]: 'tenant-a',
    })

    const context = await requireOperator()
    expect(context.operator.id).toBe(OPERATOR.id)
    expect(context.operator.email).toBe(OPERATOR.email)
    expect(context.selectedTenantId).toBe('tenant-a')
  })

  it('should report no selection rather than inventing one', async () => {
    // The load-bearing negative for this file: there is no ambient tenant, so "no
    // selection" is a real state and never becomes "the first tenant" or "every
    // tenant".
    signedIn()

    const context = await requireOperator()
    expect(context.selectedTenantId).toBeNull()
    expect(await getSelectedTenantId()).toBeNull()
    expect((await getOperatorOrNull())?.operator.id).toBe(OPERATOR.id)
  })

  it('should treat a blank selection cookie as no selection', async () => {
    givenLiveOperator(OPERATOR)
    setCookies({
      [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)),
      [ADMIN_TENANT_COOKIE]: '   ',
    })

    expect(await getSelectedTenantId()).toBeNull()
  })

  it('should report no operator for an unauthenticated caller, without throwing', async () => {
    setCookies({})
    expect(await getOperatorOrNull()).toBeNull()
  })

  it('should propagate a database failure rather than reporting an invalid session', async () => {
    // Fail closed either way — no operator, no authorisation — but reported as an
    // outage, so the health page sees it and legitimate operators are not trained to
    // re-authenticate during an incident.
    signedIn()
    mocks.platformOperatorFindUnique.mockImplementation(async () => {
      throw new Error('connection refused')
    })

    await expect(requireOperator()).rejects.toThrow('connection refused')
    // And `getOperatorOrNull` must not absorb it into "signed out".
    await expect(getOperatorOrNull()).rejects.toThrow('connection refused')
  })
})

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe('requireCapability — deny by default', () => {
  it('should refuse a capability the operator does not hold', async () => {
    givenLiveOperator(fakeOperator({ id: OPERATOR.id, capabilities: ['tenant:read'] }))
    setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)) })

    // The token still carries every capability. The row does not, and the row wins.
    await expect(requireCapability('platform:read')).rejects.toBeInstanceOf(ForbiddenError)
    expect((await requireCapability('tenant:read')).operator.id).toBe(OPERATOR.id)
  })

  it('should let a signed-in operator through for every capability it holds', async () => {
    signedIn()

    // Without this, every refusal above would also pass if the gate refused everyone.
    for (const capability of OPERATOR_CAPABILITIES) {
      expect((await requireCapability(capability)).operator.id).toBe(OPERATOR.id)
    }
  })

  it('should refuse every capability in turn when the grant set is empty', async () => {
    const row = fakeOperator({ capabilities: [] })
    givenLiveOperator(row)
    setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(row)) })

    // `requireOperator` refuses on an empty grant set before any of these is reached,
    // which is the load-bearing negative: an operator who holds nothing cannot act.
    await expect(requireOperator()).rejects.toBeInstanceOf(ForbiddenError)
    for (const capability of OPERATOR_CAPABILITIES) {
      expect(hasOperatorCapability([], capability)).toBe(false)
    }
  })

  it('should match wildcards with the shared matcher, not a second rule', () => {
    // `hasOperatorCapability` delegates to `permissionMatches`, so a delegated grant
    // written elsewhere in the platform behaves identically here.
    expect(hasOperatorCapability(['tenant:*'], 'tenant:provision')).toBe(
      permissionMatches('tenant:*', 'tenant:provision'),
    )
    expect(hasOperatorCapability(['tenant:*'], 'platform:audit')).toBe(
      permissionMatches('tenant:*', 'platform:audit'),
    )
  })

  it('should refuse an unknown capability name', () => {
    expect(parseOperatorCapability('tenant:read')).toBe('tenant:read')
    expect(parseOperatorCapability('tenant:teleport')).toBeNull()
    expect(parseOperatorCapability('TENANT:READ')).toBeNull()
    expect(parseOperatorCapability('')).toBeNull()
    expect(parseOperatorCapability(null)).toBeNull()
    expect(parseOperatorCapability(undefined)).toBeNull()
  })

  it('should hold an allowlist, not an isAdmin flag', () => {
    // The structural claim: the vocabulary is the whole privilege model, and every
    // entry in it is something a route can ask for by name.
    expect(OPERATOR_GRANTS).toEqual(OPERATOR_CAPABILITIES)
    for (const grant of OPERATOR_CAPABILITIES) {
      expect(parseOperatorCapability(grant)).toBe(grant)
    }
    expect(OPERATOR_CAPABILITIES).not.toContain('*')
  })
})

// ---------------------------------------------------------------------------
// The login route
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it('should set a signed session cookie and return the profile', async () => {
    givenOperators(OPERATOR)

    const response = await login({
      identifier: OPERATOR.username,
      password: OPERATOR_PASSWORD,
    })
    expect(response.status).toBe(200)

    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${ADMIN_SESSION_COOKIE}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=strict')
    expect(cookie).toContain('Path=/')

    const { operator } = (await response.json()) as {
      operator: Record<string, unknown>
    }
    expect(operator.username).toBe(OPERATOR.username)
    // Never a hash, and never the token itself echoed in the body.
    expect(Object.keys(operator)).not.toContain('passwordHash')
    expect(JSON.stringify(operator)).not.toContain(OPERATOR_HASH.slice(0, 12))
  })

  it('should refuse a body that is not an object of the expected shape', async () => {
    for (const body of [[], 'nope', 42, null]) {
      const response = await login(body as unknown as Record<string, unknown>)
      expect(response.status).toBe(400)
    }
  })

  it('should refuse the old email and passphrase field names', async () => {
    givenOperators(OPERATOR)

    const response = await login({
      email: OPERATOR.email,
      passphrase: OPERATOR_PASSWORD,
    })
    expect(response.status).toBe(401)
    // Not "field missing" — the same refusal, because accepting either spelling
    // would leave two ways to say one request.
    expect(await response.json()).toEqual({ error: LOGIN_FAILURE })
  })

  it('should attribute a sign-in to the operator, and a refusal to nobody', async () => {
    givenOperators(OPERATOR)

    await login({ identifier: OPERATOR.username, password: OPERATOR_PASSWORD })
    const succeeded = lastAuditEntry()
    expect(succeeded.action).toBe('LOGIN')
    expect(succeeded.entity).toBe('operator')
    // The reason this column exists: before it, every console entry had
    // `userId: null` and the trail could say what happened but never who did it.
    expect(succeeded.operatorId).toBe(OPERATOR.id)
    expect(succeeded.userId).toBeNull()
    expect(succeeded.entityId).toBe(OPERATOR.id)
    expect(succeeded.ipAddress).toBeTruthy()

    await login({ identifier: 'nobody', password: OTHER_OPERATOR_PASSWORD })
    const refused = lastAuditEntry()
    expect(refused.action).toBe('LOGIN_FAILED')
    // Deliberately absent: a refused attempt may not have named a real operator, and
    // guessing one would attribute a guessed credential to a named person. The
    // client address carries the attribution instead.
    expect(refused.operatorId).toBeNull()
    expect(refused.ipAddress).toBeTruthy()
  })

  it('should still sign in when the audit table is unreachable', async () => {
    givenOperators(OPERATOR)
    mocks.auditCreate.mockImplementation(async () => {
      throw new Error('audit unavailable')
    })

    const response = await login({
      identifier: OPERATOR.username,
      password: OPERATOR_PASSWORD,
    })
    // An operator must be able to sign in to fix the thing that made the audit table
    // unreachable. Tenant mutations do not get this leniency.
    expect(response.status).toBe(200)
  })
})