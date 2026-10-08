import type { NextRequest } from 'next/server'
import { requireCapability, requireTenantScope } from '@/lib/admin-context'
import { RequestError, toErrorResponse } from '@/lib/errors'
import { json, mutationContext } from '@/lib/http'
import { isSafeSettingPath, writeTenantSetting } from '@/lib/queries'

/**
 * `GET /api/tenants/:tenantId/settings` — the tenant's settings document.
 *
 * Settings are shown here, on the drill-down page, and not on the roster. That is
 * deliberate: `Tenant.settings` holds the school's own configuration — language,
 * currency, feature toggles — and a fleet-wide list is not the place to read it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  try {
    await requireCapability('tenant:config')
    const { tenantId } = await params
    const tenant = await requireTenantScope(tenantId)
    return json({ tenantId: tenant.id, settings: tenant.settings })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * `PATCH /api/tenants/:tenantId/settings` — write one dot-path.
 *
 * A dot-path rather than a whole document, so two operators editing different keys
 * of the same tenant do not overwrite each other. `isSafeSettingPath` is the gate
 * that matters: without it, `{"key": "__proto__.isActive"}` would write a key into
 * the stored JSON that any later read-merge sees as an inherited property.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  try {
    const context = await requireCapability('tenant:config')
    const { tenantId } = await params
    const body = await readBody(request)

    // Body checks before the database. A malformed request should not cost a
    // connection, and none of these answers depends on whether the tenant exists —
    // so a 400 here reveals nothing a 404 would not.
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const path = key.split('.').filter((segment) => segment.length > 0)

    if (key.length === 0) {
      throw new RequestError('Supply `key` as a dot-path such as `timezone`.', 400)
    }
    if (!Object.hasOwn(body, 'value')) {
      throw new RequestError('Supply `value`.', 400)
    }
    if (!isSafeSettingPath(path)) {
      throw new RequestError(
        `"${key}" is not a writable setting path. Prototype keys and empty segments are refused.`,
        400,
      )
    }
    if (body.tenantId !== undefined) {
      throw new RequestError(
        'The URL segment addresses the tenant. A body may not name one.',
        409,
        { urlTenantId: tenantId, bodyTenantId: body.tenantId },
      )
    }

    await requireTenantScope(tenantId)

    const settings = await writeTenantSetting(
      tenantId,
      path,
      body.value,
      mutationContext(context, request),
    )
    if (!settings) {
      throw new RequestError(`No tenant with id "${tenantId}".`, 404)
    }
    return json({ tenantId, key, settings })
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new RequestError('Invalid request body', 400)
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof RequestError) throw error
    throw new RequestError('Invalid request body', 400)
  }
}
