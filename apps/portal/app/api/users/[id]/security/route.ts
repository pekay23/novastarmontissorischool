/**
 * API endpoint to read and administer a user's security settings.
 *
 * Every query is scoped by the caller's tenant. An id from another tenant is
 * not found rather than forbidden, so the route cannot be used to probe which
 * user ids exist in other schools.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { logAuditEvent, AuditLogAction } from '@/lib/audit/logger'
import { toErrorResponse } from '@/lib/api-response'
import { isUserSecurityAdmin } from '@/lib/constants/platform-roles'

const SecurityActionSchema = z.object({
  action: z.enum(['disable_2fa', 'unlock_account']),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Hoisted so the catch block can attribute the failure to a tenant.
  let ctx: { tenantId?: string; userId?: string } = {}
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    const { id } = await params

    // Users can only read their own security settings unless they administer others
    if (id !== session.userId && !isUserSecurityAdmin(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const user = await prisma.user.findFirst({
      // Tenant scope is the point of `findFirst` here: `findUnique` cannot
      // filter on tenantId, so it would happily return another school's user.
      where: { id, tenantId: session.tenantId },
      select: {
        twoFactorEnabled: true,
        twoFactorSecret: true,
        status: true,
        loginAttempts: true,
        lockedUntil: true,
        mustChangePassword: true,
      },
    })

    if (!user) {
      return new NextResponse('Not found', { status: 404 })
    }

    return NextResponse.json({
      twoFactorEnabled: user.twoFactorEnabled,
      hasPasskeySecret: !!user.twoFactorSecret,
      accountStatus: user.status,
      loginAttempts: user.loginAttempts,
      lockedUntil: user.lockedUntil,
      mustChangePassword: user.mustChangePassword,
    })
  } catch (error) {
    return toErrorResponse('USER_SECURITY_API', error, ctx)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Hoisted so the catch block can attribute the failure to a tenant.
  let ctx: { tenantId?: string; userId?: string } = {}
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    const { id } = await params

    if (id !== session.userId && !isUserSecurityAdmin(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const parsed = SecurityActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid action', details: parsed.error.issues }, { status: 400 })
    }
    const { action } = parsed.data

    const data: Prisma.UserUpdateInput =
      action === 'disable_2fa'
        ? { twoFactorEnabled: false, twoFactorSecret: null }
        : { loginAttempts: 0, lockedUntil: null }

    const updated = await prisma.user.updateMany({
      // Tenant-scoped update: a cross-tenant id matches zero rows rather than
      // mutating another school's account.
      where: { id, tenantId: session.tenantId },
      data,
    })

    if (updated.count === 0) {
      return new NextResponse('Not found', { status: 404 })
    }

    // Disabling someone's 2FA is a security-relevant action — it must leave a
    // trace, under an action name the audit log's action filter can find.
    await logAuditEvent({
      userId: session.userId,
      action: action === 'disable_2fa' ? AuditLogAction.TWO_FACTOR_DISABLED : AuditLogAction.UPDATE,
      entity: 'user_security',
      entityId: id,
      description:
        action === 'disable_2fa'
          ? 'Two-factor authentication disabled'
          : 'Account unlocked',
      tenantId: session.tenantId,
      schoolId: session.schoolId ?? undefined,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse('USER_SECURITY_API', error, ctx)
  }
}
