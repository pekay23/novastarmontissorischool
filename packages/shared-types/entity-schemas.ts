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

// --- Boundary date parsing ---

/**
 * What a client is told to send, rather than what it sent wrong.
 *
 * Named because it is stated more than once below, and because a union reports
 * which of its branches refused — so one shared sentence is what turns three
 * branch complaints into one instruction.
 */
const JSON_DATE_MESSAGE =
  'Expected an ISO-8601 date string such as "2026-09-01T00:00:00.000Z" ' +
  'or "2026-09-01", not a number or a boolean.'

/**
 * A date as it arrives over the wire, validated and left as a `Date`.
 *
 * JSON has no date type. A date in a request body is a STRING, and this schema is
 * the one place that fact is reconciled with the fact that Prisma wants a `Date`:
 * it accepts the wire form, rejects everything else, and hands the rest of the
 * program a real `Date`. It exists because the schemas below were built with
 * `z.date()`, which accepts only an actual `Date` instance — so on the JSON
 * boundary every create and update carrying a date was refused with a 400 for
 * real clients, while in-process callers (the seed, tests) passed and stayed
 * green.
 *
 * WHY NOT `z.coerce.date()`. Coercion is the one fix that looks right and is
 * wrong. `z.coerce.date()` runs the input through `new Date(...)`, and
 * `new Date(null)` is 1970-01-01, `new Date(0)` is 1970-01-01, and `new Date(true)`
 * is one millisecond after it. So a client that sent `null` for `publishedAt`, or
 * `0` for a date field, would get a row silently stamped at the epoch — no error,
 * no 400, just a date that is wrong by 56 years and looks plausible in a report.
 * A validation failure is recoverable; a wrong date that stored successfully is
 * not. This schema accepts a Date or an ISO-8601 string and nothing else, so
 * `null`, `0`, `1`, `true` and `""` are all rejected rather than guessed at.
 *
 * WHY ZOD'S OWN ISO VALIDATORS. The string branches are `z.iso.*`, not a regex
 * written here. The grammar is the library's to own: it is already the canonical
 * ISO-8601 check, it stays correct when Zod tightens it, and it rejects by
 * construction the things `Date.parse` waves through (`Date.parse('2026')` and
 * `Date.parse('Sep 1 2026')` are both valid, and neither is what a caller means).
 * The permissive options are required, not generosity — they are dictated by what
 * the portal's own settings form sends (`components/config/entity-form.tsx`):
 *
 * - `z.iso.date()` — `academic_year`/`term` dates are declared `type: 'date'`,
 *   rendered as `<input type="date">`, and submitted as `"2026-09-01"`. A plain
 *   `z.iso.datetime()` rejects that, so without this branch every academic-year
 *   and term write from the settings form would still 400 after the fix.
 * - `{ offset: true, local: true }` — `publishedAt` and the event dates are
 *   declared `type: 'datetime'`, rendered as `<input type="datetime-local">`, and
 *   submitted as `"2026-09-01T00:00"`: no offset, minute precision.
 *
 * The one honest caveat is `local: true`. A zone-less datetime means a different
 * instant depending on the host's timezone, because `new Date('2026-09-01T00:00')`
 * reads it as local time. The date-only form does not have this problem —
 * ECMAScript fixes `"2026-09-01"` at UTC midnight, so it is deterministic
 * everywhere. `local: true` is kept anyway because the alternative is refusing the
 * event and news editors' own input outright, and a value stored a few hours off
 * the browser's intent is recoverable in a way a 400 on every save is not.
 *
 * `z.instanceof(Date)` is in the union for the internal callers that never crossed
 * a wire — the seed, and tests that already hold a `Date`. It deliberately does NOT
 * also reject an `Invalid Date`: no untrusted input can produce one here (the ISO
 * branches gate every string), so that would be guarding a programmer error at the
 * wrong boundary, and it would stop a `Date` being accepted unchanged.
 *
 * WHY THE MESSAGE IS DECLARED TWICE. Once on the union, once per branch, and the
 * duplication looks like a mistake until you know what Zod 4 does with each. The
 * union's own `error` string reaches `error.issues` but is DISCARDED by
 * `error.format()`; a branch's `error` string survives `format()`. Both are needed
 * because the portal reads validation failures two incompatible ways:
 *
 * - The two config routes answer with `error.format()`
 *   (`apps/portal/app/api/config/[entityType]/route.ts`, `[id]/route.ts`), which
 *   the settings UI flattens field by field (`components/config/entity-list.tsx`,
 *   `issueLines`).
 * - The other ~39 routes answer with raw `error.issues`, which is the stricter of
 *   the two here — it carries Zod's internal `pattern` — so this schema must not
 *   push them toward it.
 *
 * With the message only on the union, the one client that reads the formatted tree
 * — the settings form a school administrator actually uses — was handed Zod's
 * internal branch complaints instead: "Invalid ISO datetime; Invalid ISO date;
 * Invalid input: expected Date, received string". Three complaints about a field
 * that wants one sentence. `format()` lists one entry per failing branch, so a
 * per-branch message shows the guidance a few times over; that repetition is the
 * price of `format()` being the transport, and it is still the difference between
 * a form that says what to type and one that names Zod's internals.
 *
 * `z.iso.datetime()` is the one branch that keeps its own default wording. Its
 * `error` parameter is not honoured the way `z.iso.date()`'s and
 * `z.instanceof()`'s are, and the string it contributes is a correct statement
 * about that branch, so overriding it would buy one fewer repetition at the cost of
 * claiming to describe a branch that has already described itself.
 */
export const JsonDateSchema = z
  .union(
    [
      z.iso.datetime({ offset: true, local: true }),
      z.iso.date({ error: JSON_DATE_MESSAGE }),
      z.instanceof(Date, { error: JSON_DATE_MESSAGE }),
    ],
    { error: JSON_DATE_MESSAGE },
  )
  // A Date is returned by reference rather than copied: `new Date(existing)` would
  // make a passing write look like a change of value, and callers that already hold
  // a Date should get back the object they handed in.
  .transform((value) => (value instanceof Date ? value : new Date(value)))

// --- Config Entity Base ---
export const ConfigEntityBaseSchema = z.object({
  id: z.string().cuid(),
  tenantId: z.string().cuid(),
  schoolId: z.string().nullable().optional(),
  // Deliberately still `z.date()`, unlike the business dates below. These two are
  // written by the database, not by a client: every derived create schema `.omit()`s
  // them, so no request body can reach this validator with one. Leave them alone —
  // they are not an oversight to be tidied up into `JsonDateSchema`.
  createdAt: z.date(),
  updatedAt: z.date(),
})

// --- Academic Structure ---
export const PhaseEnum = z.enum(['KINDERGARTEN', 'PRIMARY', 'JHS', 'SHS'])
export type Phase = z.infer<typeof PhaseEnum>

export const AcademicYearSchema = ConfigEntityBaseSchema.extend({
  name: z.string(),
  startDate: JsonDateSchema,
  endDate: JsonDateSchema,
  isCurrent: z.boolean().default(false),
})

export const TermStatusEnum = z.enum(['PLANNING', 'ACTIVE', 'ASSESSMENT', 'REPORTING', 'CLOSED'])
export type TermStatus = z.infer<typeof TermStatusEnum>

export const TermSchema = ConfigEntityBaseSchema.extend({
  name: z.string(),
  academicYearId: z.string(),
  startDate: JsonDateSchema,
  endDate: JsonDateSchema,
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

/**
 * The `@@unique([gradingScaleId, key])` and `@@unique([gradingScaleId, order])`
 * constraints, for a caller that holds a whole scale at once.
 *
 * Those two indexes are what turn "silently arbitrary" into a rejected write, because
 * band lookup is first-match: a duplicate key or a duplicate order position makes the
 * winning band a function of row order rather than of the score. A single-row write
 * leans on the index and gets a driver error. A BULK write cannot lean on it the same
 * way — the collision surfaces part-way through, after the rows before it are staged,
 * and the answer names a constraint rather than the two rows that met. So the rule
 * lives here next to the two shapes it is a uniqueness of, and every bulk path can ask
 * the same question once instead of each growing its own.
 *
 * Deliberately not `z.array(GradingLevelCreateSchema)`. The set a caller must judge is
 * the scale's STORED bands merged with the ones it is writing, and a stored band's
 * colour may predate `hexBandColor`; re-checking the whole create schema over the merge
 * would refuse a caller for a value it never mentioned. Only the two unique columns are
 * in the shape, and the range rules stay where they are — a single band is judged
 * against its scale by `gradeBandWriteProblems`, which is the one place that knows a
 * scale has to be built up over many writes.
 */
const assertBandPositionsUnique = (
  positions: readonly { key: string; order: number }[],
  ctx: { addIssue: (issue: { code: 'custom'; message: string; path: PropertyKey[] }) => void },
) => {
  const keyOwner = new Map<string, string>()
  const orderOwner = new Map<number, string>()
  positions.forEach((position, index) => {
    const existingKey = keyOwner.get(position.key)
    if (existingKey === undefined) {
      keyOwner.set(position.key, String(position.order))
    } else {
      ctx.addIssue({
        code: 'custom',
        message: `"${position.key}" is already on this scale at order ${existingKey}`,
        path: [index, 'key'],
      })
    }
    const existingOrder = orderOwner.get(position.order)
    if (existingOrder === undefined) {
      orderOwner.set(position.order, position.key)
    } else {
      ctx.addIssue({
        code: 'custom',
        message: `order ${position.order} is already claimed by "${existingOrder}"`,
        path: [index, 'order'],
      })
    }
  })
}

export const GradingLevelPositionSetSchema = z
  .array(z.object({ key: z.string(), order: z.number().int() }))
  .superRefine(assertBandPositionsUnique)

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
