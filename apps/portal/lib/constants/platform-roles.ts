/**
 * Platform-level role constants.
 *
 * These mirror the role names created by the seed utility
 * (`tools/seed/index.ts`, the `systemRoles` array). Keep them in sync — a
 * name here that does not exist in the database can never match at runtime,
 * and nothing catches that at compile time because `Role.name` is a plain
 * `String` in the Prisma schema.
 */
export const PLATFORM_ROLES = {
  HEADMASTER: 'HEADMASTER',
  ASSISTANT_HEAD: 'ASSISTANT_HEAD',
  HEAD_TEACHER: 'HEAD_TEACHER',
  CLASSROOM_TEACHER: 'CLASSROOM_TEACHER',
  ACCOUNTANT: 'ACCOUNTANT',
  ADMIN_STAFF: 'ADMIN_STAFF',
  PARENT: 'PARENT',
} as const

export type PlatformRole = (typeof PLATFORM_ROLES)[keyof typeof PLATFORM_ROLES]

/**
 * Roles permitted to access the Head of School platform configuration pages
 * (`/settings/platform/*`) and their API routes.
 */
export const PLATFORM_ADMIN_ROLES: readonly PlatformRole[] = [PLATFORM_ROLES.HEADMASTER]

/**
 * Roles permitted to read or administer another user's security settings
 * (2FA, passkeys, lockout) and to read the tenant audit log.
 *
 * Note: these routes previously compared against a role named `ADMIN`, which
 * the seed never creates — so they denied every caller, including the
 * Head of School. The check is against these real seeded names now.
 */
export const USER_SECURITY_ADMIN_ROLES: readonly PlatformRole[] = [
  PLATFORM_ROLES.HEADMASTER,
  PLATFORM_ROLES.ASSISTANT_HEAD,
  PLATFORM_ROLES.ADMIN_STAFF,
]

/** Whether a session role may administer another user's security settings. */
export function isUserSecurityAdmin(role: PlatformRole | null): boolean {
  return role !== null && USER_SECURITY_ADMIN_ROLES.includes(role)
}

/**
 * Narrow an arbitrary `Role.name` string from the database to a known
 * platform role. Returns `null` for any name that is not a real role, so
 * callers never have to guess whether a string is a valid role.
 */
export function parsePlatformRole(roleName: string | null | undefined): PlatformRole | null {
  if (!roleName) return null
  return PLATFORM_ROLES[roleName as PlatformRole] ?? null
}

/**
 * Whether a session role may access platform configuration routes.
 * Takes the already-narrowed role from the session context, so `null`
 * (unauthenticated or unrecognised role) is denied rather than cast away.
 */
export function isPlatformAdmin(role: PlatformRole | null): boolean {
  return role !== null && PLATFORM_ADMIN_ROLES.includes(role)
}
