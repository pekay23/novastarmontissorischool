/**
 * Declarative mapping of API route prefixes to the permission key they
 * require. Used by the admin UI at `/settings/permissions` to render
 * a "what does this permission gate?" view, and consultable at runtime
 * via `requiredPermissionForPath()`.
 *
 * This is documentation-grade: handler-side permission checks remain authoritative.
 * Treat divergence between this table and an actual route as a code-review red flag.
 */
export interface RoutePermissionBinding {
  /** URL prefix match. */
  prefix: string
  /** Permission key required to call the route. */
  permission: string
  /** Optional brief label for the admin UI. */
  description?: string
}

// Inline permission constants (no external dependency on @novastar/auth)
const PERMISSIONS = {
  APPROVE_PAYMENTS: 'payments.approve',
  MANAGE_USERS: 'users.manage',
  MANAGE_ROLES: 'roles.manage',
  MANAGE_ENROLLMENTS: 'enrollments.manage',
  MANAGE_EXAMS: 'exams.manage',
  VIEW_AUDIT_LOGS: 'audit.logs.view',
  MANAGE_SETTINGS: 'settings.manage',
} as const

// Exported for use by the permissions admin UI
export const ADDITIONAL_PERMISSION_KEYS = {
  EXAM_SESSION_EXTEND: 'exams.session.extend',
  EXAM_VIOLATION_REVIEW: 'exams.violations.review',
  EXAM_BANK_EDIT: 'exams.banks.edit',
  EXAM_SESSION_MONITOR: 'exams.sessions.monitor',
  MANAGE_RBAC: 'rbac.manage',
  MANAGE_REFERRALS: 'referrals.manage',
  MANAGE_GDPR: 'gdpr.manage',
} as const

export const ROUTE_PERMISSION_BINDINGS: RoutePermissionBinding[] = [
  // Finance
  { prefix: '/api/staff/payments', permission: PERMISSIONS.APPROVE_PAYMENTS, description: 'Approve/reject payment proofs' },

  // Users
  { prefix: '/api/staff/users/create', permission: PERMISSIONS.MANAGE_USERS, description: 'Create staff accounts' },
  { prefix: '/api/staff/users/[id]/role', permission: PERMISSIONS.MANAGE_ROLES, description: 'Change a user\'s role' },

  // Enrollments
  { prefix: '/api/staff/enrollments', permission: PERMISSIONS.MANAGE_ENROLLMENTS, description: 'Approve/edit enrollments' },

  // Governance
  { prefix: '/api/staff/audit-logs', permission: PERMISSIONS.VIEW_AUDIT_LOGS, description: 'Read audit trail' },
  { prefix: '/api/staff/settings', permission: PERMISSIONS.MANAGE_SETTINGS, description: 'Edit system settings' },
]

export function requiredPermissionForPath(pathname: string): RoutePermissionBinding | null {
  const matches = ROUTE_PERMISSION_BINDINGS.filter((b) =>
    pathname.startsWith(b.prefix.replace(/\[[^/\]]+\]/g, '*').replace(/\*/g, ''))
  )
  if (matches.length === 0) return null
  // Longest prefix wins
  return matches.sort((a, b) => b.prefix.length - a.prefix.length)[0]
}
