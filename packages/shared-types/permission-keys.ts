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
  'execute',
  'approve',
  'delegate',
  'export',
  'grade',
  'mark',
  'pay',
  // `payment` is a legacy-grammar concession, not a verb the platform needs.
  // The two-segment key `finance:payment` derives the action `payment`, and that
  // key is live: it gates POST /api/finance/invoices/[id]/payments and is
  // asserted by tests/middleware.test.ts. Renaming it to `finance:payment:pay`
  // would orphan the granted key in every live `Role.permissions` array and
  // quietly open that route. Do not "clean this up" — it exists so the key can
  // stay. See `PERMISSION_CATALOG` below.
  'payment',
  'publish',
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

/**
 * Runtime membership check for permission actions. Backs the narrowing guard
 * below so `perm()` fails at module load when a catalog key derives an action
 * outside the enum, rather than relying on a blind cast that hides the mistake
 * from the compiler.
 */
const PERMISSION_ACTION_SET: ReadonlySet<string> = new Set(PERMISSION_ACTIONS)

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
  'ADMISSIONS_OFFICER',
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

/**
 * Narrow `string` to the action enum.
 *
 * The key grammar is a regex, not an enum, so `parsePermissionKey` can only
 * promise `string`. That value therefore has to be narrowed, and the previous
 * `as PermissionAction` cast narrowed nothing: it silenced the compiler on the
 * one catalog row whose derived action was outside the enum (`finance:payment`),
 * which is exactly the class of defect the enum exists to prevent. Narrowing
 * keeps the compiler useful and still fails loudly at module load.
 */
function isPermissionAction(action: string): action is PermissionAction {
  return PERMISSION_ACTION_SET.has(action)
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
  if (!isPermissionAction(parsed.action)) {
    throw new Error(
      `Permission key "${key}" derives action "${parsed.action}", which is not in ` +
        'PERMISSION_ACTIONS. Add the verb to the enum or correct the key — do not cast.',
    )
  }
  return {
    key,
    resource: parsed.resource,
    action: parsed.action,
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
 * handlers ended up unguarded. The third group adds keys for capabilities that
 * exist as models and routes but had no key at all (`timetable`, `grading`,
 * `promotion`, `assessment:publish`, `report:export`).
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
  perm('assessment:publish', 'academic', 'Publish or unpublish an assessment to parents'),
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
  perm('timetable:read', 'academic', 'Read weekly timetables'),
  perm('timetable:update', 'academic', 'Create, edit and delete timetable entries'),
  perm('grading:read', 'academic', 'Read grading scales and grade bands'),
  perm('grading:update', 'academic', 'Create, edit and delete grading scales and bands'),
  perm('promotion:execute', 'academic', 'Promote a class cohort to the next class'),
  // --- finance ---
  perm('finance:create', 'finance', 'Create financial records'),
  perm('finance:read', 'finance', 'Read financial records'),
  perm('finance:update', 'finance', 'Update financial records'),
  perm('finance:delete', 'finance', 'Delete financial records'),
  perm('finance:approve', 'finance', 'Approve financial records'),
  perm('finance:invoice:create', 'finance', 'Create invoices'),
  perm('finance:invoice:delete', 'finance', 'Delete invoices'),
  // LEGACY GRAMMAR — DO NOT RENAME. This is a two-segment key, so its derived
  // action is `payment` rather than `pay`. It is granted in live `Role.permissions`
  // arrays and gates POST /api/finance/invoices/[id]/payments, so renaming it to
  // `finance:payment:pay` would silently open that route. `payment` is therefore
  // in PERMISSION_ACTIONS purely so this row survives its own grammar.
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
  perm('report:export', 'reports', 'Export report data'),
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
  // --- admissions ---
  perm('admissions:read', 'student', 'Read admissions records'),
  perm('admissions:create', 'student', 'Create admissions records'),
  perm('admissions:edit', 'student', 'Edit admissions records'),
  perm('admissions:delete', 'student', 'Delete admissions records'),
  perm('admissions:manage', 'student', 'Manage admissions settings'),
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
 * Academic keys a `CLASSROOM_TEACHER` must not hold, even though they are in the
 * `academic` category.
 *
 * The rule below grants that role the whole academic category minus `delete`,
 * which is the right default for teaching (grade, mark, publish assessments) but
 * wrong for school-wide configuration and cohort decisions. Without this,
 * introducing `grading:update` and `promotion:execute` would have handed every
 * classroom teacher the ability to rewrite the grading policy and promote an
 * entire class. `grading:read` and `timetable:update` stay granted: a teacher
 * needs to see the bands they mark against, and building their own class's
 * timetable is their job.
 */
const CLASSROOM_TEACHER_EXCLUDED = new Set(['grading:update', 'promotion:execute'])

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
    (p.category === 'academic' &&
      p.action !== 'delete' &&
      !CLASSROOM_TEACHER_EXCLUDED.has(p.key)) ||
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
  // Admissions officer: can read/create admissions and related student data
  ADMISSIONS_OFFICER: (p) =>
    p.category === 'student' ||
    p.category === 'communication' ||
    p.key.startsWith('admissions:'),
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
 * Resolution order is explicit key override, then `ROLE_DEFAULT_SCOPE`, then
 * the permission's own `scope`. The middle step exists because the previous
 * fallback was the catalog's `all`, which made an omitted entry a silent
 * decision to expose the entire school. `PARENT` and `CLASSROOM_TEACHER` are
 * inherently limited roles, so for them an omission must narrow, not widen.
 */
export const ROLE_READ_SCOPE: Partial<
  Record<PlatformRoleName, Partial<Record<string, PermissionScope>>>
> = {
  PARENT: {
    'student:read': 'own',
    'enrollment:read': 'own',
    // Attendance for a parent's own child, not the class. `ROLE_GRANT_RULES`
    // does not grant PARENT any attendance key today, so these are inert --
    // but without them, granting one later would have handed every parent in
    // the school the attendance register.
    'attendance:read': 'own',
    'attendance:mark': 'own',
    // School-wide by nature: a parent must see the notices addressed to the
    // whole school. Narrowing these to `own` would show them nothing.
    'communication:read': 'all',
    'announcement:read': 'all',
    'event:read': 'all',
  },
  CLASSROOM_TEACHER: {
    'student:read': 'class',
    'attendance:read': 'class',
    'attendance:mark': 'class',
    'attendance:edit': 'class',
    // A teacher owns their own class's schedule, not the school's. Without this
    // the key's own `all` scope hands every teacher every timetable.
    'timetable:read': 'class',
    // Makes `staffVisibilityWhere` reachable: it narrows the directory to the
    // caller plus the colleagues who teach the caller's own classes. Nothing
    // resolved to `class` for this key before, so the builder was dead code and
    // `GET /api/teachers` returned every employee in the school, contact
    // details included, to any classroom teacher.
    'teacher:read': 'class',
    // Not class data. Every teacher reads the same notices, events and
    // messages, so these stay school-wide.
    'communication:read': 'all',
    'communication:create': 'all',
    'communication:update': 'all',
    'communication:send': 'all',
    'announcement:read': 'all',
    'announcement:create': 'all',
    'announcement:edit': 'all',
    'event:read': 'all',
  },
}

/**
 * The scope a role falls back to when no explicit override exists.
 *
 * Only the inherently limited roles get a narrowing default. Roles that are
 * meant to see the whole school keep `all`, which is also the catalog default,
 * so this table changes nothing for them.
 */
export const ROLE_DEFAULT_SCOPE: Record<PlatformRoleName, PermissionScope> = {
  HEADMASTER: 'all',
  ASSISTANT_HEAD: 'all',
  HEAD_TEACHER: 'all',
  ACCOUNTANT: 'all',
  ADMIN_STAFF: 'all',
  CLASSROOM_TEACHER: 'class',
  PARENT: 'own',
  ADMISSIONS_OFFICER: 'all',
}

export function scopeFor(roleName: string | null | undefined, permissionKey: string): PermissionScope {
  // No role means no claim on anything.
  if (!roleName) return 'custom'
  const role = roleName as PlatformRoleName
  const narrowed = ROLE_READ_SCOPE[role]?.[permissionKey]
  if (narrowed) return narrowed
  // A role that is inherently limited narrows by default, so an unmapped key
  // fails closed. An unrecognised role is not in ROLE_DEFAULT_SCOPE and so
  // falls through to the catalog scope, which is the documented behaviour.
  const roleDefault = ROLE_DEFAULT_SCOPE[role]
  if (roleDefault) return roleDefault
  return PERMISSION_CATALOG_BY_KEY.get(permissionKey)?.scope ?? 'all'
}