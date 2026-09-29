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

  const tenantId = process.env.TENANT_ID
  if (!tenantId) {
    throw new ServerConfigError('TENANT_ID environment variable is not set')
  }

  return {
    tenantId,
    schoolId: user.schoolId ?? null,
    userId: user.id,
    role: user.role ?? null,
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

/**
 * Checks whether the current user has a given permission.
 * Permissions are resolved from the user's Role.permissions array.
 * @param permissionKey - the permission key to check (e.g., 'student:read')
 * @returns boolean
 */
export async function checkPermission(permissionKey: string): Promise<boolean> {
  const ctx = await getTenantContext()
  if (!ctx.role) return false

  // Fetch the user's role permissions from DB (live, not cached)
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { role: { select: { permissions: true } } },
  })

  const rolePermissions = user?.role?.permissions ?? []
  return rolePermissions.includes(permissionKey)
}

export async function requirePermission(permissionKey: string): Promise<void> {
  const has = await checkPermission(permissionKey)
  if (!has) {
    throw new ForbiddenError(`Missing permission: ${permissionKey}`)
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}
