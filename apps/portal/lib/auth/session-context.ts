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
 * Returns the full TenantContext (authenticated + tenant-resolved), or throws
 * UnauthorizedError if the session is missing.
 */
export const getCachedSessionAndTenant = cache(async () => {
  const session = await getServerSession(authOptions)
  const user = session?.user as ExtendedUser | undefined
  if (!user?.id) {
    throw new UnauthorizedError()
  }

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
  }
})
