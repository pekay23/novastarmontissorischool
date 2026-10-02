import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import type { NextAuthOptions, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/password'
import { createAuditLog, AuditLogAction } from '@/lib/audit/logger'
import { verifyTOTP } from '@/lib/auth/totp'

export interface ExtendedUser {
  id?: string
  role?: string
  schoolId?: string
  schoolName?: string
  mustChangePassword?: boolean
}

/**
 * The revalidation interval for JWT sessions. Every 5 minutes, the auth
 * callback does a live DB lookup to check if the user's password was changed
 * or their status changed since the token was issued.
 * Adopted from Aerojet Academy's auth-options.ts.
 */
const REVALIDATION_INTERVAL = 5 * 60 * 1000

/**
 * Resolves the school (tenant) a sign-in attempt belongs to.
 *
 * `schoolCode` is optional: when omitted we fall back to DEFAULT_SCHOOL_CODE,
 * which lets single-school deployments (Novastar) sign in without needing to
 * know the internal school code.
 */
async function resolveSchool(schoolCode?: string | null) {
  if (schoolCode) {
    return prisma.school.findFirst({
      where: { OR: [{ id: schoolCode }, { code: schoolCode }] },
      select: { id: true, name: true },
    })
  }

  const fallbackCode = process.env.DEFAULT_SCHOOL_CODE
  if (!fallbackCode) {
    console.error('[auth] No schoolCode supplied and DEFAULT_SCHOOL_CODE is not set')
    return null
  }

  return prisma.school.findFirst({
    where: { code: fallbackCode },
    select: { id: true, name: true },
  })
}

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
    async jwt({ token, user, trigger }) {
      if (user) {
        const extendedToken = token as JWT & ExtendedUser
        const extendedUser = user as ExtendedUser
        extendedToken.id = extendedUser.id
        extendedToken.role = extendedUser.role
        extendedToken.schoolId = extendedUser.schoolId
        extendedToken.schoolName = extendedUser.schoolName
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
          token.mustChangePassword = false
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
            mustChangePassword: user.mustChangePassword && !user.passwordChangedAt,
          }
        }

        // --- Handle email verification token login ---
        if (credentials?.token) {
          const user = await prisma.user.findUnique({
            where: { verifyToken: credentials.token },
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
        if (await checkAccountLocked(user.id)) {
          throw new Error('Account is temporarily locked. Please try again later.')
        }

        // Check account status
        if (user.status === 'SUSPENDED') {
          throw new Error('Account has been suspended. Contact administration.')
        }
        if (user.status === 'ARCHIVED' || user.status === 'DELETED') {
          throw new Error('Account is no longer active. Contact administration.')
        }

        // Check email verification — skip for HEADMASTER and STAFF roles
        if (!['HEADMASTER', 'STAFF'].includes(user.role?.name ?? '') && !user.emailVerified) {
          throw new Error('Please verify your email before logging in.')
        }

        // Verify password
        const isValid = await verifyPassword(credentials.password, user.passwordHash)
        if (!isValid) {
          await recordFailedLogin(user.id)
          throw new Error('Invalid email or password')
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
          mustChangePassword: user.mustChangePassword && !user.passwordChangedAt,
        }
      },
    }),
  ],
}
