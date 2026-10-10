import { describe, it, expect, mock, beforeEach } from 'bun:test'

/**
 * What a successful Google or Microsoft sign-in leaves in the audit log.
 *
 * `sso-account-resolution.test.ts` proves who is allowed to sign in. This proves
 * that afterwards an administrator can tell *which provider* signed them in —
 * and that question has a security answer, because Google vouches for the email
 * address and Microsoft does not (see `EmailVerificationRule` in `lib/auth/sso.ts`).
 *
 * The gap this closes: `events.signIn` writes `User logged in: <email>` with no
 * provider in it, and the SSO link entry is written only on the first sign-in.
 * So on every sign-in after the first, the audit log could not distinguish a
 * Microsoft-asserted identity from a Google-verified one.
 *
 * Driven through `ssoSignIn` with the collaborators replaced, because the real
 * ones are a Prisma client, a request cookie and a live provider.
 */

mock.module('server-only', () => ({}))

const { SSO_SCHOOL_CODE_COOKIE } = await import('@/lib/auth/sso-school-code')

const SCHOOL = 'school-novastar'
const TENANT = 'tenant-novastar'
const USER_ID = 'user-1'
const EMAIL = 'teacher@novastarmontessori.com'

let schoolCode: string | null = SCHOOL

// `headers` is exported alongside `cookies` so the module keeps the shape
// `lib/auth/redirect-to-login.ts` imports it for. Registered below with the rest.

type Row = Record<string, unknown>

let userRow: Row | null = null
let links: Row[] = []
let flags: Record<string, boolean> = {}

const prisma = {
  school: {
    async findFirst({ where }: { where: { OR: Array<{ id?: string; code?: string }> } }) {
      const match = where.OR.some((clause) => clause.id === schoolCode || clause.code === schoolCode)
      return match ? { id: SCHOOL, name: 'Novastar Montessori' } : null
    },
  },
  user: {
    async findFirst({ where }: { where: { schoolId: string } }) {
      // Same scoping `resolveSsoAccount` relies on: the answer is only there
      // because the query was scoped to one school. A lookup that dropped the
      // school must not find this account.
      return where.schoolId === SCHOOL ? userRow : null
    },
  },
  account: {
    async findUnique({
      where,
    }: {
      where: { provider_providerAccountId: { provider: string; providerAccountId: string } }
    }) {
      const { provider, providerAccountId } = where.provider_providerAccountId
      return (
        links.find(
          (row) => row.provider === provider && row.providerAccountId === providerAccountId
        ) ?? null
      )
    },
    async create({ data }: { data: Row }) {
      links.push(data)
      return data
    },
  },
  systemConfig: {
    async findUnique({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) {
      const { tenantId, key } = where.tenantId_key
      const value = flags[`${tenantId}:${key}`]
      return value === undefined ? null : { value }
    },
  },
  auditLog: { findFirst: async () => null, create: async () => ({}) },
}

let auditWrites: Row[] = []

const createAuditLog = mock(async (params: Row) => {
  auditWrites.push(params)
  return null
})

// ---------------------------------------------------------------------------
// Module-mock lifetime: snapshot before registering, restore after
// ---------------------------------------------------------------------------
//
// `mock.module` patches the LIVE namespace for the whole process and never reverts,
// so a registration made at module scope is not this file's alone — it is what every
// file that loads afterwards binds to, and it is still what their tests see after
// this file has finished. Four boundaries are registered below and all four are put
// back.
//
// The snapshot is read HERE, at module scope, before the first registration, and
// that is load-bearing rather than incidental: a `beforeEach` capture would run
// after the registrations below had already overwritten the namespace, so it would
// record this file's own factory and hand the double straight back to the next file.
//
// Every factory SPREADS the namespace it replaces and then overrides, which makes
// each fake both a superset (so no import below can fail on a name this file
// happened not to list, whatever loaded first) and a subset (so the restore above
// cannot leave a key behind — `mock.module` merges, so an added key could never be
// removed again).
const previousNamespaces = new Map<string, Record<string, unknown>>()
previousNamespaces.set('next/headers', { ...(await import('next/headers')) })
previousNamespaces.set('@/lib/prisma', { ...(await import('@/lib/prisma')) })
previousNamespaces.set('@novastar/database', { ...(await import('@novastar/database')) })
previousNamespaces.set('@/lib/audit/logger', { ...(await import('@/lib/audit/logger')) })

const base = (specifier: string): Record<string, unknown> =>
  previousNamespaces.get(specifier) ?? {}

const FAKES = [
  {
    specifier: 'next/headers',
    factory: () => ({
      ...base('next/headers'),
      cookies: async () => ({
        get: (name: string) =>
          name === SSO_SCHOOL_CODE_COOKIE && schoolCode !== null ? { value: schoolCode } : undefined,
      }),
      headers: async () => new Headers(),
    }),
  },
  {
    specifier: '@/lib/prisma',
    factory: () => ({ ...base('@/lib/prisma'), prisma, default: prisma }),
  },
  {
    specifier: '@novastar/database',
    factory: () => ({ ...base('@novastar/database'), prisma, default: prisma }),
  },
  {
    specifier: '@/lib/audit/logger',
    factory: () => ({
      ...base('@/lib/audit/logger'),
      AuditLogAction: { LOGIN: 'LOGIN', LOGOUT: 'LOGOUT', LOGIN_FAILED: 'LOGIN_FAILED' },
      createAuditLog,
      logAuditEvent: createAuditLog,
    }),
  },
] as const

// Also registered at load time, so the import of the module under test below
// resolves these specifiers through the doubles, and so the file is correct in a
// run that never reaches `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

beforeEach(() => {
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
})

const { ssoSignIn } = await import('@/lib/auth/sso-signin')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The entry that records the sign-in itself, as opposed to the linkage. */
function signIns(): Row[] {
  return auditWrites.filter((write) => write.action === 'LOGIN' && write.entity === 'users')
}

/** The entry recording that an account became reachable with this identity. */
function linkages(): Row[] {
  return auditWrites.filter((write) => write.action === 'LOGIN' && write.entity === 'accounts')
}

/** The refusal code in the redirect the visitor is sent to, or `null` when allowed. */
async function refusalFrom(signIn: () => Promise<boolean | string>): Promise<string | null> {
  const result = await signIn()
  if (typeof result !== 'string') return null
  return new URL(result, 'https://portal.test').searchParams.get('error')
}

function google() {
  return {
    account: {
      provider: 'google',
      type: 'oauth',
      providerAccountId: 'google-subject-123',
      access_token: 'ya29.test',
    },
    profile: { sub: 'google-subject-123', email: EMAIL, email_verified: true },
  }
}

function microsoft() {
  return {
    account: {
      provider: 'microsoft-entra-id',
      type: 'oauth',
      providerAccountId: 'entra-subject-9',
      access_token: 'eyJ.test',
    },
    // No `email_verified`, which is what Entra actually returns and what the
    // `no-claim` rule exists for.
    profile: { sub: 'entra-subject-9', email: EMAIL },
  }
}

beforeEach(() => {
  userRow = {
    id: USER_ID,
    tenantId: TENANT,
    schoolId: SCHOOL,
    email: EMAIL,
    status: 'ACTIVE',
    mustChangePassword: false,
    passwordChangedAt: null,
  }
  links = []
  flags = { [`${TENANT}:sso_google`]: true, [`${TENANT}:sso_microsoft`]: true }
  schoolCode = SCHOOL
  auditWrites = []
})

// ---------------------------------------------------------------------------
// The provider is named on a successful sign-in
// ---------------------------------------------------------------------------

describe('a successful sign-in records which provider asserted the identity', () => {
  it('should name Google, which vouches for the address', async () => {
    expect(await ssoSignIn(google())).toBe(true)

    expect(signIns()).toHaveLength(1)
    expect(signIns()[0]!.description).toBe('Signed in with google single sign-on')
  })

  it('should name Microsoft, which does not, in exactly the same shape', async () => {
    expect(await ssoSignIn(microsoft())).toBe(true)

    expect(signIns()).toHaveLength(1)
    expect(signIns()[0]!.description).toBe('Signed in with microsoft-entra-id single sign-on')
  })

  it('should attribute the entry to the account and its tenant', async () => {
    await ssoSignIn(microsoft())

    expect(signIns()[0]).toMatchObject({
      userId: USER_ID,
      entityId: USER_ID,
      tenantId: TENANT,
      action: 'LOGIN',
    })
  })

  it('should tell the two providers apart for one person who has signed in with both', async () => {
    await ssoSignIn(google())
    await ssoSignIn(microsoft())

    // This is the whole point. Same person, same email address, two sign-ins that
    // mean different things, and an administrator can say which was which.
    expect(signIns().map((write) => write.description)).toEqual([
      'Signed in with google single sign-on',
      'Signed in with microsoft-entra-id single sign-on',
    ])
    expect(signIns()[0]!.description).not.toContain('microsoft')
    expect(signIns()[1]!.description).not.toContain('google')
  })

  it('should record the provider on the second sign-in, not only the first', async () => {
    // The gap itself. The linkage entry is written once; without a per-sign-in
    // entry a Microsoft session after the first left nothing in the audit log to
    // tell it from a Google one.
    await ssoSignIn(google())
    const firstSignIns = signIns().length

    expect(await ssoSignIn(google())).toBe(true)
    expect(await ssoSignIn(microsoft())).toBe(true)

    expect(signIns()).toHaveLength(firstSignIns + 2)
    expect(signIns()[2]!.description).toBe('Signed in with microsoft-entra-id single sign-on')
  })

  it('should record the sign-in and the linkage as separate facts', async () => {
    await ssoSignIn(microsoft())

    // Two rows, because they are two facts: the person signed in, and this is the
    // first time this identity was bound to this account.
    expect(signIns()).toHaveLength(1)
    expect(linkages()).toHaveLength(1)
    expect(linkages()[0]!.description).toBe('Linked the account to microsoft-entra-id single sign-on')
  })

  it('should not write the linkage again on a returning sign-in', async () => {
    await ssoSignIn(microsoft())
    await ssoSignIn(microsoft())

    expect(linkages()).toHaveLength(1)
    expect(signIns()).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// A refused sign-in is unchanged
// ---------------------------------------------------------------------------

describe('a refusal still records the provider, and adds nothing else', () => {
  it('should name the provider on a refused sign-in and write no sign-in entry', async () => {
    flags = { [`${TENANT}:sso_google`]: false, [`${TENANT}:sso_microsoft`]: true }

    expect(await refusalFrom(() => ssoSignIn(google()))).toBe('sso_disabled_for_school')

    expect(signIns()).toEqual([])
    expect(auditWrites.map((write) => write.action)).toEqual(['LOGIN_FAILED'])
    expect(auditWrites[0]!.description).toContain('google')
  })

  it('should write no audit entry at all for a refusal with no account to name', async () => {
    // Below the account lookup there is nobody to attribute the attempt to, so
    // there is no entry — and correspondingly no provider-bearing one either.
    userRow = null

    expect(await refusalFrom(() => ssoSignIn(microsoft()))).toBe('sso_no_account')

    expect(auditWrites).toEqual([])
  })
})
