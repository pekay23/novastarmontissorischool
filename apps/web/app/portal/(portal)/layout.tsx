// Portal pages require auth + live DB data — never prerender at build
export const dynamic = 'force-dynamic'

import '../../portal.css'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { reachableNavigation } from '@/lib/portal-sections'
import { PortalShell } from './PortalShell'

// Icons for the navigation — imported here to avoid client component issues
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  Calendar, Clock, FileText, Settings, School, LibraryBig, Package,
  CalendarDays, NotebookText, TrendingUp, Shield, Bell,
  type LucideIcon,
} from 'lucide-react'

const navigationWithIcons: readonly { name: string; href: string; icon: LucideIcon }[] = [
  { name: 'Dashboard', href: '/portal/dashboard', icon: LayoutDashboard },
  { name: 'Students', href: '/portal/students', icon: Users },
  { name: 'Teachers', href: '/portal/teachers', icon: GraduationCap },
  { name: 'Enrollment', href: '/portal/enrollment', icon: School },
  { name: 'Attendance', href: '/portal/attendance', icon: Clock },
  { name: 'Grades', href: '/portal/grades', icon: BookOpen },
  { name: 'Timetable', href: '/portal/timetable', icon: CalendarDays },
  { name: 'Syllabus', href: '/portal/syllabus', icon: NotebookText },
  { name: 'Promotions', href: '/portal/promotions', icon: TrendingUp },
  { name: 'Reports', href: '/portal/reports', icon: FileText },
  { name: 'Calendar', href: '/portal/calendar', icon: Calendar },
  { name: 'Announcements', href: '/portal/announcements', icon: Bell },
  { name: 'Fees & Payments', href: '/portal/fees', icon: Shield },
  { name: 'Library', href: '/portal/library', icon: LibraryBig },
  { name: 'Inventory', href: '/portal/inventory', icon: Package },
  { name: 'Settings', href: '/portal/settings', icon: Settings },
]

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

if (!session?.user) {
    // The proxy will redirect to /portal/login, but render a minimal shell
    // to avoid a flash. The PortalShell will show loading state.
    return (
      <PortalShell
        navigation={navigationWithIcons}
        visibleNav={[]}
        userRole="staff"
        schoolName="School Portal"
      >
        {children}
      </PortalShell>
    )
  }

  const userRole = (session.user as { role?: string })?.role || 'staff'
  const schoolName = (session.user as { schoolName?: string })?.schoolName ||
    session.user?.name?.split(' ')[0] || 'School Portal'
  const userName = session.user?.name ?? null
  const userEmail = session.user?.email ?? null

  const visibleNav = reachableNavigation(userRole, navigationWithIcons)

  return (
    <PortalShell
      navigation={navigationWithIcons}
      visibleNav={visibleNav}
      userRole={userRole}
      schoolName={schoolName}
      userName={userName}
      userEmail={userEmail}
    >
      {children}
    </PortalShell>
  )
}