'use client'

export default function FeatureFlagsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="alert">
      <div className="text-center max-w-md">
        <div className="flex justify-center mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        </div>
        <h2 className="text-lg font-black text-foreground mb-2">Feature Flags Error</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Failed to load feature flags configuration. Please try again.
        </p>
        <button
          onClick={reset}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2 rounded-md font-medium text-sm transition-colors"
        >
          Try Again
        </button>
        {error.digest && (
          <p className="mt-4 text-xs text-muted-foreground">Error ID: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
