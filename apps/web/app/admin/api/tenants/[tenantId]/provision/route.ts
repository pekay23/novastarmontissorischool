import type { NextRequest } from 'next/server'
import { requireCapability, requireTenantScope } from '@/lib/admin-context'
import { toErrorResponse } from '@/lib/errors'
import { json, mutationContext } from '@/lib/http'
import { provisionExistingTenant } from '@/lib/provision'

/**
 * `POST /api/tenants/:tenantId/provision` — reconcile provisioning onto a tenant
 * that already exists.
 *
 * The counterpart to `POST /api/tenants`, for the case where an operator already
 * has the tenant and wants to add a school or an administrator to it. Both call
 * the same shared function in `@novastar/tenant-cli`, so there is one transaction,
 * one idempotency key (`Tenant.code`) and one set of field rules.
 *
 * THE GUARD
 * ---------
 * `provisionTenant` is keyed by `Tenant.code`, not by id. So a body naming a
 * *different* code, sent to this route, would create or reconcile that other
 * tenant while the operator believed they had touched the one in the URL. That is
 * a cross-tenant write wearing an ordinary request's clothes, and it is refused
 * with a 409 that names all three values involved. Asserted in
 * `tests/provision-route.test.ts`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  try {
    const context = await requireCapability('tenant:provision')
    const { tenantId } = await params
    const tenant = await requireTenantScope(tenantId)
    const outcome = await provisionExistingTenant(
      tenantId,
      { id: tenant.id, code: tenant.code },
      await request.json(),
      mutationContext(context, request),
    )
    return json(outcome, outcome.created ? 201 : 200)
  } catch (error) {
    return toErrorResponse(error)
  }
}
