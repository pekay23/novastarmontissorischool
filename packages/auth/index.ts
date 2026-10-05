// ============================================================================
// Dynamic RBAC + Delegation System
// ============================================================================

import type { Permission, Role, Delegation } from '@novastar/shared-types'
import { permissionMatches } from '@novastar/shared-types'
import { prisma } from '@novastar/database'

// --- Permission Resolution ---

/**
 * Get all effective permissions for a user, including delegations.
 * Caches results in Redis for performance; re-validates on delegation changes.
 */
export async function getEffectivePermissions(
  userId: string,
  tenantId: string,
  schoolId?: string
): Promise<Set<string>> {
  // 1. Get user's direct role permissions
  const user = await prisma.user.findUnique({
    where: { id: userId, tenantId },
    include: {
      role: true,
    }
  })

  if (!user) return new Set()

  const permissions = new Set<string>()

  // 2. Add role permissions (including inherited roles)
  if (user.role) {
    const rolePerms = await resolveRolePermissions(user.roleId!, tenantId, schoolId)
    rolePerms.forEach(p => permissions.add(p))
  }

  // 3. Add active delegations granted TO this user
  //
  // An absent `schoolId` means "no school in scope", not "any school". `Delegation.schoolId`
  // is non-nullable, so every delegation names exactly one school and there is no
  // tenant-wide delegation to widen into. Prisma DROPS an `undefined` filter, so the
  // previous `schoolId` passed straight through matched delegations from every school in
  // the tenant: a tenant-scoped check such as `hasPermission(user, 'config:write', tenantId)`
  // could be answered by a delegation written for one school. Skipping the read outright is
  // the fail-closed form of that — role permissions still resolve, delegated ones cannot
  // leak in without a school to pin them to.
  const activeDelegations = schoolId
    ? await prisma.delegation.findMany({
        where: {
          toUserId: userId,
          tenantId,
          schoolId,
          isActive: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        select: { permissions: true },
      })
    : []

  for (const delegation of activeDelegations) {
    delegation.permissions.forEach((p: string) => permissions.add(p))
  }

  return permissions
}

/**
 * Recursively resolve all permissions for a role, including inherited roles.
 */
async function resolveRolePermissions(
  roleId: string,
  tenantId: string,
  schoolId?: string,
  visited: Set<string> = new Set()
): Promise<string[]> {
  if (visited.has(roleId)) return [] // prevent circular inheritance
  visited.add(roleId)

  const role = await prisma.role.findUnique({
    where: { id: roleId, tenantId },
  })

  if (!role) return []

  let allPerms: string[] = [...role.permissions]

  // Resolve inherited roles
  if (role.inheritsFrom && role.inheritsFrom.length > 0) {
    for (const parentRoleId of role.inheritsFrom) {
      const parentPerms = await resolveRolePermissions(parentRoleId, tenantId, schoolId, visited)
      allPerms = [...allPerms, ...parentPerms]
    }
  }

  return allPerms
}

// --- Permission Checking ---

/**
 * Check if a user has a specific permission.
 *
 * Matching honours the wildcard grants the delegation layer emits
 * (`academic:*`, `*`). This used to be a bare `Set.has`, which made every
 * wildcard inert: `getDefaultDelegationRules` grants prefix keys, so an
 * ASSISTANT_HEAD delegation of `academic:*` could never match
 * `academic:read` and the delegation silently granted nothing.
 *
 * Wildcards only widen the *action* dimension. Row-level narrowing is a
 * separate concern handled by `apps/portal/lib/visibility.ts`, because a
 * permission set has no way to express "your own records".
 */
export async function hasPermission(
  userId: string,
  permissionKey: string,
  tenantId: string,
  schoolId?: string
): Promise<boolean> {
  const permissions = await getEffectivePermissions(userId, tenantId, schoolId)
  for (const granted of permissions) {
    if (permissionMatches(granted, permissionKey)) return true
  }
  return false
}

/**
 * Check if user can perform an action on a resource.
 */
export async function can(
  userId: string,
  action: string,
  resource: string,
  tenantId: string,
  schoolId?: string
): Promise<boolean> {
  const permissionKey = `${resource}:${action}`
  return hasPermission(userId, permissionKey, tenantId, schoolId)
}

// --- Delegation ---

export interface CreateDelegationInput {
  fromUserId: string
  toUserId: string
  permissions: string[]
  context?: string
  expiresAt?: Date
  tenantId: string
  schoolId: string
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Create a delegation.
 *
 * Whether the delegation needs approval, and how long it may live, are both read
 * from the delegator's own delegation policy — never from the caller. A caller
 * that could pass `requiresApproval: false` was able to self-approve its own
 * delegation, and a caller that passed nothing got `requiresApproval: true`
 * recorded while `isActive` was computed from the same absent field, so the
 * delegation went live anyway. Both are now impossible: the policy decides, and
 * one resolved flag drives the stored value and `isActive` together.
 */
export async function createDelegation(input: CreateDelegationInput): Promise<Delegation> {
  // Verify: fromUser has all delegated permissions
  //
  // Wildcard-aware for the same reason `hasPermission` is. `Set.has` compared the literal
  // key, so a delegator holding `academic:*` could not delegate `academic:read` — which
  // made `getDefaultDelegationRules`' HEADMASTER `['*']` entry unreachable and contradicted
  // the policy check twenty lines below, which does honour wildcards. It failed closed, so
  // this is over-refusal rather than escalation; it just made the feature inert for the one
  // role it is written for.
  const fromUserPerms = await getEffectivePermissions(input.fromUserId, input.tenantId, input.schoolId)
  for (const perm of input.permissions) {
    const held = [...fromUserPerms].some((granted) => permissionMatches(granted, perm))
    if (!held) {
      throw new Error(`Cannot delegate permission "${perm}" — you don't have it`)
    }
  }

  // Verify: the recipient is inside the scope this delegation will be written for.
  //
  // `input.tenantId` and `input.schoolId` are the CALLER's values, so without this check they
  // were stamped onto an arbitrary `toUserId` and a row could hand one school's permissions
  // to a user of another tenant entirely. `Delegation.schoolId` is non-nullable, so a
  // delegation is always about one school; `User.schoolId` is nullable, so a tenant-level
  // recipient sits inside that scope while a recipient of a different school does not.
  const toUser = await prisma.user.findUnique({
    where: { id: input.toUserId, tenantId: input.tenantId },
    select: { id: true, schoolId: true },
  })

  if (!toUser) {
    throw new Error('Recipient not found in this tenant')
  }

  if (toUser.schoolId !== null && toUser.schoolId !== input.schoolId) {
    throw new Error('Recipient is not a member of this school')
  }

  // Check delegation rules for this role
  const fromUser = await prisma.user.findUnique({
    where: { id: input.fromUserId, tenantId: input.tenantId },
    include: { role: true },
  })

  if (!fromUser || !fromUser.role) {
    throw new Error('Source user not found or has no role')
  }

  // Check if delegation rules allow this. `getDelegationRules` resolves a single
  // roleId to at most one rule, so `policy` is that role's rule and is the
  // authority for approval and duration alike.
  const [policy] = await getDelegationRules(fromUser.roleId!, input.tenantId)
  for (const perm of input.permissions) {
    const allowed = policy?.permissions.some(
      (granted) => granted === '*' || permissionMatches(granted, perm)
    )
    if (!allowed) {
      throw new Error(`Your role does not allow delegating "${perm}"`)
    }
  }

  // Resolved once and used for both fields. Deriving `isActive` from anything but
  // this const is the fail-open: the record said "awaiting approval" while the
  // row was handed over anyway.
  const requiresApproval = policy?.requiresApproval ?? true

  // `maxDurationDays` is a ceiling the caller cannot raise. An absent expiry is
  // bounded by the cap too — leaving it null would hand out an open-ended
  // delegation, which is the thing the cap exists to prevent.
  const capMs = policy?.maxDurationDays === undefined ? undefined : policy.maxDurationDays * MS_PER_DAY
  const expiresAt = capMs === undefined
    ? input.expiresAt
    : (() => {
        const latest = new Date(Date.now() + capMs)
        if (!input.expiresAt) return latest
        return input.expiresAt.getTime() > latest.getTime() ? latest : input.expiresAt
      })()

  // Create delegation record
  const delegation = await prisma.delegation.create({
    data: {
      tenantId: input.tenantId,
      schoolId: input.schoolId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      permissions: input.permissions,
      requiresApproval,
      context: input.context,
      expiresAt,
      isActive: !requiresApproval, // active immediately if no approval needed
    },
  })

  return delegation
}

/**
 * Approve a delegation (typically by Headmaster).
 */
export async function approveDelegation(
  delegationId: string,
  approverId: string,
  tenantId: string
): Promise<Delegation> {
  // Verify approver has delegation:approve permission
  const canApprove = await can(approverId, 'delegate', 'delegation', tenantId)
  if (!canApprove) {
    throw new Error('You do not have permission to approve delegations')
  }

  const delegation = await prisma.delegation.update({
    where: { id: delegationId, tenantId },
    data: {
      isActive: true,
      approvedById: approverId,
      approvedAt: new Date(),
    },
  })

  // Log to audit
  await logAudit({
    tenantId,
    userId: approverId,
    action: 'delegation.approve',
    entity: 'Delegation',
    entityId: delegationId,
  })

  return delegation
}

/**
 * Revoke a delegation.
 */
export async function revokeDelegation(
  delegationId: string,
  revokedById: string,
  tenantId: string
): Promise<Delegation> {
  await prisma.delegation.update({
    where: { id: delegationId, tenantId },
    data: { isActive: false },
  })

  await logAudit({
    tenantId,
    userId: revokedById,
    action: 'delegation.revoke',
    entity: 'Delegation',
    entityId: delegationId,
  })

  return prisma.delegation.findUniqueOrThrow({ where: { id: delegationId, tenantId } })
}

// --- Delegation Rules ---

interface DelegationRule {
  roleId: string
  permissions: string[]    // which permissions this role can delegate
  requiresApproval: boolean
  maxDurationDays?: number
}

/** The delegable set for a role, without the row identity attached. */
type DelegationPolicy = Omit<DelegationRule, 'roleId'>

/**
 * The policy for a role that has no entry in the default rules.
 *
 * Fail-closed by construction: `permissions: []` matches nothing, so
 * `createDelegation` denies every permission. The previous
 * `|| ['*']` fallback granted every permission in the catalog to any role the
 * map did not name — `CLASSROOM_TEACHER`, `HEAD_TEACHER`, `ACCOUNTANT`,
 * `ADMIN_STAFF` and every custom role included. A delegation capability that
 * nobody has to be granted explicitly is not a capability.
 *
 * `requiresApproval` stays true and the duration stays at the default: an
 * unrecognised role cannot delegate at all, so these only describe the record
 * that a future explicit configuration would override.
 */
const NO_DELEGATION_POLICY: DelegationPolicy = {
  permissions: [],
  requiresApproval: true,
  maxDurationDays: 30,
}

/**
 * Get delegation rules for a role (from config + database).
 */
async function getDelegationRules(
  roleId: string,
  tenantId: string
): Promise<DelegationRule[]> {
  // Check database for custom rules
  const roles = await prisma.role.findMany({
    where: { tenantId, id: roleId },
  })

  // Merge with default rules from config. Keyed by role NAME: `Role.id` is a
  // cuid (`tools/seed/index.ts` creates roles with an explicit `name` and lets
  // the id be generated), so looking the map up by id never matched and every
  // role — HEADMASTER included — reached the fallback.
  const defaultRules = getDefaultDelegationRules()

  return roles.map(role => ({
    roleId: role.id,
    ...(defaultRules[role.name] ?? NO_DELEGATION_POLICY),
  }))
}

/**
 * Default delegation rules — Headmaster can delegate anything.
 *
 * Keyed by role name. A role absent from this map is NOT implicitly granted
 * the catalog; it resolves to `NO_DELEGATION_POLICY`.
 */
function getDefaultDelegationRules(): Record<string, DelegationPolicy> {
  return {
    HEADMASTER: {
      permissions: ['*'],  // everything
      requiresApproval: false,  // auto-approved
      maxDurationDays: 365,
    },
    ASSISTANT_HEAD: {
      permissions: ['academic:*', 'attendance:*', 'student:*', 'communication:*'],
      requiresApproval: true,
      maxDurationDays: 90,
    },
    ACADEMIC_COORD: {
      permissions: ['academic:*', 'assessment:*', 'student:*'],
      requiresApproval: true,
      maxDurationDays: 60,
    },
    BURSAR: {
      permissions: ['finance:*', 'payment:*', 'fee:*'],
      requiresApproval: true,
      maxDurationDays: 60,
    },
  }
}

// --- Audit Logging ---

interface AuditInput {
  tenantId: string
  schoolId?: string
  userId?: string
  action: string
  entity: string
  entityId?: string
  oldData?: Record<string, unknown>
  newData?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

export async function logAudit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      schoolId: input.schoolId as string,
      userId: input.userId as string,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column type
      oldData: input.oldData as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column type
      newData: input.newData as any,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  })
}

// --- Session Utils ---

/**
 * Assemble the session payload for a user.
 *
 * `schoolId` is threaded into BOTH the delegation count and the permission set. It used to
 * be absent from both, and the two halves disagreed in opposite directions: the count
 * required `expiresAt > now` so it dropped every open-ended delegation, while the
 * permissions came from `getEffectivePermissions(userId, tenantId)` — no school, so it kept
 * open-ended delegations from every school in the tenant. One row could therefore be absent
 * from `delegations` and present in `permissions`. A session has no way to answer "what is
 * this user scoped to" without being told, so both halves now take the same school.
 */
export async function getUserSession(userId: string, tenantId: string, schoolId?: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId, tenantId },
    include: {
      role: true,
      delegationsFrom: true,
      delegationsTo: {
        // The same definition of "active" as `getEffectivePermissions`, and the same school
        // handling: a session asked for one school counts only that school's delegations.
        where: {
          isActive: true,
          ...(schoolId ? { schoolId } : {}),
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      },
    },
  })

  if (!user) return null

  const permissions = await getEffectivePermissions(userId, tenantId, schoolId)

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role?.name || null,
      roleId: user.roleId,
    },
    permissions: Array.from(permissions),
    delegations: user.delegationsTo.length,
  }
}

// --- Re-export ---
export type { Permission, Role, Delegation }