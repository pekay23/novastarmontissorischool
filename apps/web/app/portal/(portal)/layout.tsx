import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SCHOOL_INFO } from '@/lib/metadata'
import { reachableNavigation } from '@/lib/portal-sections'
import { PortalShell } from './PortalShell'
import type { ReactNode } from 'react'

/**
 * The portal's authenticated shell.
 *
 * The navigation list is plain data — `{ name, href }` and nothing
 * else. `PortalShell` is a client component, and React serializes
 * only plain values across the server-to-client boundary: an icon
 * component (a `forwardRef` object carrying `$$typeof` and `render`)
 * passed as a prop is rejected at runtime with "Only plain objects
 * can be passed to Client Components from Server Components". The
 * icons are therefore resolved inside `PortalShell`, keyed by the
 * section name, which stays the join key between this list and the
 * shell that renders it.
 *
 * Order mirrors the section order in the database seed and in
 * `tools/seed/index.ts` (`SECTION_ORDER`): Dashboard, Students,
 * Attendance, Grades, Fees, Payments, Classes, Library, Calendar,
 * Announcements, Teachers, Timetable, Reports, Settings, Admissions,
 * Transport.
 *
 * The sidebar shows only the sections the role may open
 * (`reachableNavigation`), and it mirrors the proxy's own
 * `decidePortalPath(role, pathname)` gate, so a section the proxy
 * would bounce is never offered as a link in the first place.
 */
const navigation = [
  { name: 'Dashboard', href: '/portal/dashboard' },
  { name: 'Students', href: '/portal/students' },
  { name: 'Attendance', href: '/portal/attendance' },
  { name: 'Grades', href: '/portal/grades' },
  { name: 'Fees', href: '/portal/fees' },
  { name: 'Payments', href: '/portal/payments' },
  { name: 'Classes', href: '/portal/classes' },
  { name: 'Library', href: '/portal/library' },
  { name: 'Calendar', href: '/portal/calendar' },
  { name: 'Announcements', href: '/portal/announcements' },
  { name: 'Teachers', href: '/portal/teachers' },
  { name: 'Timetable', href: '/portal/timetable' },
  { name: 'Reports', href: '/portal/reports' },
  { name: 'Settings', href: '/portal/settings' },
  { name: 'Admissions', href: '/portal/settings/admissions' },
  { name: 'Transport', href: '/portal/settings/transport' },
]

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions)
  const schoolName = SCHOOL_INFO.name

  let userRole: string | null = null
  let userName: string | null = null
  let userEmail: string | null = null
  let schoolFromDb = null

  if (session?.user && session.user.tenantId) {
    userRole = session.user.role ?? null
    userName = session.user.name ?? null
    userEmail = session.user.email ?? null

    try {
      schoolFromDb = await prisma.school.findFirst({
        where: { tenantId: session.user.tenantId },
        select: { name: true },
      })
    } catch (error) {
      console.error('Failed to fetch school name:', error)
    }
  }

  const resolvedSchoolName = schoolFromDb?.name || schoolName
  const visibleNav = reachableNavigation(userRole, navigation)

  // No <ToastProvider> here. The portal's provider tree is
  // app/portal/layout.tsx (the `Providers` mount), which wraps
  // this layout's subtree.
  if (!session?.user) {
    return (
      <PortalShell
        navigation={navigation}
        visibleNav={[]}
        userRole=""
        schoolName={resolvedSchoolName}
      >
        {children}
      </PortalShell>
    )
  }

  return (
    <PortalShell
      navigation={navigation}
      visibleNav={visibleNav}
      userRole={userRole || ''}
      schoolName={resolvedSchoolName}
      userName={userName}
      userEmail={userEmail}
    >
      {children}
    </PortalShell>
  )
}
