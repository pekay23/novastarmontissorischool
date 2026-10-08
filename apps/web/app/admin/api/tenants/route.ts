import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/admin-context'
import { toErrorResponse } from '@/lib/errors'
import { json, mutationContext } from '@/lib/http'
import { provisionNewTenant } from '@/lib/provision'
import { listTenantsAcrossPlatform } from '@/lib/queries'

/**
 * `GET /api/tenants` — the fleet roster.
 *
 * `GET` is the one route in this app whose query is deliberately not scoped to a
 * tenant, because there is no tenant in the session to scope it to. The projection
 * in `listTenantsAcrossPlatform` is what makes that safe rather than a leak: nine
 * named fields, no `settings`, no relations.
 */
export async function GET(): Promise<Response> {
  try {
    await requireCapability('tenant:read')
    return json({ tenants: await listTenantsAcrossPlatform() })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * `POST /api/tenants` — provision a tenant, its first school and optionally its
 * first administrator.
 *
 * The whole body is handed to `@novastar/tenant-cli`'s `provisionTenant`, which is
 * idempotent by `Tenant.code`. So this route is safe to retry: a repeat with the
 * same code reconciles the existing tenant rather than creating a second one, and
 * a repeat never resets a credential (the shared function's admin update branch is
 * empty on purpose).
 *
 * 201 when a tenant was created, 200 when an existing code was reconciled. The
 * distinction is in the body as well as the status — `created: false` is the whole
 * point of an idempotent write, and folding it into a status code alone loses it.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const context = await requireCapability('tenant:provision')
    const outcome = await provisionNewTenant(await request.json(), mutationContext(context, request))
    return json(outcome, outcome.created ? 201 : 200)
  } catch (error) {
    return toErrorResponse(error)
  }
}
