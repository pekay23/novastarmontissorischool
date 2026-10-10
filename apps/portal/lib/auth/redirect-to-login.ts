import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

/**
 * Redirects an unauthenticated user to /login with a `returnTo` query parameter
 * so they can be sent back to the originally-requested page after sign-in.
 *
 * Usage in server components / pages:
 *   if (!session) await redirectToLogin()
 *
 * The current request path is inferred from the `x-next-url` or `x-invoke-path`
 * headers that Next.js sets automatically, falling back to `referer`.
 */
export async function redirectToLogin(): Promise<never> {
  let returnTo: string | null = null

  try {
    const h = await headers()
    // Next.js 14+ sets x-next-url; x-invoke-path is another common header
    returnTo = h.get('x-next-url') || h.get('x-invoke-path') || h.get('next-url') || null

    // Fallback: parse pathname from the referer header
    if (!returnTo) {
      const referer = h.get('referer')
      if (referer) {
        try {
          returnTo = new URL(referer).pathname
        } catch {
          // invalid referer — ignore
        }
      }
    }
  } catch {
    // headers() unavailable (e.g. build time) — proceed without returnTo
  }

  // Only attach returnTo for protected portal paths, not /login itself
  if (returnTo && returnTo !== '/login' && returnTo !== '/' && !returnTo.startsWith('/login')) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`)
  }

  redirect('/login')
}
