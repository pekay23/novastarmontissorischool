/**
 * The failure types this app distinguishes, and the one place each becomes a
 * status code.
 *
 * Deliberately NOT shared with `apps/portal/lib/tenant.ts`. That module resolves
 * the *caller's* tenant from their own database row; the failure types there are
 * about a user who is authenticated but not allowed somewhere inside one tenant.
 * Importing them would drag a tenant-resolution model across an application
 * boundary the plan explicitly forbids, and would make `grep -rn
 * "getTenantContext" apps/super-admin` non-empty for no reason.
 *
 * The mapping is fail-closed: an unrecognised error becomes a 500 with a fixed
 * body, so an unexpected fault cannot leak a stack trace or a Prisma message
 * containing connection details to a cross-tenant console.
 */

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

/**
 * A stable, machine-readable refusal code.
 *
 * Exported rather than inlined at the throw site because the value is a contract:
 * it is what an operator's tooling, or a future client, matches on to tell "this
 * tenant is switched off" apart from every other 403 this app can produce — a
 * missing capability reads as `This operator cannot <grant>.`, which is a
 * different problem with a different remedy. A code that only one call site
 * spells out is a code that drifts.
 */
export const TENANT_SUSPENDED_CODE = 'tenant-suspended'

/**
 * A tenant that exists, and has been switched off.
 *
 * 403 rather than 404, and that is the whole reason this is a class of its own
 * instead of a `NotFoundError`. A suspended tenant is still a row: the roster still
 * lists it, it still has every school and user, and reactivation is a normal
 * operation. Answering 404 would tell an operator the school they suspended an hour
 * ago had ceased to exist, and would make the console's own history of the tenant
 * unreadable at exactly the moment somebody needs to read it.
 *
 * A sibling of `ForbiddenError` and not a subclass, for the reason
 * `toErrorResponse` checks `UnauthorizedError` first: the ordering comment there
 * is about a refusal that must not confirm a resource exists to a caller who has
 * not proved who they are. That is not this case — suspension is only ever decided
 * after the operator's session and capability have both been resolved — so this
 * error adds a body field rather than borrowing an existing one.
 *
 * It carries the tenant id and nothing else. Naming the tenant the operator
 * selected is not disclosure; anything about a tenant they did not select is.
 */
export class TenantSuspendedError extends Error {
  /** The stable, machine-readable code this refusal is answered with. */
  readonly code = TENANT_SUSPENDED_CODE
  readonly tenantId: string

  constructor(tenantId: string) {
    super(`Tenant "${tenantId}" is suspended.`)
    this.name = 'TenantSuspendedError'
    this.tenantId = tenantId
  }
}

/**
 * A server-side misconfiguration: a required environment variable is absent or
 * unusable. Distinct from a fault because it is not the caller's fault and must
 * not be presented as one. Every session-signing operation throws this while
 * `PLATFORM_SESSION_SECRET` is unset or too short, which turns a misconfigured
 * deployment into a console nobody can sign in to rather than one that fails open.
 */
export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConfigError'
  }
}

/** A request the app refuses on its own terms: bad body, bad capability, bad state. */
export class RequestError extends Error {
  readonly status: number
  readonly details: unknown

  constructor(message: string, status = 400, details?: unknown) {
    super(message)
    this.name = 'RequestError'
    this.status = status
    this.details = details
  }
}

/**
 * Turns a thrown value into a response.
 *
 * `UnauthorizedError` is checked before `ForbiddenError` and both before
 * `RequestError` because a caller who is not an operator must learn nothing
 * about which capability they were missing: a 403 on an unauthenticated request
 * confirms that the resource exists and that only a role check stands in the
 * way.
 *
 * `TenantSuspendedError` is matched before the unhandled fallback for a different
 * reason: it is the only refusal here that carries a code, so it has to be
 * recognised as itself rather than collapsed into the 500 that would otherwise
 * swallow a deliberate policy decision and answer a client's question with a
 * fault report.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError) {
    return json({ error: error.message }, 401)
  }
  if (error instanceof ForbiddenError) {
    return json({ error: error.message }, 403)
  }
  if (error instanceof TenantSuspendedError) {
    // `error` for prose, `code` for machines, `tenantId` so a client can say which
    // tenant is suspended without parsing a sentence. Nothing else: this body must
    // not become a way to ask about a tenant other than the one the URL named.
    return json({ error: error.message, code: error.code, tenantId: error.tenantId }, 403)
  }
  if (error instanceof NotFoundError) {
    return json({ error: error.message }, 404)
  }
  if (error instanceof RequestError) {
    return json(
      { error: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
      error.status,
    )
  }
  if (error instanceof ServerConfigError) {
    console.error('[super-admin] Server configuration error:', error.message)
    return json({ error: 'The control plane is not configured' }, 503)
  }

  // Anything else is a bug or an outage. Log server-side with the message only,
  // and answer with a fixed body so a driver error carrying a connection string
  // fragment never reaches a browser.
  console.error('[super-admin] Unhandled error:', error instanceof Error ? error.message : error)
  return json({ error: 'Internal server error' }, 500)
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
