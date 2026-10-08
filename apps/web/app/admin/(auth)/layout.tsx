import type { ReactNode } from 'react'

/**
 * The shell around the sign-in form.
 *
 * Centred, chrome-free and deliberately un-navigable: there is no nav here, so
 * there is nothing to reach without a session. The nav lives in the dashboard
 * layout, which is behind the operator gate.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-16">
      <div className="w-full max-w-md">{children}</div>
    </main>
  )
}
