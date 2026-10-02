import 'server-only'
import { NextResponse } from 'next/server'
import { UnauthorizedError, ForbiddenError } from '@/lib/tenant'
import { logError } from '@/lib/logger'
import { logSystemError, severityFromStatus } from '@/lib/system-errors'

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
 * `scope` names the route for both the log line and the stored record.
 * `context.tenantId` is omitted for a 5xx we could not attribute to a
 * tenant; passing it makes the error visible in that page.
 */
export function toErrorResponse(
  scope: string,
  error: unknown,
  context?: { tenantId?: string; userId?: string; endpoint?: string }
): Response {
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

  if (context?.tenantId) {
    const err = error instanceof Error ? error : new Error(String(error))
    void logSystemError({
      errorType: err.name || scope,
      message: err.message,
      stack: err.stack ?? null,
      endpoint: context.endpoint ?? scope,
      userId: context.userId,
      severity: severityFromStatus(500),
      tenantId: context.tenantId,
    })
  }

  return new NextResponse('Internal Error', { status: 500 })
}
