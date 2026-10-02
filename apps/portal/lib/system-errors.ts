import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * System error logging utility for the platform.
 *
 * Captures uncaught API errors and stores them in the SystemError table
 * for the Head of School's `/settings/platform/errors` page to review.
 *
 * Requires a tenantId to scope errors correctly in multi-tenant deployments.
 */

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
 * Intended to wrap API route catch blocks that handle unexpected errors.
 */
export async function logSystemError(params: SystemErrorRecord) {
  try {
    await prisma.systemError.create({
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
  } catch (logErr) {
    // Don't let logging failures crash the original error handler
    console.error('[SYSTEM_ERROR_LOGGER]', 'Failed to persist system error:', logErr)
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
