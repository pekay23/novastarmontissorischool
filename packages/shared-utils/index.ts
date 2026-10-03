// ============================================================================
// Shared Utilities — Currency, Dates, Validation Helpers
// ============================================================================

import { format, parseISO, isValid, formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import type { Locale } from 'date-fns'

// --- Custom Twi locale (date-fns doesn't ship a Twi locale) ---
// Falls back to English formatting until full Twi locale data is provided.
// https://date-fns.org/v4.1.0/docs/Locale
const tw: Locale = {
  ...enUS,
  code: 'tw',
}

// --- Currency (Ghana Cedis) ---

export function formatGHS(amount: number | string | null | undefined): string {
  const num = parseFloat(String(amount || 0))
  if (isNaN(num)) return '₵0.00'
  return `₵${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[₵,\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

export function formatPhone(phone: string): string {
  // Ghana phone number formatting: +233 55 441 6937
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 9 && cleaned.startsWith('0')) {
    return `+233 ${cleaned.slice(1, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`
  }
  if (cleaned.length === 12 && cleaned.startsWith('233')) {
    return `+233 ${cleaned.slice(3, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`
  }
  return phone
}

// --- Date Formatting ---

export type LocaleType = 'en' | 'tw'

export function formatDate(date: Date | string | null | undefined, locale: LocaleType = 'en'): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '—'

  const loc = locale === 'tw' ? tw : enUS
  return format(d, 'PP', { locale: loc })
}

export function formatDateTime(date: Date | string | null | undefined, locale: LocaleType = 'en'): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '—'

  const loc = locale === 'tw' ? tw : enUS
  return format(d, 'PPpp', { locale: loc })
}

export function timeAgo(date: Date | string | null | undefined, locale: LocaleType = 'en'): string {
  if (!date) return '—'
  try {
    const d = typeof date === 'string' ? parseISO(date) : date
    if (!isValid(d)) return '—'

    const loc = locale === 'tw' ? tw : enUS
    return formatDistanceToNow(d, { addSuffix: true, locale: loc })
  } catch {
    return '—'
  }
}

export function formatDateRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  locale: LocaleType = 'en'
): string {
  return `${formatDate(start, locale)} — ${formatDate(end, locale)}`
}

// --- ID Generation ---

export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function generateStudentId(year: number, sequence: number): string {
  const yy = String(year).slice(-2)
  const seq = String(sequence).padStart(3, '0')
  return `NOVA${yy}${seq}`
}

export function generateInvoiceNumber(year: number, sequence: number): string {
  const yy = String(year).slice(-2)
  const seq = String(sequence).padStart(4, '0')
  return `INV${yy}${seq}`
}

// --- Validation Helpers ---

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function validateGhanaPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '')
  return (cleaned.length === 9 && cleaned.startsWith('0')) ||
         (cleaned.length === 12 && cleaned.startsWith('233'))
}

export function validateGhanaID(id: string): boolean {
  // Ghanaian ID: 10 or 12 digits
  const cleaned = id.replace(/\D/g, '')
  return cleaned.length === 10 || cleaned.length === 12
}

// --- Percentage Calculations ---

export function calculatePercentage(marks: number, total: number): number {
  if (total === 0) return 0
  return Math.round((marks / total) * 100 * 100) / 100
}

export function calculateAverage(scores: number[]): number {
  if (scores.length === 0) return 0
  return scores.reduce((sum, s) => sum + s, 0) / scores.length
}

// --- Weights ---
//
// One rule, shared by every weighted mean in this package.
// `calculateWeightedAverage` below, `resolveAssessmentWeight` further down, and
// `computeAcademicSummary` all compose with `weightedMean`; none of them divides
// by a weight sum it has not first made computable.

/** Last resort when neither the assessment nor its type carries a usable weight. */
const FALLBACK_ASSESSMENT_WEIGHT = 1

/**
 * A weight that can actually be divided by: finite and above zero.
 *
 * Zero is rejected here, and that is a decision rather than an oversight — see
 * `resolveAssessmentWeight` for why an explicit 0 cannot mean "excluded" yet.
 */
function positiveWeight(weight: number | null | undefined): number | null {
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0
    ? weight
    : null
}

/**
 * `sum(value * weight) / sum(weight)`, or null when nothing was weighted.
 *
 * Null rather than 0 because 0 is a real answer for a percentage and a
 * fabricated one here: no graded assessment is "scored zero percent". Callers
 * that owe the caller a number (the legacy `calculateWeightedAverage` contract)
 * map null to 0 themselves.
 *
 * A weight of 0 is arithmetically inert rather than dangerous: it adds nothing to
 * either sum, so such a row cannot move the answer, and the `totalWeight > 0`
 * guard means a set that is entirely zeros still returns null instead of
 * dividing by it. Nothing here can produce NaN or Infinity from any weight.
 */
function weightedMean(
  items: ReadonlyArray<{ value: number; weight: number }>,
): number | null {
  let weightedSum = 0
  let totalWeight = 0
  for (const item of items) {
    weightedSum += item.value * item.weight
    totalWeight += item.weight
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null
}

/**
 * The weighted mean of `items`, `defaultWeight` standing in for a missing or
 * unusable weight.
 *
 * Composition is a **normalised** weighted mean, `sum(x x w) / sum(w)`, so only
 * the ratio between weights matters. A school's configured weights need not sum
 * to 1 and cannot be required to: SBA is recorded three times in a term, so the
 * weights actually present in one rollup routinely exceed the template's sum.
 * Absolute shares would overflow past 100%; normalisation cannot.
 *
 * Returns 0 for an empty list or an all-zero weight sum, which is this
 * function's long-standing contract. `computeAcademicSummary` reports null
 * instead, because a report card must not print a fabricated zero.
 */
export function calculateWeightedAverage(
  items: Array<{ score: number; weight: number }>,
  defaultWeight: number = FALLBACK_ASSESSMENT_WEIGHT
): number {
  const fallback = positiveWeight(defaultWeight) ?? FALLBACK_ASSESSMENT_WEIGHT
  return (
    weightedMean(
      items.map((item) => ({
        value: item.score,
        weight: positiveWeight(item.weight) ?? fallback,
      })),
    ) ?? 0
  )
}

// --- Grade Calculation ---

/**
 * The only fields a band must have to be resolvable. Everything else is
 * presentation and is carried through when the caller supplied it.
 */
export interface GradeBandBounds {
  minScore: number
  maxScore: number
}

/**
 * One band of a grading scale, as the report sees it.
 *
 * Structural rather than imported from the generated Prisma client: this package
 * must not depend on the schema.
 */
export interface GradeBand extends GradeBandBounds {
  key: string
  label: string
  color: string
  description?: string | null
  order?: number
}

/** The band shape `resolveGradeBand` hands back: the caller's rows, plus whatever display fields they carried. */
export type ResolvedBand<T extends GradeBandBounds> = T &
  Partial<Omit<GradeBand, keyof GradeBandBounds>>

/**
 * What a coverage check needs from a band: its name to quote in a message, its
 * range, and its id when the band is a stored row rather than one being written.
 */
export interface NamedGradeBand extends GradeBandBounds {
  key: string
  /** Set on a stored row; absent on a band that does not exist yet. */
  id?: string | null
}

/**
 * A band that runs backwards, or reaches outside the percentage range at all.
 *
 * Both are per-row facts: nothing about a sibling is needed to decide them, which
 * is what makes them safe to enforce on a single-row write.
 */
function findGradeBandBoundsProblems(bands: readonly NamedGradeBand[]): string[] {
  const problems: string[] = []
  for (const band of bands) {
    if (band.minScore > band.maxScore) {
      problems.push(
        `${band.key} runs backwards: minScore ${band.minScore} is above maxScore ${band.maxScore}`,
      )
    } else if (band.minScore < 0 || band.maxScore > 100) {
      problems.push(
        `${band.key} covers ${band.minScore}-${band.maxScore}, outside 0-100`,
      )
    }
  }
  return problems
}

/** Two bands claiming the same percentage, which makes the label depend on row order. */
function findGradeBandOverlapProblems(bands: readonly NamedGradeBand[]): string[] {
  const problems: string[] = []
  // Inverted bands are skipped: their range cannot be reasoned about against their
  // neighbours, and `findGradeBandBoundsProblems` has already named them.
  const ordered = bands
    .filter((band) => band.minScore <= band.maxScore)
    .sort((a, b) => a.minScore - b.minScore)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!
    const overlapFrom = Math.max(previous.minScore, current.minScore)
    const overlapTo = Math.min(previous.maxScore, current.maxScore)
    if (overlapTo >= overlapFrom) {
      problems.push(
        `${previous.key} (${previous.minScore}-${previous.maxScore}) and ${current.key} (${current.minScore}-${current.maxScore}) both claim ${overlapFrom}-${overlapTo}`,
      )
    }
  }
  return problems
}

/** Percentages between two bands that no band claims. */
function findGradeBandHoleProblems(bands: readonly NamedGradeBand[]): string[] {
  const problems: string[] = []
  const ordered = bands
    .filter((band) => band.minScore <= band.maxScore)
    .sort((a, b) => a.minScore - b.minScore)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!
    if (Math.min(previous.maxScore, current.maxScore) >= Math.max(previous.minScore, current.minScore)) {
      continue
    }
    const holeFrom = previous.maxScore + 1
    const holeTo = current.minScore - 1
    if (holeTo >= holeFrom) {
      problems.push(
        `${holeFrom}-${holeTo}% falls between ${previous.key} and ${current.key} and matches no band`,
      )
    }
  }
  return problems
}

/**
 * Every way a set of bands mis-grades a child, as sentences a head teacher can
 * act on. An empty list means the set cannot mis-grade.
 *
 * Four defects, and the edges deliberately are not among them:
 *
 * 1. a band that runs backwards (`minScore > maxScore`), which swallows a range of
 *    percentages and labels it the wrong way round;
 * 2. a band reaching outside 0-100, which no percentage can land in at all;
 * 3. an overlap, where one percentage belongs to two bands and the winner becomes
 *    a function of row order rather than of the score;
 * 4. a hole BETWEEN two bands, where a percentage belongs to none and — this is
 *    the defect that reached a child — silently inherited the band below it. A
 *    band admin who mistyped a boundary from 65 to 66 left 65 claimed by nobody,
 *    and every child scoring exactly 65 was reported in the band beneath.
 *
 * A scale that does not reach 0, or does not reach 100, is NOT a defect here: a
 * school that reports nothing below 50 has decided something legitimate, and a
 * scale still being built one band at a time looks the same. There is no reading
 * of a mid-scale hole that is not a mis-grade, which is why that one is fatal
 * everywhere while the edges are not. `findGradeBandCoverageGaps` reports the
 * edges, and `assertBandsCoverZeroToHundred` is the strict form that requires the
 * whole 0-100 span.
 */
export function findGradeBandDefects(
  bands: readonly NamedGradeBand[],
): string[] {
  return [
    ...findGradeBandBoundsProblems(bands),
    ...findGradeBandOverlapProblems(bands),
    ...findGradeBandHoleProblems(bands),
  ]
}

/**
 * The subset of `findGradeBandDefects` a single-row write is allowed to refuse.
 *
 * This is the honest limit of the admin write path, and the hole is deliberately
 * missing from it. `POST /api/config/grading_level` writes one row per request, so
 * every intermediate state of a retune has to be a state the school may hold:
 *
 * - Moving `level_4` from 60-69 to 60-64 — the FIRST half of a correct two-row
 *   retune to 60-64/65-69 — is the very same single-row write as moving it from
 *   60-69 to 66-69, which is the mistyped boundary that mis-graded a child. The
 *   rows before and after are byte-identical; only the admin's intent differs, and
 *   intent is not in the database.
 * - So refusing every hole would not make the scale safe, it would make it
 *   unretunable: on a complete 0-100 scale, ANY single-row edit that moves a
 *   boundary leaves either a hole or an overlap, so a hole-free rule on a
 *   one-row write forbids every boundary change forever, including widening a
 *   band before deleting its neighbour.
 *
 * What IS refused here is what no legitimate intermediate state contains: a band
 * that runs backwards, a band outside 0-100, and two bands claiming the same
 * percentage. The hole is enforced where it can actually be decided — at
 * resolution, which refuses to grade a percentage no band claims and says which
 * range is at fault rather than guessing the band beneath it.
 */
export function findGradeBandWriteConflicts(
  bands: readonly NamedGradeBand[],
): string[] {
  return [
    ...findGradeBandBoundsProblems(bands),
    ...findGradeBandOverlapProblems(bands),
  ]
}

/**
 * The percentages no band claims at either end of 0-100. Non-empty means the
 * scale does not cover the whole percentage range, which the seed refuses and a
 * hand-configured scale may still be on its way to.
 */
export function findGradeBandCoverageGaps(
  bands: readonly NamedGradeBand[],
): string[] {
  const ordered = bands
    .filter((band) => band.minScore <= band.maxScore)
    .sort((a, b) => a.minScore - b.minScore)
  if (ordered.length === 0) return ['the scale has no bands']
  const problems: string[] = []
  const first = ordered[0]!
  const last = ordered[ordered.length - 1]!
  if (first.minScore > 0) problems.push(`no band covers 0-${first.minScore - 1}%`)
  if (last.maxScore < 100) {
    problems.push(`no band covers ${last.maxScore + 1}-100%`)
  }
  return problems
}

/**
 * Refuse a grading scale that does not cover 0-100 exactly once.
 *
 * The one implementation of that rule. The seed calls it before it writes, and it
 * throws rather than returning a verdict so a caller that forgets to check cannot
 * proceed silently — which is what happened when the check lived only in the seed
 * and the admin write path had none at all.
 */
export function assertBandsCoverZeroToHundred(
  scaleName: string,
  bands: ReadonlyArray<NamedGradeBand>,
): void {
  const problems = [
    ...findGradeBandDefects(bands),
    ...findGradeBandCoverageGaps(bands),
  ]
  if (problems.length > 0) {
    throw new Error(
      `Grading scale "${scaleName}" does not cover 0-100 exactly once: ${problems.join('; ')}.`,
    )
  }
}

/** One band as the admin write path sees it, before it becomes a stored row. */
export interface GradeBandWrite extends GradeBandBounds {
  key: string
  id?: string | null
}

/**
 * What a cross-row write rule is handed by the route that drives it.
 *
 * The rule gets a reader rather than a database client so this stays a module
 * with no database dependency: `apps/portal` supplies the read, and the
 * invariant lives next to the validator the seed uses.
 */
export interface CrossRowWriteContext {
  operation: 'create' | 'update' | 'delete'
  /** The row as it will be stored, already Zod-validated. */
  write: Record<string, unknown>
  /** The stored row being replaced or deleted; null on create. */
  existing: Record<string, unknown> | null
  /** Every band currently stored for a scale. */
  readScaleBands: (gradingScaleId: string) => Promise<readonly NamedGradeBand[]>
}

/** A cross-row invariant, judged against more than the row being written. */
export type CrossRowWriteRule = (
  context: CrossRowWriteContext,
) => Promise<string[]> | string[]

function recordString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function recordNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Why a single band write must be refused, judged against the whole scale it
 * would leave behind.
 *
 * A band is never exhaustive on its own — `0-49` alone is a hole, and a valid
 * bottom half of a scale — so this cannot be a refinement on the row. The caller
 * reads the scale's stored bands, replaces the row being edited (or omits it, for
 * a delete), and asks here.
 *
 * Fewer than two bands in the result is always accepted: there is nothing to
 * overlap and no interior hole, which is what lets a school build a scale one
 * band at a time through an endpoint that writes one row per request.
 *
 * Refuses exactly `findGradeBandWriteConflicts`, and the doc on that function is
 * the reason a hole is not among them. Deleting a middle band is allowed for the
 * same reason: it is a legitimate step of a restructure, and the range it leaves
 * uncovered is reported by `resolveGradeBand` rather than guessed at.
 */
export function gradeBandWriteProblems(params: {
  /** The row as it will be stored, or null when the write deletes it. */
  write: GradeBandWrite | null
  /** Every band currently stored for the scale this write lands in. */
  stored: readonly NamedGradeBand[]
  /** The id of the row being edited or deleted, so it is not counted twice. */
  editedId: string | null
}): string[] {
  const { write, stored, editedId } = params
  const survivors = stored.filter((band) => band.id !== editedId)
  const prospective =
    write === null ? survivors : [...survivors, { ...write, id: editedId }]
  if (prospective.length < 2) return []
  return findGradeBandWriteConflicts(prospective)
}

/**
 * The `grading_level` rule: one band write must leave its scale able to grade.
 *
 * Registered by kind from the entity registry (`ENTITY_CONFIG_MAP`), so the
 * constraint travels with the definition of the entity rather than living as a
 * branch in the route. A create is judged against the scale it names; an update
 * against the scale it names or, without one, the scale the row already belongs
 * to — so moving a band between scales is validated against the destination.
 */
export const gradingScaleBandWriteRule: CrossRowWriteRule = async (context) => {
  const scaleId =
    recordString(context.write.gradingScaleId) ??
    recordString(context.existing?.gradingScaleId)
  if (scaleId === null) return []
  const existingId = recordString(context.existing?.id)
  const stored = await context.readScaleBands(scaleId)

  // A delete removes the row; anything else leaves it in place with the written
  // fields merged over the stored ones, which is what the database will hold.
  const minScore =
    recordNumber(context.write.minScore) ?? recordNumber(context.existing?.minScore)
  const maxScore =
    recordNumber(context.write.maxScore) ?? recordNumber(context.existing?.maxScore)
  if (minScore === null || maxScore === null) {
    // The row's own schema requires both bounds, so a validated payload always
    // reaches here with both. Answering nothing rather than guessing keeps a
    // malformed caller from inventing a range to judge.
    return []
  }
  const write: GradeBandWrite | null =
    context.operation === 'delete'
      ? null
      : {
          key:
            recordString(context.write.key) ??
            recordString(context.existing?.key) ??
            '',
          minScore,
          maxScore,
        }

  return gradeBandWriteProblems({
    write,
    stored,
    editedId: existingId,
  })
}

/**
 * The band a percentage falls in, with everything the report needs to show it.
 *
 * Exactly one match on `[minScore, maxScore]`, and the report uses this rather
 * than the `Score.grade` key it is given for two reasons:
 *
 * 1. A band is only meaningful against the scale that defines it. `Score.grade`
 *    froze a key when the score was written; if the school has since retuned its
 *    bands, replaying the old key reports a label the school no longer uses.
 * 2. Resolving from the percentage means the report never has to interpret a key
 *    from an unknown scale, so a key written before `gradingScaleId` existed — or
 *    one whose band has since been deleted — degrades to the school's current
 *    bands instead of rendering nothing.
 *
 * What it does with a malformed scale is the whole point: it refuses rather than
 * guesses, because a guess here lands on a child. A percentage two bands claim is
 * ambiguous, and a percentage that falls in a hole between two bands belongs to
 * neither — the earlier code let both fall through to "the nearest band beneath",
 * which reported a child who scored exactly 65 in the band below when an admin
 * mistyped one boundary from 65 to 66. Both now resolve to null, and
 * `findGradeBandDefects` is what names the cause.
 *
 * One out-of-scale case still resolves, and only one: a percentage ABOVE the top
 * band. Nothing beneath it is missing — the score has run off the end of the
 * school's scale — so the top band is the last label the school defined before
 * that happened, and reporting it is honest where inventing a better band would
 * not be. Below the bottom band there is nothing beneath either, so it stays
 * ungraded rather than being called the worst band the school happens to name.
 */
export function resolveGradeBand<T extends GradeBandBounds>(
  percentage: number,
  gradingScale: readonly T[],
): ResolvedBand<T> | null {
  if (!Number.isFinite(percentage) || gradingScale.length === 0) return null
  const claimed = gradingScale.filter(
    (band) => percentage >= band.minScore && percentage <= band.maxScore,
  )
  // Two bands claiming one percentage is the overlap defect: answering here would
  // make the winning band a function of row order rather than of the score.
  if (claimed.length > 1) return null
  if (claimed.length === 1) return claimed[0]!
  const ceiling = gradingScale.reduce(
    (top, band) => Math.max(top, band.maxScore),
    Number.NEGATIVE_INFINITY,
  )
  if (percentage <= ceiling) return null
  const below = gradingScale.filter((band) => band.minScore <= percentage)
  const nearest = below.reduce((best, band) =>
    band.minScore > best.minScore ? band : best,
  below[0]!)
  // Two bands sharing the boundary this would land on is the same ambiguity as an
  // overlap, so it is refused for the same reason rather than resolved by row order.
  if (below.filter((band) => band.minScore === nearest.minScore).length > 1) {
    return null
  }
  return nearest
}

export function determineGrade(
  percentage: number,
  gradingScale: Array<{ minScore: number; maxScore: number; key: string; label: string }>
): { grade: string; key: string; label: string } | null {
  const matched = resolveGradeBand(percentage, gradingScale)
  if (!matched) return null
  return { grade: matched.label, key: matched.key, label: matched.label }
}

/**
 * The grading scale that applies to a class level: one whose
 * `appliesToLevels` names the level, else the tenant default, else null.
 *
 * One rule, shared by every writer and reader of `Score.grade`: the level
 * *code* is matched first and the level *name* second, because the seed stores
 * codes ('B1'..'B9') in `appliesToLevels`. `POST /api/assessments/[id]/scores`
 * resolves its scale with this rule and stores the resulting band `key`, so a
 * report that resolved it any other way would grade the same student's work
 * against a different band from the one the gradebook used.
 */
export function resolveApplicableGradingScale<T extends {
  appliesToLevels: readonly string[]
  isDefault: boolean
}>(
  scales: readonly T[],
  levelKeys: ReadonlyArray<string | null | undefined>,
): T | null {
  const keys = levelKeys.filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  )
  return (
    scales.find((scale) => keys.some((key) => scale.appliesToLevels.includes(key))) ??
    scales.find((scale) => scale.isDefault) ??
    null
  )
}

// --- Academic Summary Metrics ---

/** One assessment as the report sees it, after the score join. */
export interface ReportableAssessment {
  /** Stable subject identity. Grouping is by id, not by name: two subjects may share a display name and a name may be renamed mid-term. */
  subjectId: string
  /** 0-100, or null when the assessment is ungraded. */
  percentage: number | null
  /**
   * The assessment's own weight as stored, or null when it carries none.
   *
   * Null is a real state, not a gap in the type: the column is nullable so that
   * "unset" and "explicitly 1.00" are distinguishable. See
   * `resolveAssessmentWeight`.
   */
  weight: number | null
  /**
   * `AssessmentTypeConfig.defaultWeight` — the weight the school configured for
   * this assessment's type, or null when the type declares none. The fallback
   * that makes continuous assessment the school's own configuration: a type's
   * configured weight reaches the report even for an assessment row that was
   * never given one of its own.
   */
  typeDefaultWeight?: number | null
  /** Assessment-type identity, for the weighting breakdown. */
  assessmentType?: string | null
  assessmentTypeCode?: string | null
}

/** One continuous-assessment component, aggregated over the assessments of a type. */
export interface WeightingComponent {
  /** `AssessmentTypeConfig.code`, or null when the assessment has no type row. */
  code: string | null
  name: string
  /** How many graded assessments of this type contributed. */
  count: number
  /** The relative weight each assessment of this type carried. */
  weight: number
  /** That weight as a share of the total, 0-100. Null when the total is zero. */
  weightShare: number | null
  /** This component's own weighted mean percentage, 0-100. */
  percentage: number | null
}

/** How a terminal percentage was composed, so a teacher can see why it is what it is. */
export interface WeightingBreakdown {
  /** The composition rule, stated on the payload. Always `normalised-weighted-mean`. */
  rule: 'normalised-weighted-mean'
  /** Sum of the resolved weights of the graded assessments, before normalisation. */
  totalWeight: number
  components: WeightingComponent[]
}

export interface SubjectSummary {
  subjectId: string
  /** 0-100, weighted within the subject. Null when the subject's weights sum to zero. */
  percentage: number | null
  gradedAssessments: number
  /** How this subject's own percentage was composed. */
  weighting: WeightingBreakdown
  /** The school-configured band this percentage falls in, or null when the school has no applicable scale. */
  band: GradeBand | null
  /**
   * Why `band` is null when the school's own scale is why, in the words
   * `findGradeBandDefects` produces. Null in the ordinary case — the percentage
   * resolved, or the school simply has no scale for this class — and non-null
   * only when a band was withheld because the scale cannot grade without
   * guessing. It travels on the payload so a missing band is reported as a
   * misconfigured scale rather than rendered as a blank cell.
   */
  bandProblem: string | null
}

export interface AcademicSummaryMetrics {
  gradedAssessments: number
  /** Weighted mean of percentages across every graded assessment, 0-100. */
  weightedPercentage: number | null
  /** Mean of the per-subject percentages, 0-100. */
  overallPercentage: number | null
  /** How the weighted mean was composed, by assessment type. */
  weighting: WeightingBreakdown
  /** Subjects that contributed at least one graded assessment. */
  subjectCount: number
  subjects: SubjectSummary[]
}

/** Where a resolved weight came from, so the report can say so rather than guess. */
export type AssessmentWeightSource = 'assessment' | 'assessment_type' | 'default'

export interface ResolvedAssessmentWeight {
  weight: number
  source: AssessmentWeightSource
}

/**
 * The weight one assessment contributes under.
 *
 * Precedence, in one place so the report, the gradebook and any future consumer
 * cannot disagree:
 *
 * 1. the assessment's own weight, whenever it carries a usable one;
 * 2. the weight the school configured for its assessment type
 *    (`AssessmentTypeConfig.defaultWeight`);
 * 3. 1 — equal weighting.
 *
 * "Carries a weight" means the column is not NULL. `Assessment.weight` is
 * nullable precisely so that "this assessment has no weight of its own" and "a
 * teacher set this one to 1.00" are two different facts. It used to be
 * `NOT NULL DEFAULT 1`, which made them the same stored value and forced a
 * sentinel that overloaded 1: a teacher who deliberately chose a weight of
 * exactly 1.00 for one assessment had it discarded and the type's default used
 * instead, silently. There is no sentinel here now, and no value that means two
 * things — a school can run one assessment fully weighted, at 1.00, and get 1.00.
 *
 * An explicit 0 is NOT "excluded from the average". It is an unusable weight
 * that falls through to the type default, for two reasons. A normalised weighted
 * mean with every weight at 0 has nothing to divide by, so a school that excluded
 * every one of its assessments would get an undefined terminal figure rather than
 * a result; and the read path hands this function `Number(assessment.weight)`,
 * which turns the column's NULL into 0 — so treating 0 as "excluded" would
 * silently drop every assessment that carries no weight of its own, which is the
 * majority of them. Exclusion needs a stored value NULL cannot impersonate and a
 * boundary that rejects a bare 0; neither exists, and inventing one here would
 * mis-grade a term rather than protect one. `positiveWeight` is therefore the
 * single place that decides what a usable weight is.
 *
 * Composition is a normalised weighted mean, so these are relative weights: see
 * `calculateWeightedAverage`.
 */
export function resolveAssessmentWeight(
  assessment: Pick<ReportableAssessment, 'weight' | 'typeDefaultWeight'>,
): ResolvedAssessmentWeight {
  const own = positiveWeight(assessment.weight)
  if (own !== null) return { weight: own, source: 'assessment' }
  const configured = positiveWeight(assessment.typeDefaultWeight)
  if (configured !== null) return { weight: configured, source: 'assessment_type' }
  return { weight: FALLBACK_ASSESSMENT_WEIGHT, source: 'default' }
}

function round2(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.round(value * 100) / 100
}

/**
 * Group graded assessments by assessment type and report what each contributed.
 *
 * Components are ordered by weight share, heaviest first, and share is
 * `weight * count / totalWeight * 100` — the share of the terminal figure the
 * component actually carries, which is not the configured weight when a type was
 * recorded three times. This is the block that answers "why is this child on
 * 72%", and it is why `weightShare` is reported rather than the raw weight alone.
 */
function buildWeightingBreakdown(
  rows: readonly ReportableAssessment[],
): WeightingBreakdown {
  let totalWeight = 0
  const grouped = new Map<string, { name: string; weight: number; count: number; rows: ReportableAssessment[] }>()
  const order: string[] = []

  for (const row of rows) {
    const { weight } = resolveAssessmentWeight(row)
    totalWeight += weight
    const key = row.assessmentTypeCode ?? row.assessmentType ?? ''
    const bucket = grouped.get(key)
    if (bucket) {
      bucket.weight += weight
      bucket.count += 1
      bucket.rows.push(row)
    } else {
      grouped.set(key, {
        name: row.assessmentType ?? 'Untyped',
        weight,
        count: 1,
        rows: [row],
      })
      order.push(key)
    }
  }

  const components = order.map((key) => {
    const bucket = grouped.get(key)!
    return {
      code: key === '' ? null : key,
      name: bucket.name,
      count: bucket.count,
      weight: round2(bucket.weight) ?? 0,
      weightShare:
        totalWeight > 0 ? round2((bucket.weight / totalWeight) * 100) : null,
      percentage: round2(
        weightedMean(
          bucket.rows.map((row) => ({
            value: row.percentage as number,
            weight: resolveAssessmentWeight(row).weight,
          })),
        ),
      ),
    }
  })

  components.sort(
    (a, b) => (b.weightShare ?? 0) - (a.weightShare ?? 0) || a.name.localeCompare(b.name),
  )

  return { rule: 'normalised-weighted-mean', totalWeight: round2(totalWeight) ?? 0, components }
}

/**
 * Every summary figure a report card shows, from one flat assessment list.
 *
 * The two percentage figures answer different questions and are deliberately
 * not the same number:
 *
 * - `weightedPercentage` is `sum(pct x weight) / sum(weight)` across every
 *   graded assessment. It is the mean *mark*, so a subject with more
 *   assessments contributes more of it.
 * - `overallPercentage` is the mean of the per-subject percentages, where each
 *   subject's own percentage is already weighted internally. Every subject
 *   counts once regardless of how many assessments it has, so ten HOMEWORK
 *   rows cannot outvote one FINAL.
 *
 * There is no grade point here, and nothing to average: percentage is the unit
 * of grading in this product. The 0-4 average that used to sit on this function
 * was measured on `GradingLevel.point`, a column invented for it and since
 * removed — a Ghanaian primary or JHS terminal report has no use for it, and a
 * band label is what a parent is shown.
 *
 * `bands` is the school's own scale for this class's level. It is passed in
 * rather than resolved here so this stays a pure function of its arguments, and
 * no caller has to re-implement `resolveApplicableGradingScale` to get a band.
 */
export function computeAcademicSummary(
  assessments: readonly ReportableAssessment[],
  bands: readonly GradeBand[] = [],
): AcademicSummaryMetrics {
  const graded = assessments.filter(
    (a) => a.percentage !== null && Number.isFinite(a.percentage),
  )

  // Computed once for the whole summary: it describes the scale, not a score, and
  // it is what turns a withheld band into a stated reason.
  const scaleDefects = findGradeBandDefects(bands)

  // Insertion-ordered so the subject list follows the report's own ordering
  // rather than a Map iteration surprise.
  const subjectOrder: string[] = []
  const bySubject = new Map<string, ReportableAssessment[]>()
  for (const assessment of graded) {
    const bucket = bySubject.get(assessment.subjectId)
    if (bucket) {
      bucket.push(assessment)
    } else {
      bySubject.set(assessment.subjectId, [assessment])
      subjectOrder.push(assessment.subjectId)
    }
  }

  const subjects = subjectOrder.map((subjectId) => {
    const rows = bySubject.get(subjectId) ?? []
    const percentage = round2(
      weightedMean(
        rows.map((row) => ({
          value: row.percentage as number,
          weight: resolveAssessmentWeight(row).weight,
        })),
      ),
    )
    return {
      subjectId,
      gradedAssessments: rows.length,
      percentage,
      weighting: buildWeightingBreakdown(rows),
      // Resolved from the percentage against the school's current bands, never
      // from a key frozen on the score when it was graded.
      band: percentage === null ? null : resolveGradeBand(percentage, bands),
      // Stated rather than rendered blank: a band withheld because the scale
      // itself cannot grade is a fault the head teacher has to see, not an empty
      // cell that looks like a missing score.
      bandProblem:
        percentage !== null && bands.length > 0 && scaleDefects.length > 0
          ? scaleDefects.join('; ')
          : null,
    }
  })

  // A subject whose weights sum to zero has no percentage to contribute, so it
  // is dropped from the mean rather than dragging it to 0.
  const scorable = subjects
    .map((subject) => subject.percentage)
    .filter((percentage): percentage is number => percentage !== null)

  return {
    gradedAssessments: graded.length,
    weightedPercentage: round2(
      weightedMean(
        graded.map((row) => ({
          value: row.percentage as number,
          weight: resolveAssessmentWeight(row).weight,
        })),
      ),
    ),
    overallPercentage:
      scorable.length > 0
        ? round2(scorable.reduce((sum, p) => sum + p, 0) / scorable.length)
        : null,
    weighting: buildWeightingBreakdown(graded),
    subjectCount: subjects.length,
    subjects,
  }
}

// --- Band Presentation ---

/**
 * Readable text colour for a band the school picked.
 *
 * A band's `color` is whatever hex the head teacher chose, so it can be near
 * white. Colouring a badge by magnitude instead — green above 70, red below 40 —
 * is not available: bands are school-configured and the JHS default runs the
 * other way (grade 9 is the worst result and is coloured like every other worst
 * result). The badge therefore takes the school's own colour and this decides
 * only whether the text on top of it is dark or light.
 *
 * Relative luminance per WCAG 2.x, computed on the sRGB channels. Unparseable
 * input falls back to dark text, which is the safe default on the light report
 * card.
 */
export function contrastTextColor(hex: string): '#0f172a' | '#ffffff' {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return '#0f172a'
  const body = match[1]!
  const full =
    body.length === 3
      ? body
          .split('')
          .map((char) => char + char)
          .join('')
      : body
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance =
    0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  return luminance > 0.179 ? '#0f172a' : '#ffffff'
}

// --- Attendance Calculation ---

/** The five states a `AttendanceStudent.status` row can carry. */
export type AttendanceStatusValue =
  | 'PRESENT'
  | 'ABSENT'
  | 'LATE'
  | 'EXCUSED'
  | 'HALF_DAY'

/**
 * How much of one marked session a status credits, as a fraction in 0..1.
 *
 * `LATE` credits a full session: lateness is punctuality, not attendance.
 * `HALF_DAY` credits the half the child was there for.
 *
 * `EXCUSED` is absent from this table on purpose. An authorised absence —
 * illness, a death in the family, an official engagement the school itself
 * approved — is not attendance the child earned and not a failure the school
 * may attribute to them. Scoring it either way is wrong: counting it as an
 * absence penalises the family for the school's own approval, and counting it
 * as a full day lets a term of recorded illness report 100%. It is therefore
 * removed from the accounting entirely, in both the numerator and the
 * denominator, and reported on its own as `excusedDays`.
 */
export const ATTENDANCE_PRESENCE_WEIGHT: Record<string, number> = {
  PRESENT: 1,
  LATE: 1,
  HALF_DAY: 0.5,
  ABSENT: 0,
}

const EXCUSED_STATUS = 'EXCUSED'

/** One attendance row, as the report reads it. */
export interface AttendanceMark {
  date: Date | string | null | undefined
  status: string
}

export interface AttendanceSummaryMetrics {
  /** False when the student has no countable mark in range. */
  hasData: boolean
  /** Credited days as a percentage of countable days, 0-100. Null when there is no countable day. */
  attendanceRate: number | null
  /** Distinct calendar days carrying at least one countable mark. */
  totalAttendanceDays: number
  /** Credited days. Fractional: one `HALF_DAY` credits 0.5. */
  presentDays: number
  /** Distinct days whose every mark was `EXCUSED`. */
  excusedDays: number
  /** Countable days credited nothing. */
  absentDays: number
  /** Countable days credited something less than a full day. */
  partialDays: number
}

/**
 * The UTC calendar day a mark belongs to.
 *
 * `AttendanceStudent.date` is stored as UTC midnight by `normaliseAttendanceDate`
 * in the write path, so the UTC day is the calendar day and the key is
 * machine-independent. A mark with no usable date gets its own unique key: it
 * cannot be shown to belong to any other mark's day, so it is its own day
 * rather than being folded into an arbitrary bucket. `date` is `NOT NULL`, so
 * that branch is unreachable for a stored row — it exists so a malformed fixture
 * degrades to "one row, one day" instead of collapsing a term into one day.
 */
function attendanceDayKey(date: Date | string | null | undefined): string | symbol {
  const parsed = date instanceof Date ? date : typeof date === 'string' ? new Date(date) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }
  return Symbol('undated-attendance-mark')
}

/**
 * Distinct calendar days and the attendance rate, from a flat list of marks.
 *
 * `AttendanceStudent.period` is `NOT NULL` with `''` as the whole-day
 * sentinel, so a day marked per period holds one row per period and a day
 * marked as a whole holds a single row. Counting rows therefore counts
 * periods, not days, and both the day total and the rate were wrong by the
 * number of periods in the register.
 *
 * The fix is to group by UTC day first. Within a day, a day is worth the
 * fraction of its marked sessions the student was credited for:
 * `sum(weight(status)) / countable marks`. That collapses a four-period
 * `PRESENT` register to exactly one full day, credits a `HALF_DAY` 0.5, and
 * charges 0.25 for a student who sat one period of four — none of which a
 * per-row count could express.
 */
export function summariseAttendance(
  marks: readonly AttendanceMark[],
): AttendanceSummaryMetrics {
  const days = new Map<string | symbol, { credited: number; countable: number }>()

  for (const mark of marks) {
    const key = attendanceDayKey(mark.date)
    let day = days.get(key)
    if (!day) {
      day = { credited: 0, countable: 0 }
      days.set(key, day)
    }
    if (mark.status === EXCUSED_STATUS) continue
    day.credited += ATTENDANCE_PRESENCE_WEIGHT[mark.status] ?? 0
    day.countable += 1
  }

  let presentDays = 0
  let excusedDays = 0
  let absentDays = 0
  let partialDays = 0
  for (const day of days.values()) {
    if (day.countable === 0) {
      excusedDays += 1
      continue
    }
    // Weight per mark is at most 1, so the ratio cannot exceed 1; the clamp is
    // a guard against a status added to ATTENDANCE_PRESENCE_WEIGHT with a
    // value above 1, which would let one day report more than one day.
    const credit = Math.min(day.credited / day.countable, 1)
    presentDays += credit
    if (credit === 0) absentDays += 1
    else if (credit < 1) partialDays += 1
  }

  const totalAttendanceDays = days.size - excusedDays
  const hasData = totalAttendanceDays > 0

  return {
    hasData,
    attendanceRate: hasData
      ? Math.round((presentDays / totalAttendanceDays) * 100)
      : null,
    totalAttendanceDays,
    presentDays: Math.round(presentDays * 100) / 100,
    excusedDays,
    absentDays,
    partialDays,
  }
}

export function calculateAttendancePercentage(
  present: number,
  total: number
): { percentage: number; colour: string } {
  if (total === 0) return { percentage: 0, colour: 'gray' }
  const pct = Math.round((present / total) * 100)
  
  let colour = 'green'
  if (pct < 75) colour = 'red'
  else if (pct < 85) colour = 'amber'
  
  return { percentage: pct, colour }
}

// --- Truncation ---

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// --- Deep Clone ---

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// --- Debounce ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- debounce requires any[] for generic function args
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

// --- Retry ---

export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt))
      }
    }
  }
  throw lastError!
}