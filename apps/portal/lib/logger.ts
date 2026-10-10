/**
 * Structured logging utility — replaces `console.error` with consistent,
 * redacted JSON-safe output. No full stack traces are logged to stdout in
 * production; errors are summarized with name + message only.
 */

const isProduction = process.env.NODE_ENV === 'production'

interface LogEntry {
  level: 'error' | 'warn' | 'info'
  timestamp: string
  component: string
  message: string
  error?: {
    name: string
    message: string
  }
}

function redactError(error: unknown): { name: string; message: string } | undefined {
  if (!error) return undefined
  if (error instanceof Error) {
    return { name: error.name, message: isProduction ? '[redacted]' : error.message }
  }
  return { name: 'UnknownError', message: isProduction ? '[redacted]' : String(error) }
}

export function logError(component: string, error: unknown, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level: 'error',
    timestamp: new Date().toISOString(),
    component,
    message: 'Request failed',
    error: redactError(error),
  }
  if (context && !isProduction) {
    (entry as LogEntry & { context?: Record<string, unknown> }).context = context
  }
  console.error(JSON.stringify(entry))
}

export function logWarn(component: string, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level: 'warn',
    timestamp: new Date().toISOString(),
    component,
    message,
  }
  if (context && !isProduction) {
    (entry as LogEntry & { context?: Record<string, unknown> }).context = context
  }
  console.warn(JSON.stringify(entry))
}
