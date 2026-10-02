/**
 * System health monitoring API for HEADMASTER role.
 *
 * GET /api/system/health — returns database, sync, storage, and email
 * status. Deliberately coarse: it reports whether a capability works, never
 * which vendor, bucket, or environment variable backs it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { AuditLogAction } from '@/lib/audit/logger'
import { toErrorResponse } from '@/lib/api-response'
import { isPlatformAdmin } from '@/lib/constants/platform-roles'

/**
 * Coarse signal only: can this deployment send transactional mail at all?
 * Deliberately does not report the provider, key, or any other integration
 * configuration — a HEADMASTER needs to know mail works, not what backs it.
 */
function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function GET(_req: NextRequest) {
  // Hoisted so the catch block can attribute the failure to a tenant, which
  // is what makes it show up on the Head of School's errors page.
  let ctx: { tenantId?: string; userId?: string } = {}
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    if (!isPlatformAdmin(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // Database latency check
    const dbStart = Date.now()
    let dbStatus: 'ok' | 'warning' | 'error' = 'ok'
    let dbLatency: number | undefined
    try {
      await prisma.$queryRaw`SELECT 1`
      dbLatency = Date.now() - dbStart
      if (dbLatency > 500) dbStatus = 'warning'
    } catch {
      dbStatus = 'error'
    }

    // Last sync timestamp — most recent system-level audit entry for this tenant
    const lastSyncEntry = await prisma.auditLog.findFirst({
      where: { tenantId: session.tenantId, action: { in: [AuditLogAction.SYSTEM_UPDATE, 'SYSTEM'] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })

    // Unresolved errors are a per-tenant signal, never a global count
    const pendingWrites = await prisma.systemError.count({
      where: { tenantId: session.tenantId, resolved: false },
    })

    // Storage estimation — approximate based on table counts.
    // We do not expose bucket names, provider details, or exact env values.
    const storageTotal = 50 * 1024 * 1024 * 1024 // 50GB allocated
    const storageUsed = 0 // placeholder — would query actual storage in production
    const storagePercentage = (storageUsed / storageTotal) * 100

    const healthStatus = {
      database: {
        status: dbStatus,
        latency: dbLatency,
      },
      lastSync: {
        timestamp: lastSyncEntry?.createdAt ?? null,
        pending: pendingWrites,
      },
      storage: {
        used: storageUsed,
        total: storageTotal,
        percentage: storagePercentage,
      },
      // Only a coarse "usable / not usable" signal. Per-integration
      // configuration state is an infrastructure detail and is deliberately
      // not surfaced — a HEADMASTER needs to know mail is working, not
      // which vendor or bucket backs it.
      email: {
        available: isEmailConfigured(),
      },
    }

    return NextResponse.json(healthStatus)
  } catch (error) {
    return toErrorResponse('SYSTEM_HEALTH_API', error, {
      ...ctx,
      endpoint: 'GET /api/system/health',
    })
  }
}
