import { nextId } from '../ids'
import { now } from '../time'

export interface BuildRoleOverrides {
  id?: string
  tenantId?: string
  schoolId?: string | null
  name?: string
  description?: string | null
  isSystem?: boolean
  permissions?: string[]
  inheritsFrom?: string[]
  createdAt?: Date
  updatedAt?: Date
}

export function buildRole(overrides: BuildRoleOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? nextId('test_role'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? null,
    name: overrides.name ?? 'Test Role',
    description: overrides.description ?? null,
    isSystem: overrides.isSystem ?? false,
    permissions: overrides.permissions ?? ['student:read', 'student:create'],
    inheritsFrom: overrides.inheritsFrom ?? [],
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildPermissionOverrides {
  id?: string
  tenantId?: string
  key?: string
  description?: string
  category?: string
  resource?: string
  action?: string
  scope?: string
  isSystem?: boolean
  schoolId?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export function buildPermission(overrides: BuildPermissionOverrides = {}): Record<string, unknown> {
  const key = overrides.key ?? 'student:read'
  const [resource, actionScope] = key.split(':')
  const [action, scope] = actionScope?.split('@') ?? ['read', 'tenant']
  return {
    id: overrides.id ?? nextId('test_permission'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    key,
    description: overrides.description ?? 'Read student records',
    category: overrides.category ?? 'academic',
    resource: overrides.resource ?? resource,
    action: overrides.action ?? action,
    scope: overrides.scope ?? scope,
    isSystem: overrides.isSystem ?? false,
    schoolId: overrides.schoolId ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildDelegationOverrides {
  id?: string
  tenantId?: string
  schoolId?: string
  fromUserId?: string
  toUserId?: string
  permissions?: string[]
  requiresApproval?: boolean
  context?: string | null
  expiresAt?: Date | null
  isActive?: boolean
  approvedById?: string | null
  approvedAt?: Date | null
  createdAt?: Date
  updatedAt?: Date
}

export function buildDelegation(overrides: BuildDelegationOverrides = {}): Record<string, unknown> {
  // Resolved once so the fixture cannot hand back a row that contradicts itself.
  // The previous `isActive: overrides.isActive ?? true` paired an active flag with
  // `requiresApproval: true` by default, so a "pending approval" delegation came
  // back usable — the same fail-open shape `createDelegation` had in production.
  const requiresApproval = overrides.requiresApproval ?? true

  return {
    id: overrides.id ?? nextId('test_delegation'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? nextId('test_school'),
    fromUserId: overrides.fromUserId ?? nextId('test_user'),
    toUserId: overrides.toUserId ?? nextId('test_user_2'),
    permissions: overrides.permissions ?? ['student:read', 'student:create'],
    requiresApproval,
    context: overrides.context ?? null,
    expiresAt: overrides.expiresAt ?? null,
    isActive: overrides.isActive ?? !requiresApproval,
    approvedById: overrides.approvedById ?? null,
    approvedAt: overrides.approvedAt ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}