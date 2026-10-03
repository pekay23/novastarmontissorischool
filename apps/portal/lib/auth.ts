import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import type { NextAuthOptions, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/password'
import { createAuditLog, AuditLogAction } from '@/lib/audit/logger'
import { verifyTOTP } from '@/lib/auth/totp'
import { resolveSchool } from '@/lib/auth/school-lookup'
import { hashEmailToken, isEmailToken } from '@/lib/auth/email-verification'
import { PASSWORD_RESET_TOKEN_PREFIX } from '@/lib/auth/password-reset-token'
import { isEmailVerificationExempt, parsePlatformRole } from '@/lib/constants/platform-roles'
import { buildSsoProviders } from '@/lib/auth/sso'
import { ssoSignIn } from '@/lib/auth/sso-signin'

export interface ExtendedUser {
  id?: string
  role?: string
  schoolId?: string
  schoolName?: string
  mustChangePassword?: boolean
  /**
   * Set by the `jwt` callback and copied to the session, so `getServerSession`
   * can name the tenant a request belonged to without a database round-trip.
   * The platform error logger reads it precisely when the database is the thing
   * that is failing — otherwise an outage in the user lookup cannot be
   * recorded anywhere.
   */
  tenantId?: string
}

/**
 * The revalidation interval for JWT sessions. Every 5 minutes, the auth
 * callback does a live DB lookup to check if the user's password was changed
 * or their status changed since the token was issued.
 * Adopted from Aerojet Academy's auth-options.ts.
 */
const REVALIDATION_INTERVAL = 5 * 60 * 1000

/**
 * Check account lockout. Returns true if locked.
 */
async function checkAccountLocked(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lockedUntil: true },
  })
  if (!user?.lockedUntil) return false
  return user.lockedUntil > new Date()
}

/**
 * Record a failed login attempt, locking the account after 5 failures.
 */
async function recordFailedLogin(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { loginAttempts: true },
  })

  const attempts = (user?.loginAttempts ?? 0) + 1
  const updateData: { loginAttempts: number; lockedUntil?: Date } = {
    loginAttempts: attempts,
  }

  if (attempts >= 5) {
    updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000) // 30 min lockout
  }

  await prisma.user.update({
    where: { id: userId },
    data: updateData,
  })
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours (reduced from 30 days for security)
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    /**
     * The OAuth gate.
     *
     * Credentials answers `true` unconditionally and is unchanged: every check it
     * needs is inside `authorize()`, which already refuses by throwing.
     *
     * Everything else is off by default. The only other branch is an OAuth
     * provider, so the email provider this app does not register — or a provider
     * added later without a rule written for it — is turned down rather than
     * handed a session. The rules themselves, and the reason this callback never
     * lets `@auth/prisma-adapter` create a user, are in `lib/auth/sso.ts`.
     */
    async signIn({ account, profile }) {
      if (account?.provider === 'credentials') return true
      if (account?.type !== 'oauth') return false

      // `profile` arrives as next-auth's `Profile`, which declares no index
      // signature, while `ssoSignIn` reads the raw OIDC `userinfo` claims —
      // `sub`, `preferred_username`, `email_verified` — that none of its declared
      // fields cover. Those claim names are the whole point of the call: they are
      // what the providers actually return, and inventing named fields for them
      // would mean a new provider's claim is a type error rather than a read.
      //
      // So the wider type stays with the module that needs it and the cast sits
      // here, at the library boundary, where it is one line and says what it is
      // reconciling. Narrowing `SsoSignInParams.profile` instead would move the
      // cast to every future caller and hide the real shape of the input.
      return ssoSignIn({ account, profile: profile as Record<string, unknown> | undefined })
    },

    async jwt({ token, user, trigger }) {
      if (user) {
        const extendedToken = token as JWT & ExtendedUser
        const extendedUser = user as ExtendedUser
        extendedToken.id = extendedUser.id
        extendedToken.role = extendedUser.role
        extendedToken.schoolId = extendedUser.schoolId
        extendedToken.schoolName = extendedUser.schoolName
        extendedToken.tenantId = extendedUser.tenantId
        extendedToken.mustChangePassword = extendedUser.mustChangePassword
        extendedToken.issuedAt = Date.now()
      }

      // Periodic session validation (every 5 minutes) — checks if password
      // was changed after token issued, or if status changed.
      const now = Date.now()
      const lastChecked = (token.lastChecked as number) | 0
      const shouldRevalidate =
        trigger === 'update' || now - lastChecked > REVALIDATION_INTERVAL

      if (shouldRevalidate && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: {
            status: true,
            passwordChangedAt: true,
            mustChangePassword: true,
            // `schoolName` is read here, not from the `user` the sign-in was
            // given, because the two credential paths do not supply it equally.
            // `authorize()` returns it; an OAuth sign-in's `user` is the plain
            // `User` row the adapter fetched by id, which has `schoolId` but no
            // school relation loaded. Without this an SSO session would render
            // with the school name blank while a password session did not.
            school: { select: { name: true } },
            role: { select: { name: true } },
          },
        })

        if (dbUser) {
          // Invalidate session if password was changed after token issued
          if (
            dbUser.passwordChangedAt &&
            token.issuedAt &&
            dbUser.passwordChangedAt.getTime() > (token.issuedAt as number)
          ) {
            token.id = ''
            token.role = ''
            token.status = ''
            return token
          }

          // Invalidate session if status changed to SUSPENDED/ARCHIVED/DELETED
          if (
            dbUser.status === 'SUSPENDED' ||
            dbUser.status === 'ARCHIVED' ||
            dbUser.status === 'DELETED'
          ) {
            token.id = ''
            token.role = ''
            token.status = ''
            return token
          }

          token.role = dbUser.role?.name ?? token.role
          token.schoolName = dbUser.school?.name ?? token.schoolName
          // From the database, because the database is the only authority on this
          // flag. The tenant CLI sets it on every account it provisions and every
          // invitation sets it, and nothing but a real password write clears it
          // — so assigning a constant here wiped it on the first revalidation,
          // within five minutes of the sign-in that had just read it. That made
          // the one-time setup link unenforced and every "change your password"
          // flag decorative.
          token.mustChangePassword = dbUser.mustChangePassword
        }

        token.lastChecked = now
      }

      return token
    },

    async session({ session, token }) {
      if (session.user) {
        const extendedToken = token as JWT & ExtendedUser
        const extendedSession = session as Session & { user: ExtendedUser }
        extendedSession.user.id = extendedToken.id as string
        extendedSession.user.role = extendedToken.role as string
        extendedSession.user.schoolId = extendedToken.schoolId as string
        extendedSession.user.schoolName = extendedToken.schoolName as string
        // The token claim is only useful if it survives into the session:
        // `getServerSession` returns the session, and every reader of the claim
        // (session-context, the platform error logger's attribution fallback)
        // goes through it.
        extendedSession.user.tenantId = extendedToken.tenantId
        extendedSession.user.mustChangePassword = extendedToken.mustChangePassword as boolean
      }
      return session
    },
  },
  events: {
    async signIn({ user }) {
      const extendedUser = user as { id: string; email?: string | null }
      await createAuditLog({
        userId: extendedUser.id,
        action: AuditLogAction.LOGIN,
        entity: 'users',
        entityId: extendedUser.id,
        description: `User logged in: ${extendedUser.email ?? 'unknown'}`,
      }).catch((err) => console.error('[auth] Failed to log event:', err))
    },
    async signOut(message) {
      const userId = (message as { token?: { id?: string } })?.token?.id
      if (userId) {
        await createAuditLog({
          userId,
          action: AuditLogAction.LOGOUT,
          entity: 'users',
          entityId: userId,
          description: 'User logged out',
        }).catch((err) => console.error('[auth] Failed to log event:', err))
      }
    },
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        schoolCode: { label: 'School Code', type: 'text' },
        // Added for passkey bridge and TOTP
        token: { label: 'Token', type: 'text' },
        totpCode: { label: '2FA Code', type: 'text' },
        ipAddress: { label: 'IP Address', type: 'text' },
      },
      async authorize(credentials) {
        // --- Handle passkey bridge token login (Aerojet Academy pattern) ---
        if (credentials?.token && credentials.token.startsWith('pk_')) {
          const user = await prisma.user.findUnique({
            where: { passkeyBridgeToken: credentials.token },
            include: { role: { select: { name: true } }, school: { select: { name: true } } },
          })

          if (!user) {
            throw new Error('Invalid verification token')
          }

          const tokenExpires = user.passkeyBridgeExpires
          if (tokenExpires && tokenExpires < new Date()) {
            throw new Error('Verification link has expired')
          }

          // Check account status
          if (user.status === 'SUSPENDED') {
            throw new Error('Account has been suspended. Contact administration.')
          }
          if (user.status === 'ARCHIVED' || user.status === 'DELETED') {
            throw new Error('Account is no longer active. Contact administration.')
          }

          // Passkey tokens skip 2FA — already proved possession and biometric
          await prisma.user.update({
            where: { id: user.id },
            data: {
              passkeyBridgeToken: null,
              passkeyBridgeExpires: null,
              lastLoginAt: new Date(),
              loginAttempts: 0,
              lockedUntil: null,
            },
          })

          return {
            id: user.id,
            email: user.email,
            name: user.name ?? undefined,
            role: user.role?.name ?? null,
            schoolId: user.schoolId,
            schoolName: user.school?.name ?? undefined,
            tenantId: user.tenantId,
            mustChangePassword: user.mustChangePassword && !user.passwordChangedAt,
          }
        }

        // --- Handle email verification token login ---
        if (credentials?.token) {
          // A password-reset token is not a sign-in credential. It has its own
          // page and its own endpoint, and this refusal exists so that pasting a
          // reset link into the sign-in form produces an explanation instead of a
          // bare "invalid token" — and so the intent ("`verifyToken` is a login
          // credential, reset tokens are not") is asserted in one place.
          if (credentials.token.startsWith(PASSWORD_RESET_TOKEN_PREFIX)) {
            throw new Error('This is a password reset link. Use the reset password page instead.')
          }

          // Anything reaching here claims to be a verification / setup token. The
          // stored column holds a SHA-256 digest rather than the token itself, so
          // the incoming value is transformed the same way before the lookup —
          // `hashEmailToken` is the single definition of that transform, shared
          // with `lib/auth/email-verification.ts` which wrote the row.
          if (!isEmailToken(credentials.token)) {
            throw new Error('Invalid verification token')
          }

          const user = await prisma.user.findUnique({
            where: { verifyToken: hashEmailToken(credentials.token) },
            include: { role: { select: { name: true } }, school: { select: { name: true } } },
          })

          if (!user) {
            throw new Error('Invalid verification token')
          }

          const tokenExpires = user.verifyTokenExpires
          if (tokenExpires && tokenExpires < new Date()) {
            throw new Error('Verification link has expired')
          }

          if (user.status === 'SUSPENDED') {
            throw new Error('Account has been suspended. Contact administration.')
          }
          if (user.status === 'ARCHIVED' || user.status === 'DELETED') {
            throw new Error('Account is no longer active. Contact administration.')
          }

          // An emailed link is a SETUP link, not a session.
          //
          // A freshly invited account has no `passwordHash` by design, so
          // completing this sign-in would hand an intercepted invitation a full
          // login as the invited role — and no password would ever be chosen,
          // because nothing on this path stores one. The password path below
          // already refuses a row with no hash; this is the same rule, made
          // consistent rather than leaving one credential path weaker than the
          // other.
          //
          // The token is deliberately left unspent and the address unverified, so
          // the page named in the error can still consume it. That is the same
          // trade `POST /api/auth/verify-email` makes, and it is why the refusal
          // sits above the write that clears `verifyToken`.
          if (!user.passwordHash) {
            throw new Error(
              `SET_PASSWORD_REQUIRED:/set-password?token=${encodeURIComponent(credentials.token)}`,
            )
          }

          // 2FA check for email verification token (passkey tokens skip this)
          if (user.twoFactorEnabled && user.twoFactorSecret) {
            const totpCode = credentials.totpCode
            if (!totpCode || totpCode === 'undefined' || totpCode === '') {
              throw new Error('2FA_REQUIRED')
            }

            const settings = (user.settings as Record<string, unknown>) || {}
            const lastCounter =
              typeof settings.lastTotpCounter === 'number' ? settings.lastTotpCounter : undefined
            const counter = verifyTOTP(totpCode, user.twoFactorSecret, 1, lastCounter)
            if (counter === false) {
              throw new Error('Invalid 2FA code')
            }

            await prisma.user.update({
              where: { id: user.id },
              data: {
                settings: { ...settings, lastTotpCounter: counter },
              },
            })
          }

          // Clear the used token and mark email as verified
          await prisma.user.update({
            where: { id: user.id },
            data: {
              passkeyBridgeToken: null,
              passkeyBridgeExpires: null,
              emailVerified: new Date(),
              verifyToken: null,
              verifyTokenExpires: null,
              lastLoginAt: new Date(),
              loginAttempts: 0,
              lockedUntil: null,
            },
          })

          return {
            id: user.id,
            email: user.email,
            name: user.name ?? undefined,
            role: user.role?.name ?? null,
            schoolId: user.schoolId,
            schoolName: user.school?.name ?? undefined,
            tenantId: user.tenantId,
            mustChangePassword: user.mustChangePassword && !user.passwordChangedAt,
          }
        }

        // --- Standard email + password login ---
        if (!credentials?.email || !credentials?.password) return null

        const school = await resolveSchool(credentials.schoolCode)
        if (!school) return null

        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { email: { equals: credentials.email, mode: 'insensitive' } },
              { email: credentials.email },
            ],
            schoolId: school.id,
          },
          include: { role: { select: { name: true } }, school: { select: { name: true } } },
        })

        if (!user?.passwordHash) return null

        // Check account lockout
        //
        // The same sentence as a wrong password, on purpose. This branch is only
        // reachable for a real account that has a password and is currently
        // locked, so a distinct "temporarily locked" message told an
        // unauthenticated caller that the address exists — the oracle the
        // verification check below is carefully ordered to avoid.
        if (await checkAccountLocked(user.id)) {
          throw new Error('Invalid email or password')
        }

        // Check account status
        if (user.status === 'SUSPENDED') {
          throw new Error('Account has been suspended. Contact administration.')
        }
        if (user.status === 'ARCHIVED' || user.status === 'DELETED') {
          throw new Error('Account is no longer active. Contact administration.')
        }

        // Verify password
        //
        // BEFORE the email-verification check, on purpose. That check used to run
        // first and threw a message naming the account's verification state, so
        // anyone who could guess an address got a free oracle for "this account
        // exists and is unverified". Reaching it now requires the correct
        // password, which is the only moment the answer is owed to the caller.
        const isValid = await verifyPassword(credentials.password, user.passwordHash)
        if (!isValid) {
          await recordFailedLogin(user.id)
          throw new Error('Invalid email or password')
        }

        // Check email verification. Every role must verify except the explicit
        // break-glass list in `lib/constants/platform-roles.ts` — the Head of
        // School only, so a deployment provisioned by the seed or the tenant CLI
        // (neither of which can mint a verification token) cannot lock itself out
        // of its own portal. The old inline check named `'STAFF'`, which is not a
        // seeded role name, so it silently exempted the Head of School alone while
        // reading as a blanket staff exemption.
        if (!user.emailVerified && !isEmailVerificationExempt(parsePlatformRole(user.role?.name))) {
          throw new Error(
            'Please verify your email before logging in. Check your inbox for the verification ' +
              'link, or request a new one from the sign-in page.',
          )
        }

        // 2FA check
        if (user.twoFactorEnabled && user.twoFactorSecret) {
          const totpCode = credentials.totpCode
          if (!totpCode || totpCode === 'undefined' || totpCode === '') {
            throw new Error('2FA_REQUIRED')
          }

          const settings = (user.settings as Record<string, unknown>) || {}
          const lastCounter =
            typeof settings.lastTotpCounter === 'number' ? settings.lastTotpCounter : undefined
          const counter = verifyTOTP(totpCode, user.twoFactorSecret, 1, lastCounter)
          if (counter === false) {
            await recordFailedLogin(user.id)
            throw new Error('Invalid 2FA code')
          }

          await prisma.user.update({
            where: { id: user.id },
            data: {
              settings: { ...settings, lastTotpCounter: counter },
            },
          })
        }

        // Reset login attempts on successful login
        await prisma.user.update({
          where: { id: user.id },
          data: {
            loginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
          },
        })

        // Audit log
        await createAuditLog({
          userId: user.id,
          action: AuditLogAction.LOGIN,
          entity: 'users',
          entityId: user.id,
          description: `User logged in: ${user.email}`,
          ipAddress: credentials.ipAddress,
        }).catch((err) => console.error('[auth] Failed to log event:', err))

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role?.name ?? null,
          schoolId: user.schoolId,
          schoolName: user.school?.name ?? undefined,
          tenantId: user.tenantId,
          mustChangePassword: user.mustChangePassword && !user.passwordChangedAt,
        }
      },
    }),
    /**
     * Google and Microsoft, when this deployment has credentials for them.
     *
     * A provider whose client id or client secret is absent is not registered at
     * all rather than registered and left to fail. That matters because
     * `/api/auth/providers` is where the sign-in page reads its button list
     * from: an unregistered provider produces no button, so there is nothing on
     * the page that costs a visitor a redirect to Google and back before failing.
     *
     * Credentials stays at index 0. Nothing here depends on that, but
     * `tests/must-change-password.test.ts` reads `authorize` off
     * `authOptions.providers[0]`, and a provider list that reordered itself with
     * the environment would make that test pass or fail on unrelated grounds.
     */
    ...buildSsoProviders(),
  ],
}
