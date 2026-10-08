import type { NextRequest } from 'next/server'
import type { Prisma } from '@novastar/database'
import { requireCapability, requireTenantScope } from '@/lib/admin-context'
import { RequestError, toErrorResponse } from '@/lib/errors'
import { json, mutationContext } from '@/lib/http'
import { setTenantActive, updateTenantFields } from '@/lib/queries'
import type { MutableTenantFields } from '@/lib/queries'

/**
 * `GET /api/tenants/:tenantId` — one tenant in full.
 *
 * 404 for an unknown id, never the fleet. That is asserted in
 * `tests/tenant-switch.test.ts` because the alternative — falling back to "all
 * tenants" — turns a stale bookmark into a cross-tenant read without any signal
 * that it happened.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  try {
    await requireCapability('tenant:read')
    const { tenantId } = await params
    return json({ tenant: await requireTenantScope(tenantId) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * `PATCH /api/tenants/:tenantId` — change a tenant's mutable fields, or flip
 * `isActive`.
 *
 * The tenant is addressed by the URL segment and by nothing else. A `tenantId` in
 * the body is refused rather than ignored: silently dropping it would let an
 * operator believe they had patched one tenant while patching another, and would
 * train a client to keep sending it. The 409 message names both.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  try {
    const context = await requireCapability('tenant:update')
    const { tenantId } = await params
    const body = await readBody(request)

    if (body.tenantId !== undefined) {
      throw new RequestError(
        'The URL segment addresses the tenant. A body may not name one.',
        409,
        { urlTenantId: tenantId, bodyTenantId: body.tenantId },
      )
    }

    const fields = mutableFieldsOf(body)
    if (Object.keys(fields).length > 0) {
      const updated = await updateTenantFields(tenantId, fields, mutationContext(context, request))
      if (!updated) throw new RequestError(`No tenant with id "${tenantId}".`, 404)
      return json({ tenant: updated.tenant, changed: fields })
    }

    if (typeof body.isActive === 'boolean') {
      const flipped = await setTenantActive(tenantId, body.isActive, mutationContext(context, request))
      if (!flipped) throw new RequestError(`No tenant with id "${tenantId}".`, 404)
      return json({
        tenant: flipped.tenant,
        // `previous` is in the response as well as the audit entry. An operator
        // who clicked "suspend" on an already-suspended tenant should be told,
        // not left guessing whether the click did anything.
        previousIsActive: flipped.previous,
        isActive: flipped.tenant.isActive,
      })
    }

    throw new RequestError('Nothing to update. Supply `name`, `domain`, `settings` or `isActive`.', 400)
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * `DELETE` is deliberately not implemented.
 *
 * Suspension exists and is the off switch. A "remove this tenant" endpoint in a
 * cross-tenant control plane is a school-deletion endpoint with a `confirm=true`
 * query parameter in front of it, and the plan rules it out explicitly:
 * `Tenant.isActive` is the field, and suspension must not delete anything. Saying
 * so here is cheaper than a future caller assuming the verb was forgotten rather
 * than refused on purpose.
 */
export async function DELETE(): Promise<Response> {
  return toErrorResponse(
    new RequestError(
      'Tenants cannot be deleted. PATCH this tenant with { "isActive": false } to suspend it.',
      405,
    ),
  )
}

/**
 * The subset of the body that is a mutable tenant field.
 *
 * Read as a projection rather than spread, so an unknown key is ignored instead of
 * reaching Prisma as a column name. `code` is in that ignored set on purpose: it
 * is the routing key, and patching it would move a live tenant to a different
 * subdomain.
 */
function mutableFieldsOf(body: Record<string, unknown>): MutableTenantFields {
  const fields: MutableTenantFields = {}
  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    fields.name = body.name.trim()
  }
  if (body.domain === null) {
    fields.domain = null
  } else if (typeof body.domain === 'string' && body.domain.trim().length > 0) {
    fields.domain = body.domain.trim()
  }
  if (body.settings !== undefined && body.settings !== null && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
    fields.settings = body.settings as Prisma.InputJsonValue
  }
  return fields
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
