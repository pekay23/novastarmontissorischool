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
 * Tenant isolation is NOT enforced here: `token.schoolId` is a claim snapshot,
 * so per-request tenant scoping is resolved downstream in getTenantContext()
 * (apps/portal/lib/tenant.ts).
 */

import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'

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

export default withAuth(
  async function proxy(req) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (req as any).nextauth?.token
    const { pathname } = req.nextUrl

    // --- Rate limiting ---
    // Before the public-path short-circuit, on purpose. The short-circuit
    // returns before any limiting work, so `/api/auth/*` used to be reachable
    // at unlimited rate; `/api/auth/totp` and the passkey registration pair were
    // the consequence.
    //
    // Uses the shared limiter in lib/rate-limit.ts, which is covered by
    // tests/rate-limit.test.ts. Its store is per-process; a multi-instance
    // deployment needs a shared store (Redis/Upstash) to enforce globally.
    const isApi = pathname.startsWith('/api/')
    const isAuthApi = pathname.startsWith('/api/auth')
    const max = isAuthApi ? AUTH_RATE_LIMIT : isApi ? API_RATE_LIMIT : PAGE_RATE_LIMIT
    const { success, reset } = checkRateLimit(clientIdentifier(req), max, RATE_LIMIT_WINDOW_MS)

    if (!success) {
      const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
      if (isApi) {
        return NextResponse.json(
          { error: 'Rate limit exceeded', retryAfter: retryAfterSeconds },
          { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
        )
      }
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      })
    }

    // Allow public paths after limiting, so "public" means "no session needed"
    // rather than "no limits".
    if (publicPaths.some((p) => pathname.startsWith(p))) return NextResponse.next()

    if (!token) {
      const url = req.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(url)
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
      return NextResponse.redirect(new URL('/set-password', req.url))
    }

    const role = token.role as string
    const perms = PERMISSIONS[role]

    // Check role-based permissions
    if (perms) {
      if (perms.includes('*')) {
        return NextResponse.next()
      }

      // A role holding a `perms` array at all has been identified as a portal
      // role; this admits only the exact prefixes in `PATH_EXEMPT_PREFIXES`, and
      // deliberately sits after the `*` check so it cannot widen HEADMASTER's
      // already-total access into something narrower or differently ordered.
      const exempt = PATH_EXEMPT_PREFIXES[role]
      if (exempt?.some((prefix) => pathname.startsWith(prefix))) {
        return NextResponse.next()
      }

      const sections = isApi
        ? pathname.split('/').slice(2).filter(Boolean) // /api/<resource> → [resource]
        : pathname.split('/').filter(Boolean) // /<section>/... → [section, ...]
      const section = sections[0] || ''

      const hasPerm = perms.some((p) => section === p || section.startsWith(p))
      if (!hasPerm) {
        return NextResponse.redirect(new URL('/dashboard/unauthorized', req.url))
      }
    } else {
      // Unknown role - deny access
      return NextResponse.redirect(new URL('/login', req.url))
    }

    // Check school access (multi-tenant isolation)
    const requestedSchoolId = req.nextUrl.searchParams.get('schoolId')
    if (requestedSchoolId && requestedSchoolId !== token.schoolId) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    return NextResponse.next()
  },
  {
    pages: {
      signIn: '/login',
    },
  }
)
