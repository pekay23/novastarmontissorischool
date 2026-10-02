import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * System error logging utility for the platform.
 *
 * Captures uncaught API errors and stores them in the SystemError table
 * for the Head of School's `/settings/platform/errors` page to review.
 *
 * Requires a tenantId — errors are always scoped to one tenant, never global.
 */

/**
 * How long the whole persist path may take before it is abandoned.
 *
 * Exported because the caller has to bound *its* side of the work too:
 * `logSystemError` only covers the insert, while the path that gets here may
 * first resolve a tenant by reading the session. Bounding only the insert
 * would leave the caller's latency unbounded when the database is degraded.
 */
export const PERSIST_TIMEOUT_MS = 3_000

export type ErrorSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface SystemErrorRecord {
  errorType: string
  message: string
  stack?: string | null
  endpoint?: string
  userId?: string | null
  severity?: ErrorSeverity
  tenantId: string
}

/**
 * Log an error to the SystemError table.
 *
 * Awaited by callers rather than fire-and-forget: on a serverless runtime a
 * detached insert can be frozen the moment the response flushes, so the error
 * page would silently be missing the failures it exists to show.
 *
 * Never throws and never rejects. A failure to record must not turn into a
 * second failure on top of the one being reported, and the timeout bounds the
 * cost of the insert when the database is the thing that is broken — the
 * common case for a 500 — so a degraded database cannot also stall every
 * response.
 *
 * The timeout covers this insert only, not any tenant resolution a caller does
 * before calling. Callers must bound their own side of the path too; see
 * `PERSIST_TIMEOUT_MS`.
 */
export async function logSystemError(params: SystemErrorRecord): Promise<void> {
  const write = prisma.systemError.create({
    data: {
      errorType: params.errorType,
      message: params.message,
      stack: params.stack ?? undefined,
      endpoint: params.endpoint,
      userId: params.userId,
      severity: params.severity ?? 'MEDIUM',
      tenantId: params.tenantId,
    },
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      write,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('SystemError insert timed out')),
          PERSIST_TIMEOUT_MS
        )
      }),
    ])
  } catch (logErr) {
    // Don't let logging failures crash the original error handler
    console.error('[SYSTEM_ERROR_LOGGER]', 'Failed to persist system error:', logErr)
  } finally {
    if (timer) clearTimeout(timer)
    // Nothing awaits `write` if the timeout won; swallow its late rejection so
    // it does not surface as an unhandled promise rejection.
    void write.catch(() => {})
  }
}

/**
 * Resolve the severity based on HTTP status code.
 */
export function severityFromStatus(status: number): ErrorSeverity {
  if (status >= 500) return 'HIGH'
  if (status >= 400) return 'MEDIUM'
  return 'LOW'
}
