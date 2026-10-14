'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import {
  LogOut, Menu,
  Bell, Search,
  ChevronLeft, ChevronRight, ChevronDown,
  LayoutDashboard, GraduationCap, ClipboardCheck, BookOpen,
  DollarSign, LibraryBig, Calendar, Megaphone,
  UserCheck, Clock, BarChart3, Settings, UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { Button, cn, ToastProvider, ConfirmProvider, useToast, Avatar, AvatarFallback, AvatarImage, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@novastar/shared-ui'
import { useState, useEffect, useRef } from 'react'

interface NavigationItem {
  name: string
  href: string
}

/**
 * The icon for each named section, resolved on the client.
 *
 * Icon components are React `forwardRef` objects, which React will
 * not serialize from a Server Component to a Client Component, so
 * the portal layout passes the navigation as plain `{ name, href }`
 * data and this map — kept beside the code that renders the icons —
 * supplies each section's icon by name. A name with no entry falls
 * back to the dashboard icon rather than to nothing, so a renamed
 * section keeps a glyph instead of an empty sidebar row.
 */
const NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
  Dashboard: LayoutDashboard,
  Students: GraduationCap,
  Attendance: ClipboardCheck,
  Grades: BookOpen,
  Fees: DollarSign,
  Library: LibraryBig,
  Calendar: Calendar,
  Announcements: Megaphone,
  Teachers: UserCheck,
  Timetable: Clock,
  Reports: BarChart3,
  Settings: Settings,
  Admissions: UserPlus,
}

function iconFor(item: NavigationItem): LucideIcon {
  return NAV_ICONS[item.name] ?? LayoutDashboard
}

interface NavGroup {
  id: string
  label: string
  items: NavigationItem[]
}

function buildNavGroups(navigation: readonly NavigationItem[], visibleNav: readonly NavigationItem[]): NavGroup[] {
  const visibleSet = new Set(visibleNav.map(v => v.name))
  const groups: NavGroup[] = [
    { id: 'overview', label: 'Overview', items: navigation.filter(n => visibleSet.has(n.name) && ['Dashboard'].includes(n.name)) },
    { id: 'academics', label: 'Academics', items: navigation.filter(n => visibleSet.has(n.name) && ['Students', 'Attendance', 'Grades', 'Timetable', 'Syllabus', 'Reports', 'Promotions'].includes(n.name)) },
    { id: 'finance', label: 'Finance', items: navigation.filter(n => visibleSet.has(n.name) && ['Fees'].includes(n.name)) },
    { id: 'library-assets', label: 'Library & Assets', items: navigation.filter(n => visibleSet.has(n.name) && ['Library', 'Inventory'].includes(n.name)) },
    { id: 'school-life', label: 'School Life', items: navigation.filter(n => visibleSet.has(n.name) && ['Calendar', 'Announcements'].includes(n.name)) },
    { id: 'people', label: 'People', items: navigation.filter(n => visibleSet.has(n.name) && ['Teachers'].includes(n.name)) },
    { id: 'management', label: 'Management', items: navigation.filter(n => visibleSet.has(n.name) && ['Settings', 'Admissions'].includes(n.name)) },
  ]
  return groups.filter(g => g.items.length > 0)
}

const DEFAULT_COLLAPSED_GROUPS: Record<string, boolean> = {
  overview: false,
  // Academics open by default: for a teacher the Academics group is the
  // whole portal, and a collapsed one hides Students/Attendance/Grades
  // behind an extra click on first visit.
  academics: false,
  finance: false,
  'library-assets': false,
  'school-life': false,
  people: false,
  management: true,
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
  const { data: _session, status } = useSession()
  const mainRef = useRef<HTMLElement>(null)
  // The rail's collapsed state. Initialized to the SSR default and synced
  // from localStorage after mount: reading storage in the initializer would
  // render a different tree on the client's first pass than the server sent,
  // which is a hydration mismatch.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // The mobile drawer only. Starts closed on every load — a drawer left open
  // from a previous session is a layout that appears over the page unasked —
  // and is not persisted for the same reason.
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    () => ({ ...DEFAULT_COLLAPSED_GROUPS }),
  )

  // Restore stored preferences once after mount, before the write effects
  // below can push a default back over them (effects run in order, and React
  // commits the read's state before the writer's effect runs).
  useEffect(() => {
    function restore() {
      try {
        const stored = localStorage.getItem('portal-sidebar-collapsed')
        if (stored !== null) setSidebarCollapsed(JSON.parse(stored))
        const groups = localStorage.getItem('portal-nav-groups')
        if (groups !== null) {
          const parsed = JSON.parse(groups)
          if (parsed && typeof parsed === 'object') {
            setCollapsedGroups(prev => ({ ...prev, ...parsed }))
          }
        }
      } catch {
        // private mode or corrupted JSON: defaults stand
      }
    }
    restore()
  }, [])

  // Persist sidebarCollapsed to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('portal-sidebar-collapsed', JSON.stringify(sidebarCollapsed))
    } catch {
      // private mode
    }
  }, [sidebarCollapsed])

  // Persist collapsedGroups to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('portal-nav-groups', JSON.stringify(collapsedGroups))
    } catch {
      // private mode
    }
  }, [collapsedGroups])

  // Scroll reset on navigation
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0
    }
  }, [pathname])

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

  const navGroups = buildNavGroups(navigation, visibleNav)

  // Longest-prefix match for header title
  const currentPage = navigation
    .filter(n => pathname?.startsWith(n.href))
    .sort((a, b) => b.href.length - a.href.length)[0]

   // Breadcrumb segments: portal section > current page
   const breadcrumbSegments: { label: string; href: string }[] = []
   if (currentPage && currentPage.href !== '/portal/dashboard') {
     const parentGroup = navGroups.find(g => g.items.some(i => i.name === currentPage.name))
     if (parentGroup) {
       breadcrumbSegments.push({ label: parentGroup.label, href: parentGroup.items[0]?.href || '#' })
     }
   }

  return (
    <TooltipProvider>
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
                // The drawer state only governs the mobile breakpoint: below
                // md the rail slides off-canvas until the hamburger opens it.
                // Gating desktop with `md:hidden` here would hide the rail
                // from every user whose stored drawer state is closed, and
                // the only control that reopens it is itself `md:hidden`.
                !sidebarOpen && 'max-md:hidden -translate-x-full'
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
                    'shrink-0',
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
                {/*
                  Collapsed means w-16: a group header would render as a lone
                  icon with no way to reach its sub-items, so the collapsed
                  rail is the flat nav with tooltips instead of the groups.
                */}
                {sidebarCollapsed
                  ? visibleNav.map((item) => {
                      const Icon = iconFor(item)
                      const isActive =
                        pathname === item.href || pathname.startsWith(item.href + '/')
                      return (
                        <Tooltip key={item.name}>
                          <TooltipTrigger asChild>
                            <Link
                              href={item.href}
                              className={cn(
                                'flex items-center justify-center rounded-md px-2 py-2 text-sm font-medium transition-colors',
                                isActive
                                  ? 'bg-primary/10 text-primary'
                                  : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                              )}
                              onClick={() => setSidebarOpen(false)}
                              aria-current={isActive ? 'page' : undefined}
                            >
                              <Icon className="h-5 w-5 shrink-0" />
                              <span className="sr-only">{item.name}</span>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right">{item.name}</TooltipContent>
                        </Tooltip>
                      )
                    })
                  : navGroups.map((group) => {
                      const isGroupActive = group.items.some(item =>
                        pathname === item.href || pathname.startsWith(item.href + '/')
                      )
                      const isCollapsed = collapsedGroups[group.id] ?? DEFAULT_COLLAPSED_GROUPS[group.id] ?? false
                      const groupId = `nav-group-${group.id}`
                      const GroupIcon = group.items[0] ? iconFor(group.items[0]) : LayoutDashboard

                      const GroupTrigger = (
                        <button
                          id={`${groupId}-trigger`}
                          onClick={() => setCollapsedGroups(prev => ({ ...prev, [group.id]: !prev[group.id] }))}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                            isGroupActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                          )}
                          aria-expanded={!isCollapsed}
                          aria-controls={`${groupId}-content`}
                        >
                          <GroupIcon className="h-5 w-5 shrink-0" />
                          <span className="truncate">{group.label}</span>
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 shrink-0 ml-auto transition-transform duration-200',
                              // ChevronDown points down when open; collapsed
                              // rotates it right, matching the disclosure.
                              isCollapsed && '-rotate-90'
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      )

                      return (
                        <div key={group.id}>
                          {GroupTrigger}
                          <div
                            id={`${groupId}-content`}
                            className={cn(
                              'overflow-hidden transition-all duration-200 ease-in-out',
                              isCollapsed ? 'max-h-0 opacity-0' : 'max-h-96 opacity-100'
                            )}
                            role="group"
                            aria-labelledby={`${groupId}-trigger`}
                          >
                            {!isCollapsed && (
                              <div className="ml-7 mt-1 space-y-1 border-l pl-3">
                                {group.items.map((item) => {
                                  const Icon = iconFor(item)
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
                                      aria-current={isActive ? 'page' : undefined}
                                    >
                                      <Icon className="h-5 w-5 shrink-0" />
                                      <span className="truncate">{item.name}</span>
                                    </Link>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
               </nav>
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

                  {/* Breadcrumb */}
                  {breadcrumbSegments.length > 0 && (
                    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="Breadcrumb">
                      {breadcrumbSegments.map((segment, i) => (
                        <span key={`${i}-${segment.label}`} className="flex items-center gap-1.5">
                          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
                          {i === breadcrumbSegments.length - 1 ? (
                            <span aria-current="page" className="font-medium text-foreground">{segment.label}</span>
                          ) : (
                            <Link href={segment.href} className="hover:text-foreground">{segment.label}</Link>
                          )}
                        </span>
                      ))}
                    </nav>
                  )}

                  <h1 className="font-heading text-xl font-bold">
                    {currentPage?.name || 'Dashboard'}
                  </h1>
                </div>

                <HeaderActions
                  key={pathname}
                  userName={userName}
                  userRole={userRole}
                  userEmail={userEmail}
                  pages={visibleNav}
                />
              </header>

              {/* Page content */}
              <main ref={mainRef} data-portal-scroll className="flex-1 overflow-y-auto">
                <div className="container mx-auto p-4 md:p-6">
                  {children}
                </div>
              </main>
            </div>
          </ConfirmProvider>
        </ToastProvider>
      </div>
    </TooltipProvider>
  )
}

/**
 * Closes a transient popover when the pointer lands outside it.
 *
 * A full-screen `fixed inset-0` blocker does the same job by stacking
 * over the page, but it also stacks over the trigger and the field that
 * owns the popover — the search input became unclickable the moment its
 * overlay mounted. Listening for the pointer outside the container keeps
 * the trigger and the field usable and needs no z-index stacking at all.
 */
function useDismissOnOutside(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  // Held in a ref so the listener does not re-register on every render.
  const handler = useRef(onDismiss)

  useEffect(() => {
    handler.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && ref.current && !ref.current.contains(target)) {
        handler.current()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])
  return ref
}

/**
 * The header's action cluster: page search, notifications and the user
 * menu. The parent keys this component by pathname, so a route change
 * remounts it and both transient panels close as a consequence — no
 * effect watching the pathname to reset them.
 */
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
  const searchRef = useDismissOnOutside(() => {
    setSearchOpen(false)
    setQuery('')
  })
  const userMenuRef = useDismissOnOutside(() => setUserMenuOpen(false))
  // So Escape inside the input can hand focus back to the control that
  // opened it, rather than dropping focus to <body>.
  const searchToggleRef = useRef<HTMLButtonElement>(null)

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

      <div ref={searchRef} className="relative flex items-center gap-2">
        {searchOpen && (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchOpen(false)
                setQuery('')
                searchToggleRef.current?.focus()
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
          ref={searchToggleRef}
          variant="ghost"
          size="icon"
          aria-label="Search"
          aria-expanded={searchOpen}
          aria-controls={searchOpen ? 'header-page-search' : undefined}
          onClick={() => {
            setSearchOpen((open) => !open)
            setQuery('')
          }}
        >
          <Search className="h-4 w-4" />
        </Button>

        {searchOpen && matches.length > 0 && (
          <ul id="header-page-search" className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-md border bg-card shadow-lg">
            {matches.map((item) => {
              const Icon = iconFor(item)
              return (
                <li key={item.name}>
                  <button
                    onClick={() => goTo(item.href)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="h-4 w-4" />
                    {item.name}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* User Menu */}
      <div ref={userMenuRef} className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 rounded-md bg-muted px-3 py-1 text-sm"
          onClick={() => setUserMenuOpen(open => !open)}
          aria-expanded={userMenuOpen}
          aria-haspopup="true"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && userMenuOpen) {
              setUserMenuOpen(false)
            }
          }}
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={userEmail ? `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(userEmail)}` : undefined} alt={userName || 'User'} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline-block truncate max-w-30">{userName}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>

        {userMenuOpen && (
          <div
            className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-md border bg-card shadow-lg py-1"
            // Escape from inside the menu (the trigger is not focused once a
            // row is) — keydown bubbles from the focused row up to here.
            onKeyDown={(e) => {
              if (e.key === 'Escape') setUserMenuOpen(false)
            }}
          >
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
        )}
      </div>
    </div>
  )
}