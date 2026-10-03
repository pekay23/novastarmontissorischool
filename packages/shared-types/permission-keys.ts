/**
 * Canonical permission vocabulary.
 *
 * This module is the single source of truth for:
 *   - the shape of a permission key,
 *   - every permission the platform ships,
 *   - which keys each role receives,
 *   - how far a role's reach extends for a given key (row-level scope).
 *
 * The seed (`tools/seed`), the API route guards (`apps/portal`) and the
 * authorization tests all import from here. Previously the seed hardcoded the
 * list, `PermissionSchema.key` asserted a two-segment regex that rejected 11
 * live rows, and role grants were inline `Array.filter` chains — three
 * vocabularies that could drift apart silently.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Key grammar
// ---------------------------------------------------------------------------

/**
 * A permission key is one to three colon-separated lowercase segments:
 *
 *   resource:action                 e.g. `student:read`
 *   resource:subResource:action     e.g. `finance:invoice:create`
 *   prefix:*                        e.g. `academic:*` (delegation wildcard)
 *   *                               (global wildcard, HEADMASTER only)
 *
 * Digits, hyphens and underscores are allowed inside a segment because tenant
 * identifiers and third-party codes appear in real grants.
 */
const PERMISSION_SEGMENT = /^[a-z][a-z0-9_-]*$/
const MAX_PERMISSION_SEGMENTS = 3

export interface ParsedPermissionKey {
  /** First segment. `*` for the global wildcard. */
  resource: string
  /** Middle segment of a `resource:subResource:action` key, otherwise null. */
  subResource: string | null
  /** Last segment. `*` for a prefix wildcard. */
  action: string
  /** True when either the key or its action segment is a wildcard. */
  isWildcard: boolean
}

export function parsePermissionKey(key: string): ParsedPermissionKey | null {
  if (typeof key !== 'string' || key.length === 0) return null
  const segments = key.split(':')
  if (segments.length < 1 || segments.length > MAX_PERMISSION_SEGMENTS) return null

  const isGlobalWildcard = key === '*'
  if (!isGlobalWildcard) {
    for (const segment of segments) {
      if (segment === '*') continue
      if (!PERMISSION_SEGMENT.test(segment)) return null
    }
  }

  const resource = segments[0] as string
  const action = segments[segments.length - 1] as string
  return {
    resource,
    subResource: segments.length === MAX_PERMISSION_SEGMENTS ? (segments[1] as string) : null,
    action,
    isWildcard: isGlobalWildcard || action === '*',
  }
}

export const PermissionKeySchema = z
  .string()
  .refine((key) => parsePermissionKey(key) !== null, {
    message:
      'Permission key must be one to three colon-separated lowercase segments ' +
      "(resource[:subResource]:action), or a '*' wildcard segment",
  })

/**
 * True when a granted permission set satisfies a requested key.
 *
 * `hasPermission` in `@novastar/auth` performs an exact `Set.has` match, which
 * makes every wildcard grant inert. Delegation rules emit `academic:*`-style
 * keys, so they currently grant nothing. Match wildcard prefixes here and let
 * the auth package use it.
 */
export function permissionMatches(granted: string, requested: string): boolean {
  if (granted === requested) return true
  if (granted === '*') return true
  if (!granted.endsWith(':*')) return false
  return requested.startsWith(granted.slice(0, -1))
}

// ---------------------------------------------------------------------------
// Controlled vocabularies
// ---------------------------------------------------------------------------

export const PERMISSION_ACTIONS = [
  'create',
  'read',
  'update',
  'edit',
  'delete',
  'approve',
  'delegate',
  'export',
  'grade',
  'mark',
  'pay',
  'record',
  'return',
  'send',
  'manage',
  'settings',
  'write',
  '*',
] as const
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]
export const PermissionActionEnum = z.enum(PERMISSION_ACTIONS)

export const PERMISSION_CATEGORIES = [
  'academic',
  'finance',
  'staff',
  'student',
  'communication',
  'reports',
  'system',
] as const
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number]
export const PermissionCategoryEnum = z.enum(PERMISSION_CATEGORIES)

export const PERMISSION_SCOPES = ['all', 'own', 'class', 'department', 'custom'] as const
export type PermissionScope = (typeof PERMISSION_SCOPES)[number]
export const PermissionScopeEnum = z.enum(PERMISSION_SCOPES)

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const PLATFORM_ROLE_NAMES = [
  'HEADMASTER',
  'ASSISTANT_HEAD',
  'HEAD_TEACHER',
  'CLASSROOM_TEACHER',
  'ACCOUNTANT',
  'ADMIN_STAFF',
  'PARENT',
] as const
export type PlatformRoleName = (typeof PLATFORM_ROLE_NAMES)[number]

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface PermissionDefinition {
  key: string
  resource: string
  action: PermissionAction
  category: PermissionCategory
  /** Widest reach the permission can ever grant. Role narrowing happens below. */
  scope: PermissionScope
  description: string
}

function perm(
  key: string,
  category: PermissionCategory,
  description: string,
  scope: PermissionScope = 'all',
): PermissionDefinition {
  const parsed = parsePermissionKey(key)
  if (!parsed) {
    // Fail at module load rather than shipping a malformed key to the database.
    throw new Error(`Malformed permission key in catalog: ${key}`)
  }
  return {
    key,
    resource: parsed.resource,
    action: parsed.action as PermissionAction,
    category,
    description,
    scope,
  }
}

/**
 * Every permission the platform ships.
 *
 * The first block reproduces the previously hardcoded seed list verbatim so no
 * live `Permission` row or `Role.permissions` entry is invalidated. The second
 * block adds the `*:read` keys that resources were missing — without them a
 * route can only be guarded with an unrelated key, which is how 21 GET
 * handlers ended up unguarded.
 */
export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  // --- academic: term/calendar level ---
  perm('academic:create', 'academic', 'Create academic records'),
  perm('academic:read', 'academic', 'Read academic records'),
  perm('academic:update', 'academic', 'Update academic records'),
  perm('academic:delete', 'academic', 'Delete academic records'),
  perm('academic:approve', 'academic', 'Approve academic records'),
  // --- academic: assessments ---
  perm('assessment:create', 'academic', 'Create assessments'),
  perm('assessment:read', 'academic', 'Read assessments'),
  perm('assessment:update', 'academic', 'Update assessments'),
  perm('assessment:delete', 'academic', 'Delete assessments'),
  perm('assessment:grade', 'academic', 'Grade assessments'),
  // --- academic: attendance ---
  perm('attendance:read', 'academic', 'Read attendance records'),
  perm('attendance:mark', 'academic', 'Mark attendance'),
  perm('attendance:edit', 'academic', 'Edit attendance records'),
  perm('attendance:delete', 'academic', 'Delete attendance records'),
  // --- academic: classes ---
  perm('class:read', 'academic', 'Read classes'),
  perm('class:create', 'academic', 'Create classes'),
  perm('class:edit', 'academic', 'Edit classes'),
  perm('class:delete', 'academic', 'Delete classes'),
  perm('term:read', 'academic', 'Read academic terms and years'),
  // --- finance ---
  perm('finance:create', 'finance', 'Create financial records'),
  perm('finance:read', 'finance', 'Read financial records'),
  perm('finance:update', 'finance', 'Update financial records'),
  perm('finance:delete', 'finance', 'Delete financial records'),
  perm('finance:approve', 'finance', 'Approve financial records'),
  perm('finance:invoice:create', 'finance', 'Create invoices'),
  perm('finance:invoice:delete', 'finance', 'Delete invoices'),
  perm('finance:payment', 'finance', 'Make payments'),
  perm('finance:payment:record', 'finance', 'Record payments'),
  // --- staff ---
  perm('staff:create', 'staff', 'Create staff records'),
  perm('staff:read', 'staff', 'Read staff records'),
  perm('staff:update', 'staff', 'Update staff records'),
  perm('staff:delete', 'staff', 'Delete staff records'),
  perm('teacher:read', 'staff', 'Read teacher records'),
  perm('teacher:create', 'staff', 'Create teachers'),
  perm('teacher:edit', 'staff', 'Edit teachers'),
  perm('teacher:delete', 'staff', 'Delete teachers'),
  // --- staff: library ---
  perm('library:read', 'staff', 'Read the library catalogue'),
  perm('library:book:create', 'staff', 'Create library books'),
  perm('library:book:edit', 'staff', 'Edit library books'),
  perm('library:book:delete', 'staff', 'Delete library books'),
  perm('library:loan:read', 'staff', 'Read library loans'),
  perm('library:loan:create', 'staff', 'Create library loans'),
  perm('library:loan:return', 'staff', 'Return library loans'),
  // --- student ---
  perm('student:create', 'student', 'Create student records'),
  perm('student:read', 'student', 'Read student records'),
  perm('student:update', 'student', 'Update student records'),
  perm('student:delete', 'student', 'Delete student records'),
  perm('student:edit', 'student', 'Edit student records'),
  perm('enrollment:read', 'student', 'Read enrollments'),
  perm('enrollment:create', 'student', 'Create enrollments'),
  perm('enrollment:delete', 'student', 'Delete enrollments'),
  // --- communication ---
  perm('communication:create', 'communication', 'Create communications'),
  perm('communication:read', 'communication', 'Read communications'),
  perm('communication:update', 'communication', 'Update communications'),
  perm('communication:send', 'communication', 'Send communications'),
  perm('announcement:read', 'communication', 'Read announcements'),
  perm('announcement:create', 'communication', 'Create announcements'),
  perm('announcement:edit', 'communication', 'Edit announcements'),
  perm('announcement:delete', 'communication', 'Delete announcements'),
  perm('event:read', 'communication', 'Read events'),
  perm('event:create', 'communication', 'Create events'),
  perm('event:edit', 'communication', 'Edit events'),
  perm('event:delete', 'communication', 'Delete events'),
  // --- reports ---
  perm('reports:create', 'reports', 'Create reports'),
  perm('reports:read', 'reports', 'Read reports'),
  perm('reports:export', 'reports', 'Export reports'),
  perm('report:read', 'reports', 'Read a student academic report'),
  // --- system ---
  perm('system:manage', 'system', 'Manage system settings'),
  perm('system:settings', 'system', 'Manage system settings'),
  perm('delegation:approve', 'system', 'Approve delegations'),
  perm('config:read', 'system', 'Read configuration'),
  perm('config:write', 'system', 'Write configuration'),
  perm('inventory:read', 'system', 'Read inventory'),
  perm('inventory:item:create', 'system', 'Create inventory items'),
  perm('inventory:item:edit', 'system', 'Edit inventory items'),
  perm('inventory:item:delete', 'system', 'Delete inventory items'),
]

export const PERMISSION_KEYS: readonly string[] = PERMISSION_CATALOG.map((p) => p.key)

export const PERMISSION_CATALOG_BY_KEY: ReadonlyMap<string, PermissionDefinition> = new Map(
  PERMISSION_CATALOG.map((p) => [p.key, p]),
)

// ---------------------------------------------------------------------------
// Role grants
// ---------------------------------------------------------------------------

export type RoleGrantRule = (permission: PermissionDefinition) => boolean

/**
 * Grant rules per role. These reproduce the previous inline `Array.filter`
 * chains in `tools/seed/index.ts` exactly, extended with the new `*:read` keys.
 */
export const ROLE_GRANT_RULES: Record<PlatformRoleName, RoleGrantRule> = {
  HEADMASTER: () => true,
  ASSISTANT_HEAD: (p) => p.category !== 'system' && !p.key.includes('delete'),
  HEAD_TEACHER: (p) =>
    p.category === 'academic' || p.category === 'student' || p.category === 'communication',
  CLASSROOM_TEACHER: (p) =>
    (p.category === 'academic' && p.action !== 'delete') ||
    (p.category === 'student' && p.action === 'read') ||
    (p.category === 'communication' && p.action !== 'delete'),
  ACCOUNTANT: (p) => p.category === 'finance' || p.category === 'reports',
  ADMIN_STAFF: (p) =>
    (p.category === 'student' && (p.action === 'read' || p.action === 'create')) ||
    (p.category === 'communication' && p.action === 'read'),
  // A parent may read their own children and anything addressed to parents.
  // `student:read` is narrowed to their own children by ROLE_READ_SCOPE below,
  // so granting the key here is safe.
  PARENT: (p) => p.key === 'student:read' || p.key === 'communication:read' || p.key === 'announcement:read',
}

export function permissionsForRole(
  role: PlatformRoleName,
  catalog: readonly PermissionDefinition[] = PERMISSION_CATALOG,
): string[] {
  const rule = ROLE_GRANT_RULES[role]
  return rule ? catalog.filter(rule).map((p) => p.key) : []
}

// ---------------------------------------------------------------------------
// Row-level scope
// ---------------------------------------------------------------------------

/**
 * How far a role may see for a specific permission.
 *
 * A role can hold `student:read` and still only be entitled to its own
 * children. Without this map the only options were "grant the key to everyone"
 * (leaks the whole roster) or "withhold the key" (breaks the feature), which
 * is why `GET /api/students` returned every student in the school to parents.
 *
 * Anything not listed resolves to the permission's own `scope`, which is
 * `all` for the whole catalog today.
 */
export const ROLE_READ_SCOPE: Partial<
  Record<PlatformRoleName, Partial<Record<string, PermissionScope>>>
> = {
  PARENT: {
    'student:read': 'own',
    'enrollment:read': 'own',
  },
  CLASSROOM_TEACHER: {
    'student:read': 'class',
    'attendance:read': 'class',
    'attendance:mark': 'class',
    'attendance:edit': 'class',
  },
}

export function scopeFor(roleName: string | null | undefined, permissionKey: string): PermissionScope {
  if (!roleName) return 'custom'
  const narrowing = ROLE_READ_SCOPE[roleName as PlatformRoleName]
  const narrowed = narrowing?.[permissionKey]
  if (narrowed) return narrowed
  return PERMISSION_CATALOG_BY_KEY.get(permissionKey)?.scope ?? 'all'
}