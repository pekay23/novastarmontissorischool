import { getServerSession } from 'next-auth'
import { authOptions, ExtendedUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export interface TenantContext {
  tenantId: string
  schoolId: string | null
  userId: string
  role: string | null
  user: ExtendedUser
}

/**
 * Extracts the authenticated user's tenant/school context from the NextAuth session.
 * Throws 401 if unauthenticated, 500 if server is misconfigured (missing TENANT_ID).
 * All portal API routes and server components must use this for tenant isolation.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const session = await getServerSession(authOptions)
  const user = session?.user as ExtendedUser | undefined
  if (!user?.id) {
    throw new UnauthorizedError()
  }

  // Resolve tenantId from the user record (DB lookup), not from process.env.
  // This ensures per-request tenant isolation instead of a single process-level TENANT_ID.
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { tenantId: true, role: { select: { name: true } } },
  })

  if (!dbUser) {
    throw new UnauthorizedError()
  }

  return {
    tenantId: dbUser.tenantId,
    schoolId: user.schoolId ?? null,
    userId: user.id,
    role: dbUser.role?.name ?? null,
    user,
  }
}

/**
 * Like getTenantContext but returns null instead of throwing.
 * Useful for pages that have optional auth (e.g., landing pages).
 */
export async function getTenantContextOrNull(): Promise<TenantContext | null> {
  try {
    return await getTenantContext()
  } catch {
    return null
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConfigError'
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}
