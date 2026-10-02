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
 * - Per-client-IP rate limiting (100 req/min API, 300 req/min pages)
 * - Session authentication via next-auth
 * - Role-based path authorization
 *
 * Tenant isolation is NOT enforced here: `token.schoolId` is a claim snapshot,
 * so per-request tenant scoping is resolved downstream in getTenantContext()
 * (apps/portal/lib/tenant.ts).
 */

import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'

// Paths that don't require authentication
const publicPaths = ['/login', '/api/auth', '/api/health', '/_next', '/favicon.ico', '/logo.svg']

// Rate limits, per client IP, per minute.
const API_RATE_LIMIT = 100
const PAGE_RATE_LIMIT = 300
const RATE_LIMIT_WINDOW_MS = 60_000

// Role-based permissions — keys MUST match the DB Role.name values from
// tools/seed/index.ts: HEADMASTER, ASSISTANT_HEAD, HEAD_TEACHER,
// CLASSROOM_TEACHER, ACCOUNTANT, ADMIN_STAFF, PARENT.
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
    'dashboard', 'students', 'grades', 'attendance',
  ],
  ACCOUNTANT: ['dashboard', 'fees', 'payments', 'reports', 'students'],
  ADMIN_STAFF: ['dashboard', 'students_view', 'announcements'],
  PARENT: ['dashboard', 'announcements', 'students'],
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

    // Allow public paths before any limiting or authorization work.
    if (publicPaths.some((p) => pathname.startsWith(p))) return NextResponse.next()

    // --- Rate limiting ---
    // Uses the shared limiter in lib/rate-limit.ts, which is covered by
    // tests/rate-limit.test.ts. Its store is per-process; a multi-instance
    // deployment needs a shared store (Redis/Upstash) to enforce globally.
    const isApi = pathname.startsWith('/api/')
    const max = isApi ? API_RATE_LIMIT : PAGE_RATE_LIMIT
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

    if (!token) {
      const url = req.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(url)
    }

    const role = token.role as string
    const perms = PERMISSIONS[role]

    // Check role-based permissions
    if (perms) {
      if (perms.includes('*')) {
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
