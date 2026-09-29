import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

// Paths that don't require authentication
const publicPaths = ['/login', '/api/auth', '/api/health', '/_next', '/favicon.ico', '/logo.svg']

// Role-based permissions
const PERMISSIONS: Record<string, string[]> = {
  admin: ['*'],  // All access
  teacher: ['dashboard', 'students', 'attendance', 'grades', 'announcements', 'messages'],
  finance: ['dashboard', 'fees', 'payments', 'reports', 'students'],
  bursar: ['dashboard', 'fees', 'payments', 'reports'],
  'assistant-head': ['dashboard', 'students', 'grades', 'attendance', 'announcements', 'reports'],
  staff: ['dashboard', 'students_view', 'announcements'],
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

    // Allow public paths
    if (publicPaths.some(p => pathname.startsWith(p))) return NextResponse.next()

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
      
      const sections = pathname.split('/').filter(Boolean)
      const section = sections[1] || ''
      
      const hasPerm = perms.some(p => section === p || section.startsWith(p))
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