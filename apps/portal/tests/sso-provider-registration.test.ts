import { describe, it, expect, mock } from 'bun:test'

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
mock.module('@/lib/prisma', () => ({ prisma, default: prisma }))
mock.module('@novastar/database', () => ({ prisma, default: prisma }))
mock.module('@/lib/audit/logger', () => ({
  AuditLogAction: { LOGIN: 'LOGIN', LOGOUT: 'LOGOUT', LOGIN_FAILED: 'LOGIN_FAILED' },
  createAuditLog: mock(async () => null),
}))

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