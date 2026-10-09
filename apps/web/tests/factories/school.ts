import { nextId } from './ids'
import { now } from './time'

export interface School {
  id: string
  tenantId: string
  name: string
  code: string
  address: string
  phone: string
  email: string
  logoUrl: string | null
  motto: string | null
  established: Date
  settings: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface BuildSchoolOverrides {
  id?: string
  tenantId?: string
  name?: string
  code?: string
  address?: string
  phone?: string
  email?: string
  logoUrl?: string | null
  motto?: string | null
  established?: Date
  settings?: Record<string, unknown>
  createdAt?: Date
  updatedAt?: Date
}

export function buildSchool(overrides: BuildSchoolOverrides = {}): School {
  return {
    id: overrides.id ?? nextId('test_school'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    name: overrides.name ?? 'Test School',
    code: overrides.code ?? `TS${nextId('s').replace('test_s_', '').padStart(3, '0')}`,
    address: overrides.address ?? '123 Test Street, Test City',
    phone: overrides.phone ?? '+233-00-000-0000',
    email: overrides.email ?? 'school@test.example',
    logoUrl: overrides.logoUrl ?? null,
    motto: overrides.motto ?? null,
    established: overrides.established ?? new Date('2020-01-01'),
    settings: overrides.settings ?? {},
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}