/**
 * PATCH  /api/system/config/:key   — update a feature flag value
 *
 * Only HEADMASTER role can access. Mutations are audit-logged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { logAuditEvent, AuditLogAction } from '@/lib/audit/logger'
import { toErrorResponse } from '@/lib/api-response'
import { isPlatformAdmin } from '@/lib/constants/platform-roles'
import { FEATURE_FLAGS, ensureFeatureFlags } from '@/lib/system-config'

export async function PATCH(req: NextRequest, context: { params: Promise<{ key: string }> }) {
  // Hoisted so the catch block can attribute the failure to a tenant and a key.
  let ctx: { tenantId?: string; userId?: string } = {}
  let flagKey: string | undefined
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    if (!isPlatformAdmin(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const { key } = await context.params
    flagKey = key

    const definition = FEATURE_FLAGS[key]
    if (!definition) {
      return NextResponse.json({ error: `Unknown feature flag: ${key}` }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const result = definition.schema.safeParse(body.value)
    if (!result.success) {
      return NextResponse.json({ error: 'Invalid value', details: result.error.issues }, { status: 400 })
    }

    await ensureFeatureFlags(session.tenantId)

    const existing = await prisma.systemConfig.findUnique({
      where: { tenantId_key: { tenantId: session.tenantId, key } },
    })

    // The UI disables controls for non-editable flags, but a crafted request
    // would bypass that entirely — enforce it here or the column is theatre.
    if (!existing?.isEditable) {
      return NextResponse.json({ error: `Feature flag '${key}' is read-only` }, { status: 403 })
    }

    const config = await prisma.systemConfig.update({
      where: { tenantId_key: { tenantId: session.tenantId, key } },
      data: {
        value: result.data as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    })

    await logAuditEvent({
      userId: session.userId,
      action: AuditLogAction.SYSTEM_UPDATE,
      entity: 'feature_flag',
      entityId: key,
      description: `Feature flag '${key}' updated from ${JSON.stringify(existing.value)} to ${JSON.stringify(result.data)}`,
      tenantId: session.tenantId,
      schoolId: session.schoolId ?? undefined,
    })

    return NextResponse.json({ flag: { key: config.key, value: config.value } })
  } catch (error) {
    return toErrorResponse('SYSTEM_CONFIG_API', error, {
      ...ctx,
      endpoint: flagKey ? `PATCH /api/system/config/${flagKey}` : 'PATCH /api/system/config',
    })
  }
}
