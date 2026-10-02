import { cache } from 'react'
import { getServerSession } from 'next-auth'
import { authOptions, ExtendedUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UnauthorizedError } from '@/lib/tenant'
import { parsePlatformRole } from '@/lib/constants/platform-roles'

/**
 * Request-scoped session + tenant context fetcher.
 *
 * Uses React.cache to ensure getServerSession is only called once per request,
 * even if multiple components or API handlers trigger it in parallel. This
 * significantly reduces database connection pressure.
 *
 * The tenant is resolved from the JWT first, then confirmed against the
 * database. That ordering matters: the token half does not depend on the tenant
 * lookup, so when the lookup is what failed the token still names the tenant and
 * the failure can be attributed. Resolving the tenant from the database alone
 * would mean an outage in the user lookup produces no record at all — exactly
 * the outage an error log exists to surface.
 *
 * The token half is not free, though. `getServerSession` runs the auth `jwt`
 * callback, which can revalidate the session against the database, and that
 * query carries no timeout of its own. Callers that use the token tenant to
 * record a failure must therefore bound the read rather than assume it returns
 * promptly. `toErrorResponse` wraps it in a deadline for exactly this reason.
 *
 * Returns the full TenantContext (authenticated + tenant-resolved), or throws
 * UnauthorizedError if the session is missing.
 */
export const getCachedSessionAndTenant = cache(async () => {
  const session = await getServerSession(authOptions)
  const user = session?.user as ExtendedUser | undefined
  if (!user?.id) {
    throw new UnauthorizedError()
  }

  // Available without a database round-trip.
  const claimedTenantId = user.tenantId

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      tenantId: true,
      schoolId: true,
      role: { select: { name: true } },
      status: true,
    },
  })

  if (!dbUser) {
    throw new UnauthorizedError()
  }

  // Check account status
  if (dbUser.status === 'SUSPENDED' || dbUser.status === 'ARCHIVED' || dbUser.status === 'DELETED') {
    throw new UnauthorizedError()
  }

  return {
    userId: user.id,
    tenantId: dbUser.tenantId,
    schoolId: dbUser.schoolId ?? null,
    /** Narrowed to a real seeded role name, or `null` if unknown. */
    role: parsePlatformRole(dbUser.role?.name),
    roleName: dbUser.role?.name ?? null,
    user,
    /**
     * The tenant as claimed by the token, before the database confirmed it.
     * Only useful for attributing a failure that happened during the database
     * lookup itself; prefer `tenantId` for anything that acts on data.
     */
    claimedTenantId: claimedTenantId ?? null,
  }
})

/**
 * The tenant for a request, resolved from the token alone.
 *
 * Use this to attribute a failure that occurred inside the session lookup:
 * by definition the database-backed resolver did not complete, but the token
 * still names the tenant. Returns `null` when there is no valid session, in
 * which case there is no tenant to attribute the failure to.
 */
export const getTokenTenantId = cache(async (): Promise<string | null> => {
  try {
    const session = await getServerSession(authOptions)
    const user = session?.user as ExtendedUser | undefined
    return user?.id && user.tenantId ? user.tenantId : null
  } catch {
    return null
  }
})
