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
// A band is a percentage range plus the text and colour the school wants shown
// for it. There is no grade point: percentage is the unit of grading, `order`
// sequences the bands, and the 0-4 point that used to sit here existed only to
// feed the 0-4 average this product no longer reports.
const gradingLevelShape = {
  id: z.string().cuid(),
  gradingScaleId: z.string(),
  key: z.string(),
  label: z.string(),
  minScore: z.number().int().min(0).max(100),
  maxScore: z.number().int().min(0).max(100),
  color: z.string(),
  description: z.string().nullable().optional(),
  order: z.number().int(),
}

// Load-bearing from the moment a grade is computed: `determineGrade` picks the
// first band whose [minScore, maxScore] contains the score, so an inverted band
// silently swallows a range of scores and never reports a mismatch.
const assertBandOrder = (level: { minScore: number; maxScore: number }, ctx: { addIssue: (issue: { code: 'custom'; message: string; path: PropertyKey[] }) => void }) => {
  if (level.minScore > level.maxScore) {
    ctx.addIssue({
      code: 'custom',
      message: 'minScore must be less than or equal to maxScore',
      path: ['minScore'],
    })
  }
}

export const GradingLevelSchema = z.object(gradingLevelShape).superRefine(assertBandOrder)

// Zod 4 throws ".omit() cannot be used on object schemas containing refinements",
// so this cannot be derived from GradingLevelSchema with `.omit({ id: true })`.
// It is built from the same shape and the same check instead — a derived schema
// would have to drop the check, and the check is the whole point.
export const GradingLevelCreateSchema = z.object(gradingLevelShape)
  .omit({ id: true })
  .superRefine(assertBandOrder)

export type GradingLevel = z.infer<typeof GradingLevelSchema>

/**
 * The edit path's half of the band rule.
 *
 * `assertBandOrder` guards the create schema, and it used to guard nothing else:
 * a single PATCH could set `minScore` above `maxScore` and invert a seeded band,
 * which makes `resolveGradeBand` swallow a range of percentages and label it
 * backwards — silently, because an inverted band is still a band.
 *
 * Coverage ACROSS the scale is the other half and cannot live here: no single row
 * is exhaustive, `0-49` alone is a hole and a valid bottom half at the same time.
 * That half is the registry entry's `writeValidation` and the shared validator it
 * dispatches to (`gradingScaleBandWriteRule` in @novastar/shared-utils).
 */
export const GradingLevelUpdateSchema = z
  .object({
    gradingScaleId: z.string().optional(),
    key: z.string().optional(),
    label: z.string().optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    maxScore: z.number().int().min(0).max(100).optional(),
    color: z.string().optional(),
    order: z.number().int().optional(),
    description: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    // Only judged when the patch carries both bounds: a patch that moves one
    // boundary of a stored band is the normal way to retune a scale, and its
    // resulting range is the cross-row check's business, not this one's.
    if (value.minScore !== undefined && value.maxScore !== undefined) {
      assertBandOrder({ minScore: value.minScore, maxScore: value.maxScore }, ctx)
    }
  })

export const GradingScaleSchema = ConfigEntityBaseSchema.extend({
  name: z.string(),
  description: z.string().nullable().optional(),
  isDefault: z.boolean().default(false),
  appliesToLevels: z.array(z.string()),
  levels: z.array(GradingLevelSchema).optional(),
})

// --- Assessment ---
// `defaultWeight` is a RELATIVE weight, not a share of the terminal mark. A
// school's terminal figure is a normalised weighted mean
// (`sum(pct x weight) / sum(weight)`, see `computeAcademicSummary`), so only the
// ratio between components matters and the set need not sum to 1 — it usually
// cannot, because SBA repeats three times in a term. The 0..1 cap below is a
// sanity bound on a single row, not a promise that a school's seven types add up
// to 1; a head teacher retunes these at Settings and the report shows the
// resulting shares next to each component.
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

// --- Syllabi ---
// Declared after ContentStatusEnum because it uses it as its lifecycle field,
// matching the bottom-up dependency order the rest of this file follows.
export const SyllabusSchema = ConfigEntityBaseSchema.extend({
  classSubjectId: z.string(),
  termId: z.string(),
  title: z.string().min(1),
  body: z.string().nullable().optional(),
  topics: z.array(z.string()).default([]),
  status: ContentStatusEnum.default('DRAFT'),
})

export type Syllabus = z.infer<typeof SyllabusSchema>
