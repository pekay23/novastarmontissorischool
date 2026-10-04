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
  GradingLevelCreateSchema,
  GradingLevelUpdateSchema,
  SyllabusSchema,
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

/** `HH:mm`, 00:00-23:59. Validated at the boundary because timetable columns are
 *  stored as text and sort as text. */
const HHMM_REGEX = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm')

/**
 * Cross-row invariants, named rather than implemented here.
 *
 * `shared-types` cannot import the rule: `@novastar/shared-utils` is not one of
 * its dependencies and adding that edge would put a database-facing, date-fns
 * importing module underneath the lowest layer of the type graph. So the entry
 * names a kind, `apps/portal`'s config route dispatches on it, and the rule lives
 * beside the validator the seed already calls — one implementation, one place
 * that decides what a valid scale is.
 *
 * Naming it here rather than branching on `entityType` in the route is the point:
 * the constraint travels with the definition of the entity, so registering a new
 * cross-row entity is a registry change and the route never learns the entity's
 * name.
 */
export type CrossRowWriteRuleKind = 'grading_scale_bands'

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
  /**
   * Whether the entity's model carries an `isActive` column.
   *
   * True makes the [id] route filter on `isActive: true` and make DELETE write
   * `isActive = false`, so it is only true for a model that HAS the column. False
   * means DELETE hard-deletes — the honest behaviour for a model that predates the
   * flag, until retirement is designed for it properly rather than inferred from a
   * column that does not exist.
   */
  softDelete: boolean
  /**
   * Set when a single write to this entity cannot be valid on its own — the row
   * is only meaningful beside its siblings. The generic route reads the kind,
   * looks the rule up, and refuses the write when the rule returns problems.
   */
  writeValidation?: { kind: CrossRowWriteRuleKind }
}

/**
 * Entity types whose Prisma model lacks a `schoolId` column.
 * These are tenant-scoped only — schoolId is never included in queries.
 */
export const TENANT_ONLY_ENTITY_TYPES = new Set([
  'grading_level',
  'subject_level',
  'fee_line_item',
  'timetable',
  'timetable_entry',
])

/**
 * Entity types whose Prisma model has an `isActive` Boolean column.
 * Used to implement soft-delete: DELETE sets isActive=false instead of hard-deleting.
 * Models with status enums (staff, student, parent) or `isSystem`/`status` fields
 * (role, news, event) are excluded — they have dedicated lifecycle management.
 *
 * A model with no `isActive` column must NOT appear here, and must not carry
 * `softDelete: true` either — the flag is what the [id] route reads, and it pushes
 * `isActive: true` into the where clause of every findFirst/update/delete, so a
 * model without the column 500s on every read, update and delete of that row.
 *
 * Reconciled against `schema.prisma` on 2026-10-03: three of the fourteen models
 * registered as soft-deletable actually have the column. The other eleven did not,
 * which is why a school could create a grading scale and then never read, edit or
 * retire one. Adding an `isActive` column to eleven pre-existing models is a
 * migration and a design question about what retiring a row should do to the
 * reports that reference it, so those entities hard-delete instead and say so on
 * their own entry. Verified by `softDeleteAudit.test.ts`.
 */
export const SOFT_DELETE_ENTITY_TYPES = new Set([
  'assessment_type',
  'fee_structure',
  'attendance_taker',
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
    // `AcademicYear` has no `isActive` column. `isCurrent` is its lifecycle flag
    // and it is a different question — which year reports default to — so it is
    // not read as "deleted". DELETE removes the row.
    softDelete: false,
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
    // `Term` has no `isActive` column. It carries a `status` enum (PLANNING,
    // ACTIVE, …), which is the lifecycle a term actually has and is edited through
    // the field below. DELETE removes the row, and its `Term` rows cascade with it.
    softDelete: false,
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
    // `ClassLevel` has no `isActive` column. A level is referenced by name and code
    // rather than soft-referenced, so retiring one by deletion is what the schema
    // already does everywhere else it is used.
    softDelete: false,
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
    // `Subject` has no `isActive` column. `isCore` says whether a subject is part of
    // the curriculum, not whether the row is still wanted, so it is not read as
    // "deleted". DELETE removes the row.
    softDelete: false,
  },

  // A scale names the bands a percentage is labelled under. `softDelete` is false
  // because `GradingScale` has no `isActive` column, and declaring it soft-deletable
  // made the [id] route push `isActive: true` into the where clause of its
  // findFirst, update and delete — so a school could create a grading scale and
  // could then never read, edit or retire one: every GET, PATCH and DELETE of the
  // row it had just made returned 500. POST was unaffected, which is why the failure
  // looked like "saving works" from the Settings dialog.
  //
  // Hard-deleting is the honest behaviour here rather than a guess: `Score.grade`
  // and `Score.gradingScaleId` reference the scale, and the report resolves the band
  // from the score's percentage against the school's current scale rather than from
  // the frozen key, so a retired scale degrades the same way a deleted one does.
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
    // No `isActive` column on `GradingScale` — see the comment above the entry.
    softDelete: false,
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
    // `FeeCategory` has no `isActive` column. `isRecurring` and `defaultMandatory`
    // describe the fee, not the row's lifecycle. DELETE removes the row; the
    // invoices that reference it keep their stored amounts.
    softDelete: false,
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
    // `PaymentMethodConfig` has no `isActive` column. `isEnabled` IS its lifecycle
    // flag and the field the school edits to stop offering a method, so a method a
    // school has turned off is already out of the way; DELETE removes the row.
    softDelete: false,
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
    }),
    updateSchema: z.object({
      name: z.string().optional(),
      description: z.string().nullable().optional(),
    }),
    allowedSortFields: ['name', 'isSystem', 'createdAt'],
    schoolScoped: true,
    softDelete: false,
  },

  // Continuous assessment is the school's own configuration: the components it
  // records (classwork, homework, SBA, quizzes, projects, exams) and what each is
  // worth live here, and this entry is what makes them editable at
  // /settings/entities instead of frozen in the seed.
  //
  // `schoolScoped: true` because the whole point is per-school divergence —
  // `@@unique([tenantId, schoolId, code])` lets each school retune a weight
  // without touching a sibling school's.
  //
  // `softDelete: true` is the retirement mechanism, not a second one: DELETE
  // writes `isActive = false` (see `SOFT_DELETE_ENTITY_TYPES`). Hard-deleting a
  // type would orphan every `Assessment` that points at it, and a retired type
  // still has to resolve for last term's report.
  assessment_type: {
    type: 'assessment_type',
    model: 'assessmentTypeConfig',
    fields: ['id', 'code', 'name', 'description', 'defaultWeight', 'maxScore', 'isActive', 'appliesToLevels', 'createdAt', 'updatedAt'],
    createSchema: AssessmentTypeConfigSchema.omit({
      id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true,
    }),
    updateSchema: z.object({
      code: z.string().optional(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      // Relative weight, not a share: the report normalises the weights it finds, so
      // the set is neither required to sum to 1 nor capped at 1 per row. Bounded to
      // match the column (`Decimal(3,2)` → 9.99) and to refuse a bare 0, which the
      // arithmetic would read as "unset" rather than as "excluded" — see
      // `AssessmentTypeConfigSchema` for the full reasoning.
      defaultWeight: z.number().positive({
        error:
          'Weight must be greater than 0. A weight of 0 cannot exclude a component: the ' +
          'report divides by the sum of the weights it finds, so a zero weight is ignored ' +
          'rather than excluded.',
      }).max(9.99, {
        error:
          'Weight must be at most 9.99 — that is the largest value the column stores ' +
          '(2 decimal places, 1 whole digit). Weight is relative, so 3 against 1 is fine.',
      }).optional(),
      maxScore: z.number().int().positive().optional(),
      isActive: z.boolean().optional(),
      appliesToLevels: z.array(z.string()).optional(),
    }),
    allowedSortFields: ['code', 'name', 'defaultWeight', 'isActive', 'createdAt'],
    schoolScoped: true,
    softDelete: true,
  },

  // A band. `softDelete` is false because `GradingLevel` has no `isActive`
  // column: the [id] route pushes `isActive: true` into the where clause for a
  // soft-deletable type, so declaring a band soft-deletable made every read,
  // update and delete of it ask Prisma for a field the model does not have —
  // which is why a school could not edit its own bands. Deleting a band
  // hard-deletes it; `Score.grade` keys that named it stop resolving, and the
  // report resolves the band from the score's percentage against the school's
  // current scale instead.
  //
  // `writeValidation` is the other half of that: a band is judged against every
  // other band of its scale, because no single row can be checked for coverage.
  // Without it, an admin retuning one boundary from 65 to 66 persisted a scale
  // where 65% matched no band and every child scoring 65 was reported in the band
  // below — and the seed's coverage check, the only one that existed, never ran
  // again. POST, PATCH and DELETE all route through it.
  grading_level: {
    type: 'grading_level',
    model: 'gradingLevel',
    fields: ['id', 'gradingScaleId', 'key', 'label', 'minScore', 'maxScore', 'color', 'description', 'order', 'createdAt', 'updatedAt'],
    createSchema: GradingLevelCreateSchema,
    updateSchema: GradingLevelUpdateSchema,
    allowedSortFields: ['order', 'key', 'minScore', 'createdAt'],
    schoolScoped: false,
    softDelete: false,
    writeValidation: { kind: 'grading_scale_bands' },
  },

  // Per-term topic lists for a class subject. `softDelete` is false because the
  // model carries a `status` enum and no `isActive` column: `SOFT_DELETE_ENTITY_TYPES`
  // excludes status-lifecycle models, and the [id] route would otherwise push
  // `isActive: true` into a where clause on a column that does not exist.
  syllabus: {
    type: 'syllabus',
    model: 'syllabus',
    fields: ['id', 'classSubjectId', 'termId', 'title', 'body', 'topics', 'status', 'createdAt', 'updatedAt'],
    createSchema: SyllabusSchema.omit({
      id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true,
    }),
    updateSchema: z.object({
      classSubjectId: z.string().optional(),
      termId: z.string().optional(),
      title: z.string().min(1).optional(),
      body: z.string().nullable().optional(),
      topics: z.array(z.string()).optional(),
      status: ContentStatusEnum.optional(),
    }),
    allowedSortFields: ['title', 'status', 'termId', 'classSubjectId', 'createdAt'],
    schoolScoped: true,
    softDelete: false,
  },

  // Neither Timetable nor TimetableEntry has a schoolId column, so both are
  // tenant-scoped: the generic route must not push schoolId into the where clause.
  timetable: {
    type: 'timetable',
    model: 'timetable',
    fields: ['id', 'classId', 'termId', 'name', 'isPublished', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      classId: z.string(),
      termId: z.string(),
      name: z.string().min(1),
      isPublished: z.boolean().default(false),
    }),
    updateSchema: z.object({
      classId: z.string().optional(),
      termId: z.string().optional(),
      name: z.string().optional(),
      isPublished: z.boolean().optional(),
    }),
    allowedSortFields: ['name', 'isPublished', 'createdAt'],
    schoolScoped: false,
    softDelete: false,
  },

  timetable_entry: {
    type: 'timetable_entry',
    model: 'timetableEntry',
    fields: ['id', 'timetableId', 'classSubjectId', 'dayOfWeek', 'startTime', 'endTime', 'room', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      timetableId: z.string(),
      classSubjectId: z.string(),
      dayOfWeek: z.number().int().min(1).max(7),
      // startTime is part of the unique constraint and is compared as text, so a
      // malformed value would both collide wrongly and sort wrongly. The columns
      // are documented "HH:mm"; enforce it at the boundary instead of in the DB.
      startTime: HHMM_REGEX,
      endTime: HHMM_REGEX,
      room: z.string().nullable().optional(),
    }),
    updateSchema: z.object({
      timetableId: z.string().optional(),
      classSubjectId: z.string().optional(),
      dayOfWeek: z.number().int().min(1).max(7).optional(),
      startTime: HHMM_REGEX.optional(),
      endTime: HHMM_REGEX.optional(),
      room: z.string().nullable().optional(),
    }),
    allowedSortFields: ['dayOfWeek', 'startTime', 'endTime', 'createdAt'],
    schoolScoped: false,
    softDelete: false,
  },

  // Has both a schoolId column and an isActive column, so it is school-scoped
  // and soft-deletable.
  attendance_taker: {
    type: 'attendance_taker',
    model: 'attendanceTaker',
    fields: ['id', 'classId', 'staffId', 'canMarkStudent', 'canMarkStaff', 'isActive', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      classId: z.string().nullable().optional(),
      staffId: z.string(),
      canMarkStudent: z.boolean().default(true),
      canMarkStaff: z.boolean().default(false),
    }),
    updateSchema: z.object({
      classId: z.string().nullable().optional(),
      staffId: z.string().optional(),
      canMarkStudent: z.boolean().optional(),
      canMarkStaff: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }),
    allowedSortFields: ['staffId', 'classId', 'isActive', 'createdAt'],
    schoolScoped: true,
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
    // `Branding` has no `isActive` column. A school has one branding row, so there
    // is no lifecycle to keep: DELETE removes the row.
    softDelete: false,
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
    // `Department` has no `isActive` column. DELETE removes the row; the staff rows
    // that name it set `departmentId` to null.
    softDelete: false,
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
    // `House` has no `isActive` column. DELETE removes the row; students keep their
    // marks with `houseId` null.
    softDelete: false,
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
    // `Class` has no `isActive` column, so a class cannot be soft-deleted even where
    // its lifecycle is real: `promotions-route` reads `ClassTerm.isActive`, a
    // different row, because that is the promotion state rather than the class's
    // existence. DELETE removes the class row.
    softDelete: false,
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
    // `SubjectLevel` has no `isActive` column. `isRequired` says whether a school
    // teaches the subject at the level, not whether the row is still wanted.
    softDelete: false,
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
    // `FeeLineItem` has no `isActive` column. `isMandatory` and `sortOrder` order
    // and qualify the line, they do not retire it. DELETE removes the line from its
    // structure; invoices already raised keep their stored amounts.
    softDelete: false,
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
