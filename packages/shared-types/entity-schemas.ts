import { z } from 'zod'

/**
 * Entity-level Zod schemas shared by `index.ts` and `entity-api-config.ts`.
 *
 * This module exists to break an import cycle. `index.ts` re-exports from
 * `entity-api-config.ts`, and that module needs the entity schemas at module
 * evaluation time (to build `ENTITY_CONFIG_MAP`). If it imported them from
 * `./index`, evaluation would start at `index.ts`, reach its re-export of
 * `entity-api-config.ts`, and then hit a schema binding that `index.ts` had not
 * finished initialising — a temporal dead zone `ReferenceError` that only
 * surfaces at bundle/runtime evaluation, never in `tsc`.
 *
 * Rule: this file must not import from `./index` or `./entity-api-config`.
 */

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

// --- Entity status enums ---
// These describe the lifecycle state of entities managed through the config API,
// so they live with the entity schemas rather than in the RBAC/user block.
export const GenderEnum = z.enum(['MALE', 'FEMALE', 'OTHER'])
export type Gender = z.infer<typeof GenderEnum>

export const StaffStatusEnum = z.enum(['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'])
export type StaffStatus = z.infer<typeof StaffStatusEnum>

export const StudentStatusEnum = z.enum(['ACTIVE', 'GRADUATED', 'TRANSFERRED', 'WITHDRAWN', 'SUSPENDED'])
export type StudentStatus = z.infer<typeof StudentStatusEnum>

export const ContentStatusEnum = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
export type ContentStatus = z.infer<typeof ContentStatusEnum>
