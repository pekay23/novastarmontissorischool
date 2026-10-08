'use client'

/**
 * Segment-level error boundary for class promotions.
 *
 * The screen is read-only apart from the promotion itself, so the failure
 * being caught here is a load failure: the class list, the term list or the
 * roster did not arrive. `reset` re-runs the render, which re-runs the
 * lookups — there is nothing to reconcile because nothing was written.
 */
export default function PromotionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="alert">
      <div className="max-w-md text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg
              className="h-6 w-6 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        </div>
        <h2 className="mb-2 text-lg font-black text-foreground">Promotions unavailable</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Failed to load class promotion data. No student has been moved.
        </p>
        <button
          onClick={reset}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
        {error.digest && (
          <p className="mt-4 text-xs text-muted-foreground">Error ID: {error.digest}</p>
        )}
      </div>
    </div>
  )
}