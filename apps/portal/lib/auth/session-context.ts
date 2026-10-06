import { cache } from 'react'
import { getServerSession } from 'next-auth'
import { authOptions, ExtendedUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withDbTimeout } from '@novastar/database'
import { UnauthorizedError, TenantSuspendedError } from '@/lib/tenant'
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

  // Bounded, and the bound is the point of the line. This is the only database
  // read on the request path, it runs on every request, and the Neon adapter has
  // no timeout option — so a database that accepts the connection and then goes
  // quiet would otherwise hold the request open indefinitely. An open request is
  // the worst possible failure for this function specifically: the caller's
  // `toErrorResponse` never runs, so the outage is recorded nowhere, which is
  // the one thing the error log exists to prevent.
  //
  // The query now joins `Tenant` to enforce suspension: Prisma 7 collapses the
  // to-one relation into the same SQL statement (relationJoins is GA and enabled
  // by default), so there is no second round-trip. The cost is one extra column
  // in the row returned, not a second query.
  //
  // A `DbTimeoutError` is deliberately NOT translated into an
  // `UnauthorizedError`. The caller is authenticated and the session is valid;
  // the database is what is unavailable, and reporting that as a 401 would both
  // misreport the fault and invite the client to re-authenticate against a
  // working identity provider. It propagates instead, and `toErrorResponse`
  // records it under its own `errorType`, which is what lets the errors page
  // tell an outage apart from a genuine authentication failure.
  const dbUser = await withDbTimeout(
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        tenantId: true,
        schoolId: true,
        role: { select: { name: true } },
        status: true,
        tenant: { select: { isActive: true } },
      },
    }),
    'user.findUnique'
  )

  if (!dbUser) {
    throw new UnauthorizedError()
  }

  if (dbUser.tenant?.isActive === false) {
    throw new TenantSuspendedError()
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
