import { PERMISSION_KEYS } from '@novastar/shared-types'

/**
 * Declarative mapping of API route prefixes to the permission key they
 * require. Used by the admin UI at `/settings/permissions` to render
 * a "what does this permission gate?" view, and consultable at runtime
 * via `requiredPermissionForPath()`.
 *
 * This is documentation-grade: handler-side permission checks remain authoritative.
 * Treat divergence between this table and an actual route as a code-review red flag.
 *
 * ## Vocabulary
 *
 * Every `permission` below is a key from `PERMISSION_CATALOG` in
 * `@novastar/shared-types`, which is the single source of truth for what the
 * platform ships and what each role holds. This table used to define a second,
 * parallel vocabulary of dot-cased keys (`payments.approve`, `users.manage`, …).
 * Nothing granted those keys, so `hasPermission(userId, 'payments.approve', …)`
 * could never succeed: the table was consulted at runtime and every lookup
 * through it failed. The dot vocabulary has been deleted rather than mapped onto
 * itself.
 *
 * A test in `tests/middleware.test.ts` asserts every key reachable through
 * `requiredPermissionForPath` exists in `PERMISSION_CATALOG`, and the assertion
 * below fails at module load if that ever stops being true.
 */
export interface RoutePermissionBinding {
  /** URL prefix match. */
  prefix: string
  /** Permission key required to call the route. */
  permission: string
  /** Optional brief label for the admin UI. */
  description?: string
}

/**
 * Fail at module load rather than shipping a binding that no grant can satisfy.
 *
 * This is the runtime half of the drift guard; the test is the other half. It
 * is deliberately loud — a table whose keys are unsatisfiable is worse than no
 * table, because it reads as authoritative.
 */
function assertCatalogKeys(): void {
  const catalog = new Set<string>(PERMISSION_KEYS)
  const unknown = ROUTE_PERMISSION_BINDINGS.map((b) => b.permission).filter(
    (p) => !catalog.has(p),
  )
  if (unknown.length > 0) {
    throw new Error(
      `permission-routes: ${unknown.join(', ')} not in PERMISSION_CATALOG. ` +
        'Every binding must name a key the catalog actually ships and grants.',
    )
  }
}

/**
 * Capabilities this table used to name that the product does not have.
 *
 * `exams.*`, `referrals.*` and `gdpr.*` were deleted rather than mapped: there
 * is no exam, referral or GDPR feature in the schema, routes or catalog, so any
 * mapping would have asserted a gate on nothing. They come back when the
 * features do, in the catalog's colon grammar.
 */
export const UNIMPLEMENTED_CAPABILITIES = {
  exams: 'No exam, question-bank, seating or session feature exists yet.',
  referrals: 'No referral or admissions-pipeline feature exists yet.',
  gdpr: 'No data-subject request feature exists yet.',
} as const

export const ROUTE_PERMISSION_BINDINGS: RoutePermissionBinding[] = [
  // Finance — was `payments.approve`
  {
    prefix: '/api/staff/payments',
    permission: 'finance:approve',
    description: 'Approve/reject payment proofs',
  },

  // Users — was `users.manage`, the one binding that mapped cleanly onto a
  // distinct catalog key: the route creates a staff account.
  {
    prefix: '/api/staff/users/create',
    permission: 'staff:create',
    description: 'Create staff accounts',
  },
  // Was `roles.manage`. The catalog has no role-management key, so this shares
  // the single system-administration key. A dedicated `role:update` would be
  // the honest fix if role assignment is ever split from system settings.
  {
    prefix: '/api/staff/users/[id]/role',
    permission: 'system:manage',
    description: "Change a user's role",
  },

  // Enrollments — was `enrollments.manage`. `enrollment:create` is the catalog's
  // only enrollment write verb; there is no `enrollment:update` for the "edit"
  // half of the original description.
  {
    prefix: '/api/staff/enrollments',
    permission: 'enrollment:create',
    description: 'Approve/edit enrollments',
  },

  // Governance — was `audit.logs.view` and `settings.manage`. Both are
  // system-administration capabilities under the catalog's single `system`
  // resource.
  {
    prefix: '/api/staff/audit-logs',
    permission: 'system:manage',
    description: 'Read audit trail',
  },
  {
    prefix: '/api/staff/settings',
    permission: 'system:manage',
    description: 'Edit system settings',
  },
]

assertCatalogKeys()

/** `/api/staff/users/[id]/role` — one path segment standing for any value. */
const DYNAMIC_SEGMENT = /^\[[^/]+\]$/

/**
 * Match a pathname against a binding prefix, segment by segment.
 *
 * The previous implementation rewrote `[id]` to `*` and then deleted every `*`,
 * which also deleted the slash around it: `/api/staff/users/[id]/role` became
 * `/api/staff/users//role` and could never match a real pathname. Any binding
 * with a dynamic segment was silently dead, and a dead binding in an
 * authoritative-looking table is worse than no table at all.
 */
export function requiredPermissionForPath(pathname: string): RoutePermissionBinding | null {
  // A query string is not part of the route being matched.
  const segments = pathname.split('?')[0]?.split('/') ?? []

  const matches = ROUTE_PERMISSION_BINDINGS.filter((binding) => {
    const prefix = binding.prefix.split('/')
    if (prefix.length > segments.length) return false
    return prefix.every(
      (segment, i) => DYNAMIC_SEGMENT.test(segment) || segment === segments[i],
    )
  })
  if (matches.length === 0) return null
  // Longest prefix wins
  return matches.sort((a, b) => b.prefix.length - a.prefix.length)[0]
}