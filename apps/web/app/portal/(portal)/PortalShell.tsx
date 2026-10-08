'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  Calendar, Clock, FileText, Settings, LogOut, Menu,
  Bell, Search, Shield, School, LibraryBig, Package,
  CalendarDays, NotebookText, TrendingUp,
  ChevronLeft, ChevronRight, ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import { Button, cn, ToastProvider, ConfirmProvider, useToast, Avatar, AvatarFallback, AvatarImage } from '@novastar/shared-ui'
import { useState } from 'react'

interface NavigationItem {
  name: string
  href: string
  icon: LucideIcon
}

interface PortalShellProps {
  navigation: readonly NavigationItem[]
  visibleNav: readonly NavigationItem[]
  userRole: string
  schoolName: string
  userName?: string | null
  userEmail?: string | null
  children: React.ReactNode
}

export function PortalShell({
  navigation,
  visibleNav,
  userRole,
  schoolName,
  userName,
  userEmail,
  children,
}: PortalShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session, status } = useSession()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // The proxy handles auth redirects, but keep a client-side guard for UX
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
    // Proxy will redirect, but show loading briefly
    return null
  }

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
              'fixed md:fixed md:translate-x-0 z-50 flex h-full flex-col border-r bg-card transition-all duration-300 ease-in-out',
              sidebarCollapsed
                ? 'w-16'
                : 'w-64',
              !sidebarOpen && 'md:hidden -translate-x-full'
            )}
          >
            <div className="flex h-14 items-center justify-between border-b px-4">
              {!sidebarCollapsed && (
                <Link href="/portal/dashboard" className="font-heading text-xl font-bold text-primary">
                  {schoolName}
                </Link>
              )}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'flex-shrink-0',
                  sidebarCollapsed && 'ml-auto'
                )}
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="h-5 w-5" />
                ) : (
                  <ChevronLeft className="h-5 w-5" />
                )}
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
                      sidebarCollapsed
                        ? 'justify-center px-2'
                        : 'justify-start px-3',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                    onClick={() => setSidebarOpen(false)}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn('h-5 w-5 flex-shrink-0', sidebarCollapsed && 'mx-auto')} />
                    {!sidebarCollapsed && <span className="truncate">{item.name}</span>}
                  </Link>
                )
              })}
            </nav>

            <div className="border-t p-3">
              {!sidebarCollapsed ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => signOut({ callbackUrl: '/portal/login' })}
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-full justify-center"
                  onClick={() => signOut({ callbackUrl: '/portal/login' })}
                  title="Sign Out"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              )}
            </div>
          </aside>

          {/* Main content */}
          <div
            className={cn(
              'flex-1 flex flex-col overflow-hidden transition-all duration-300 ease-in-out',
              sidebarCollapsed ? 'md:ml-16' : 'md:ml-64'
            )}
          >
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

              <HeaderActions
                userName={userName}
                userRole={userRole}
                userEmail={userEmail}
                pages={visibleNav}
              />
            </header>

            {/* Page content */}
            <main className="flex-1 overflow-y-auto">
              <div className="container mx-auto p-4 md:p-6">
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
  userEmail,
  pages,
}: {
  userName?: string | null
  userRole: string
  userEmail?: string | null
  pages: readonly NavigationItem[]
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const matches = query.trim()
    ? pages.filter((item) =>
        item.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : []

  function goTo(href: string) {
    setSearchOpen(false)
    setQuery('')
    router.push(href)
  }

  const initials = userName
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'US'

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

      {/* User Menu */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 rounded-md bg-muted px-3 py-1 text-sm"
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          aria-expanded={userMenuOpen}
          aria-haspopup="true"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={userEmail ? `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(userEmail)}` : undefined} alt={userName || 'User'} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline-block truncate max-w-[120px]">{userName}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>

        {userMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setUserMenuOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-md border bg-card shadow-lg py-1">
              <div className="px-3 py-2 border-b text-sm">
                <p className="font-medium truncate">{userName}</p>
                <p className="text-xs text-muted-foreground capitalize">{userRole.toLowerCase()}</p>
              </div>
              <button
                onClick={() => {
                  setUserMenuOpen(false)
                  signOut({ callbackUrl: '/portal/login' })
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-accent hover:text-accent-foreground"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}