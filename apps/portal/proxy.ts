/**
 * Portal proxy (Next.js 16's name for middleware).
 *
 * `proxy.ts` is the Next.js 16 convention. `middleware.ts` is deprecated in
 * 16.3.3 and cannot coexist with `proxy.ts` — having both fails the build with
 * "Both middleware file ./middleware.ts and proxy file ./proxy.ts are
 * detected." See docs/audit-reports/CONSOLIDATED-AUDIT-REPORT.md (SEC-01),
 * which re-evaluated an earlier "rename proxy.ts to middleware.ts" finding as a
 * false positive.
 *
 * Runs on every matched request and enforces, in order:
 * - Per-client-IP rate limiting (20 req/min auth, 100 req/min API, 300 req/min pages)
 * - CSRF double-submit verification, and issuance of the token cookie
 * - Session authentication via next-auth
 * - An outstanding password change, which confines the session to the
 *   credential-recovery pages
 * - Role-based path authorization
 *
 * Rate limiting runs BEFORE the public-path short-circuit. It used to run after
 * it, which left every route under `/api/auth` both unauthenticated and
 * completely unthrottled — `/api/auth/totp` and the passkey registration pair
 * were reachable at unlimited rate from any address. Ordering the limiter first
 * is what makes the public-path exemption mean "no session required" rather
 * than "no limits".
 *
 * CSRF sits in the same slot for the same reason: it has to see the request
 * before any handler runs, and a limiter that a flood could skip is no limiter.
 * The check itself is a pure function in lib/security/csrf.ts, so the policy is
 * unit-tested without constructing a NextRequest.
 *
 * Tenant isolation is NOT enforced here: `token.schoolId` is a claim snapshot,
 * so per-request tenant scoping is resolved downstream in getTenantContext()
 * (apps/portal/lib/tenant.ts).
 */

import { withAuth } from 'next-auth/middleware'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  csrfCookieOptions,
  evaluateCsrf,
  generateCsrfToken,
} from '@/lib/security/csrf'

// Paths that don't require authentication. These are exempted from the SESSION
// check only — the rate limiter above still applies to them.
//
// The credential-recovery pages sit here for the same reason `/login` does: a
// recipient following an emailed link is not signed in, and is by definition
// unable to become signed in until the link works. Requiring a session would make
// every verification, setup and reset link dead on arrival. Their API routes are
// already covered by the `/api/auth` prefix and each carry their own limiter,
// because they are unauthenticated write paths.
const publicPaths = [
  '/login',
  '/verify-email',
  '/set-password',
  '/forgot-password',
  '/reset-password',
  '/api/auth',
  '/api/health',
  '/_next',
  '/favicon.ico',
  '/logo.svg',
]

// Rate limits, per client IP, per minute.
const API_RATE_LIMIT = 100
const PAGE_RATE_LIMIT = 300
const RATE_LIMIT_WINDOW_MS = 60_000
// `/api/auth/*` gets its own, much tighter budget than the general API limit.
// The sign-in, passkey and TOTP endpoints under it are the credential surface,
// so 100/minute from one address is far too generous for them.
const AUTH_RATE_LIMIT = 20

/**
 * Paths outside a role's section list that the role may still reach.
 *
 * The section match below compares only the first path segment, so admitting
 * `/settings/admissions` would mean admitting all of `/settings`. These are
 * exact prefixes for exactly that reason: each entry is a surface whose own
 * server-side gate is the real authorisation, and this layer exists so the
 * request reaches that gate rather than bouncing off the proxy.
 */
const PATH_EXEMPT_PREFIXES: Record<string, string[]> = {
  ADMIN_STAFF: ['/settings/admissions', '/api/admissions'],
  ADMISSIONS_OFFICER: ['/settings/admissions', '/api/admissions'],
}

// Role-based permissions — keys MUST match the DB Role.name values from
// tools/seed/index.ts: HEADMASTER, ASSISTANT_HEAD, HEAD_TEACHER,
// CLASSROOM_TEACHER, ACCOUNTANT, ADMIN_STAFF, PARENT, ADMISSIONS_OFFICER.
//
// The old lowercase PERMISSIONS keys (admin, teacher, finance, bursar,
// assistant-head, staff) never matched the DB role names, causing every
// authenticated user to be redirected to /login (PERMISSIONS[role] → undefined).
const PERMISSIONS: Record<string, string[]> = {
  HEADMASTER: ['*'], // All portal access
  ASSISTANT_HEAD: [
    'dashboard', 'students', 'grades', 'attendance', 'announcements',
    'reports', 'fees', 'payments', 'calendar', 'library', 'inventory',
  ],
  HEAD_TEACHER: [
    'dashboard', 'students', 'grades', 'attendance', 'announcements', 'reports',
  ],
  CLASSROOM_TEACHER: [
    'dashboard', 'students', 'grades', 'attendance', 'classes',
  ],
  ACCOUNTANT: ['dashboard', 'fees', 'payments', 'reports', 'students'],
  // No `students_view` entry: section matching is `section === p ||
  // section.startsWith(p)` against the first path segment, so `'students_view'`
  // could never match `'students'` and sat in the list as a dead entry while
  // ADMIN_STAFF was actually denied `/api/students` — a role PARENT was allowed.
  // Nor `'settings'`, which would hand the whole settings section to every admin
  // staffer; the admissions surface it needs is exempted by prefix above.
  ADMIN_STAFF: ['dashboard', 'announcements'],
  PARENT: ['dashboard', 'announcements', 'students'],
  // Absent from this map until now, which meant `perms` was `undefined` and the
  // role was redirected to `/login` for every path — the admissions pages and API
  // it exists to serve included. `students` because an application becomes a
  // student record; `announcements` because intake notices go out the same way as
  // any other school communication.
  ADMISSIONS_OFFICER: ['dashboard', 'students', 'announcements'],
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo\\.svg|robots\\.txt|sitemap\\.xml|api/health).*)',
  ],
}

const authedProxy = withAuth(
  async function authedProxy(req) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (req as any).nextauth?.token
    const { pathname } = req.nextUrl
    const isApi = pathname.startsWith('/api/')

    // --- CSRF token issuance ---
    // Any request that reaches the proxy without a token gets one issued on the
    // way out, so the first page view seeds the cookie the client later echoes.
    // Issued on every response path — including denials — because a 403 that
    // hands back a usable token lets the caller's next attempt succeed without a
    // reload, and handing the cookie to a cross-site attacker leaks nothing they
    // could not already ride along with.
    //
    // `finalize` exists so no return below can forget the Set-Cookie; there are
    // a dozen exit points and a missed one would silently strand the client
    // without a token until the next full page load.
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

    // --- Rate limiting happens in the exported wrapper below, not here ---
    //
    // It used to sit here, which meant it never ran for the paths `withAuth`
    // short-circuits. `withAuth` keeps its own `doesNotRequireAuth` list —
    // `/api/auth`, `/api/health`, `/_next`, and the configured sign-in page —
    // and returns `NextResponse.next()` for those WITHOUT invoking this handler.
    // So `AUTH_RATE_LIMIT` was unreachable: `/api/auth/totp` and the passkey
    // registration pair were reachable at unlimited rate from any address, while
    // this file's own header claimed the limiter ran "before the public-path
    // short-circuit". The wrapper runs first for every matched request, which is
    // what makes that claim true.

    // --- CSRF (double-submit) ---
    //
    // SameSite=Lax on the session cookie already blocks classic cross-site form
    // POSTs. What Lax does NOT block is a same-site origin — a sibling
    // subdomain, or anything else that can write cross-origin on our own site —
    // because Lax judges the site, not the origin. Double-submit closes that: the
    // browser attaches the cookie to such a request, but the attacker cannot read
    // the cookie to copy it into the header, so the echo fails.
    //
    // The decision is delegated to evaluateCsrf (lib/security/csrf.ts) so the
    // policy is a pure function and testable without a NextRequest. Mutating
    // `/api/*` calls must present both a cookie and a matching `X-CSRF-Token`;
    // `/api/auth/*` is exempt because sign-in cannot have a token yet.
    //
    // Rejection is a 403 JSON body, never a redirect: this is an API caller, and
    // bouncing it to /login would turn a CSRF failure into a confusing sign-in
    // loop rather than an error the client can act on.
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
    // rather than "no limits".
    if (publicPaths.some((p) => pathname.startsWith(p))) return finalize(NextResponse.next())

    if (!token) {
      const url = req.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('callbackUrl', pathname)
      return finalize(NextResponse.redirect(url))
    }

    // A session that still owes a password change reaches nothing else.
    //
    // The claim is set by the `jwt` callback in `lib/auth.ts`, which re-reads it
    // from the database on every revalidation, and nothing but a real password
    // write clears the column it mirrors. Before this check the flag was
    // decorative: `authorize()` copied it into the token and nothing read it, so
    // a tenant-CLI account told "It must be changed at first sign-in" could use
    // the portal indefinitely on the provisional password.
    //
    // It sits AFTER the public-path short-circuit, and that is what makes it
    // loop-free: `/set-password`, `/verify-email`, `/forgot-password`,
    // `/reset-password`, `/login` and all of `/api/auth` return above it, so the
    // redirect target and every recovery route stay reachable. A flagged session
    // with no setup token in hand is not locked out either — `/forgot-password`
    // mails a reset link, and `POST /api/auth/reset-password` is a write that
    // clears the flag.
    if (token.mustChangePassword) {
      return finalize(NextResponse.redirect(new URL('/set-password', req.url)))
    }

    const role = token.role as string
    const perms = PERMISSIONS[role]

    // Check role-based permissions
    if (perms) {
      if (perms.includes('*')) {
        return finalize(NextResponse.next())
      }

      // A role holding a `perms` array at all has been identified as a portal
      // role; this admits only the exact prefixes in `PATH_EXEMPT_PREFIXES`, and
      // deliberately sits after the `*` check so it cannot widen HEADMASTER's
      // already-total access into something narrower or differently ordered.
      const exempt = PATH_EXEMPT_PREFIXES[role]
      if (exempt?.some((prefix) => pathname.startsWith(prefix))) {
        return finalize(NextResponse.next())
      }

      const sections = isApi
        ? pathname.split('/').slice(2).filter(Boolean) // /api/<resource> → [resource]
        : pathname.split('/').filter(Boolean) // /<section>/... → [section, ...]
      const section = sections[0] || ''

      const hasPerm = perms.some((p) => section === p || section.startsWith(p))
      if (!hasPerm) {
        return finalize(NextResponse.redirect(new URL('/dashboard/unauthorized', req.url)))
      }
    } else {
      // Unknown role - deny access
      return finalize(NextResponse.redirect(new URL('/login', req.url)))
    }

    // Check school access (multi-tenant isolation)
    const requestedSchoolId = req.nextUrl.searchParams.get('schoolId')
    if (requestedSchoolId && requestedSchoolId !== token.schoolId) {
      return finalize(NextResponse.redirect(new URL('/dashboard', req.url)))
    }

    return finalize(NextResponse.next())
  },
  {
    pages: {
      signIn: '/login',
    },
  }
)

/**
 * The exported proxy.
 *
 * Rate limiting lives out here, ahead of `withAuth`, because `withAuth` answers a
 * set of paths itself and never calls the handler for them: `/api/auth`, `/api/health`,
 * `/_next`, and the sign-in page. A limiter inside the handler therefore did not run for
 * the credential endpoints — the exact surface that most needs one.
 *
 * Uses the shared limiter in lib/rate-limit.ts, covered by tests/rate-limit.test.ts. Its
 * store is per-process; a multi-instance deployment needs a shared store (Redis/Upstash)
 * to enforce globally.
 */
export default async function proxy(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl
  const isApi = pathname.startsWith('/api/')
  const isAuthApi = pathname.startsWith('/api/auth')
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

  // `withAuth` narrows its request to `NextRequestWithAuth`, which is the same
  // object at runtime with `nextauth` attached by the wrapper.
  return authedProxy(req as Parameters<typeof authedProxy>[0], event)
}
