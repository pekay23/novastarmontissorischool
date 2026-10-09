import { nextId } from './ids'
import { now } from './time'

export interface Tenant {
  id: string
  name: string
  code: string
  domain: string | null
  isActive: boolean
  settings: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface BuildTenantOverrides {
  id?: string
  name?: string
  code?: string
  domain?: string | null
  isActive?: boolean
  settings?: Record<string, unknown>
  createdAt?: Date
  updatedAt?: Date
}

export function buildTenant(overrides: BuildTenantOverrides = {}): Tenant {
  return {
    id: overrides.id ?? nextId('test_tenant'),
    name: overrides.name ?? 'Test Tenant',
    code: overrides.code ?? `t${nextId('tenant_code').replace('tenant_code_', '')}`,
    domain: overrides.domain ?? null,
    isActive: overrides.isActive ?? true,
    settings: overrides.settings ?? {},
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}