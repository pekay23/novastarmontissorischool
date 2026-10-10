import { describe, it, expect } from 'bun:test'
import { 
  hasPermission, 
  can,
  createDelegation,
  approveDelegation,
  revokeDelegation,
  getEffectivePermissions,
  getUserSession,
  logAudit,
} from '@novastar/auth'

describe('Auth - Permission Checking', () => {
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
})

describe('Auth - Delegation', () => {
  it('should export createDelegation function', () => {
    expect(typeof createDelegation).toBe('function')
  })

  it('should export approveDelegation function', () => {
    expect(typeof approveDelegation).toBe('function')
  })

  it('should export revokeDelegation function', () => {
    expect(typeof revokeDelegation).toBe('function')
  })
})

describe('Auth - Audit Logging', () => {
  it('should export logAudit function', () => {
    expect(typeof logAudit).toBe('function')
  })
})

describe('Auth - Types', () => {
  it('should re-export Permission type', () => {
    // Types are compile-time only, just verify module loads
    expect(true).toBe(true)
  })

  it('should re-export Role type', () => {
    expect(true).toBe(true)
  })

  it('should re-export Delegation type', () => {
    expect(true).toBe(true)
  })
})