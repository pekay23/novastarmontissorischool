import { describe, it, expect, beforeEach } from 'bun:test'

import {
  SSO_GOOGLE_PROVIDER_ID,
  SSO_MICROSOFT_PROVIDER_ID,
  SSO_SCOPE,
  buildSsoProviders,
  evaluateEmailVerification,
  isSsoProviderConfigured,
  readConfiguredSsoProviders,
  resolveSsoAccount,
  ssoRefusalMessage,
  type SsoAccountLink,
  type SsoProviderClaims,
  type SsoResolutionDeps,
  type SsoUserRecord,
} from '@/lib/auth/sso'
import { normalizeSchoolCode, schoolCodeFromCookie } from '@/lib/auth/sso-school-code'

/**
 * Who gets a session when they come back through Google or Microsoft.
 *
 * The rules under test are the ones a portal must not get wrong: an address
 * nobody pre-created, an account somebody suspended, an address the provider has
 * not vouched for, and — the one this schema makes dangerous — the same address
 * existing in two schools.
 *
 * Driven through `resolveSsoAccount` with injected collaborators rather than
 * through NextAuth, because the alternative is a live provider. The database
 * stand-ins record what they were asked, so the tenant scoping is asserted on
 * the query that was built and not merely on the answer it produced.
 */

// ---------------------------------------------------------------------------
// Stand-ins
// ---------------------------------------------------------------------------

const SCHOOL_A = 'school-novastar'
const SCHOOL_B = 'school-other'

interface FakeUser extends SsoUserRecord {
  schoolId: string
}

let users: FakeUser[] = []
let links: (SsoAccountLink & { provider: string; providerAccountId: string })[] = []
let flags: Record<string, boolean> = {}

/** Every `findUserByEmail` call, so a test can assert what was looked up. */
let lookups: { schoolId: string; email: string }[] = []
let linksWritten = 0

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: 'user-1',
    tenantId: 'tenant-novastar',
    schoolId: SCHOOL_A,
    email: 'teacher@novastarmontessori.com',
    status: 'ACTIVE',
    mustChangePassword: false,
    passwordChangedAt: null,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<SsoResolutionDeps> = {}): SsoResolutionDeps {
  return {
    async findSchool(code) {
      if (code === SCHOOL_A || code === SCHOOL_B) return { id: code }
      return null
    },
    async findUserByEmail({ schoolId, email }) {
      lookups.push({ schoolId, email })
      const match = users.find(
        (row) =>
          row.schoolId === schoolId && row.email.toLowerCase() === email.toLowerCase()
      )
      return match ?? null
    },
    async findAccountLink({ provider, providerAccountId }) {
      return (
        links.find(
          (row) => row.provider === provider && row.providerAccountId === providerAccountId
        ) ?? null
      )
    },
    async createAccountLink({ userId, provider, providerAccountId }) {
      linksWritten += 1
      links.push({ id: `link-${linksWritten}`, userId, provider, providerAccountId })
    },
    async isTenantFlagEnabled(tenantId, flagKey) {
      return flags[`${tenantId}:${flagKey}`] ?? false
    },
    ...overrides,
  }
}

function input(overrides: Partial<Parameters<typeof resolveSsoAccount>[1]> = {}) {
  return {
    provider: SSO_GOOGLE_PROVIDER_ID,
    providerAccountId: 'google-subject-123',
    claims: { sub: 'google-subject-123', email: 'Teacher@NovastarMontessori.com', email_verified: true },
    schoolCode: SCHOOL_A,
    tokens: { access_token: 'ya29.test', scope: SSO_SCOPE },
    ...overrides,
  }
}

/** The refusal reason, or `null` when the sign-in was allowed. */
async function refuseWith(
  deps: SsoResolutionDeps,
  overrides: Partial<Parameters<typeof resolveSsoAccount>[1]> = {}
): Promise<string | null> {
  const resolution = await resolveSsoAccount(deps, input(overrides))
  return resolution.allowed ? null : resolution.reason
}

beforeEach(() => {
  users = [makeUser()]
  links = []
  flags = { 'tenant-novastar:sso_google': true }
  lookups = []
  linksWritten = 0
})

// ---------------------------------------------------------------------------
// Registration: absent credentials means no provider
// ---------------------------------------------------------------------------

describe('a provider is registered only when both credentials are present', () => {
  const googleEnv = { GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'g-secret' }
  const microsoftEnv = {
    MICROSOFT_ENTRA_ID_CLIENT_ID: 'entra-id',
    MICROSOFT_ENTRA_ID_CLIENT_SECRET: 'entra-secret',
  }

  it('should register nothing when no environment variables are set', () => {
    expect(readConfiguredSsoProviders({})).toEqual([])
    expect(buildSsoProviders({})).toEqual([])
  })

  it('should register nothing when only the client id is set', () => {
    // The half-configured case. NextAuth accepts a provider with no secret and
    // fails on the token exchange, which is after the visitor has already been
    // sent to Google; the button would have been on the page because the
    // provider was in the list.
    const providers = buildSsoProviders({ GOOGLE_CLIENT_ID: googleEnv.GOOGLE_CLIENT_ID })

    expect(providers).toEqual([])
    expect(isSsoProviderConfigured(SSO_GOOGLE_PROVIDER_ID, { GOOGLE_CLIENT_ID: googleEnv.GOOGLE_CLIENT_ID })).toBe(false)
  })

  it('should register nothing when only the client secret is set', () => {
    expect(buildSsoProviders({ GOOGLE_CLIENT_SECRET: googleEnv.GOOGLE_CLIENT_SECRET })).toEqual([])
  })

  it('should register nothing when a credential is only whitespace', () => {
    // A variable set to a single space is a paste accident, and NextAuth would
    // take it as a credential.
    expect(buildSsoProviders({ ...googleEnv, GOOGLE_CLIENT_SECRET: '   ' })).toEqual([])
  })

  it('should register exactly the provider whose credentials exist', () => {
    const providers = buildSsoProviders(microsoftEnv)

    expect(providers.map((p) => p.id)).toEqual([SSO_MICROSOFT_PROVIDER_ID])
  })

  it('should register both when both are configured', () => {
    const providers = buildSsoProviders({ ...googleEnv, ...microsoftEnv })

    expect(providers.map((p) => p.id)).toEqual([SSO_GOOGLE_PROVIDER_ID, SSO_MICROSOFT_PROVIDER_ID])
    for (const provider of providers) {
      expect(provider.type).toBe('oauth')
      // Identity scopes only. Anything else puts Google into verification
      // territory and Microsoft into admin consent.
      //
      // `Provider` is a union discriminated on `type`, and `authorization` only
      // exists on the `OAuthConfig` arm. The expect above proves the runtime
      // value; this guard is what tells the compiler the same thing, so the scope
      // assertion below is typed rather than reached through the union with a
      // cast that would also satisfy a provider missing the field entirely.
      if (provider.type !== 'oauth') {
        throw new Error(`provider ${provider.id} is not an OAuth provider`)
      }
      expect(JSON.stringify(provider.authorization)).toContain('openid email profile')
    }
  })

  it('should report the provider as unconfigured when its environment is blank', () => {
    expect(isSsoProviderConfigured(SSO_GOOGLE_PROVIDER_ID, {})).toBe(false)
    expect(isSsoProviderConfigured(SSO_GOOGLE_PROVIDER_ID, googleEnv)).toBe(true)
    expect(isSsoProviderConfigured('microsoft-entra-id', googleEnv)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The address has to be asserted, and vouched for
// ---------------------------------------------------------------------------

describe('the provider has to assert an address', () => {
  it('should refuse an unknown provider before anything else is asked', async () => {
    const resolution = await resolveSsoAccount(makeDeps(), input({ provider: 'evil-provider' }))

    expect(resolution).toEqual({ allowed: false, reason: 'sso_unknown_provider' })
    expect(lookups).toEqual([])
  })

  it('should refuse when the provider sent no address', async () => {
    expect(await refuseWith(makeDeps(), { claims: { email: null, email_verified: true } })).toBe(
      'sso_no_email'
    )
  })

  it('should refuse when the provider sent a blank address', async () => {
    expect(await refuseWith(makeDeps(), { claims: { email: '   ', email_verified: true } })).toBe(
      'sso_no_email'
    )
  })

  it("should refuse a Google identity whose email Google has not verified", async () => {
    // `email_verified: false` is a refusal under every provider. For Google it is
    // the only claim Google makes, so reading it is the whole point of asking.
    expect(
      await refuseWith(makeDeps(), {
        claims: { email: 'teacher@novastarmontessori.com', email_verified: false },
      })
    ).toBe('sso_email_unverified')
  })

  it("should refuse a Google identity Google sent no verification claim for", async () => {
    // Silence is not consent. A provider that asserts verification is held to it:
    // an absent claim means the assertion was not made, so there is nothing to
    // rely on.
    expect(
      await refuseWith(makeDeps(), {
        claims: { email: 'teacher@novastarmontessori.com' },
      })
    ).toBe('sso_email_unverified')
  })

  it('should refuse a Microsoft identity that explicitly reports an unverified address', async () => {
    expect(
      await refuseWith(makeDeps(), {
        provider: SSO_MICROSOFT_PROVIDER_ID,
        claims: { email: 'teacher@novastarmontessori.com', email_verified: false },
      })
    ).toBe('sso_email_unverified')
  })

  it('should accept a Microsoft identity that makes no verification claim at all', async () => {
    // Entra's v2.0 userinfo response has no `email_verified`, in either the
    // present or the absent form — so requiring one would refuse every Microsoft
    // sign-in. What it does return is a directory-managed address, or a personal
    // account's verified primary alias.
    flags['tenant-novastar:sso_microsoft'] = true

    const resolution = await resolveSsoAccount(
      makeDeps(),
      input({
        provider: SSO_MICROSOFT_PROVIDER_ID,
        claims: { email: 'teacher@novastarmontessori.com' },
      })
    )

    expect(resolution.allowed).toBe(true)
  })

  it('should read the rule directly, so the two providers cannot converge by accident', () => {
    const claims: SsoProviderClaims = { email: 'a@b.test' }

    expect(evaluateEmailVerification('required-claim', claims)).toBe('sso_email_unverified')
    expect(evaluateEmailVerification('required-claim', { ...claims, email_verified: true })).toBeNull()
    expect(evaluateEmailVerification('no-claim', claims)).toBeNull()
    expect(evaluateEmailVerification('no-claim', { ...claims, email_verified: false })).toBe(
      'sso_email_unverified'
    )
    // A truthy non-boolean is not a provider assertion either.
    expect(evaluateEmailVerification('required-claim', { ...claims, email_verified: 'true' })).toBe(
      'sso_email_unverified'
    )
  })
})

// ---------------------------------------------------------------------------
// The school code, and the account that has to already exist there
// ---------------------------------------------------------------------------

describe('the school code survives the redirect, or the sign-in is refused', () => {
  it('should refuse when no school code was carried across', async () => {
    expect(await refuseWith(makeDeps(), { schoolCode: null })).toBe('sso_no_school_code')
    expect(lookups).toEqual([])
  })

  it('should refuse a code that names no school', async () => {
    expect(await refuseWith(makeDeps(), { schoolCode: 'not-a-school' })).toBe('sso_unknown_school')
    expect(lookups).toEqual([])
  })

  it('should refuse an address with no pre-created account, and write nothing', async () => {
    const reason = await refuseWith(makeDeps(), {
      claims: { email: 'stranger@example.com', email_verified: true },
    })

    expect(reason).toBe('sso_no_account')
    // No `User`, no `Account`, no `Session`. Nobody gets a portal account because
    // they could authenticate somewhere else.
    expect(linksWritten).toBe(0)
    expect(links).toEqual([])
  })

  it('should refuse an address that exists only at another school', async () => {
    users = [makeUser({ schoolId: SCHOOL_B })]

    expect(await refuseWith(makeDeps(), { schoolCode: SCHOOL_A })).toBe('sso_no_account')
    expect(linksWritten).toBe(0)
  })

  it('should match the stored address without regard to case', async () => {
    // The stored value is lower case and the provider's is not, which is the
    // whole reason `authorize()` looks the address up twice.
    users = [makeUser({ email: 'teacher@novastarmontessori.com' })]

    const resolution = await resolveSsoAccount(
      makeDeps(),
      input({ claims: { email: 'TEACHER@NOVASTARMONTESSORI.COM', email_verified: true } })
    )

    expect(resolution.allowed).toBe(true)
    expect(lookups).toEqual([
      { schoolId: SCHOOL_A, email: 'teacher@novastarmontessori.com' },
    ])
  })

  it('should scope the lookup to the school the code named, never to the address alone', async () => {
    // THE cross-tenant case. One address, two schools, two accounts. The lookup
    // carries the school in its `where`, so the second school's account is not
    // merely refused later — it is never a candidate.
    users = [
      makeUser({ id: 'user-a', tenantId: 'tenant-a', schoolId: SCHOOL_A }),
      makeUser({ id: 'user-b', tenantId: 'tenant-b', schoolId: SCHOOL_B }),
    ]
    flags = { 'tenant-a:sso_google': true, 'tenant-b:sso_google': true }

    const resolution = await resolveSsoAccount(makeDeps(), input({ schoolCode: SCHOOL_B }))

    expect(resolution).toMatchObject({ allowed: true, userId: 'user-b', tenantId: 'tenant-b' })
    expect(lookups).toEqual([{ schoolId: SCHOOL_B, email: 'teacher@novastarmontessori.com' }])
    expect(linksWritten).toBe(1)
    expect(links[0]!.userId).toBe('user-b')
  })

  it('should refuse the second school when the first already owns the identity', async () => {
    // `Account` is unique on `(provider, providerAccountId)`, so one provider
    // identity binds to one portal account. Naming the other school does not
    // produce a second account for the same Google identity.
    users = [
      makeUser({ id: 'user-a', tenantId: 'tenant-a', schoolId: SCHOOL_A }),
      makeUser({ id: 'user-b', tenantId: 'tenant-b', schoolId: SCHOOL_B }),
    ]
    flags = { 'tenant-a:sso_google': true, 'tenant-b:sso_google': true }
    links = [
      {
        id: 'link-1',
        userId: 'user-a',
        provider: SSO_GOOGLE_PROVIDER_ID,
        providerAccountId: 'google-subject-123',
      },
    ]

    expect(await refuseWith(makeDeps(), { schoolCode: SCHOOL_B })).toBe('sso_identity_linked_elsewhere')
    expect(linksWritten).toBe(0)
    expect(links).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Account state
// ---------------------------------------------------------------------------

describe('an account that cannot be used is refused', () => {
  it.each(['SUSPENDED', 'ARCHIVED', 'DELETED'] as const)(
    'should refuse a %s account',
    async (status) => {
      users = [makeUser({ status })]

      const reason = await refuseWith(makeDeps())

      expect(reason).toBe(status === 'SUSPENDED' ? 'sso_account_suspended' : 'sso_account_inactive')
      expect(linksWritten).toBe(0)
    }
  )

  it('should refuse an account that still owes its first password', async () => {
    // The proxy would send the resulting session to the setup page, which is only
    // reachable by an emailed link. A visitor arriving through a provider has no
    // such link, so letting them in is a dead end rather than a sign-in.
    users = [makeUser({ mustChangePassword: true, passwordChangedAt: null })]

    expect(await refuseWith(makeDeps())).toBe('sso_password_not_set')
    expect(linksWritten).toBe(0)
  })

  it('should allow an account whose password was provisioned and then changed', async () => {
    // The tenant CLI writes `mustChangePassword` together with a provisional
    // hash AND `passwordChangedAt`; the same `&& !passwordChangedAt` clause every
    // `authorize()` return value uses is what decides this.
    users = [makeUser({ mustChangePassword: true, passwordChangedAt: new Date() })]

    expect((await resolveSsoAccount(makeDeps(), input())).allowed).toBe(true)
  })

  it('should refuse before touching the account when the school has not enabled the provider', async () => {
    flags = {}

    const reason = await refuseWith(makeDeps())

    expect(reason).toBe('sso_disabled_for_school')
    expect(linksWritten).toBe(0)
  })

  it('should gate on the resolved account\'s own tenant flag, not a global one', async () => {
    users = [
      makeUser({ id: 'user-a', tenantId: 'tenant-a', schoolId: SCHOOL_A }),
      makeUser({ id: 'user-b', tenantId: 'tenant-b', schoolId: SCHOOL_B }),
    ]
    flags = { 'tenant-a:sso_google': true }

    expect((await resolveSsoAccount(makeDeps(), input({ schoolCode: SCHOOL_A }))).allowed).toBe(true)
    expect(await refuseWith(makeDeps(), { schoolCode: SCHOOL_B })).toBe('sso_disabled_for_school')
  })

  it('should gate Microsoft on its own flag, so enabling Google does not enable Microsoft', async () => {
    flags = { 'tenant-novastar:sso_google': true, 'tenant-novastar:sso_microsoft': false }

    expect(await refuseWith(makeDeps(), { provider: SSO_MICROSOFT_PROVIDER_ID })).toBe(
      'sso_disabled_for_school'
    )
  })
})

// ---------------------------------------------------------------------------
// The linkage on `Account`
// ---------------------------------------------------------------------------

describe('the provider identity is written once, and only for the resolved account', () => {
  it('should write the linkage on the first sign-in and report it', async () => {
    const resolution = await resolveSsoAccount(makeDeps(), input())

    expect(resolution).toEqual({
      allowed: true,
      userId: 'user-1',
      tenantId: 'tenant-novastar',
      linked: true,
    })
    expect(links).toEqual([
      {
        id: 'link-1',
        userId: 'user-1',
        provider: SSO_GOOGLE_PROVIDER_ID,
        providerAccountId: 'google-subject-123',
      },
    ])
  })

  it('should write nothing on the second sign-in, and still allow it', async () => {
    await resolveSsoAccount(makeDeps(), input())
    const second = await resolveSsoAccount(makeDeps(), input())

    expect(second).toEqual({
      allowed: true,
      userId: 'user-1',
      tenantId: 'tenant-novastar',
      linked: false,
    })
    expect(links).toHaveLength(1)
  })

  it('should keep the two providers separate for one person', async () => {
    flags['tenant-novastar:sso_microsoft'] = true

    await resolveSsoAccount(makeDeps(), input())
    const microsoft = await resolveSsoAccount(
      makeDeps(),
      input({ provider: SSO_MICROSOFT_PROVIDER_ID, providerAccountId: 'entra-subject-9' })
    )

    expect(microsoft).toMatchObject({ allowed: true, linked: true })
    expect(links.map((link) => link.provider)).toEqual([
      SSO_GOOGLE_PROVIDER_ID,
      SSO_MICROSOFT_PROVIDER_ID,
    ])
  })

  it('should not treat an identity linked to somebody else as a reason to sign that person in', async () => {
    // The refusal that replaces `allowDangerousEmailAccountLinking`. There is no
    // code path in which the address is enough.
    links = [
      {
        id: 'link-1',
        userId: 'someone-else',
        provider: SSO_GOOGLE_PROVIDER_ID,
        providerAccountId: 'google-subject-123',
      },
    ]

    const resolution = await resolveSsoAccount(makeDeps(), input())

    expect(resolution.allowed).toBe(false)
    expect(linksWritten).toBe(0)
    expect(links[0]!.userId).toBe('someone-else')
  })
})

// ---------------------------------------------------------------------------
// What the visitor is told
// ---------------------------------------------------------------------------

describe('every refusal has a sentence, and only ours has one', () => {
  it('should explain all eleven refusals', () => {
    const reasons = [
      'sso_unknown_provider',
      'sso_no_email',
      'sso_email_unverified',
      'sso_no_school_code',
      'sso_unknown_school',
      'sso_disabled_for_school',
      'sso_no_account',
      'sso_account_suspended',
      'sso_account_inactive',
      'sso_password_not_set',
      'sso_identity_linked_elsewhere',
    ]

    for (const reason of reasons) {
      expect(`${reason}: ${ssoRefusalMessage(reason, 'Google')}`).not.toBe(`${reason}: null`)
    }
  })

  it('should name the provider wherever the sentence is about the provider', async () => {
    // The provider name is what tells somebody reading "not switched on for your
    // school" WHICH switch is off. The two refusals above the account lookup say
    // nothing about the provider's own state and so do not need it.
    const named = [
      'sso_no_email',
      'sso_email_unverified',
      'sso_disabled_for_school',
      'sso_identity_linked_elsewhere',
    ]

    for (const reason of named) {
      expect(`${reason}: ${ssoRefusalMessage(reason, 'Google')}`).toContain('Google')
      expect(`${reason}: ${ssoRefusalMessage(reason, 'Microsoft')}`).toContain('Microsoft')
    }
  })

  it('should render nothing for a code this app does not own', () => {
    // `?error=` also carries next-auth's own codes, and it is a URL parameter.
    for (const code of ['AccessDenied', 'OAuthAccountNotLinked', 'CredentialsSignin', 'constructor']) {
      expect(ssoRefusalMessage(code, 'Google')).toBeNull()
    }
  })

  it('should fall back to a neutral provider name when none is known', () => {
    expect(ssoRefusalMessage('sso_disabled_for_school', null)).toContain('this sign-in method')
  })
})

// ---------------------------------------------------------------------------
// The school code cookie
// ---------------------------------------------------------------------------

describe('the school code cookie', () => {
  it('should round-trip a code through encoding', () => {
    expect(schoolCodeFromCookie(encodeURIComponent('  Novastar/2026  '))).toBe('Novastar/2026')
  })

  it('should refuse an absent or empty value', () => {
    expect(schoolCodeFromCookie(undefined)).toBeNull()
    expect(schoolCodeFromCookie(null)).toBeNull()
    expect(schoolCodeFromCookie('')).toBeNull()
  })

  it('should refuse malformed percent-encoding rather than throwing', () => {
    // Read inside the `signIn` callback, where a throw becomes an opaque
    // `?error=` the visitor cannot act on.
    expect(schoolCodeFromCookie('%')).toBeNull()
  })

  it('should refuse a value no school could have', () => {
    expect(normalizeSchoolCode('x'.repeat(101))).toBeNull()
    expect(normalizeSchoolCode('nove\u0000star')).toBeNull()
    expect(normalizeSchoolCode('')).toBeNull()
  })
})