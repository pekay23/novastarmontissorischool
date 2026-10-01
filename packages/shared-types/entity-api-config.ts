import { z } from 'zod'
// Imported from the leaf module, never from './index': index.ts re-exports this
// file, so importing from it would create a cycle and a temporal-dead-zone
// ReferenceError when ENTITY_CONFIG_MAP is evaluated at module load.
import {
  AcademicYearSchema,
  TermSchema,
  ClassLevelSchema,
  SubjectSchema,
  GradingScaleSchema,
  FeeCategorySchema,
  PaymentMethodConfigSchema,
  AssessmentTypeConfigSchema,
  GradingLevelSchema,
  PhaseEnum,
  TermStatusEnum,
  SubjectCategoryEnum,
  GenderEnum,
  StaffStatusEnum,
  StudentStatusEnum,
  ContentStatusEnum,
} from './entity-schemas'

// ---------------------------------------------------------------------------
// Entity API Config — single source of truth for entity → Prisma model mapping,
// create/update Zod schemas, sort fields, and scoping metadata.
// Used by config/[entityType]/route.ts and config/[entityType]/[id]/route.ts
// ---------------------------------------------------------------------------

export type EntityApiConfig = {
  /** Entity type key (URL segment) */
  type: string
  /** Prisma model name (camelCase) */
  model: string
  /** Field names available on this entity (used for search/sort validation) */
  fields: string[]
  /** Zod schema for creating a new entity (omits id, tenantId, schoolId, timestamps) */
  createSchema: z.ZodType<Record<string, unknown>>
  /** Zod schema for updating an entity (all fields optional, omits immutable fields) */
  updateSchema: z.ZodType<Record<string, unknown>>
  /** Field names that can be used in `?sort=` query param */
  allowedSortFields: string[]
  /** Whether the entity has a schoolId column (false = tenant-only) */
  schoolScoped: boolean
  /** Whether the entity supports soft-delete via isActive flag */
  softDelete: boolean
}

/**
 * Entity types whose Prisma model lacks a `schoolId` column.
 * These are tenant-scoped only — schoolId is never included in queries.
 */
export const TENANT_ONLY_ENTITY_TYPES = new Set([
  'grading_level',
  'subject_level',
  'fee_line_item',
])

/**
 * Entity types whose Prisma model has an `isActive` Boolean column.
 * Used to implement soft-delete: DELETE sets isActive=false instead of hard-deleting.
 * Models with status enums (staff, student, parent) or `isSystem`/`status` fields
 * (role, news, event) are excluded — they have dedicated lifecycle management.
 */
export const SOFT_DELETE_ENTITY_TYPES = new Set([
  'academic_year',
  'term',
  'class_level',
  'subject',
  'grading_scale',
  'grading_level',
  'fee_category',
  'fee_structure',
  'payment_method',
  'assessment_type',
  'branding',
  'department',
  'house',
  'class',
  'subject_level',
])

/**
 * Consolidated entity configuration map.
 * Replaces the duplicated entityModelMap/entityUpdateSchemas in route files.
 */
export const ENTITY_CONFIG_MAP: Record<string, EntityApiConfig> = {
  academic_year: {
    type: 'academic_year',
    model: 'academicYear',
    fields: ['id', 'name', 'startDate', 'endDate', 'isCurrent', 'createdAt', 'updatedAt'],
    createSchema: AcademicYearSchema.omit({
      id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true,
    }),
    updateSchema: z.object({
      name: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      isCurrent: z.boolean().optional(),
    }),
    allowedSortFields: ['name', 'startDate', 'endDate', 'isCurrent', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  term: {
    type: 'term',
    model: 'term',
    fields: ['id', 'name', 'academicYearId', 'startDate', 'endDate', 'isCurrent', 'status', 'weeks', 'createdAt', 'updatedAt'],
    createSchema: TermSchema.omit({
      id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true,
    }),
    updateSchema: z.object({
      name: z.string().optional(),
      academicYearId: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      isCurrent: z.boolean().optional(),
      status: TermStatusEnum.optional(),
      weeks: z.number().int().positive().optional(),
    }),
    allowedSortFields: ['name', 'startDate', 'endDate', 'isCurrent', 'status', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  class_level: {
    type: 'class_level',
    model: 'classLevel',
    fields: ['id', 'code', 'name', 'phase', 'order', 'ageMin', 'ageMax', 'createdAt', 'updatedAt'],
    createSchema: ClassLevelSchema.omit({
      id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true,
    }),
    updateSchema: z.object({
      code: z.string().optional(),
      name: z.string().optional(),
      phase: PhaseEnum.optional(),
      order: z.number().int().positive().optional(),
      ageMin: z.number().int().positive().optional(),
      ageMax: z.number().int().positive().optional(),
    }),
    allowedSortFields: ['code', 'name', 'phase', 'order', 'ageMin', 'ageMax', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  subject: {
    type: 'subject',
    model: 'subject',
    fields: ['id', 'code', 'name', 'category', 'isCore', 'creditHours', 'description', 'color', 'createdAt', 'updatedAt'],
    createSchema: SubjectSchema.omit({
      id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true,
    }),
    updateSchema: z.object({
      code: z.string().optional(),
      name: z.string().optional(),
      category: SubjectCategoryEnum.optional(),
      isCore: z.boolean().optional(),
      creditHours: z.number().int().positive().optional(),
      description: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
    }),
    allowedSortFields: ['code', 'name', 'category', 'isCore', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  grading_scale: {
    type: 'grading_scale',
    model: 'gradingScale',
    fields: ['id', 'name', 'description', 'isDefault', 'appliesToLevels', 'createdAt', 'updatedAt'],
    createSchema: GradingScaleSchema.omit({
      id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true,
    }),
    updateSchema: z.object({
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      isDefault: z.boolean().optional(),
      appliesToLevels: z.array(z.string()).optional(),
    }),
    allowedSortFields: ['name', 'isDefault', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  fee_category: {
    type: 'fee_category',
    model: 'feeCategory',
    fields: ['id', 'code', 'name', 'isRecurring', 'defaultMandatory', 'sortOrder', 'createdAt', 'updatedAt'],
    createSchema: FeeCategorySchema.omit({
      id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true,
    }),
    updateSchema: z.object({
      code: z.string().optional(),
      name: z.string().optional(),
      isRecurring: z.boolean().optional(),
      defaultMandatory: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }),
    allowedSortFields: ['code', 'name', 'sortOrder', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  payment_method: {
    type: 'payment_method',
    model: 'paymentMethodConfig',
    fields: ['id', 'code', 'name', 'instructions', 'isEnabled', 'sortOrder', 'providerConfig', 'createdAt', 'updatedAt'],
    createSchema: PaymentMethodConfigSchema.omit({
      id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true,
    }),
    updateSchema: z.object({
      code: z.string().optional(),
      name: z.string().optional(),
      instructions: z.string().nullable().optional(),
      isEnabled: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      providerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
    allowedSortFields: ['code', 'name', 'sortOrder', 'isEnabled', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  // Privilege-management fields (permissions, inheritsFrom, isSystem) are
  // intentionally excluded from both create and update — they cannot be
  // edited via the generic config endpoints. Use a dedicated admin endpoint.
  role: {
    type: 'role',
    model: 'role',
    fields: ['id', 'name', 'description', 'isSystem', 'permissions', 'inheritsFrom', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      description: z.string().nullable().optional(),
      permissions: z.array(z.string()).default([]),
      inheritsFrom: z.array(z.string()).default([]),
    }),
    updateSchema: z.object({
      name: z.string().optional(),
      description: z.string().nullable().optional(),
    }),
    allowedSortFields: ['name', 'isSystem', 'createdAt'],
    schoolScoped: true,
    softDelete: false,
  },

  assessment_type: {
    type: 'assessment_type',
    model: 'assessmentTypeConfig',
    fields: ['id', 'code', 'name', 'defaultWeight', 'maxScore', 'isActive', 'appliesToLevels', 'createdAt', 'updatedAt'],
    createSchema: AssessmentTypeConfigSchema.omit({
      id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true,
    }),
    updateSchema: z.object({
      code: z.string().optional(),
      name: z.string().optional(),
      defaultWeight: z.number().min(0).max(1).optional(),
      maxScore: z.number().int().positive().optional(),
      isActive: z.boolean().optional(),
      appliesToLevels: z.array(z.string()).optional(),
    }),
    allowedSortFields: ['code', 'name', 'defaultWeight', 'isActive', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  grading_level: {
    type: 'grading_level',
    model: 'gradingLevel',
    fields: ['id', 'gradingScaleId', 'key', 'label', 'minScore', 'maxScore', 'color', 'description', 'order', 'createdAt', 'updatedAt'],
    createSchema: GradingLevelSchema.omit({ id: true }),
    updateSchema: z.object({
      gradingScaleId: z.string().optional(),
      key: z.string().optional(),
      label: z.string().optional(),
      minScore: z.number().int().min(0).max(100).optional(),
      maxScore: z.number().int().min(0).max(100).optional(),
      color: z.string().optional(),
      order: z.number().int().optional(),
      description: z.string().nullable().optional(),
    }),
    allowedSortFields: ['order', 'key', 'minScore', 'createdAt'],
    schoolScoped: false,
    softDelete: true,
  },

  branding: {
    type: 'branding',
    model: 'branding',
    fields: ['id', 'name', 'logoUrl', 'primaryColor', 'secondaryColor', 'accentColor', 'motto', 'phone', 'email', 'address', 'socialLinks', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      logoUrl: z.string().url().nullable().optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      motto: z.string().nullable().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().optional(),
      socialLinks: z.record(z.string(), z.unknown()).optional(),
    }),
    updateSchema: z.object({
      name: z.string().min(1).optional(),
      logoUrl: z.string().url().nullable().optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      motto: z.string().nullable().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().optional(),
      socialLinks: z.record(z.string(), z.unknown()).optional(),
    }),
    allowedSortFields: ['createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  news: {
    type: 'news',
    model: 'news',
    fields: ['id', 'title', 'bodyEn', 'bodyTw', 'excerptEn', 'excerptTw', 'category', 'featuredImage', 'audience', 'status', 'publishedAt', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      title: z.string().min(1),
      bodyEn: z.string().optional(),
      bodyTw: z.string().optional(),
      excerptEn: z.string().optional(),
      excerptTw: z.string().optional(),
      category: z.string().optional(),
      featuredImage: z.string().url().nullable().optional(),
      audience: z.array(z.string()).optional(),
      status: ContentStatusEnum.default('DRAFT'),
      publishedAt: z.date().nullable().optional(),
    }),
    updateSchema: z.object({
      title: z.string().optional(),
      bodyEn: z.string().optional(),
      bodyTw: z.string().optional(),
      excerptEn: z.string().optional(),
      excerptTw: z.string().optional(),
      category: z.string().optional(),
      featuredImage: z.string().url().nullable().optional(),
      audience: z.array(z.string()).optional(),
      status: ContentStatusEnum.optional(),
      publishedAt: z.date().nullable().optional(),
    }),
    allowedSortFields: ['title', 'publishedAt', 'status', 'createdAt'],
    schoolScoped: true,
    softDelete: false,
  },

  event: {
    type: 'event',
    model: 'event',
    fields: ['id', 'title', 'descriptionEn', 'descriptionTw', 'startDate', 'endDate', 'location', 'audience', 'isAllDay', 'recurrence', 'status', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      title: z.string().min(1),
      descriptionEn: z.string().optional(),
      descriptionTw: z.string().optional(),
      startDate: z.date(),
      endDate: z.date(),
      location: z.string().optional(),
      audience: z.array(z.string()).optional(),
      isAllDay: z.boolean().default(false),
      recurrence: z.string().optional(),
      status: ContentStatusEnum.default('DRAFT'),
    }),
    updateSchema: z.object({
      title: z.string().optional(),
      descriptionEn: z.string().optional(),
      descriptionTw: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      location: z.string().optional(),
      audience: z.array(z.string()).optional(),
      isAllDay: z.boolean().optional(),
      recurrence: z.string().optional(),
      status: ContentStatusEnum.optional(),
    }),
    allowedSortFields: ['startDate', 'endDate', 'title', 'status', 'createdAt'],
    schoolScoped: true,
    softDelete: false,
  },

  department: {
    type: 'department',
    model: 'department',
    fields: ['id', 'name', 'code', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      code: z.string().min(1),
    }),
    updateSchema: z.object({
      name: z.string().optional(),
      code: z.string().optional(),
    }),
    allowedSortFields: ['name', 'code', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  house: {
    type: 'house',
    model: 'house',
    fields: ['id', 'name', 'color', 'motto', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      color: z.string().min(1),
      motto: z.string().optional(),
    }),
    updateSchema: z.object({
      name: z.string().optional(),
      color: z.string().min(1).optional(),
      motto: z.string().optional(),
    }),
    allowedSortFields: ['name', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  class: {
    type: 'class',
    model: 'class',
    fields: ['id', 'name', 'levelId', 'stream', 'capacity', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      levelId: z.string(),
      stream: z.string().optional(),
      capacity: z.number().int().positive().default(35),
    }),
    updateSchema: z.object({
      name: z.string().optional(),
      levelId: z.string().optional(),
      stream: z.string().optional(),
      capacity: z.number().int().positive().optional(),
    }),
    allowedSortFields: ['name', 'levelId', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  subject_level: {
    type: 'subject_level',
    model: 'subjectLevel',
    fields: ['id', 'subjectId', 'classLevelId', 'isRequired', 'periodsPerWeek', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      subjectId: z.string(),
      classLevelId: z.string(),
      isRequired: z.boolean().default(true),
      periodsPerWeek: z.number().int().positive().default(4),
    }),
    updateSchema: z.object({
      subjectId: z.string().optional(),
      classLevelId: z.string().optional(),
      isRequired: z.boolean().optional(),
      periodsPerWeek: z.number().int().positive().optional(),
    }),
    allowedSortFields: ['subjectId', 'classLevelId', 'createdAt'],
    schoolScoped: false,
    softDelete: true,
  },

  fee_structure: {
    type: 'fee_structure',
    model: 'feeStructure',
    fields: ['id', 'name', 'academicYearId', 'termId', 'classLevelId', 'isActive', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      academicYearId: z.string(),
      termId: z.string(),
      classLevelId: z.string(),
      isActive: z.boolean().default(true),
    }),
    updateSchema: z.object({
      name: z.string().optional(),
      academicYearId: z.string().optional(),
      termId: z.string().optional(),
      classLevelId: z.string().optional(),
      isActive: z.boolean().optional(),
    }),
    allowedSortFields: ['name', 'academicYearId', 'termId', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  fee_line_item: {
    type: 'fee_line_item',
    model: 'feeLineItem',
    fields: ['id', 'feeStructureId', 'categoryId', 'amount', 'isMandatory', 'sortOrder', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      feeStructureId: z.string(),
      categoryId: z.string(),
      amount: z.number().nonnegative(),
      isMandatory: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
    }),
    updateSchema: z.object({
      feeStructureId: z.string().optional(),
      categoryId: z.string().optional(),
      amount: z.number().nonnegative().optional(),
      isMandatory: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }),
    allowedSortFields: ['sortOrder', 'amount', 'createdAt'],
    schoolScoped: false,
    softDelete: true,
  },

  staff: {
    type: 'staff',
    model: 'staff',
    fields: ['id', 'employeeId', 'firstName', 'lastName', 'gender', 'phone', 'email', 'hireDate', 'status', 'roleId', 'departmentId', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      employeeId: z.string().min(1),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      gender: GenderEnum,
      phone: z.string().optional(),
      email: z.string().email().optional(),
      hireDate: z.date().optional(),
      status: StaffStatusEnum.default('ACTIVE'),
      roleId: z.string(),
      departmentId: z.string().nullable().optional(),
    }),
    updateSchema: z.object({
      employeeId: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      gender: GenderEnum.optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      hireDate: z.date().optional(),
      status: StaffStatusEnum.optional(),
      roleId: z.string().optional(),
      departmentId: z.string().nullable().optional(),
    }),
    allowedSortFields: ['employeeId', 'firstName', 'lastName', 'status', 'createdAt'],
    schoolScoped: true,
    softDelete: false,
  },

  student: {
    type: 'student',
    model: 'student',
    fields: ['id', 'admissionNumber', 'firstName', 'lastName', 'gender', 'dateOfBirth', 'admissionDate', 'status', 'classId', 'houseId', 'parentId', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      admissionNumber: z.string().min(1),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      gender: GenderEnum,
      dateOfBirth: z.date(),
      admissionDate: z.date(),
      status: StudentStatusEnum.default('ACTIVE'),
      classId: z.string(),
      houseId: z.string().nullable().optional(),
      parentId: z.string().nullable().optional(),
    }),
    updateSchema: z.object({
      admissionNumber: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      gender: GenderEnum.optional(),
      dateOfBirth: z.date().optional(),
      admissionDate: z.date().optional(),
      status: StudentStatusEnum.optional(),
      classId: z.string().optional(),
      houseId: z.string().nullable().optional(),
      parentId: z.string().nullable().optional(),
    }),
    allowedSortFields: ['admissionNumber', 'firstName', 'lastName', 'admissionDate', 'status', 'createdAt'],
    schoolScoped: true,
    softDelete: false,
  },

  parent: {
    type: 'parent',
    model: 'parent',
    fields: ['id', 'firstName', 'lastName', 'phone', 'email', 'address', 'occupation', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      phone: z.string().min(1),
      email: z.string().email().optional(),
      address: z.string().optional(),
      occupation: z.string().optional(),
    }),
    updateSchema: z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().optional(),
      occupation: z.string().optional(),
    }),
    allowedSortFields: ['firstName', 'lastName', 'phone', 'createdAt'],
    schoolScoped: true,
    softDelete: false,
  },
}
