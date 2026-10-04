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
// A band's `color` is the only value on a band that reaches a `style`
// attribute, so it is constrained to the one shape the report can act on:
// `#rrggbb`. The report colours its badge from this and decides light-or-dark
// text from it (`contrastTextColor`), and that decision is only correct for a hex
// triple. A named colour parses to nothing there: 'red' would be drawn with dark
// text at 4.26:1, below AA for the 12px label, and 'transparent' yields a badge
// with no background at all — neither of which a head teacher can see as a
// mistake on the settings form. One validator, shared by the full, create and
// update schemas, so a colour cannot enter by a different door.
const hexBandColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a hex colour such as #047857')

const gradingLevelShape = {
  id: z.string().cuid(),
  gradingScaleId: z.string(),
  key: z.string(),
  label: z.string(),
  minScore: z.number().int().min(0).max(100),
  maxScore: z.number().int().min(0).max(100),
  color: hexBandColor,
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
 * Coverage ACROSS the scale is the OTHER half, and it is NOT enforced here — the
 * registry entry's `writeValidation` refuses a band that runs backwards, one that
 * leaves 0-100, and two bands claiming the same percentage, and nothing else. It
 * does not refuse an interior hole or a scale that does not cover 0-100, because
 * a one-row write cannot tell them apart: `POST /api/config/grading_level` writes
 * one row per request, so the first half of a correct two-row retune is
 * indistinguishable from the mistyped boundary that caused the mis-grade, and
 * refusing every hole would make a complete scale unretunable. The hole is caught
 * at resolution instead (`resolveGradeBand` refuses to grade a percentage no band
 * claims and the report names the range), and coverage is checked only by the
 * seed's `assertBandsCoverZeroToHundred`. Do not read this schema, or
 * `writeValidation`, as a promise of continuous coverage.
 *
 * `gradingScaleId` stays here, and it stays a bare string, because the one client
 * of this schema submits the entity's whole field set on every edit: the generic
 * settings form is built from `DEFAULT_ENTITY_REGISTRY`, which declares
 * `gradingScaleId` as a required select, so every PATCH a school admin makes in
 * the UI carries the band's own scale whether or not they touched it. Dropping
 * the key here would make Zod strip it from every one of those edits — leaving an
 * admin who moves the select with a saved, successful edit that changed nothing —
 * and rejecting it would stop a band being edited in the UI at all.
 *
 * What makes it safe is not this schema but the write path: the config route
 * resolves the scale this key names and refuses the write with a 404 unless that
 * scale is the caller's own (`gradingScaleParentScopeWriteRule`). The bare string
 * is a reference to be proved, not a reference trusted to arrive.
 */
export const GradingLevelUpdateSchema = z
  .object({
    gradingScaleId: z.string().optional(),
    key: z.string().optional(),
    label: z.string().optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    maxScore: z.number().int().min(0).max(100).optional(),
    color: hexBandColor.optional(),
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
// cannot, because SBA repeats three times in a term. Requiring the set to sum to 1
// is therefore not available as an alternative to the cap below: this is a
// per-TYPE template and the rollup counts per-ASSESSMENT, so the weights present in
// one report are the template's set with every repeated type counted again.
//
// The bounds match what the column can hold and what the arithmetic can use:
//
// - Above zero, because 0 cannot mean "excluded". `resolveAssessmentWeight` treats a
//   non-positive weight as absent, so a stored 0 would silently be read as the type's
//   default rather than as an exclusion — the opposite of what the teacher who set it
//   meant, and the exclusion is not something the schema can record honestly yet (a
//   normalised mean with every weight at 0 has nothing to divide by). Refusing 0 at
//   the boundary is the only place the teacher can be told, and it is told why.
// - At most 9.99, which is the ceiling of `defaultWeight Decimal @db.Decimal(3, 2)`: one
//   integer digit, two decimals. The old cap of 1 refused legitimate ratios like
//   FINAL = 3.00 against SBA = 1.00, which the normalised mean handles correctly and
//   which the column stores exactly.
export const AssessmentTypeConfigSchema = ConfigEntityBaseSchema.extend({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  defaultWeight: z.number().positive({
    error:
      'Weight must be greater than 0. A weight of 0 cannot exclude a component: the report ' +
      'divides by the sum of the weights it finds, so a zero weight is ignored rather than ' +
      'excluded, and every component would then carry its type\'s own weight instead.',
  }).max(9.99, {
    error:
      'Weight must be at most 9.99 — that is the largest value the column stores ' +
      '(2 decimal places, 1 whole digit). Weight is relative, so 3 against 1 is fine.',
  }),
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
