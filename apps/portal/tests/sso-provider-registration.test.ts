import { describe, it, expect, mock, beforeEach } from 'bun:test'

/**
 * What `authOptions.providers` actually contains, which is the only thing that
 * decides whether a sign-in button exists.
 *
 * The sign-in page reads its button list from NextAuth's `/api/auth/providers`,
 * which answers from `authOptions.providers`. A provider registered with no
 * credentials would therefore be a button on the page that fails after a round
 * trip to Google, so the composition of that array is itself part of the rule
 * rather than an implementation detail — and the pure builder tests in
 * `sso-account-resolution.test.ts` cannot see it.
 *
 * Credentials stays at index 0, and `tests/must-change-password.test.ts` reads
 * `authorize` off `authOptions.providers[0]`. Asserted here so a provider list
 * that reorders itself with the environment fails in the file that says why,
 * instead of in a suite about one-time passwords.
 */
mock.module('server-only', () => ({}))

const prisma = {
  user: { findUnique: async () => null, findFirst: async () => null },
  account: { findUnique: async () => null, create: async () => ({}) },
  systemConfig: { findUnique: async () => null },
  auditLog: { findFirst: async () => null, create: async () => ({}) },
}

await import('@/lib/prisma')

// ---------------------------------------------------------------------------
// Module-mock lifetime: snapshot before registering, restore after
// ---------------------------------------------------------------------------
//
// `mock.module` patches the LIVE namespace for the whole process and never reverts, so
// a registration made at module scope is what every file that loads afterwards binds
// to. Three boundaries are registered below and all three are put back.
//
// The snapshot is read HERE, before the first registration, and that is
// load-bearing: a `beforeEach` capture would run after these registrations had already
// overwritten the namespace, so it would record this file's own factory and hand the
// double straight back to the next file.
//
// Every factory SPREADS the namespace it replaces and then overrides, which makes each
// fake both a superset (no import below can fail on a name this file happened not to
// list) and a subset (`mock.module` merges, so an added key could never be removed by
// the restore).
const previousNamespaces = new Map<string, Record<string, unknown>>()
previousNamespaces.set('@/lib/prisma', { ...(await import('@/lib/prisma')) })
previousNamespaces.set('@novastar/database', { ...(await import('@novastar/database')) })
previousNamespaces.set('@/lib/audit/logger', { ...(await import('@/lib/audit/logger')) })

const base = (specifier: string): Record<string, unknown> =>
  previousNamespaces.get(specifier) ?? {}

const FAKES = [
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
      createAuditLog: mock(async () => null),
    }),
  },
] as const

// Also registered at load time, so the import of `@/lib/auth` below resolves these
// specifiers through the doubles and the file is correct in a run that never reaches
// `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

beforeEach(() => {
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
})

// No provider credential is set in the test environment, which is the point.
delete process.env.GOOGLE_CLIENT_ID
delete process.env.GOOGLE_CLIENT_SECRET
delete process.env.MICROSOFT_ENTRA_ID_CLIENT_ID
delete process.env.MICROSOFT_ENTRA_ID_CLIENT_SECRET

const { authOptions } = await import('@/lib/auth')

type SignIn = (params: { account: unknown }) => Promise<boolean | string>

describe('authOptions.providers with no single sign-on credentials configured', () => {
  it('should register the credentials provider and nothing else', () => {
    expect(authOptions.providers.map((provider) => provider.id)).toEqual(['credentials'])
  })

  it('should keep the credentials provider at index 0', () => {
    const credentials = authOptions.providers[0]

    expect(credentials?.id).toBe('credentials')
    expect(typeof (credentials as { options?: { authorize?: unknown } })?.options?.authorize).toBe(
      'function'
    )
  })

  it('should still declare the sign-in callback the OAuth path refuses through', () => {
    expect(typeof authOptions.callbacks?.signIn).toBe('function')
  })
})

describe('the signIn callback is closed to everything it has no rule for', () => {
  const signIn = authOptions.callbacks!.signIn as unknown as SignIn

  const credentialsAccount = {
    provider: 'credentials',
    type: 'credentials',
    providerAccountId: 'user-1',
  }

  it('should let the credentials provider through untouched', async () => {
    // `authorize()` already refuses everything it should, by throwing, and it is
    // the only path that can reach the database without a tenant in the URL.
    expect(await signIn({ account: credentialsAccount })).toBe(true)
  })

  it('should refuse an account of a provider this app does not register', async () => {
    // The email provider is not in `authOptions.providers`, so this cannot happen
    // today. It is the shape a provider added later without a rule would take,
    // and the answer it must give is `false` rather than a session.
    expect(
      await signIn({
        account: { provider: 'email', type: 'email', providerAccountId: 'someone@example.com' },
      })
    ).toBe(false)
  })

  it('should refuse a sign-in with no account at all', async () => {
    expect(await signIn({ account: null })).toBe(false)
  })
})