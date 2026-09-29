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
export const ConfigEntityBaseSchema = z.object({
  id: z.string().cuid(),
  tenantId: z.string().cuid(),
  schoolId: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// --- Academic Structure ---
export const PhaseEnum = z.enum(['KINDERGARTEN', 'PRIMARY', 'JHS', 'SHS'])
export type Phase = z.infer<typeof PhaseEnum>

export const AcademicYearSchema = ConfigEntityBaseSchema.extend({
  name: z.string(),
  startDate: z.date(),
  endDate: z.date(),
  isCurrent: z.boolean().default(false),
})

export const TermStatusEnum = z.enum(['PLANNING', 'ACTIVE', 'ASSESSMENT', 'REPORTING', 'CLOSED'])
export type TermStatus = z.infer<typeof TermStatusEnum>

export const TermSchema = ConfigEntityBaseSchema.extend({
  name: z.string(),
  academicYearId: z.string(),
  startDate: z.date(),
  endDate: z.date(),
  isCurrent: z.boolean().default(false),
  status: TermStatusEnum.default('PLANNING'),
  weeks: z.number().int().positive().default(14),
})

export const ClassLevelSchema = ConfigEntityBaseSchema.extend({
  code: z.string(),
  name: z.string(),
  phase: PhaseEnum,
  order: z.number().int().positive(),
  ageMin: z.number().int().positive(),
  ageMax: z.number().int().positive(),
})

export const SubjectCategoryEnum = z.enum([
  'LANGUAGE',
  'MATHEMATICS',
  'SCIENCE',
  'SOCIAL_STUDIES',
  'CREATIVE_ARTS',
  'PHYSICAL_EDUCATION',
  'ICT',
  'RELIGIOUS_MORAL',
  'MONTESSORI_PRACTICAL',
  'MONTESSORI_SENSORIAL',
  'MONTESSORI_LANGUAGE',
  'MONTESSORI_MATHEMATICS',
  'MONTESSORI_CULTURAL',
  'OTHER',
])
export type SubjectCategory = z.infer<typeof SubjectCategoryEnum>

export const SubjectSchema = ConfigEntityBaseSchema.extend({
  code: z.string(),
  name: z.string(),
  category: SubjectCategoryEnum,
  isCore: z.boolean().default(true),
  creditHours: z.number().int().positive().default(1),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
})

// --- Grading (GradingLevel defined before GradingScale to avoid forward ref) ---
export const GradingLevelSchema = z.object({
  id: z.string().cuid(),
  gradingScaleId: z.string(),
  key: z.string(),
  label: z.string(),
  minScore: z.number().int().min(0).max(100),
  maxScore: z.number().int().min(0).max(100),
  color: z.string(),
  description: z.string().nullable().optional(),
  order: z.number().int(),
})

export const GradingScaleSchema = ConfigEntityBaseSchema.extend({
  name: z.string(),
  description: z.string().nullable().optional(),
  isDefault: z.boolean().default(false),
  appliesToLevels: z.array(z.string()),
  levels: z.array(GradingLevelSchema).optional(),
})

// --- Assessment ---
export const AssessmentTypeConfigSchema = ConfigEntityBaseSchema.extend({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  defaultWeight: z.number().min(0).max(1),
  maxScore: z.number().int().positive().default(100),
  appliesToLevels: z.array(z.string()),
  isActive: z.boolean().default(true),
})

// --- Fees ---
export const FeeCategorySchema = ConfigEntityBaseSchema.extend({
  code: z.string(),
  name: z.string(),
  isRecurring: z.boolean().default(true),
  defaultMandatory: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

export const PaymentMethodConfigSchema = ConfigEntityBaseSchema.extend({
  code: z.string(),
  name: z.string(),
  instructions: z.string().nullable().optional(),
  isEnabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  providerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
})

// --- Roles & Permissions (DelegationRule defined before Role) ---
export const PermissionScopeEnum = z.enum(['all', 'own', 'class', 'department', 'custom'])
export type PermissionScope = z.infer<typeof PermissionScopeEnum>

export const PermissionSchema = ConfigEntityBaseSchema.extend({
  key: z.string().regex(/^[a-z]+:[a-z]+$/),
  description: z.string(),
  category: z.enum(['academic', 'finance', 'staff', 'student', 'communication', 'reports', 'system']),
  resource: z.string(),
  action: z.enum(['create', 'read', 'update', 'delete', 'approve', 'delegate', 'export']),
  scope: PermissionScopeEnum,
  isSystem: z.boolean().default(false),
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
export const GenderEnum = z.enum(['MALE', 'FEMALE', 'OTHER'])
export type Gender = z.infer<typeof GenderEnum>

export type UserRole = z.infer<typeof UserRoleEnum>

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
