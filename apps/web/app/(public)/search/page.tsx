import { Suspense } from 'react'

import SearchPageClient from './page-client'

/*
 * The search route itself.
 *
 * `SearchPageClient` reads `?q=` through `useSearchParams()`, which Next.js
 * requires be behind a Suspense boundary during prerendering — without this
 * wrapper the build fails on `/search` with `missing-suspense-with-csr-bailout`.
 * The wrapper is a server component, so the boundary costs nothing on the
 * client and the fallback below is what a slow connection sees first.
 */
export default function SearchPage() {
  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchPageClient />
    </Suspense>
  )
}

function SearchFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-purple-whisper">
      <div className="container px-4 text-center">
        <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-foreground/10 bg-background/80 px-4 py-2 text-xs font-bold tracking-widest uppercase">
          <span className="h-4 w-4 animate-pulse rounded-full bg-primary" aria-hidden="true" />
          Loading search
        </div>
        <div className="mx-auto max-w-2xl animate-pulse space-y-4">
          <div className="mx-auto h-8 w-64 rounded-lg bg-surface-container-low" />
          <div className="h-14 rounded-xl bg-surface-container-low" />
        </div>
      </div>
    </div>
  )
}
