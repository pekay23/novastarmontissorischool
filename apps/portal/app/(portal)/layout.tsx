'use client'

// Portal pages require auth + live DB data — never prerender at build
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  Calendar, Clock, FileText, Settings, LogOut, Menu,
  Bell, Search, Shield, School, LibraryBig, Package,
  CalendarDays, NotebookText, TrendingUp,
} from 'lucide-react'
import { Button, cn, ToastProvider, ConfirmProvider, useToast } from '@novastar/shared-ui'
import { useState } from 'react'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Students', href: '/students', icon: Users },
  { name: 'Teachers', href: '/teachers', icon: GraduationCap },
  { name: 'Enrollment', href: '/enrollment', icon: School },
  { name: 'Attendance', href: '/attendance', icon: Clock },
  { name: 'Grades', href: '/grades', icon: BookOpen },
  { name: 'Timetable', href: '/timetable', icon: CalendarDays },
  { name: 'Syllabus', href: '/syllabus', icon: NotebookText },
  { name: 'Promotions', href: '/promotions', icon: TrendingUp },
  { name: 'Reports', href: '/reports', icon: FileText },
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'Announcements', href: '/announcements', icon: Bell },
  { name: 'Fees & Payments', href: '/fees', icon: Shield },
  { name: 'Library', href: '/library', icon: LibraryBig },
  { name: 'Inventory', href: '/inventory', icon: Package },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session, status } = useSession()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-4 border-primary border-t-transparent rounded-full w-8 h-8 animate-spin mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    router.push('/login')
    return null
  }

  const userRole = (session?.user as { role?: string })?.role || 'staff'

  // School name comes from session — in production, this is set during login
  // and stored in the Branding table for admin override via Settings
  const schoolName = (session?.user as { schoolName?: string })?.schoolName ||
    session?.user?.name?.split(' ')[0] || 'School Portal'

  // Settings is restricted to roles that manage the school itself.
  //
  // This used to test for 'admin' and 'super_admin', neither of which the seed
  // ever assigns: tools/seed/index.ts creates HEADMASTER, ASSISTANT_HEAD,
  // HEAD_TEACHER, CLASSROOM_TEACHER, ACCOUNTANT, ADMIN_STAFF and PARENT. So no
  // provisioned user could ever see Settings, and the school could not manage
  // itself. Gate on the roles that actually exist.
  //
  // 'admin'/'super_admin' are kept for a future super-admin surface, which is
  // what apps/super-admin is intended to become.
  const SETTINGS_ROLES = new Set([
    'HEADMASTER',
    'ASSISTANT_HEAD',
    'admin',
    'super_admin',
  ])

  const visibleNav = navigation.filter((item) => {
    if (SETTINGS_ROLES.has(userRole)) return true
    if (item.href === '/settings') return false
    // Timetable, Syllabus and Promotions are deliberately NOT gated
    // here. The nav is not an authorization boundary — every one of
    // those pages' data routes is permission-gated (`timetable:read`
    // for the timetable, which `CLASSROOM_TEACHER` holds with
    // class-level scope), exactly as Grades and Attendance already
    // appear for every role while their APIs refuse unauthorized
    // callers. Hiding them here would need a second role-keyed
    // mechanism alongside `SETTINGS_ROLES`; the existing single
    // mechanism gates only Settings.
    return true
  })

  return (
    <div className="flex h-screen overflow-hidden">
      <ToastProvider>
        <ConfirmProvider>
          {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed md:fixed md:translate-x-0 z-50 flex h-full w-64 flex-col border-r bg-card transition-transform duration-200 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link href="/dashboard" className="font-heading text-xl font-bold text-primary">
            {schoolName}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {visibleNav.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                )}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon className="h-5 w-5" />
                {item.name}
              </Link>
            )
          })}
        </nav>

        <div className="border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => signOut({ callbackUrl: '/login' })}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="relative flex h-14 items-center justify-between border-b bg-card px-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading text-xl font-bold">
              {navigation.find(n => pathname?.startsWith(n.href))?.name || 'Dashboard'}
            </h1>
          </div>

          <HeaderActions userName={session?.user?.name} userRole={userRole} />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="container mx-auto p-4">
            {children}
          </div>
        </main>
      </div>
      </ConfirmProvider>
      </ToastProvider>
    </div>
  )
}

function HeaderActions({
  userName,
  userRole,
}: {
  userName?: string | null
  userRole: string
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  const matches = query.trim()
    ? navigation.filter((item) =>
        item.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : []

  function goTo(href: string) {
    setSearchOpen(false)
    setQuery('')
    router.push(href)
  }

  return (
    <div className="flex items-center gap-2">
      {searchOpen && (
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchOpen(false)
              setQuery('')
            } else if (e.key === 'Enter' && matches[0]) {
              goTo(matches[0].href)
            }
          }}
          placeholder="Search pages..."
          aria-label="Search pages"
          className="h-9 w-40 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
        />
      )}

      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        onClick={() =>
          toast.info({
            title: 'Notifications',
            description: 'No new notifications',
          })
        }
      >
        <Bell className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Search"
        aria-expanded={searchOpen}
        onClick={() => {
          setSearchOpen((open) => !open)
          setQuery('')
        }}
      >
        <Search className="h-4 w-4" />
      </Button>

      {searchOpen && matches.length > 0 && (
        <ul className="absolute right-4 top-14 z-50 w-56 overflow-hidden rounded-md border bg-card shadow-lg">
          {matches.map((item) => (
            <li key={item.name}>
              <button
                onClick={() => goTo(item.href)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1 text-sm">
        <span className="hidden sm:inline">{userName}</span>
        <span className="text-xs uppercase text-muted-foreground">({userRole})</span>
      </div>
    </div>
  )
}
