/**
 * Platform feature flag management API.
 *
 * GET /api/system/config — effective flag values for the caller's tenant.
 *
 * Read-only: values are resolved from the registry defaults overlaid with any
 * stored overrides, so this never creates or modifies rows. Each flag carries
 * the `version` of the row it resolved from — `0` when there is no override row
 * — so a client can seed the `expectedVersion` precondition its next PATCH will
 * carry without a second round trip.
 *
 * PATCH /api/system/config/:key — see ./[key]/route.ts
 *
 * Only users with HEADMASTER role can access. The list is then filtered to the
 * flags that role can actually write through `PATCH /api/system/config/:key`, so
 * the caller is never offered a switch the write route would refuse — which is
 * how `admissions_open` (owned by `PATCH /api/admissions/status`) drops out.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { toErrorResponse } from '@/lib/api-response'
import { isPlatformAdmin } from '@/lib/constants/platform-roles'
import { resolveFeatureFlags, featureFlagDefinitions, manageableFlagKeys } from '@/lib/system-config'

export async function GET(_req: NextRequest) {
  // Hoisted so the catch block can attribute the failure to a tenant.
  let ctx: { tenantId?: string; userId?: string } = {}
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    if (!isPlatformAdmin(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // A pure, in-memory filter over the resolved list — no gate lookup per flag,
    // so the read still costs exactly one query for the whole catalogue.
    const manageable = new Set<string>(manageableFlagKeys(session.role))
    const flags = (await resolveFeatureFlags(session.tenantId)).filter((flag) =>
      manageable.has(flag.key)
    )

    return NextResponse.json({
      flags,
      definitions: featureFlagDefinitions(),
    })
  } catch (error) {
    return toErrorResponse('SYSTEM_CONFIG_API', error, {
      ...ctx,
      endpoint: 'GET /api/system/config',
    })
  }
}
