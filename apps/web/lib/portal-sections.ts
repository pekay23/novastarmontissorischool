import { permissionsForRole, type PlatformRoleName } from '@novastar/shared-types'

/** Coarse route reachability. Each API handler still enforces permissions and row visibility. */
const SECTION_READ_PERMISSIONS: Readonly<Record<string, string>> = {
  students: 'student:read',
  teachers: 'teacher:read',
  grades: 'academic:read',
  attendance: 'attendance:read',
  announcements: 'announcement:read',
  reports: 'report:read',
  fees: 'finance:read',
  calendar: 'event:read',
  library: 'library:read',
  inventory: 'inventory:read',
  settings: 'config:read',
  admissions: 'admissions:read',
  enrollment: 'enrollment:read',
  classes: 'class:read',
  timetable: 'timetable:read',
  syllabus: 'academic:read',
  promotions: 'promotion:execute',
}

const PORTAL_ROLES: readonly PlatformRoleName[] = [
  'HEADMASTER', 'ASSISTANT_HEAD', 'HEAD_TEACHER', 'CLASSROOM_TEACHER',
  'ACCOUNTANT', 'ADMIN_STAFF', 'PARENT', 'ADMISSIONS_OFFICER',
]

export const PORTAL_SECTIONS_BY_ROLE: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  PORTAL_ROLES.map((role) => {
    if (role === 'HEADMASTER') return [role, ['*']]
    const granted = new Set(permissionsForRole(role))
    return [role, ['dashboard', ...Object.entries(SECTION_READ_PERMISSIONS)
      .filter(([, permission]) => granted.has(permission))
      .map(([section]) => section)]]
  }),
)

export const PATH_EXEMPT_PREFIXES_BY_ROLE: Readonly<Record<string, readonly string[]>> = {
  ADMIN_STAFF: ['/portal/admissions', '/portal/api/admissions'],
  ADMISSIONS_OFFICER: ['/portal/admissions', '/portal/api/admissions'],
  ASSISTANT_HEAD: ['/portal/teachers/me', '/portal/api/teachers/me'],
  HEAD_TEACHER: ['/portal/teachers/me', '/portal/api/teachers/me'],
  CLASSROOM_TEACHER: ['/portal/teachers/me', '/portal/api/teachers/me'],
}

/** Page sections and their differently named API resources/dependencies. */
const API_RESOURCE_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  assessments: ['grades'],
  finance: ['fees'],
  events: ['calendar'],
  syllabi: ['syllabus'],
  enrollments: ['enrollment'],
  classes: ['classes', 'students', 'grades', 'attendance', 'timetable', 'enrollment', 'promotions', 'syllabus'],
  terms: ['grades', 'attendance', 'timetable', 'enrollment', 'promotions', 'fees', 'reports', 'syllabus'],
  'record-amendments': ['settings', 'students', 'attendance'],
}

export type PortalPathDecision =
  | { readonly outcome: 'allow' }
  | { readonly outcome: 'denied' }
  | { readonly outcome: 'unknown-role' }

function within(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function decidePortalPath(role: string | null | undefined, pathname: string): PortalPathDecision {
  if (!role || !Object.hasOwn(PORTAL_SECTIONS_BY_ROLE, role)) return { outcome: 'unknown-role' }
  const sections = PORTAL_SECTIONS_BY_ROLE[role]
  if (sections.includes('*')) return { outcome: 'allow' }
  if (PATH_EXEMPT_PREFIXES_BY_ROLE[role]?.some((prefix) => within(pathname, prefix))) return { outcome: 'allow' }

  const path = within(pathname, '/portal') ? pathname.slice('/portal'.length) : pathname
  const isApi = within(path, '/api')
  const segments = path.split('/').filter(Boolean)
  const section = segments[isApi ? 1 : 0] ?? ''
  if (isApi && section === 'session') return { outcome: 'allow' }
  const candidates = isApi ? API_RESOURCE_SECTIONS[section] ?? [section] : [section]
  return candidates.some((candidate) => sections.includes(candidate)) ? { outcome: 'allow' } : { outcome: 'denied' }
}

export function reachableNavigation<T extends { href: string }>(role: string | null | undefined, items: readonly T[]): T[] {
  return items.filter((item) => decidePortalPath(role, item.href).outcome === 'allow')
}
