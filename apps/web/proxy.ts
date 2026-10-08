/**
 * Merged app proxy (Next.js 16's name for middleware).
 *
 * `proxy.ts` is the Next.js 16 convention. `middleware.ts` is deprecated in
 * 16.3.3 and cannot coexist with `proxy.ts` — having both fails the build with
 * "Both middleware file ./middleware.ts and proxy file ./proxy.ts are
 * detected." See docs/audit-reports/CONSOLIDATED-AUDIT-REPORT.md (SEC-01).
 *
 * Handles:
 * - Portal paths (/portal/*): full auth, rate limiting, CSRF, role gates
 * - Admin paths (/admin/*): auth via super_admin_session cookie, rate limiting, CSRF
 * - Public site paths (/): security headers only (handled in next.config.ts)
 */

import { withAuth } from 'next-auth/middleware'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'
import { decidePortalPath } from '@/lib/portal-sections'
import {
  ADMIN_SESSION_COOKIE,
  verifySessionToken,
} from '@/lib/admin-auth'
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  csrfCookieOptions,
  evaluateCsrf,
  generateCsrfToken,
} from '@/lib/security/csrf'

// Paths that don't require authentication (portal). Exempted from SESSION
// check only — the rate limiter above still applies to them.
const portalPublicPaths = [
  '/portal/login',
  '/portal/verify-email',
  '/portal/set-password',
  '/portal/forgot-password',
  '/portal/reset-password',
  '/portal/api/auth',
  '/portal/api/health',
]

// Admin paths that don't require authentication
const adminPublicPaths = [
  '/admin/login',
  '/admin/api/health',
]

// Rate limits, per client IP, per minute.
const API_RATE_LIMIT = 100
const PAGE_RATE_LIMIT = 300
const RATE_LIMIT_WINDOW_MS = 60_000
// `/portal/api/auth/*` gets its own, much tighter budget than the general API limit.
const AUTH_RATE_LIMIT = 20

// Portal matcher: all /portal/* paths except static assets
export const config = {
  matcher: [
    '/portal/:path*',
    // Admin paths handled here for CSP/COOP headers, auth, rate limiting, CSRF
    '/admin/:path*',
  ],
}

const portalAuthedProxy = withAuth(
  async function portalAuthedProxy(req) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (req as any).nextauth?.token
    const { pathname } = req.nextUrl

    // --- CSRF token issuance ---
    const existingToken = req.cookies.get(CSRF_COOKIE_NAME)?.value
    const issuedToken = existingToken ? null : generateCsrfToken()
    const finalize = (res: NextResponse) => {
      if (issuedToken) {
        res.cookies.set(
          CSRF_COOKIE_NAME,
          issuedToken,
          csrfCookieOptions(process.env.NODE_ENV === 'production')
        )
      }
      return res
    }

    // --- CSRF (double-submit) ---
    const cookieToken = existingToken
    const csrf = evaluateCsrf({
      method: req.method,
      pathname,
      cookieToken,
      headerToken: req.headers.get(CSRF_HEADER_NAME),
    })

    if (!csrf.allow) {
      return finalize(
        NextResponse.json(
          { error: 'Invalid CSRF token', reason: csrf.reason },
          { status: 403 }
        )
      )
    }

    // Allow public paths after limiting, so "public" means "no session needed"
    if (portalPublicPaths.some((p) => pathname.startsWith(p))) return finalize(NextResponse.next())

    if (!token) {
      const url = req.nextUrl.clone()
      url.pathname = '/portal/login'
      url.searchParams.set('callbackUrl', pathname)
      return finalize(NextResponse.redirect(url))
    }

    // A session that still owes a password change reaches nothing else.
    if (token.mustChangePassword) {
      return finalize(NextResponse.redirect(new URL('/portal/set-password', req.url)))
    }

    // Role-based authorization — decidePortalPath strips /portal prefix internally
    const role = token.role as string
    const decision = decidePortalPath(role, pathname)

    if (decision.outcome === 'unknown-role') {
      return finalize(NextResponse.redirect(new URL('/portal/login', req.url)))
    }
    if (decision.outcome === 'denied') {
      return finalize(NextResponse.redirect(new URL('/portal/dashboard/unauthorized', req.url)))
    }

    // Check school access (multi-tenant isolation)
    const requestedSchoolId = req.nextUrl.searchParams.get('schoolId')
    if (requestedSchoolId && requestedSchoolId !== token.schoolId) {
      return finalize(NextResponse.redirect(new URL('/portal/dashboard', req.url)))
    }

    return finalize(NextResponse.next())
  },
  {
    pages: {
      /*
       * withAuth exempts the sign-in page by exact pathname
       * equality (`[signInPage, errorPage].includes(pathname)`
       * in next-auth's middleware), and `trailingSlash: true`
       * in next.config.ts makes the canonical URL
       * `/portal/login/`. The unslashed form fails that
       * comparison, so an unauthenticated visit to the sign-in
       * page itself was redirected back into the trailing-slash
       * redirect and looped forever. The slash is load-bearing.
       */
      signIn: '/portal/login/',
    },
  }
)

/**
 * Admin auth + CSRF proxy.
 * Validates super_admin_session cookie, applies rate limiting, enforces CSRF.
 */
async function adminProxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl

  // --- CSRF token issuance ---
  const existingToken = req.cookies.get(CSRF_COOKIE_NAME)?.value
  const issuedToken = existingToken ? null : generateCsrfToken()
  const finalize = (res: NextResponse) => {
    if (issuedToken) {
      res.cookies.set(
        CSRF_COOKIE_NAME,
        issuedToken,
        csrfCookieOptions(process.env.NODE_ENV === 'production')
      )
    }
    return res
  }

  // Allow public paths without auth
  if (adminPublicPaths.some((p) => pathname.startsWith(p))) return finalize(NextResponse.next())

  // --- Session verification ---
  const sessionCookie = req.cookies.get(ADMIN_SESSION_COOKIE)?.value
  if (!sessionCookie) {
    const url = req.nextUrl.clone()
    url.pathname = '/admin/login'
    url.searchParams.set('returnTo', pathname)
    return finalize(NextResponse.redirect(url))
  }

  let session
  try {
    session = verifySessionToken(sessionCookie)
  } catch {
    const url = req.nextUrl.clone()
    url.pathname = '/admin/login'
    url.searchParams.set('returnTo', pathname)
    return finalize(NextResponse.redirect(url))
  }

  // --- CSRF (double-submit) for mutating requests ---
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const cookieToken = existingToken
    const csrf = evaluateCsrf({
      method: req.method,
      pathname,
      cookieToken,
      headerToken: req.headers.get(CSRF_HEADER_NAME),
    })

    if (!csrf.allow) {
      return finalize(
        NextResponse.json(
          { error: 'Invalid CSRF token', reason: csrf.reason },
          { status: 403 }
        )
      )
    }
  }

  // Session valid — attach operator info to headers for downstream use
  const res = finalize(NextResponse.next())
  res.headers.set('x-operator-id', session!.id)
  res.headers.set('x-operator-username', session!.username)
  return res
}

/**
 * The exported proxy.
 *
 * Rate limiting lives out here, ahead of `withAuth`, because `withAuth` answers a
 * set of paths itself and never calls the handler for them: `/portal/api/auth`, `/portal/api/health`,
 * `/_next`, and the sign-in page. A limiter inside the handler therefore did not run for
 * the credential endpoints — the exact surface that most needs one.
 *
 * Uses the shared limiter in lib/rate-limit.ts, covered by tests/rate-limit.test.ts. Its
 * store is per-process; a multi-instance deployment needs a shared store (Redis/Upstash)
 * to enforce globally.
 */
export default async function proxy(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl
  const isPortal = pathname.startsWith('/portal')
  const isAdmin = pathname.startsWith('/admin')

  if (!isPortal && !isAdmin) {
    // Public site paths — no proxy logic needed (headers in next.config.ts)
    return NextResponse.next()
  }

  if (isPortal) {
    const isApi = pathname.startsWith('/portal/api/')
    const isAuthApi = pathname.startsWith('/portal/api/auth')
    const max = isAuthApi ? AUTH_RATE_LIMIT : isApi ? API_RATE_LIMIT : PAGE_RATE_LIMIT
    const { success, reset } = checkRateLimit(clientIdentifier(req), max, RATE_LIMIT_WINDOW_MS)

    if (!success) {
      const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
      const headers = { 'Retry-After': String(retryAfterSeconds) }
      if (isApi) {
        return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: retryAfterSeconds }, { status: 429, headers })
      }
      return new NextResponse('Too Many Requests', { status: 429, headers })
    }

    // `withAuth` narrows its request to `NextRequestWithAuth`
    return portalAuthedProxy(req as Parameters<typeof portalAuthedProxy>[0], event)
  }

  // Admin paths — super_admin_session auth, rate limiting, CSRF
  const isApi = pathname.startsWith('/admin/api/')
  const isAuthApi = pathname.startsWith('/admin/api/auth')
  const max = isAuthApi ? AUTH_RATE_LIMIT : isApi ? API_RATE_LIMIT : PAGE_RATE_LIMIT
  const { success, reset } = checkRateLimit(clientIdentifier(req), max, RATE_LIMIT_WINDOW_MS)

  if (!success) {
    const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    const headers = { 'Retry-After': String(retryAfterSeconds) }
    if (isApi) {
      return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: retryAfterSeconds }, { status: 429, headers })
    }
    return new NextResponse('Too Many Requests', { status: 429, headers })
  }

  return adminProxy(req)
}