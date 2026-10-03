import { NextResponse } from 'next/server'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { prisma } from '@/lib/prisma'
import { logError } from '@/lib/logger'

/**
 * Self-read of the caller's own account.
 *
 * This route used to call `getToken` (JWT-only, so it answered from a token that
 * could outlive a suspension) and then `prisma.user.findUnique({ where: { id } })`
 * with no tenant filter. `getCachedSessionAndTenant` resolves `tenantId` from the
 * database, re-checks account status, and refuses `SUSPENDED`/`ARCHIVED`/
 * `DELETED`, so this route now inherits all three.
 *
 * The response is an explicit allow-list. `prisma.user.findFirst` without a
 * `select` would serialise `twoFactorSecret`, `passkeyBridgeToken`,
 * `verifyToken` and `passwordHash` to the browser; `select` makes that
 * impossible rather than merely unlikely.
 *
 * There is deliberately no `hasPermission` gate. Every authenticated role needs
 * to read its own identity, and the only caller is the session holder.
 */
export async function GET() {
  try {
    const { userId, tenantId } = await getCachedSessionAndTenant()

    const dbUser = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        schoolId: true,
        isActive: true,
        status: true,
        twoFactorEnabled: true,
        mustChangePassword: true,
        role: { select: { name: true } },
      },
    })

    if (!dbUser || !dbUser.isActive) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        image: dbUser.image,
        role: dbUser.role?.name ?? null,
        schoolId: dbUser.schoolId,
        status: dbUser.status,
        twoFactorEnabled: dbUser.twoFactorEnabled,
        mustChangePassword: dbUser.mustChangePassword,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }
    logError('Session', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}