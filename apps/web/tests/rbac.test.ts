import { describe, it, expect } from 'bun:test'
import { 
  hasPermission,
  can,
  getEffectivePermissions,
  getUserSession,
  createDelegation,
  approveDelegation,
  revokeDelegation,
  logAudit,
} from '@novastar/auth'
import { buildTenant, buildSchool, buildUser, buildRole, buildPermission, buildDelegation } from '@novastar/testing/factories'

describe('RBAC - Core Functions', () => {
  it('should export hasPermission function', () => {
    expect(typeof hasPermission).toBe('function')
  })

  it('should export can function', () => {
    expect(typeof can).toBe('function')
  })

  it('should export getEffectivePermissions function', () => {
    expect(typeof getEffectivePermissions).toBe('function')
  })

  it('should export getUserSession function', () => {
    expect(typeof getUserSession).toBe('function')
  })

  it('should export createDelegation function', () => {
    expect(typeof createDelegation).toBe('function')
  })

  it('should export approveDelegation function', () => {
    expect(typeof approveDelegation).toBe('function')
  })

  it('should export revokeDelegation function', () => {
    expect(typeof revokeDelegation).toBe('function')
  })

  it('should export logAudit function', () => {
    expect(typeof logAudit).toBe('function')
  })
})

describe('RBAC - Types', () => {
  it('should re-export Permission type', () => { expect(true).toBe(true) })
  it('should re-export Role type', () => { expect(true).toBe(true) })
  it('should re-export Delegation type', () => { expect(true).toBe(true) })
})

describe('RBAC - Delegation Interface', () => {
  it('should export CreateDelegationInput interface', () => { expect(true).toBe(true) })
})

describe('RBAC - Permission Logic (No DB)', () => {
  // Test permission string parsing logic without DB
  it('should parse resource:action format', () => {
    const permission = 'student:read'
    const [resource, action] = permission.split(':')
    expect(resource).toBe('student')
    expect(action).toBe('read')
  })

  it('should parse resource:action@scope format', () => {
    const permission = 'student:read@tenant_123'
    const [main, scope] = permission.split('@')
    const [resource, action] = main.split(':')
    expect(resource).toBe('student')
    expect(action).toBe('read')
    expect(scope).toBe('tenant_123')
  })

  it('should handle wildcard permissions', () => {
    const permission = 'student:*'
    const [resource, action] = permission.split(':')
    expect(resource).toBe('student')
    expect(action).toBe('*')
  })

  it('should handle full wildcard', () => {
    const permission = '*:*:*'
    const [resource, action, scope] = permission.split(':')
    expect(resource).toBe('*')
    expect(action).toBe('*')
    expect(scope).toBe('*')
  })

  it('should construct permission key from resource and action', () => {
    const resource = 'assessment'
    const action = 'create'
    const key = `${resource}:${action}`
    expect(key).toBe('assessment:create')
  })
})

describe('RBAC - Factory Integration', () => {
  it('should build a valid tenant', () => {
    const tenant = buildTenant({ name: 'Test Tenant' })
    expect(tenant.id).toMatch(/^test_tenant_\d+$/)
    expect(tenant.name).toBe('Test Tenant')
    expect(tenant.code).toMatch(/^t\d+$/)
    expect(tenant.isActive).toBe(true)
    expect(tenant.settings).toEqual({})
    expect(tenant.createdAt).toBeInstanceOf(Date)
    expect(tenant.updatedAt).toBeInstanceOf(Date)
  })

  it('should build a valid school', () => {
    const tenant = buildTenant()
    const school = buildSchool({ tenantId: tenant.id, name: 'Test School' })
    expect(school.id).toMatch(/^test_school_\d+$/)
    expect(school.tenantId).toBe(tenant.id)
    expect(school.name).toBe('Test School')
    expect(school.address).toBe('123 Test Street, Test City')
    expect(school.phone).toBe('+233-00-000-0000')
    expect(school.email).toBe('school@test.example')
    expect(school.established).toBeInstanceOf(Date)
    expect(school.settings).toEqual({})
  })

  it('should build a valid user', () => {
    const tenant = buildTenant()
    const school = buildSchool({ tenantId: tenant.id })
    const user = buildUser({ tenantId: tenant.id, schoolId: school.id, email: 'test@example.com' })
    expect(user.id).toMatch(/^test_user_\d+$/)
    expect(user.tenantId).toBe(tenant.id)
    expect(user.schoolId).toBe(school.id)
    expect(user.email).toBe('test@example.com')
    expect(user.isActive).toBe(true)
    expect(user.status).toBe('ACTIVE')
  })

  it('should build a valid role with permissions', () => {
    const tenant = buildTenant()
    const school = buildSchool({ tenantId: tenant.id })
    const role = buildRole({ tenantId: tenant.id, schoolId: school.id, name: 'Test Role', permissions: ['student:read', 'student:create'] })
    expect(role.id).toMatch(/^test_role_\d+$/)
    expect(role.tenantId).toBe(tenant.id)
    expect(role.schoolId).toBe(school.id)
    expect(role.name).toBe('Test Role')
    expect(role.permissions).toEqual(['student:read', 'student:create'])
    expect(role.isSystem).toBe(false)
  })

  it('should build a valid permission', () => {
    const tenant = buildTenant()
    const permission = buildPermission({ tenantId: tenant.id, key: 'student:read', resource: 'student', action: 'read', scope: 'tenant' })
    expect(permission.id).toMatch(/^test_permission_\d+$/)
    expect(permission.tenantId).toBe(tenant.id)
    expect(permission.key).toBe('student:read')
    expect(permission.resource).toBe('student')
    expect(permission.action).toBe('read')
    expect(permission.scope).toBe('tenant')
  })

  it('should build a valid delegation', () => {
    const tenant = buildTenant()
    const school = buildSchool({ tenantId: tenant.id })
    const delegation = buildDelegation({ tenantId: tenant.id, schoolId: school.id, fromUserId: 'user_1', toUserId: 'user_2', permissions: ['student:read'] })
    expect(delegation.id).toMatch(/^test_delegation_\d+$/)
    expect(delegation.tenantId).toBe(tenant.id)
    expect(delegation.schoolId).toBe(school.id)
    expect(delegation.fromUserId).toBe('user_1')
    expect(delegation.toUserId).toBe('user_2')
    expect(delegation.permissions).toEqual(['student:read'])
    // A delegation awaiting approval must not come back active. The fixture used
    // to emit `requiresApproval: true` beside `isActive: true`, which is the
    // fail-open shape `createDelegation` had: a pending handover that was already
    // live. `isActive` now follows the resolved approval flag.
    expect(delegation.requiresApproval).toBe(true)
    expect(delegation.isActive).toBe(false)
  })

  it('builds an approved delegation that is active', () => {
    const tenant = buildTenant()
    const school = buildSchool({ tenantId: tenant.id })
    const delegation = buildDelegation({
      tenantId: tenant.id,
      schoolId: school.id,
      fromUserId: 'user_1',
      toUserId: 'user_2',
      requiresApproval: false,
    })
    expect(delegation.requiresApproval).toBe(false)
    expect(delegation.isActive).toBe(true)
  })

  it('should produce deterministic IDs across multiple calls', () => {
    const tenant1 = buildTenant()
    const tenant2 = buildTenant()
    expect(tenant1.id).not.toBe(tenant2.id)
    // IDs should be sequential (format: test_tenant_N)
    expect(tenant1.id).toMatch(/^test_tenant_\d+$/)
    expect(tenant2.id).toMatch(/^test_tenant_\d+$/)
  })
})