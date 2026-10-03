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
// `lib/auth/redirect-to-login.ts` imports it for. Bun's `mock.module` registry is
// global, so a partial replacement would leak into whatever loads next.
mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SSO_SCHOOL_CODE_COOKIE && schoolCode !== null ? { value: schoolCode } : undefined,
  }),
  headers: async () => new Headers(),
}))

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

await import('@/lib/prisma')
mock.module('@/lib/prisma', () => ({ prisma, default: prisma }))
mock.module('@novastar/database', () => ({ prisma, default: prisma }))

let auditWrites: Row[] = []

const createAuditLog = mock(async (params: Row) => {
  auditWrites.push(params)
  return null
})

mock.module('@/lib/audit/logger', () => ({
  AuditLogAction: { LOGIN: 'LOGIN', LOGOUT: 'LOGOUT', LOGIN_FAILED: 'LOGIN_FAILED' },
  createAuditLog,
  logAuditEvent: createAuditLog,
}))

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
