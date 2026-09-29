import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'

const handler = NextAuth(authOptions)

const CREDENTIALS_ATTEMPTS = 5
const CREDENTIALS_WINDOW_MS = 15 * 60 * 1000

/**
 * Brute-force protection for the credentials callback.
 *
 * Only sign-in attempts are limited — session, CSRF and other auth routes stay
 * unthrottled so a rate-limited client can still sign out or re-authenticate.
 */
function isCredentialsSignIn(request: Request): boolean {
  return new URL(request.url).pathname === '/api/auth/callback/credentials'
}

export async function GET(request: Request, context: { params: Promise<{ nextauth: string[] }> }) {
  return handler(request, context)
}

export async function POST(request: Request, context: { params: Promise<{ nextauth: string[] }> }) {
  if (isCredentialsSignIn(request)) {
    const result = checkRateLimit(
      clientIdentifier(request),
      CREDENTIALS_ATTEMPTS,
      CREDENTIALS_WINDOW_MS
    )

    if (!result.success) {
      const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
      return new Response(
        JSON.stringify({ error: 'Too many sign-in attempts. Please try again later.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(CREDENTIALS_ATTEMPTS),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
          },
        }
      )
    }
  }

  return handler(request, context)
}
