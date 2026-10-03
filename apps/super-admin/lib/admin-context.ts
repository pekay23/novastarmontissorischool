import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_TENANT_COOKIE,
  resolveLiveOperator,
  verifySessionToken,
} from '@/lib/admin-auth'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/lib/errors'
import { assertOperatorCapability, hasOperatorCapability, type OperatorCapability } from '@/lib/permissions'
import { getTenantById } from '@/lib/queries'
import type { TenantDetail } from '@/types/admin'

/**
 * The operator's identity and the tenant they have selected.
 *
 * This module is the reason `apps/super-admin` exists as a separate codebase
 * rather than a route group inside `apps/portal`. The portal resolves tenant
 * scope from the caller's own `User` row (`apps/portal/lib/tenant.ts:27-30`),
 * which is exactly right there: a portal user can never leave their tenant. An
 * operator here has no `User` row, enumerates every tenant, and switches between
 * them deliberately. Forcing that through `getTenantContext()` would mean either
 * inventing a fake `User` per tenant — a super-admin is not a tenant user — or
 * adding an override parameter to a function the portal depends on, which is one
 * careless call site away from becoming a portal-wide tenant-escape hatch.
 *
 * So: two authorisation models, two codebases, no shared tenant resolution. This
 * file does not import from `apps/portal` and nothing here imports
 * `apps/portal/lib/tenant.ts`.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It does not provide an ambient tenant. `getSelectedTenantId()` returns `null`
 * when nothing is selected, and no query anywhere treats `null` as "all
 * tenants" — a caller that wants every tenant has to say so by calling a
 * function named for it. `tests/admin-context.test.ts` asserts the absence of a
 * fallback precisely because a fallback is the failure mode that turns one
 * forgotten argument into a cross-tenant leak.
 */

export interface AdminContext {
  readonly operator: {
    readonly id: string
    readonly username: string
    readonly email: string
    readonly name: string | null
    readonly issuedAt: number
    readonly expiresAt: number
    readonly capabilities: readonly string[]
    readonly mustChangePassword: boolean
  }
  /**
   * The tenant the operator has drilled into, or `null`.
   *
   * `null` is a real state — "browsing the fleet, not inside a tenant" — and is
   * never coerced into a query scope.
   */
  readonly selectedTenantId: string | null
}

/**
 * Resolves the signed-in operator, or throws `UnauthorizedError`.
 *
 * Deny-by-default at every step, and the order is the design:
 *
 * 1. No cookie, or a token that does not verify, is a 401. Nothing is parsed
 *    before the signature is checked, and nothing is read from the database —
 *    `verifySessionToken` is pure, so an unverifiable cookie costs exactly one
 *    hash comparison.
 * 2. A verified token naming an operator whose *live* row is missing or is not
 *    `ACTIVE` is a 401. This is what replaced the environment allowlist, and it
 *    is a strictly better revocation mechanism: deactivating an account takes
 *    effect on the next request rather than at token expiry, and removing a grant
 *    from the row narrows what the session can do immediately. The check is
 *    against the database, never against a claim inside the token.
 * 3. A token that verifies and whose operator holds nothing is a 403, not a 401,
 *    because the caller is authenticated and only the grant is missing.
 */
export async function requireOperator(): Promise<AdminContext> {
  const store = await cookies()
  const claims = verifySessionToken(store.get(ADMIN_SESSION_COOKIE)?.value)

  if (!claims) {
    throw new UnauthorizedError('No valid operator session.')
  }

  // Not caught: a database outage here is an outage, and reporting it as "your
  // session is invalid" would send every legitimate operator to the sign-in form
  // during an incident while hiding the incident from the health page. It still
  // fails closed — no row, no operator.
  const operator = await resolveLiveOperator(claims)

  if (!operator) {
    throw new UnauthorizedError('This operator account is no longer active.')
  }
  if (operator.capabilities.length === 0) {
    throw new ForbiddenError('This operator holds no platform capability.')
  }

  return { operator, selectedTenantId: await getSelectedTenantId() }
}

/**
 * `requireOperator()` without the throwing, for pages that render either way.
 *
 * A separate function rather than `requireOperator().catch(() => null)`: a
 * `redirect()` inside the awaited call throws Next's own redirect signal, and a
 * blanket `catch` would swallow it and render the signed-out page to an operator
 * who is in fact signed in. Only `UnauthorizedError` is absorbed here.
 */
export async function getOperatorOrNull(): Promise<AdminContext | null> {
  try {
    return await requireOperator()
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return null
    throw error
  }
}

/**
 * `requireOperator()` for a page, redirecting an unauthenticated visitor to the
 * login form instead of throwing.
 *
 * A server component cannot render a 401, so the two surfaces differ on purpose:
 * `requireOperator` is for route handlers and assertions, this is for rendering.
 * Both refuse the same set of callers.
 */
export async function requireOperatorPage(): Promise<AdminContext> {
  try {
    return await requireOperator()
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect('/login')
    }
    throw error
  }
}

/** Like `requireOperatorPage`, but also asserts one capability before rendering. */
export async function requireCapabilityPage(
  capability: OperatorCapability,
): Promise<AdminContext> {
  const context = await requireOperatorPage()
  assertOperatorCapability(
    context.operator.capabilities,
    capability,
    () => new ForbiddenError(`This operator cannot ${capability}.`),
  )
  return context
}

/** Like `requireOperator`, but also asserts one capability or throws `ForbiddenError`. */
export async function requireCapability(capability: OperatorCapability): Promise<AdminContext> {
  const context = await requireOperator()
  assertOperatorCapability(
    context.operator.capabilities,
    capability,
    () => new ForbiddenError(`This operator cannot ${capability}.`),
  )
  return context
}

/**
 * The selected tenant id, or `null`.
 *
 * Read from a plain cookie and nothing more. It is a UI preference, so a forged
 * value is not a privilege: every caller passes it to `requireTenantScope`, which
 * re-reads the tenant by id and 404s on a miss. A crafted cookie can therefore
 * only produce a 404.
 */
export async function getSelectedTenantId(): Promise<string | null> {
  const store = await cookies()
  const value = store.get(ADMIN_TENANT_COOKIE)?.value
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Whether an operator holds a capability, without throwing. */
export function operatorCan(
  context: AdminContext,
  capability: OperatorCapability,
): boolean {
  return hasOperatorCapability(context.operator.capabilities, capability)
}

/**
 * Resolves a tenant by id and proves it exists, or throws `NotFoundError`.
 *
 * Every drill-down route passes through this rather than calling
 * `getTenantById` itself, because the 404 is the security-relevant half: an
 * unknown tenant id must not fall back to the fleet view, and must not fall back
 * to "the first tenant" either. Both of those would silently turn a stale
 * bookmark into a cross-tenant read.
 */
export async function requireTenantScope(tenantId: string): Promise<TenantDetail> {
  if (tenantId.trim().length === 0) {
    throw new NotFoundError('No tenant was named.')
  }
  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    throw new NotFoundError(`No tenant with id "${tenantId}".`)
  }
  return tenant
}
