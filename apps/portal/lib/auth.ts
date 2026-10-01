import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import type { NextAuthOptions, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import prisma from '@/lib/prisma'
import { verifyPassword } from '@/lib/password'

export interface ExtendedUser {
  id?: string
  role?: string
  schoolId?: string
  schoolName?: string
}

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

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const extendedToken = token as JWT & ExtendedUser
        const extendedUser = user as ExtendedUser
        extendedToken.id = extendedUser.id
        extendedToken.role = extendedUser.role
        extendedToken.schoolId = extendedUser.schoolId
        extendedToken.schoolName = extendedUser.schoolName
      }
      return token
    },
    async session({ session, token }) {
      const extendedToken = token as JWT & ExtendedUser
      const extendedSession = session as Session & { user: ExtendedUser }
      extendedSession.user.id = extendedToken.id
      extendedSession.user.role = extendedToken.role
      extendedSession.user.schoolId = extendedToken.schoolId
      extendedSession.user.schoolName = extendedToken.schoolName
      return session
    },
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        schoolCode: { label: 'School Code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const school = await resolveSchool(credentials.schoolCode)
        if (!school) return null

        const user = await prisma.user.findFirst({
          where: { email: credentials.email, schoolId: school.id },
          include: { role: true, school: { select: { name: true } } },
        })

        // Deactivated accounts and passwordless (invited-but-unset) accounts
        // must never authenticate.
        if (!user?.passwordHash || !user.isActive) return null

        const isValid = await verifyPassword(credentials.password, user.passwordHash)
        if (!isValid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role?.name ?? null,
          schoolId: user.schoolId,
          schoolName: user.school?.name ?? school.name,
        }
      },
    }),
  ],
}
 
// The NextAuth request handler lives in app/api/auth/[...nextauth]/route.ts,
// which must use the App Router signature: `export { handler as GET, handler as POST }`.



