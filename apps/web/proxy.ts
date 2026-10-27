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
import { rateLimitAsync, clientIdentifier } from '@/lib/rate-limit'
import { decidePortalPath } from '@/lib/portal-sections'
import { sectionContentSecurityPolicy } from '@/lib/security/csp'
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
  validateCsrfToken,
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
  '/admin/api/auth/login',
  '/admin/api/auth/logout',
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

    if (!token) {
      const url = req.nextUrl.clone()
      url.pathname = '/portal/login'
      url.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(url)
    }

    // A session that still owes a password change reaches nothing else.
    if (token.mustChangePassword) {
      return NextResponse.redirect(new URL('/portal/set-password', req.url))
    }

    // Role-based authorization — decidePortalPath strips /portal prefix internally
    const role = token.role as string
    const decision = decidePortalPath(role, pathname)

    if (decision.outcome === 'unknown-role') {
      return NextResponse.redirect(new URL('/portal/login', req.url))
    }
    if (decision.outcome === 'denied') {
      return NextResponse.redirect(new URL('/portal/dashboard/unauthorized', req.url))
    }

    // Check school access (multi-tenant isolation)
    const requestedSchoolId = req.nextUrl.searchParams.get('schoolId')
    if (requestedSchoolId && requestedSchoolId !== token.schoolId) {
      return NextResponse.redirect(new URL('/portal/dashboard', req.url))
    }

    return NextResponse.next()
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

  // --- Session verification ---
  const sessionCookie = req.cookies.get(ADMIN_SESSION_COOKIE)?.value
  if (!sessionCookie) {
    const url = req.nextUrl.clone()
    url.pathname = '/admin/login'
    url.searchParams.set('returnTo', pathname)
    return NextResponse.redirect(url)
  }

  let session
  try {
    session = verifySessionToken(sessionCookie)
    if (!session) return NextResponse.redirect(new URL('/admin/login', req.url))
  } catch {
    const url = req.nextUrl.clone()
    url.pathname = '/admin/login'
    url.searchParams.set('returnTo', pathname)
    return NextResponse.redirect(url)
  }

  // Session valid — attach operator info to headers for downstream use
  const res = NextResponse.next()
  res.headers.set('x-operator-id', session.id)
  res.headers.set('x-operator-username', session.username)
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
  const isPortal = isWithinPath(pathname, '/portal')
  const isAdmin = isWithinPath(pathname, '/admin')

  if (!isPortal && !isAdmin) {
    // Public site paths — no proxy logic needed (headers in next.config.ts)
    return NextResponse.next()
  }

  const section = isPortal ? '/portal' : '/admin'
  const isApi = isWithinPath(pathname, `${section}/api`)
  const isAuthApi = isWithinPath(pathname, `${section}/api/auth`)
  const max = isAuthApi ? AUTH_RATE_LIMIT : isApi ? API_RATE_LIMIT : PAGE_RATE_LIMIT
  const budget = isAuthApi ? 'auth' : isApi ? 'api' : 'page'
  const { success, reset } = await rateLimitAsync(`proxy:${section}:${budget}:${clientIdentifier(req)}`, max, RATE_LIMIT_WINDOW_MS)

  if (!success) {
    const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    const headers = { 'Retry-After': String(retryAfterSeconds) }
    if (isApi) {
      return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: retryAfterSeconds }, { status: 429, headers })
    }
    return new NextResponse('Too Many Requests', { status: 429, headers })
  }

  const existingToken = req.cookies.get(CSRF_COOKIE_NAME)?.value
  const validExistingToken = existingToken && validateCsrfToken(existingToken, existingToken)
  const issuedToken = validExistingToken ? null : generateCsrfToken()
  const nonce = !isApi && process.env.NODE_ENV === 'production' ? generateCsrfToken() : null
  const csp = nonce ? sectionContentSecurityPolicy(section, nonce, req.nextUrl) : null
  const finalize = (response: Response): NextResponse => {
    const result = response instanceof NextResponse ? response : new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
    if (nonce && csp) {
      result.headers.set('Content-Security-Policy', csp)
      if (result.headers.get('x-middleware-next') === '1') {
        const requestHeaders = new Headers(req.headers)
        requestHeaders.set('x-nonce', nonce)
        requestHeaders.set('Content-Security-Policy', csp)
        const forwarded = NextResponse.next({ request: { headers: requestHeaders } })
        forwarded.headers.forEach((value, key) => {
          if (key === 'x-middleware-override-headers' || key.startsWith('x-middleware-request-')) result.headers.set(key, value)
        })
      }
    }
    if (issuedToken) result.cookies.set(CSRF_COOKIE_NAME, issuedToken, csrfCookieOptions(process.env.NODE_ENV === 'production', req.nextUrl))
    return result
  }
  const csrf = evaluateCsrf({
    method: req.method,
    pathname,
    cookieToken: validExistingToken ? existingToken : undefined,
    headerToken: req.headers.get(CSRF_HEADER_NAME),
  })
  if (!csrf.allow) {
    return finalize(NextResponse.json({ error: 'Invalid CSRF token', reason: csrf.reason }, { status: 403 }))
  }

  // These session exemptions must be outside withAuth, which otherwise redirects
  // recovery pages or skips the wrapped handler for NextAuth's entire auth path.
  if (isPortal && portalPublicPaths.some((path) => isWithinPath(pathname, path))) return finalize(NextResponse.next())
  if (isAdmin && adminPublicPaths.some((path) => isWithinPath(pathname, path))) return finalize(NextResponse.next())

  const response = isPortal
    ? await portalAuthedProxy(req as Parameters<typeof portalAuthedProxy>[0], event)
    : await adminProxy(req)
  return finalize(response ?? NextResponse.next())
}

function isWithinPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}
