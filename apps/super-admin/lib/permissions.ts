import { PermissionKeySchema, permissionMatches } from '@novastar/shared-types'

/**
 * Operator capabilities, in the canonical permission grammar.
 *
 * There is deliberately no second permission vocabulary in this app. Every key
 * below is validated at module load by `PermissionKeySchema`, the same parser
 * `@novastar/shared-types` uses for every seeded `Permission.key` and the same
 * `permissionMatches` function `@novastar/auth`'s `hasPermission` matches with,
 * so a key written here cannot drift from the platform's grammar and a wildcard
 * grant behaves identically here and in the portal.
 *
 * What is NOT reused is the catalog itself. `PERMISSION_CATALOG` has no
 * tenant-lifecycle keys — it describes what a member of a *school* may do, and
 * a platform operator is not a member of any school. Adding keys to the catalog
 * would mean editing `packages/shared-types/permission-keys.ts`, which belongs to
 * another workspace. So the cross-tenant capabilities live here, in the same
 * grammar, and the honest follow-up is a migration that promotes them into the
 * catalog. See the README.
 */
export const OPERATOR_CAPABILITIES = [
  /** Read the platform overview: tenant and school counts, deployment health. */
  'platform:read',
  /** Read the cross-tenant audit log. */
  'platform:audit',
  /** List tenants and read one tenant's detail, schools and users. */
  'tenant:read',
  /** Change a tenant's mutable fields and its `isActive` flag. */
  'tenant:update',
  /** Create or update a tenant, its first school and its first administrator. */
  'tenant:provision',
  /** Read and write `Tenant.settings` and `School.settings`. */
  'tenant:config',
  /** Read a tenant's user directory and each user's effective permissions. */
  'tenant:user:read',
  /**
   * Create a school-level account inside a tenant, in the invited state, and send
   * its one-time setup link.
   *
   * Split from `tenant:user:read` rather than folded into it: reading a directory is
   * something every operator who can see a school should be able to do, while minting
   * an account is the thing a school hands to a new head, a new accountant or a new
   * teacher. One capability for both would mean either refusing reads to a narrow
   * operator or handing account creation to every operator who can browse a roster.
   *
   * It does NOT cover replacing or resetting an existing account, and that is a
   * separate capability (`tenant:user:update`) if it is ever written. The operations
   * are not the same: a create adds an account nobody has, while a reset revokes a
   * credential somebody is using right now, invalidates their sessions and forces
   * them to set a new password. It deserves its own grant, its own audit action and
   * its own confirmation, and the honest failure mode of shipping them as one
   * capability is that `tenant:user:create` quietly becomes "reset any teacher in
   * any tenant". There is no plaintext-password path here at all: the only way an
   * operator grants someone access is to have them choose their own password through
   * a single-use link.
   */
  'tenant:user:create',
  /** Edit/update an existing school-level account and reactivate/reactivate. */
  'tenant:user:update',
  /** Create a new school within a tenant. */
  'tenant:school:create',
  /** Edit an existing school's full profile. */
  'tenant:school:update',
  /** Remove a school from a tenant (refused if students or staff exist). */
  'tenant:school:delete',
] as const

export type OperatorCapability = (typeof OPERATOR_CAPABILITIES)[number]

const OPERATOR_CAPABILITY_SET: ReadonlySet<string> = new Set(OPERATOR_CAPABILITIES)

/** Narrow an arbitrary string to a real capability, or `null`. */
export function parseOperatorCapability(value: string | null | undefined): OperatorCapability | null {
  if (!value) return null
  return OPERATOR_CAPABILITY_SET.has(value) ? (value as OperatorCapability) : null
}

/**
 * Fail at module load rather than shipping a key the rest of the platform's
 * parser would reject.
 */
for (const capability of OPERATOR_CAPABILITIES) {
  if (!PermissionKeySchema.safeParse(capability).success) {
    throw new Error(
      `Malformed operator capability "${capability}". It must satisfy PermissionKeySchema — ` +
        'add it to the catalog in packages/shared-types rather than bypassing the grammar.',
    )
  }
}

/**
 * What a signed-in operator holds.
 *
 * Deny-by-default: this is an allowlist, so a capability that is not named here
 * and is not covered by one of these keys through `permissionMatches` is refused.
 * There is no "implied superuser" path and no `isAdmin` boolean that bypasses
 * this set.
 */
export const OPERATOR_GRANTS: readonly string[] = OPERATOR_CAPABILITIES

/**
 * Whether `granted` satisfies `requested`.
 *
 * `granted` is the operator's grant list; `requested` is what a route is about
 * to do. Wildcard matching comes from `permissionMatches`, so `tenant:*` covers
 * `tenant:provision` here exactly as it would inside `@novastar/auth`.
 */
export function hasOperatorCapability(
  granted: readonly string[],
  requested: OperatorCapability,
): boolean {
  return granted.some((key) => permissionMatches(key, requested))
}

/**
 * Asserts a capability or throws `ForbiddenError`. Routes call this rather than
 * branching, so a route that forgets the check fails the call rather than
 * rendering an empty page.
 */
export function assertOperatorCapability(
  granted: readonly string[],
  requested: OperatorCapability,
  forbidden: () => Error,
): void {
  if (!hasOperatorCapability(granted, requested)) throw forbidden()
}

/** Every capability, for the UI. A capability list is not a secret. */
export function listOperatorCapabilities(): readonly OperatorCapability[] {
  return OPERATOR_CAPABILITIES
}
