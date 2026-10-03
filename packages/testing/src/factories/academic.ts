import { nextId } from '../ids'
import { now } from '../time'
import type { Phase, TermStatus, SubjectCategory } from '@novastar/shared-types'

export interface BuildAcademicYearOverrides {
  id?: string
  tenantId?: string
  schoolId?: string
  name?: string
  startDate?: Date
  endDate?: Date
  isCurrent?: boolean
  createdAt?: Date
  updatedAt?: Date
}

export function buildAcademicYear(overrides: BuildAcademicYearOverrides = {}): Record<string, unknown> {
  const startDate = overrides.startDate ?? new Date('2024-09-01')
  const endDate = overrides.endDate ?? new Date('2025-06-30')
  return {
    id: overrides.id ?? nextId('test_academic_year'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? nextId('test_school'),
    name: overrides.name ?? '2024-2025',
    startDate,
    endDate,
    isCurrent: overrides.isCurrent ?? true,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildTermOverrides {
  id?: string
  tenantId?: string
  schoolId?: string
  academicYearId?: string
  name?: string
  startDate?: Date
  endDate?: Date
  isCurrent?: boolean
  status?: TermStatus
  weeks?: number
  createdAt?: Date
  updatedAt?: Date
}

export function buildTerm(overrides: BuildTermOverrides = {}): Record<string, unknown> {
  const startDate = overrides.startDate ?? new Date('2024-09-01')
  const endDate = overrides.endDate ?? new Date('2024-12-15')
  return {
    id: overrides.id ?? nextId('test_term'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? nextId('test_school'),
    academicYearId: overrides.academicYearId ?? nextId('test_academic_year'),
    name: overrides.name ?? 'Term 1',
    startDate,
    endDate,
    isCurrent: overrides.isCurrent ?? true,
    status: overrides.status ?? 'ACTIVE',
    weeks: overrides.weeks ?? 14,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildClassLevelOverrides {
  id?: string
  tenantId?: string
  schoolId?: string
  code?: string
  name?: string
  phase?: Phase
  order?: number
  ageMin?: number
  ageMax?: number
  createdAt?: Date
  updatedAt?: Date
}

export function buildClassLevel(overrides: BuildClassLevelOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? nextId('test_class_level'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? nextId('test_school'),
    code: overrides.code ?? `CL${nextId('cl').replace('test_cl_', '').padStart(2, '0')}`,
    name: overrides.name ?? 'Primary 1',
    phase: overrides.phase ?? 'PRIMARY',
    order: overrides.order ?? 1,
    ageMin: overrides.ageMin ?? 6,
    ageMax: overrides.ageMax ?? 7,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildClassOverrides {
  id?: string
  tenantId?: string
  schoolId?: string
  name?: string
  levelId?: string
  stream?: string | null
  capacity?: number
  classTeacherId?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export function buildClass(overrides: BuildClassOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? nextId('test_class'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? nextId('test_school'),
    name: overrides.name ?? 'Primary 1A',
    levelId: overrides.levelId ?? nextId('test_class_level'),
    stream: overrides.stream ?? 'A',
    capacity: overrides.capacity ?? 45,
    classTeacherId: overrides.classTeacherId ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildSubjectOverrides {
  id?: string
  tenantId?: string
  schoolId?: string
  code?: string
  name?: string
  category?: SubjectCategory
  isCore?: boolean
  creditHours?: number
  description?: string | null
  color?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export function buildSubject(overrides: BuildSubjectOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? nextId('test_subject'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? nextId('test_school'),
    code: overrides.code ?? `SUB${nextId('sub').replace('test_sub_', '').padStart(3, '0')}`,
    name: overrides.name ?? 'Mathematics',
    category: overrides.category ?? 'MATHEMATICS',
    isCore: overrides.isCore ?? true,
    creditHours: overrides.creditHours ?? 1,
    description: overrides.description ?? null,
    color: overrides.color ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}