import { z } from 'zod'

// ============================================================================
// SHARED TYPES — Tenant-aware, validated with Zod
// All schemas include tenantId/schoolId for multi-tenancy
// ============================================================================

// --- Pagination ---
export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export type Pagination = z.infer<typeof PaginationSchema>

export const PaginatedResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: z.array(dataSchema),
    meta: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
      hasNext: z.boolean(),
      hasPrev: z.boolean(),
    }),
  })

// --- Tenancy ---
export const TenantSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1),
  code: z.string().min(2).max(20),
  domain: z.string().url().nullable().optional(),
  isActive: z.boolean().default(true),
  settings: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const SchoolSchema = z.object({
  id: z.string().cuid(),
  tenantId: z.string().cuid(),
  name: z.string().min(1),
  code: z.string().min(1),
  address: z.string(),
  phone: z.string(),
  email: z.string().email(),
  logoUrl: z.string().url().nullable().optional(),
  motto: z.string().nullable().optional(),
  established: z.date(),
  currentTermId: z.string().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// --- Config Entity Base ---
// Definitions now live in ./entity-schemas so entity-api-config.ts can consume
// them without an import cycle. Re-exported here to keep the public surface of
// this barrel identical for all existing importers.
export {
  ConfigEntityBaseSchema,
  PhaseEnum,
  AcademicYearSchema,
  TermStatusEnum,
  TermSchema,
  ClassLevelSchema,
  SubjectCategoryEnum,
  SubjectSchema,
  GradingLevelSchema,
  GradingScaleSchema,
  SyllabusSchema,
  AssessmentTypeConfigSchema,
  FeeCategorySchema,
  PaymentMethodConfigSchema,
  GenderEnum,
  StaffStatusEnum,
  StudentStatusEnum,
  ContentStatusEnum,
} from './entity-schemas'
export type {
  Phase,
  TermStatus,
  SubjectCategory,
  Gender,
  StaffStatus,
  StudentStatus,
  ContentStatus,
  GradingLevel,
  Syllabus,
} from './entity-schemas'

import { ConfigEntityBaseSchema } from './entity-schemas'
import {
  PermissionActionEnum,
  PermissionCategoryEnum,
  PermissionKeySchema,
  PermissionScopeEnum,
  parsePermissionKey,
} from './permission-keys'
export {
  PERMISSION_ACTIONS,
  PERMISSION_CATEGORIES,
  PERMISSION_CATALOG,
  PERMISSION_CATALOG_BY_KEY,
  PERMISSION_KEYS,
  PERMISSION_SCOPES,
  PermissionActionEnum,
  PermissionCategoryEnum,
  PermissionKeySchema,
  PermissionScopeEnum,
  PLATFORM_ROLE_NAMES,
  ROLE_GRANT_RULES,
  ROLE_READ_SCOPE,
  parsePermissionKey,
  permissionMatches,
  permissionsForRole,
  scopeFor,
} from './permission-keys'
export type {
  ParsedPermissionKey,
  PermissionAction,
  PermissionCategory,
  PermissionDefinition,
  PermissionScope,
  PlatformRoleName,
  RoleGrantRule,
} from './permission-keys'

// --- Roles & Permissions (DelegationRule defined before Role) ---

/**
 * `resource` and `action` are declared but validated against `key` below, so a
 * row can no longer claim one resource while being granted under another. The
 * previous shape asserted `key` against `/^[a-z]+:[a-z]+$/`, which rejected 11
 * live rows (`finance:invoice:create` and friends) and 11 action verbs
 * (`grade`, `mark`, `edit`, `pay`, `record`, `return`, `send`, `manage`,
 * `settings`, `write`) — including the two keys that gate score and attendance
 * writes.
 */
export const PermissionSchema = ConfigEntityBaseSchema.extend({
  key: PermissionKeySchema,
  description: z.string(),
  category: PermissionCategoryEnum,
  resource: z.string(),
  action: PermissionActionEnum,
  scope: PermissionScopeEnum,
  isSystem: z.boolean().default(false),
}).superRefine((value, ctx) => {
  const parsed = parsePermissionKey(value.key)
  if (!parsed) return // already reported by PermissionKeySchema

  if (value.resource !== parsed.resource) {
    ctx.addIssue({
      code: 'custom',
      path: ['resource'],
      message: `resource "${value.resource}" does not match key "${value.key}" (expected "${parsed.resource}")`,
    })
  }
  if (value.action !== parsed.action) {
    ctx.addIssue({
      code: 'custom',
      path: ['action'],
      message: `action "${value.action}" does not match key "${value.key}" (expected "${parsed.action}")`,
    })
  }
})

export const DelegationRuleSchema = z.object({
  fromRole: z.string(),
  toRole: z.string().optional(),
  toUserId: z.string().optional(),
  permissions: z.array(z.string()),
  requiresApproval: z.boolean().default(true),
  expiresAt: z.date().nullable().optional(),
  context: z.string().nullable().optional(),
})

export const RoleSchema = ConfigEntityBaseSchema.extend({
  name: z.string(),
  description: z.string().nullable().optional(),
  isSystem: z.boolean().default(false),
  permissions: z.array(z.string()),
  inheritsFrom: z.array(z.string()).default([]),
  delegationRules: z.array(DelegationRuleSchema).optional(),
})

export const DelegationSchema = z.object({
  id: z.string().cuid(),
  tenantId: z.string().cuid(),
  schoolId: z.string(),
  fromUserId: z.string(),
  toUserId: z.string(),
  permissions: z.array(z.string()),
  requiresApproval: z.boolean().default(true),
  context: z.string().nullable().optional(),
  expiresAt: z.date().nullable().optional(),
  isActive: z.boolean().default(true),
  approvedById: z.string().nullable().optional(),
  approvedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const CreateDelegationInputSchema = DelegationSchema.omit({
  id: true, tenantId: true, createdAt: true, updatedAt: true
}).extend({
  isActive: z.boolean().default(false),
})

// --- Users ---
// GenderEnum, StaffStatusEnum, StudentStatusEnum and ContentStatusEnum moved to
// ./entity-schemas (re-exported above) because entity-api-config.ts needs them.
// UserRoleEnum is declared at the bottom of this file, next to NotificationType.

// --- Permission, Role, Delegation types ---
export type Permission = z.infer<typeof PermissionSchema>
export type DelegationRule = z.infer<typeof DelegationRuleSchema>
export type Role = z.infer<typeof RoleSchema>
export type Delegation = z.infer<typeof DelegationSchema>
export type CreateDelegationInput = z.infer<typeof CreateDelegationInputSchema>

// --- Config Entity & Sync types ---
export type ConfigEntity = z.infer<typeof ConfigEntityBaseSchema>
export type SyncRecord = {
  id: string
  tenantId: string
  entityType: string
  entityId: string
  table: string
  recordId: string
  operation: 'create' | 'update' | 'delete' | 'upsert'
  data: Record<string, unknown>
  timestamp: Date
  syncStatus: 'pending' | 'synced' | 'conflict' | 'failed'
  retryCount: number
}

// Re-export from config-schema
export type { EntityType, EntityField, EntityDefinition, EntityRegistry } from './config-schema'
export { DEFAULT_ENTITY_REGISTRY, CONFIG_VERSION } from './config-schema'

// --- Notification ---
  export type NotificationType = 'FEE_DUE' | 'FEE_OVERDUE' | 'PAYMENT_RECEIVED' | 'ATTENDANCE_ALERT' | 'GRADE_POSTED' | 'REPORT_READY' | 'ANNOUNCEMENT' | 'MESSAGE' | 'TASK_ASSIGNED' | 'APPROVAL_REQUEST' | 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS' | 'SYSTEM'

export const UserRoleEnum = z.enum([
  'SUPER_ADMIN',
  'HEADMASTER',
  'ASSISTANT_HEAD',
  'HEAD_TEACHER',
  'CLASSROOM_TEACHER',
  'ACCOUNTANT',
  'LIBRARIAN',
  'NURSE',
  'ADMIN_STAFF',
  'PARENT',
  'TEACHER',
  'STAFF',
])

export type UserRole = z.infer<typeof UserRoleEnum>

// Re-export entity API config (consolidated entity model map, schemas, and sets)
export type { EntityApiConfig } from './entity-api-config'
export { ENTITY_CONFIG_MAP, TENANT_ONLY_ENTITY_TYPES, SOFT_DELETE_ENTITY_TYPES } from './entity-api-config'
