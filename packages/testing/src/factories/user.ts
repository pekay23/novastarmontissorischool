import { nextId } from '../ids'
import { now } from '../time'

export type Gender = 'MALE' | 'FEMALE' | 'OTHER'
export type StaffStatus = 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED'
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | 'DELETED'

export interface User {
  id: string
  tenantId: string
  schoolId: string | null
  email: string
  emailVerified: Date | null
  passwordHash: string | null
  name: string | null
  image: string | null
  roleId: string | null
  isActive: boolean
  status: UserStatus
  loginAttempts: number
  lockedUntil: Date | null
  twoFactorEnabled: boolean
  twoFactorSecret: string | null
  settings: Record<string, unknown> | null
  passkeyBridgeToken: string | null
  passkeyBridgeExpires: Date | null
  mustChangePassword: boolean
  passwordChangedAt: Date | null
  verifyToken: string | null
  verifyTokenExpires: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface Staff {
  id: string
  tenantId: string
  schoolId: string
  userId: string
  employeeId: string
  firstName: string
  lastName: string
  otherNames: string | null
  gender: Gender
  dateOfBirth: Date | null
  phone: string
  email: string
  address: string | null
  hireDate: Date
  status: StaffStatus
  roleId: string | null
  departmentId: string | null
  managerId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface BuildUserOverrides {
  id?: string
  tenantId?: string
  schoolId?: string | null
  email?: string
  emailVerified?: Date | null
  passwordHash?: string | null
  name?: string | null
  image?: string | null
  roleId?: string | null
  isActive?: boolean
  status?: UserStatus
  loginAttempts?: number
  lockedUntil?: Date | null
  twoFactorEnabled?: boolean
  twoFactorSecret?: string | null
  settings?: Record<string, unknown> | null
  passkeyBridgeToken?: string | null
  passkeyBridgeExpires?: Date | null
  mustChangePassword?: boolean
  passwordChangedAt?: Date | null
  verifyToken?: string | null
  verifyTokenExpires?: Date | null
  createdAt?: Date
  updatedAt?: Date
}

export function buildUser(overrides: BuildUserOverrides = {}): User {
  return {
    id: overrides.id ?? nextId('test_user'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? null,
    email: overrides.email ?? `user${nextId('u').replace('test_u_', '')}@test.example`,
    emailVerified: overrides.emailVerified ?? null,
    passwordHash: overrides.passwordHash ?? '$2b$10$hashedpassword',
    name: overrides.name ?? 'Test User',
    image: overrides.image ?? null,
    roleId: overrides.roleId ?? null,
    isActive: overrides.isActive ?? true,
    status: overrides.status ?? 'ACTIVE',
    loginAttempts: overrides.loginAttempts ?? 0,
    lockedUntil: overrides.lockedUntil ?? null,
    twoFactorEnabled: overrides.twoFactorEnabled ?? false,
    twoFactorSecret: overrides.twoFactorSecret ?? null,
    settings: overrides.settings ?? {},
    passkeyBridgeToken: overrides.passkeyBridgeToken ?? null,
    passkeyBridgeExpires: overrides.passkeyBridgeExpires ?? null,
    mustChangePassword: overrides.mustChangePassword ?? false,
    passwordChangedAt: overrides.passwordChangedAt ?? null,
    verifyToken: overrides.verifyToken ?? null,
    verifyTokenExpires: overrides.verifyTokenExpires ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildStaffOverrides {
  id?: string
  tenantId?: string
  schoolId?: string
  userId?: string
  employeeId?: string
  firstName?: string
  lastName?: string
  otherNames?: string | null
  gender?: Gender
  dateOfBirth?: Date | null
  phone?: string
  email?: string
  address?: string | null
  hireDate?: Date
  status?: StaffStatus
  roleId?: string | null
  departmentId?: string | null
  managerId?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export function buildStaff(overrides: BuildStaffOverrides = {}): Staff {
  const userId = overrides.userId ?? nextId('test_user')
  return {
    id: overrides.id ?? nextId('test_staff'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? nextId('test_school'),
    userId,
    employeeId: overrides.employeeId ?? `EMP${nextId('e').replace('test_e_', '').padStart(6, '0')}`,
    firstName: overrides.firstName ?? 'Test',
    lastName: overrides.lastName ?? 'Staff',
    otherNames: overrides.otherNames ?? null,
    gender: overrides.gender ?? 'MALE',
    dateOfBirth: overrides.dateOfBirth ?? null,
    phone: overrides.phone ?? '+233-00-000-0000',
    email: overrides.email ?? `staff${nextId('s').replace('test_s_', '')}@test.example`,
    address: overrides.address ?? null,
    hireDate: overrides.hireDate ?? now(),
    status: overrides.status ?? 'ACTIVE',
    roleId: overrides.roleId ?? null,
    departmentId: overrides.departmentId ?? null,
    managerId: overrides.managerId ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}