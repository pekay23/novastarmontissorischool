'use client'

import { useEffect } from 'react'

/**
 * The error boundary for this group.
 *
 * A client component because Next.js requires an error boundary to be one. It
 * renders a fixed message and never the error's own text: an unhandled fault in a
 * cross-tenant console is frequently a Prisma error carrying a connection string
 * fragment, and an operator reading it on a screen is exactly the disclosure the
 * console exists to prevent. The detail goes to the server log via the
 * `console.error` the boundary already emits, correlated by the request id in the
 * header.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[super-admin] Unhandled page error', error)
  }, [error])

  return (
    <div className="rounded-md border border-destructive/40 bg-card p-8">
      <h1 className="text-lg font-semibold">Something failed on this page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The detail is in the server log rather than here, because an internal error in this console
        can carry connection details.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        Try again
      </button>
    </div>
  )
}
