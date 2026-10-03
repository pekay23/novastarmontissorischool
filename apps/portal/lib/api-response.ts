import 'server-only'
import { NextResponse } from 'next/server'
import { UnauthorizedError, ForbiddenError } from '@/lib/tenant'
import { logError } from '@/lib/logger'
import { logSystemError, severityFromStatus, PERSIST_TIMEOUT_MS } from '@/lib/system-errors'
import { getTokenTenantId } from '@/lib/auth/session-context'

/**
 * Translate a thrown error in an API route into the right HTTP response.
 *
 * Without this, an unauthenticated or suspended caller reaches the generic
 * `catch` and gets a 500 — which both misreports the fault and buries a
 * routine auth failure in the error logs.
 *
 * Unexpected failures are also persisted to `SystemError`, which is what the
 * Head of School's `/settings/platform/errors` page reads. Without this call
 * the table stays empty and that page has nothing to show.
 *
 * `scope` names the route for both the log line and the stored record, and
 * `context` carries whatever the handler knew by the time it failed.
 *
 * Returns a promise, which route handlers may return directly — an async
 * handler's returned promise is awaited by the framework.
 */
export async function toErrorResponse(
  scope: string,
  error: unknown,
  context?: { tenantId?: string; userId?: string; endpoint?: string }
): Promise<Response> {
  if (error instanceof Response) {
    return error
  }
  if (error instanceof UnauthorizedError) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  if (error instanceof ForbiddenError) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  logError(scope, error)

  const err = error instanceof Error ? error : new Error(String(error))

  // Persist with the tenant the handler had already resolved. When it had not
  // — because the session lookup itself is what failed — fall back to the
  // tenant named by the token, so a database outage is still attributable.
  // Without that fallback the failures most worth seeing are the ones that
  // record nothing.
  // Awaited rather than detached. On a serverless runtime the instance can be
  // frozen the moment the response flushes, which would drop the insert and
  // leave the errors page missing the failures it exists to show.
  //
  // Bounded by `withinPersistTimeout` rather than by `logSystemError`'s own
  // deadline, because the expensive part is not always the insert: resolving
  // the tenant reads the session, and the auth `jwt` callback may run a
  // `user.findUnique` before the token is due for revalidation. That query is
  // bounded by `withDbTimeout` in `session-context`, but bounded is not
  // instant, and a deadline around the insert alone would leave this response
  // waiting on whatever that lookup costs on top of its own.
  await withinPersistTimeout(persist(scope, err, context))

  return new NextResponse('Internal Error', { status: 500 })
}

/**
 * Await `work` under a hard deadline, abandoning it if the deadline wins.
 *
 * Nothing here can throw: the timeout resolves rather than rejects, so losing
 * the race is an ordinary outcome, not an error to report. `work` keeps
 * running after the deadline — it may still insert the row a moment later, and
 * its own guard reports any failure to the log stream — but nothing is waiting
 * on it, so its late rejection is swallowed rather than surfacing as an
 * unhandled rejection.
 */
async function withinPersistTimeout(work: Promise<void>): Promise<void> {
  void work.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, PERSIST_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Write the failure to `SystemError`, scoped to the tenant the handler had
 * resolved or, failing that, the one named by the token.
 *
 * Never rejects. `getTokenTenantId()` reads the session rather than the
 * database directly, but it is not free: the auth `jwt` callback can run a
 * `user.findUnique` before the token is due for revalidation, and that lookup
 * carries its own deadline. A caller still has to bound the whole path rather
 * than relying on `logSystemError`'s, because the two costs are paid in series.
 *
 * The stored `errorType` is `err.name`, which is what keeps the two kinds of
 * failure apart on the errors page. A `DbTimeoutError` from a query that never
 * answered is recorded under its own name and is therefore visibly an outage,
 * where a driver error or an ordinary bug is recorded under its own. Both are
 * 500s, and both are logged the same way; nothing about the response contract
 * changes, because the distinction an operator needs belongs in the record, not
 * in the status code a client can see.
 */
async function persist(
  scope: string,
  err: Error,
  context?: { tenantId?: string; userId?: string; endpoint?: string }
): Promise<void> {
  try {
    const tenantId = context?.tenantId ?? (await getTokenTenantId())
    if (!tenantId) {
      // No session and no tenant claim: there is nothing to scope the row to,
      // and an unscoped error would be visible to every tenant's Head of School.
      logError('[SYSTEM_ERROR_LOGGER]', `Unattributable ${scope} failure: ${err.message}`)
      return
    }
    await logSystemError({
      errorType: err.name || scope,
      message: err.message,
      stack: err.stack ?? null,
      endpoint: context?.endpoint ?? scope,
      userId: context?.userId,
      severity: severityFromStatus(500),
      tenantId,
    })
  } catch (persistErr) {
    // Belt-and-braces: `logSystemError` already swallows its own failures, so
    // reaching here means the surrounding guard itself misbehaved. Report it to
    // the log stream only — the caller is about to return its 500 regardless.
    console.error('[SYSTEM_ERROR_LOGGER]', `Failed to record ${scope} failure:`, persistErr)
  }
}
