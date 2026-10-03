/**
 * The four failure types this app distinguishes, and the one place each becomes
 * a status code.
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
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError) {
    return json({ error: error.message }, 401)
  }
  if (error instanceof ForbiddenError) {
    return json({ error: error.message }, 403)
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
