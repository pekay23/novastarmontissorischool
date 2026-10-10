import { PLATFORM_AUDIT_SCOPE, writeAuditEntry, type AuditWrite } from '@/lib/queries'

/**
 * Audit actions this console writes.
 *
 * A closed set on purpose. `AuditLog.action` is a free `String`, so the platform
 * already contains entries no code path can produce; adding another way to spell
 * "the operator changed something" makes the log harder to query, not easier.
 *
 * PARITY WITH THE PORTAL IS PARTIAL, AND THAT IS KNOWN. The portal's
 * `AuditLogAction` (an enum) carries `LOGIN`, `LOGIN_FAILED`, `LOGOUT`,
 * `SYSTEM_UPDATE`, `CREATE`, `READ`, `UPDATE`, `DELETE` and a handful of domain
 * events. This console shares the first three by value — same strings, because
 * the auth routes were written to match — and `SYSTEM_UPDATE` by value too,
 * though nothing here writes it. There is no `CREATE`, `UPDATE`, `DELETE` or
 * `READ` here: this console has never logged a read, and its writes are the
 * tenant lifecycle, invites, and sign-in. Do not read this table as a vocabulary
 * the portal is a subset of. A cross-app query that unions the two trails buckets
 * reads under `READ` from the portal and under nothing from here, and that is the
 * real state, not a gap to close by adding a member nobody emits.
 */
export const AdminAuditAction = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  /** A tenant was provisioned — created, or reconciled onto an existing code. */
  TENANT_PROVISION: 'TENANT_PROVISION',
  TENANT_UPDATE: 'TENANT_UPDATE',
  TENANT_SUSPEND: 'TENANT_SUSPEND',
  TENANT_REACTIVATE: 'TENANT_REACTIVATE',
  TENANT_SETTING_UPDATE: 'TENANT_SETTING_UPDATE',
  /**
   * A school-level account was created in a tenant, in the invited state.
   *
   * One action for both outcomes, with `changes.setupEmail` carrying whether the
   * one-time setup link was delivered. Two actions would mean an auditor asking
   * "which invitations failed?" had to know that the absence of an entry meant
   * success, which is the inference a hash-chained log is worst at.
   */
  TENANT_USER_CREATE: 'TENANT_USER_CREATE',
  SYSTEM_UPDATE: 'SYSTEM_UPDATE',
} as const

export type AdminAuditActionName = (typeof AdminAuditAction)[keyof typeof AdminAuditAction]

/** What a `TENANT_PROVISION` entry records about the shared call's outcome. */
export interface ProvisionAuditSummary {
  readonly created: boolean
  readonly tenantId: string
  readonly tenantCode: string
  readonly schoolId: string
  readonly adminEmail: string | null
  readonly permissionsCreated: number
  readonly rolesCreated: number
}

/**
 * Files one audit entry for a tenant-scoped action.
 *
 * The tenant is a required argument rather than something read from a session,
 * because the console has no session tenant. `schoolId` is optional and defaults
 * to the platform sentinel: most of what an operator does is tenant-wide (a
 * tenant's `isActive`, its `settings`), and forcing every caller to invent a
 * school would put a wrong value in the column more often than a right one.
 */
export async function auditTenantAction(
  input: Omit<AuditWrite, 'tenantId' | 'schoolId'> & {
    tenantId: string
    schoolId?: string | null
  },
): Promise<void> {
  await writeAuditEntry({
    ...input,
    schoolId: input.schoolId ?? PLATFORM_AUDIT_SCOPE,
  })
}

/**
 * Files one audit entry for an action that is about the console itself — a sign-in
 * or a refusal. There is no tenant to attribute it to, so the platform sentinel
 * is used on both columns rather than leaving a plausible-looking id behind.
 *
 * `operatorId` still rides on the caller's object untouched: a console action is
 * about the platform, not about a tenant, but it is still done *by somebody* and
 * the operator is that somebody. Both auth routes pass it — the sign-out from the
 * verified token, the sign-in from the account it just authenticated — and the
 * refusal deliberately passes none, because a refused attempt may not have named a
 * real operator.
 */
export async function auditPlatformAction(
  input: Omit<AuditWrite, 'tenantId' | 'schoolId'>,
): Promise<void> {
  await writeAuditEntry({
    ...input,
    tenantId: PLATFORM_AUDIT_SCOPE,
    schoolId: PLATFORM_AUDIT_SCOPE,
  })
}
