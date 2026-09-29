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
} from 'lucide-react'
import { Button, cn, ToastProvider, ConfirmProvider } from '@novastar/shared-ui'
import { useState } from 'react'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Students', href: '/students', icon: Users },
  { name: 'Teachers', href: '/teachers', icon: GraduationCap },
  { name: 'Enrollment', href: '/enrollment', icon: School },
  { name: 'Attendance', href: '/attendance', icon: Clock },
  { name: 'Grades', href: '/grades', icon: BookOpen },
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

  // Filter navigation based on role permissions
  // Roles with broad access (admin, super_admin) see all items;
  // staff see everything except Settings (restricted to admin)
  const visibleNav = navigation.filter((item) => {
    if (userRole === 'admin' || userRole === 'super_admin') return true
    if (item.href === '/settings') return false
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
        <header className="flex h-14 items-center justify-between border-b bg-card px-4">
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

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon">
              <Bell className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon">
              <Search className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1 text-sm">
              <span className="hidden sm:inline">{session?.user?.name}</span>
              <span className="text-xs uppercase text-muted-foreground">({userRole})</span>
            </div>
          </div>
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
