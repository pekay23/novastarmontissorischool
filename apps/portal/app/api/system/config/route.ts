/**
 * Platform feature flag management API.
 *
 * GET  /api/system/config          — list all feature flags
 * PATCH  /api/system/config/:key   — update a feature flag value  (see ./[key]/route.ts)
 *
 * Only HEADMASTER role can access.
 * All mutations are audit-logged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { toErrorResponse } from '@/lib/api-response'
import { isPlatformAdmin } from '@/lib/constants/platform-roles'
import { FEATURE_FLAGS, ensureFeatureFlags } from '@/lib/system-config'

export async function GET(_req: NextRequest) {
  // Hoisted so the catch block can attribute the failure to a tenant.
  let ctx: { tenantId?: string; userId?: string } = {}
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    if (!isPlatformAdmin(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    await ensureFeatureFlags(session.tenantId)

    const configs = await prisma.systemConfig.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { category: 'asc', key: 'asc' },
    })

    return NextResponse.json({
      flags: configs.map((c) => ({
        key: c.key,
        value: c.value,
        description: c.description,
        category: c.category,
        isEditable: c.isEditable,
        updatedAt: c.updatedAt,
      })),
      definitions: Object.entries(FEATURE_FLAGS).reduce(
        (acc, [key, def]) => {
          acc[key] = { description: def.description, category: def.category, defaultValue: def.defaultValue }
          return acc
        },
        {} as Record<string, { description: string; category: string; defaultValue: unknown }>
      ),
    })
  } catch (error) {
    return toErrorResponse('SYSTEM_CONFIG_API', error, {
      ...ctx,
      endpoint: 'GET /api/system/config',
    })
  }
}
