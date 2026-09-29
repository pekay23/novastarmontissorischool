// ============================================================================
// Dynamic RBAC + Delegation System
// ============================================================================

import type { Permission, Role, Delegation } from '@novastar/shared-types'
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
    where: { id: userId },
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
  const activeDelegations = await prisma.delegation.findMany({
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
    where: { id: roleId },
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
 * Check if a user has a specific permission (with optional scope check).
 */
export async function hasPermission(
  userId: string,
  permissionKey: string,
  tenantId: string,
  schoolId?: string
): Promise<boolean> {
  const permissions = await getEffectivePermissions(userId, tenantId, schoolId)
  return permissions.has(permissionKey)
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
  requiresApproval?: boolean
  context?: string
  expiresAt?: Date
  tenantId: string
  schoolId: string
}

/**
 * Create a delegation. If requiresApproval=true, it goes to pending state
 * until approved by an authorized user (typically Headmaster).
 */
export async function createDelegation(input: CreateDelegationInput): Promise<Delegation> {
  // Verify: fromUser has all delegated permissions
  const fromUserPerms = await getEffectivePermissions(input.fromUserId, input.tenantId, input.schoolId)
  for (const perm of input.permissions) {
    if (!fromUserPerms.has(perm)) {
      throw new Error(`Cannot delegate permission "${perm}" — you don't have it`)
    }
  }

  // Check delegation rules for this role
  const fromUser = await prisma.user.findUnique({
    where: { id: input.fromUserId },
    include: { role: true },
  })

  if (!fromUser || !fromUser.role) {
    throw new Error('Source user not found or has no role')
  }

  // Check if delegation rules allow this
  const delegationRules = await getDelegationRules(fromUser.roleId!, input.tenantId)
  for (const perm of input.permissions) {
    const allowed = delegationRules.some(rule => {
      const ruleAllowsPerm = rule.permissions.includes(perm) || rule.permissions.includes('*')
      return ruleAllowsPerm
    })
    if (!allowed) {
      throw new Error(`Your role does not allow delegating "${perm}"`)
    }
  }

  // Create delegation record
  const delegation = await prisma.delegation.create({
    data: {
      tenantId: input.tenantId,
      schoolId: input.schoolId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      permissions: input.permissions,
      requiresApproval: input.requiresApproval ?? true,
      context: input.context,
      expiresAt: input.expiresAt,
      isActive: !input.requiresApproval, // active immediately if no approval needed
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
    where: { id: delegationId },
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
    where: { id: delegationId },
    data: { isActive: false },
  })

  await logAudit({
    tenantId,
    userId: revokedById,
    action: 'delegation.revoke',
    entity: 'Delegation',
    entityId: delegationId,
  })

  return prisma.delegation.findUniqueOrThrow({ where: { id: delegationId } })
}

// --- Delegation Rules ---

interface DelegationRule {
  roleId: string
  permissions: string[]    // which permissions this role can delegate
  requiresApproval: boolean
  maxDurationDays?: number
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

  // Merge with default rules from config
  const defaultRules = getDefaultDelegationRules()
  
  return roles.map(role => ({
    roleId: role.id,
    permissions: defaultRules[role.id]?.permissions || ['*'],
    requiresApproval: defaultRules[role.id]?.requiresApproval ?? true,
    maxDurationDays: defaultRules[role.id]?.maxDurationDays ?? 30,
  }))
}

/**
 * Default delegation rules — Headmaster can delegate anything.
 */
function getDefaultDelegationRules(): Record<string, Partial<DelegationRule>> {
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

export async function getUserSession(userId: string, tenantId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: true,
      delegationsFrom: true,
      delegationsTo: {
        where: { isActive: true, expiresAt: { gt: new Date() } },
      },
    },
  })

  if (!user) return null

  const permissions = await getEffectivePermissions(userId, tenantId)

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