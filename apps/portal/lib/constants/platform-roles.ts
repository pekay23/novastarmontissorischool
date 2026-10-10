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
  ADMISSIONS_OFFICER: 'ADMISSIONS_OFFICER',
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
 * Roles permitted to sign in without a verified email address.
 *
 * WHY ONLY THE HEAD OF SCHOOL
 * --------------------------
 * This is the break-glass list, and the reason it exists is lockout, not
 * convenience. `tools/seed` and `tools/tenant-cli` provision administrator
 * accounts directly: a password hash, no verification token, and no way to mint
 * one, because a deployment that has not configured email delivery could never
 * complete the loop. Requiring verification for these accounts would mean a
 * freshly provisioned deployment cannot reach its own portal — and an operator
 * locked out of the Head of School account is the exact scenario an admin
 * account exists to survive.
 *
 * Everything else must verify, and gets a link. A teacher, accountant or parent
 * created through the portal is sent a one-time setup link instead, so "verify
 * your email" is a step they complete once rather than a wall.
 *
 * The previous check in `lib/auth.ts` read `['HEADMASTER', 'STAFF']`. `STAFF` is
 * not a seeded role name — the seed writes the seven in `PLATFORM_ROLES` above —
 * so the exemption silently applied to the Head of School only, while reading as
 * though every member of staff were covered. The intent is now the list above,
 * stated where it can be checked against the seeded names.
 */
export const EMAIL_VERIFICATION_EXEMPT_ROLES: readonly PlatformRole[] = [PLATFORM_ROLES.HEADMASTER]

/** Whether a session role may sign in with an unverified email address. */
export function isEmailVerificationExempt(role: PlatformRole | null): boolean {
  return role !== null && EMAIL_VERIFICATION_EXEMPT_ROLES.includes(role)
}

/**
 * Roles permitted to open and close this school's admissions.
 *
 * WIDER THAN `PLATFORM_ADMIN_ROLES`, AND DELIBERATELY SO
 * ---------------------------------------------------
 * Whether this school is taking applications right now is a per-tenant
 * operational decision, not platform infrastructure. The Head of School decides
 * it every intake window, and the person doing the intake — an admissions
 * officer, or front-office admin staff fielding calls from parents — is the one
 * who knows when the window opens and closes. Requiring the Head of School to
 * make each toggle means the flag is closed when no one is at the top, which
 * reads to a parent community as "the school is not enrolling".
 *
 * Every member of that wider set is authorised *per tenant*: the caller already
 * resolved `tenantId` from their own session, so this list widens who may act
 * within a school, never which school they may act on.
 */
export const ADMISSIONS_MANAGER_ROLES: readonly PlatformRole[] = [
  PLATFORM_ROLES.HEADMASTER,
  PLATFORM_ROLES.ADMIN_STAFF,
  PLATFORM_ROLES.ADMISSIONS_OFFICER,
]

/** Whether a session role may open or close this tenant's admissions. */
export function canManageAdmissions(role: PlatformRole | null): boolean {
  return role !== null && ADMISSIONS_MANAGER_ROLES.includes(role)
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
