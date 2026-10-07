import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_TENANT_COOKIE,
  resolveLiveOperator,
  verifySessionToken,
} from '@/lib/admin-auth'
import { ForbiddenError, NotFoundError, TenantSuspendedError, UnauthorizedError } from '@/lib/errors'
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
      const h = await headers()
      const referer = h.get('referer') ?? ''
      const callbackUrl = referer?.startsWith('/admin/') ? referer : '/admin/tenants'

      // Derive origin from the request's Host/Origin header, not from env
      // This prevents redirecting to localhost when accessed via 192.168.8.202
      const host = h.get('host') ?? 'localhost:3200'
      const proto = h.get('x-forwarded-proto') ?? 'http'
      const origin = `${proto}://${host}`

      const url = new URL('/admin/login', origin)
      url.searchParams.set('callbackUrl', callbackUrl)
      redirect(url.toString())
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
 * Resolves a tenant by id, proves it exists, and proves it is switched on — or
 * throws.
 *
 * Every drill-down route passes through this rather than calling
 * `getTenantById` itself, because the refusals are the security-relevant half: an
 * unknown tenant id must not fall back to the fleet view, and must not fall back
 * to "the first tenant" either. Both of those would silently turn a stale
 * bookmark into a cross-tenant read.
 *
 * THE SUSPENSION GATE IS HERE, AND HERE IS WHY THAT IS ENOUGH
 * -----------------------------------------------------------
 * `Tenant.isActive` used to be written by the console and read only for a badge,
 * which made `PATCH {"isActive": false}` — the endpoint `DELETE` points operators
 * at as the tenant's off switch — a label rather than a switch. This function is
 * the single existence gate on every drill-down route, so refusing here refuses
 * all of them by construction rather than one at a time: `GET /api/tenants/:id`,
 * `PATCH /api/tenants/:id/settings`, `POST /api/tenants/:id/users` and
 * `POST /api/tenants/:id/provision` all reach a tenant only through it.
 *
 * `PATCH /api/tenants/:id` is the deliberate exception and does not come here,
 * because the request it carries may *be* the suspension: `setTenantActive` has to
 * keep working on a suspended tenant or nothing could ever be reactivated, which
 * is the one thing the flag exists to make possible. That route reaches the
 * suspension check inside `updateTenantFields` and `writeTenantSetting` instead,
 * which refuse every other write against the same flag.
 *
 * 403 and not 404, because the tenant exists. `NotFoundError` below is reserved
 * for a genuine miss, and a 404 here would tell an operator that a school they
 * suspended yesterday had been deleted.
 */
export async function requireTenantScope(tenantId: string): Promise<TenantDetail> {
  const resolved = await requireExistingTenant(tenantId)
  if (resolved.status === 'suspended') {
    // The tenant id is already in the URL the operator is holding, so naming it
    // discloses nothing; nothing about any other tenant is read to produce this.
    throw new TenantSuspendedError(resolved.identity.id)
  }
  return resolved.tenant
}

/**
 * What a suspended tenant is allowed to be *known* by.
 *
 * Id and code, and nothing else. Not the name, not the counts, not the settings
 * document. Those are tenant data, and `TenantSuspendedNotice` renders on a page an
 * operator reaches precisely when the tenant is switched off — so the whole question
 * is whether the refusal path can be handed a `TenantDetail` and then decide what to
 * show. Making the suspended arm of the union carry only this is what answers it.
 */
export interface TenantIdentity {
  readonly id: string
  readonly code: string
}

/**
 * What `requireExistingTenant` hands back: the tenant, or the fact that it is off.
 *
 * THE PAYLOAD IS SPLIT, AND THAT IS THE WHOLE POINT
 * -------------------------------------------------
 * The obvious shape — `{ status: 'active', tenant } | { status: 'suspended', tenant }`
 * — does not work, and the reason is worth stating because it is the difference
 * between a type guarantee and a convention wearing a type's clothes.
 *
 * `tenant` is a property of *both* arms, so `const { tenant } = await
 * requireExistingTenant(id)` compiles, and `resolved.tenant` compiles, and a page
 * that never looks at `status` gets a full suspended `TenantDetail` with no compiler
 * complaint at all. Verified against this repo's compiler: that variant produces zero
 * errors. A union discriminates only the arms you branch on, and nothing forces the
 * branch.
 *
 * So `tenant` exists on the active arm alone. A caller that has not narrowed gets
 * `TS2339: Property 'tenant' does not exist on type 'ResolvedTenant'` the first time
 * it reaches for the row, which means:
 *
 * - a fifth drill-down page cannot read a suspended tenant at all, rather than being
 *   trusted to remember not to;
 * - a page cannot reorder its own reads above the check, because the identifier it
 *   would need for `listSchoolsForTenant(tenant.id)` is only in scope after
 *   `resolved.status === 'suspended'` has been answered;
 * - and the refusal path is handed `TenantIdentity` — two strings the roster already
 *   showed the operator — so there is no suspended `TenantDetail` anywhere in a
 *   component's props for it to leak by accident.
 *
 * `identity` rather than a narrower `tenant` on the suspended arm is the same
 * argument one step on: a page still needs the id and the code to render the notice
 * and the reactivation control, and it should get them from a type that cannot also
 * carry `settings`.
 */
export type ResolvedTenant =
  | { readonly status: 'active'; readonly tenant: TenantDetail }
  | { readonly status: 'suspended'; readonly identity: TenantIdentity }

/**
 * `requireTenantScope` without the suspension refusal: resolves the tenant or
 * throws `NotFoundError`.
 *
 * THIS DOES NOT REFUSE A SUSPENDED TENANT, and the reason it is exported at all is
 * that the four tenant drill-down *pages* cannot use the gate. `/tenants/:tenantId`
 * is where "Reactivate tenant" lives, so gating it would put the control behind the
 * gate it exists to open; the other three are the tenant's schools, users and
 * settings, and a suspended tenant must be able to show *why* it is suspended
 * instead of rendering an error boundary or, worse, an empty list that reads as "this
 * school has no users".
 *
 * Each of those four answers the suspension question for itself, and `ResolvedTenant`
 * is how that obligation stops being a convention: the tenant row is unreachable
 * until the caller has handled the suspended arm, so "forgot the branch" is a
 * compile error rather than a silent leak. `tests/tenant-suspension-pages.test.ts`
 * runs all four and pins that the suspension arm renders the notice and reads
 * nothing; `tests/tenant-suspension.test.ts` pins the resolver and the routes.
 *
 * Split out rather than adding an option to `requireTenantScope` because the
 * dangerous shape here is a boolean flag on a gate — a caller that passes the wrong
 * value gets no refusal and no compiler complaint. The union is the same argument
 * carried into the type: the caller cannot pick its way past the answer.
 */
export async function requireExistingTenant(tenantId: string): Promise<ResolvedTenant> {
  if (tenantId.trim().length === 0) {
    throw new NotFoundError('No tenant was named.')
  }
  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    throw new NotFoundError(`No tenant with id "${tenantId}".`)
  }
  if (!tenant.isActive) {
    return { status: 'suspended', identity: { id: tenant.id, code: tenant.code } }
  }
  return { status: 'active', tenant }
}
