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

/**
 * Readable form of a Ghanaian phone number: `+233 55 441 6937`.
 *
 * Both accepted lengths are counted the way the NCC counts them, which is the
 * point of this function having been wrong:
 *
 * - the LOCAL form is TEN digits — `0` + a 2-digit network code + 7 digits, e.g.
 *   `0554416937`. That is what a parent types, and it is the local form of the
 *   example above;
 * - the INTERNATIONAL form is TWELVE — `233` + the same ten — e.g.
 *   `233554416937` or `+233 55 441 6937`.
 *
 * It used to gate the local arm on `length === 9`, which is off by one in the
 * dangerous direction twice over. A 10-digit number matched neither arm and was
 * returned unformatted, so the canonical form got no treatment at all; and a
 * 9-digit input was accepted as local and sliced into `+233 <2> <3> <3>` — a
 * NINE-digit national number, which is a different number rather than a shorter
 * way of writing this one. A parent reading that off the admissions review
 * screen and dialling it reaches nobody.
 *
 * Unrecognised input is returned unchanged. A number this function cannot parse
 * is one a human still has to be able to read and correct, so it is never
 * rewritten into something that merely looks formatted.
 */
export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 10 && cleaned.startsWith('0')) {
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

/**
 * Whether `phone` is a Ghanaian number this codebase is willing to accept.
 *
 * The two accepted forms and why they are ten and twelve digits are set out on
 * `formatPhone`, and this predicate has to agree with it — a form that accepts
 * what `formatPhone` cannot render, or refuses what it renders perfectly, is
 * worse than having neither. It previously gated the local arm on nine digits,
 * so `0554416937` — a complete, dialable number, and the form Ghanaians write —
 * was rejected while the nine-digit `054416937` was accepted.
 *
 * Length and leading digit only. This is a shape gate, not a proof of
 * allocation: it does not check the network code against the NCC's list, so it
 * accepts `0000000000`. That is deliberate — the question this answers is
 * "did the parent type something shaped like a Ghanaian number", and a stricter
 * check would refuse real numbers from ranges this code has no list of.
 */
export function validateGhanaPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '')
  return (cleaned.length === 10 && cleaned.startsWith('0')) ||
         (cleaned.length === 12 && cleaned.startsWith('233'))
}

export function validateGhanaID(id: string): boolean {
  // Ghanaian ID: 10 or 12 digits
  const cleaned = id.replace(/\D/g, '')
  return cleaned.length === 10 || cleaned.length === 12
}

// --- Percentage Calculations ---

/**
 * A mark as a percentage of what it was scored against, or null when the two
 * cannot produce one.
 *
 * Refusing rather than rounding or clamping is the point. `rawScore` and
 * `Assessment.maxScore` are bounded independently, so a teacher who typed 150
 * into a 100-mark assessment used to get 150% — and `Score.grade`, the audit
 * record of what the gradebook decided, recorded the top band for it. A
 * percentage is by definition inside 0-100; anything else is not a percentage
 * that needs rounding, it is a mark that does not belong on this assessment.
 *
 * `null` is also what keeps `Score.percentage` (`Decimal(5,2)`) reachable: a
 * ratio such as 9999/1 would otherwise become a 500 from the database rather
 * than a 400 to the teacher who typed the mark.
 */
export function calculatePercentage(marks: number, total: number): number | null {
  if (!Number.isFinite(marks) || !Number.isFinite(total) || total === 0) return null
  const percentage = Math.round((marks / total) * 100 * 100) / 100
  if (percentage < 0 || percentage > 100) return null
  return percentage
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
  // The highest `maxScore` reached by ANY earlier band, not the previous row's
  // own. A band that ends inside its predecessor claims nothing beyond it, so
  // with `a 0-49, c 30-45, b 50-100` the percentage 46 is claimed by `a`, and
  // comparing `b` against `c` alone reported a "hole" that no percentage can
  // fall into — naming a defect that does not exist, and refusing through
  // `assertBandsCoverZeroToHundred` a scale that grades every percentage once.
  //
  // An overlap still reports no hole, without a special case: where two bands
  // overlap the later one starts at or below what earlier bands already reached,
  // which is the same statement as "nothing new begins here".
  let reached: number | null = null
  let boundaryKey = ''
  for (const band of ordered) {
    if (reached !== null && band.minScore > reached + 1) {
      problems.push(
        `${reached + 1}-${band.minScore - 1}% falls between ${boundaryKey} and ${band.key} and matches no band`,
      )
    }
    reached = reached === null ? band.maxScore : Math.max(reached, band.maxScore)
    boundaryKey = band.key
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
 * of a mid-scale hole that is not a mis-grade, which is why this one is fatal to
 * GRADING while the edges are not: a percentage in a hole resolves to no band at
 * all, and a percentage below the floor is a child the school chose not to
 * report. So the two are enforced in two different places — resolution refuses
 * the hole, and `findGradeBandCoverageGaps` names the edges for the strict
 * `assertBandsCoverZeroToHundred` the seed calls.
 *
 * Nothing in this list is refused by a single-row admin write. See
 * `findGradeBandWriteConflicts` for why a hole in particular cannot be.
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
 * percentage.
 *
 * What is NOT enforced anywhere on this path, so that nothing here is read as a
 * stronger promise than it keeps:
 *
 * - an interior hole, which is why the mitigation is at resolution — it refuses
 *   to grade a percentage no band claims and says which range is at fault rather
 *   than guessing the band beneath it;
 * - coverage of 0-100, or of both edges, which `findGradeBandCoverageGaps`
 *   reports and only `assertBandsCoverZeroToHundred` (the seed) refuses. A school
 *   may legitimately hold a scale that stops at 70, and may empty one entirely.
 *
 * So the honest statement of the admin write path's guarantee is: no band it
 * writes runs backwards, leaves 0-100, or doubles up a percentage. Nothing more.
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
  /**
   * Every band currently stored for a scale.
   *
   * The route supplies this, so it is the route that must scope it: a rule that
   * judges a write against another school's bands would refuse it for a conflict
   * it did not cause, and would name those bands' keys in the 400 that explains
   * why. A scale the caller cannot see has to read as empty.
   */
  readScaleBands: (gradingScaleId: string) => Promise<readonly NamedGradeBand[]>
}

/** A cross-row invariant, judged against more than the row being written. */
export type CrossRowWriteRule = (
  context: CrossRowWriteContext,
) => Promise<string[]> | string[]

/**
 * What a write does, without the read that goes with it.
 *
 * Deciding who a write belongs to needs nothing from the database, so the parent
 * check takes this and never touches the reader a conflict check has to have.
 */
export type CrossRowWriteTarget = Omit<CrossRowWriteContext, 'readScaleBands'>

/**
 * The tenant and school a request is being served for.
 *
 * `schoolId` is null for a caller with no school assigned — a tenant-level admin —
 * which is why the predicates below treat it as a value to match rather than as
 * a filter to skip.
 */
export interface CallerScope {
  tenantId: string
  schoolId: string | null
}

/**
 * A Prisma `where` clause, written without depending on Prisma's generated
 * types — the lowest layer of the type graph cannot import them.
 *
 * A rule that narrows this to the shape it actually produces keeps its
 * `where` clause assignable to the delegate it is handed to, which is what lets
 * the route read a parent without casting the query it did not write.
 */
export type PrismaWhereClause = Record<string, unknown>

/**
 * The row a write attaches to, and the predicate that proves it is the caller's.
 *
 * A row that names a foreign key is only safe when the parent it names is
 * checked. Owning the row being written says nothing about the row it hangs
 * from: a `grading_level` row has no `schoolId` column, so the school that
 * grades a child against a band is the school of the band's scale, and a band
 * whose own `tenantId` is the caller's can still hang from another school's
 * scale. The band is then invisible to the school whose grading it has changed,
 * because that school would filter it out, and unremovable through the API.
 *
 * Declared per cross-row kind, so the constraint travels with the entity
 * definition the way `CrossRowWriteRule` does. Kept free of a database client:
 * the route supplies the read, and this module stays pure.
 *
 * `Where` is the clause this kind produces, narrowed to its real shape. It is a
 * type parameter rather than a cast so the query the route hands to Prisma is
 * still type-checked against the model it is aimed at.
 */
export interface ParentScopeWriteRule<Where = PrismaWhereClause> {
  /**
   * The parent this write names, or the one the stored row already belongs to.
   * Null when neither can be resolved, which no write can be allowed past.
   */
  parentId: (context: CrossRowWriteTarget) => string | null
  /** The where-clause under which a parent row counts as the caller's. */
  scopeWhere: (scope: CallerScope & { id: string }) => Where
}

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
 * Which scale a band write belongs to: the one it names, or — for a write that
 * names none — the one the stored row already belongs to.
 *
 * The ownership check and the sibling check must resolve the destination scale
 * the same way, or a band can pass one and be judged against the other.
 */
export function gradingScaleParentId(context: CrossRowWriteTarget): string | null {
  return (
    recordString(context.write.gradingScaleId) ??
    recordString(context.existing?.gradingScaleId)
  )
}

/**
 * The predicate that makes a grading scale the caller's to write against.
 *
 * `schoolId` is an `OR`, never an equality. `GradingScale.schoolId` is nullable
 * and a tenant-wide scale (null) is shared by every school in the tenant, which
 * is a legitimate parent — an equality would refuse every band written against a
 * shared scale, and refusing the shared case would be the same bug wearing the
 * opposite hat: the band belongs to nobody's school and everybody's report.
 * A caller with no school assigned therefore reaches only tenant-wide scales,
 * which is the most it can be trusted with.
 */
export function gradingScaleScopeWhere(
  scope: CallerScope & { id: string },
): {
  id: string
  tenantId: string
  OR: Array<{ schoolId: string | null }>
} {
  return {
    id: scope.id,
    tenantId: scope.tenantId,
    OR: [{ schoolId: scope.schoolId }, { schoolId: null }],
  }
}

export const gradingScaleParentScopeWriteRule: ParentScopeWriteRule<ReturnType<typeof gradingScaleScopeWhere>> = {
  parentId: gradingScaleParentId,
  scopeWhere: gradingScaleScopeWhere,
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
  const scaleId = gradingScaleParentId(context)
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
 * And no band is invented for a percentage that is not a percentage. That rule
 * is about the VALUE and never about the scale's extent, because those are two
 * different questions:
 *
 * 1. Outside 0-100 is out of range whatever the school configured. A child
 *    scoring 100.5 or 150 has not run off the end of the scale — they have a mark
 *    that cannot exist, usually a typo (`15` written as `150`) that nothing
 *    related back to `Assessment.maxScore`. The code this replaced handed such a
 *    value to "the band with the highest `minScore`", so a child who scored 15
 *    was recorded as `level_6` — Excellent — on the assessment, and `Score.grade`
 *    is the audit record of what the gradebook decided.
 * 2. A scale that legitimately does not span 0-100 is a different thing. "Report
 *    nothing below 50" is a school's own decision, `findGradeBandDefects`
 *    accepts it and `tools/seed` treats it as not a defect. A child at 45%
 *    against such a scale is below the school's floor, so it stays null — the
 *    same answer as before, and for the same reason: no band claims it.
 *
 * So there is one implementation of "which band is this percentage", and out of
 * range is an answer it knows: none.
 */
export function resolveGradeBand<T extends GradeBandBounds>(
  percentage: number,
  gradingScale: readonly T[],
): ResolvedBand<T> | null {
  if (!Number.isFinite(percentage)) return null
  if (percentage < 0 || percentage > 100) return null
  if (gradingScale.length === 0) return null
  const claimed = gradingScale.filter(
    (band) => percentage >= band.minScore && percentage <= band.maxScore,
  )
  // Two bands claiming one percentage is the overlap defect: answering here would
  // make the winning band a function of row order rather than of the score.
  if (claimed.length > 1) return null
  return claimed[0] ?? null
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
 * The order a read must present grading scales in for `resolveApplicableGradingScale`
 * to answer the same way twice: default first, then oldest first, then by id.
 *
 * The rule is "prefer a scale naming the level, else the default", and `Array.find`
 * takes the FIRST match — so with no ordering clause the winning scale was whatever
 * order the database happened to return rows in. Verified before this was pinned:
 * two scales both claiming `B9` and both marked default resolved to whichever came
 * first, so `[C, B]` gave `C` and `[B, C]` gave `B`, and a routine VACUUM was enough
 * to move a cohort of children from one band to another with no error anywhere.
 *
 * Each key earns its place. `isDefault` first, because a scale the school has
 * explicitly marked as the default is its stated preference among the scales that
 * claim the level. `createdAt` ascending next, so the scale that was in place first
 * wins over a later copy of it — the review's scenario is a head teacher duplicating
 * "Ghana Primary (GES 6-level)" as "Ghana Primary 2026", and a copy must never
 * displace the original. `id` last because `createdAt` is a timestamp rather than a
 * unique key, and without it the order is still not a total one.
 *
 * Both readers pass this same ordering as their Prisma `orderBy`, and the helper
 * below re-imposes it on whatever it is handed, so a caller that forgets it still
 * gets a stable answer rather than an arbitrary one.
 */
export const GRADING_SCALE_RESOLUTION_ORDER = [
  { isDefault: 'desc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] as const

type OrderedGradingScale = {
  appliesToLevels: readonly string[]
  isDefault: boolean
  createdAt?: Date | string
  id?: string
}

/**
 * `createdAt` as a comparable number, or `Infinity` when the row carries none.
 *
 * `Infinity` sorts a scale with no timestamp after every scale that has one, which
 * is the safe direction: a real row read through Prisma always carries `createdAt`,
 * so this only orders the hand-built fixtures and the degenerate caller.
 *
 * Returning a number rather than a Date is what keeps the comparison below
 * arithmetic, but it is NOT on its own what keeps a non-comparator out of it —
 * two rows with no timestamp both produce `Infinity`, and `Infinity - Infinity` is
 * `NaN`. `compareGradingScaleApplicability` is where that is handled, and the
 * reason this function is happy to return `Infinity` at all is that the caller
 * tests the two values for equality before subtracting.
 */
function gradingScaleCreatedAtValue(scale: OrderedGradingScale): number {
  const createdAt = scale.createdAt
  if (createdAt instanceof Date) return createdAt.getTime()
  if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt)
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
  }
  return Number.POSITIVE_INFINITY
}

/**
 * The total order `GRADING_SCALE_RESOLUTION_ORDER` describes, as a comparator.
 *
 * The `createdAt` step compares the two values with `!==` and only then
 * subtracts, and that ordering is load-bearing rather than incidental style:
 * `gradingScaleCreatedAtValue` returns `Infinity` for a row with no timestamp,
 * so two such rows give `Infinity - Infinity`, which is `NaN` — and the obvious
 * guard `if (createdAt !== 0) return createdAt` does not catch it, because
 * `NaN !== 0` is true. The comparator then returned `NaN`, and a comparator that
 * returns `NaN` is not a comparator: `Array.prototype.sort` reads it as "no
 * opinion" and leaves the rows where they were. The `id` tiebreaker below, the
 * one step documented as making the order total, was unreachable in exactly the
 * case it exists for, and the answer fell back to the caller's array order —
 * the same defect `GRADING_SCALE_RESOLUTION_ORDER` was written to remove.
 *
 * Testing the values before subtracting is what fixes it. `Infinity !== Infinity`
 * is false, so two undated rows fall through to `id` and the order is total for
 * them too; `0 !== Infinity` is true, so one dated and one undated still sort
 * with the undated one last, which is the safe direction `Infinity` was chosen
 * for.
 */
function compareGradingScaleApplicability(
  a: OrderedGradingScale,
  b: OrderedGradingScale,
): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
  const aCreatedAt = gradingScaleCreatedAtValue(a)
  const bCreatedAt = gradingScaleCreatedAtValue(b)
  if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt
  return (a.id ?? '').localeCompare(b.id ?? '')
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
 *
 * Ties are broken by `GRADING_SCALE_RESOLUTION_ORDER` rather than by the array's
 * order, so the answer is a function of the configuration and not of the row order
 * the database happened to use. Two scales claiming one level is still a
 * misconfiguration and is named by `findGradingScaleApplicabilityProblems`; this
 * function answers deterministically about it rather than refusing, because the
 * gradebook has to store something and the read has to agree with it.
 */
export function resolveApplicableGradingScale<T extends OrderedGradingScale>(
  scales: readonly T[],
  levelKeys: ReadonlyArray<string | null | undefined>,
): T | null {
  const keys = levelKeys.filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  )
  const candidates = [...scales].sort(compareGradingScaleApplicability)
  return (
    candidates.find((scale) => keys.some((key) => scale.appliesToLevels.includes(key))) ??
    candidates.find((scale) => scale.isDefault) ??
    null
  )
}

/** One grading scale as the applicability check sees it: enough to name it in a 400. */
export interface GradingScaleApplicability extends OrderedGradingScale {
  name?: string | null
}

/**
 * Why a set of grading scales cannot decide which one grades a class, in sentences
 * a head teacher can act on. An empty list means the set is unambiguous.
 *
 * Two defects, and both are silent rather than loud: whichever scale the reader
 * happened to pick first is the one that grades the child, and nothing on any card
 * says the choice was arbitrary. `@@unique([tenantId, schoolId, name])` stops two
 * scales sharing a NAME, so "Ghana Primary (GES 6-level)" and "Ghana Primary 2026"
 * are both legal rows that both name `B1`-`B6`.
 *
 * 1. Two or more scales claiming one level code. `resolveApplicableGradingScale`
 *    answers deterministically about it now — see `GRADING_SCALE_RESOLUTION_ORDER` —
 *    but "which of these two identical copies grades B4" is a question about the
 *    school's configuration, and the answer should not be a coin that happens to fall
 *    the same way twice.
 * 2. Two or more scales marked `isDefault`. The default is the fallback for every
 *    level no scale names, so two defaults make every KG and Creche class — and
 *    every level a school has not configured — a matter of row order.
 *
 * Not enforced on the write path yet, and the reason is structural rather than an
 * oversight: `POST/PATCH /api/config/[entityType]` hands a cross-row rule only a
 * `readScaleBands(gradingScaleId)` reader and a mandatory parent-scope check, and a
 * grading scale is its own parent and names no band — so the route would answer 404
 * for every scale create before this rule ever ran. Wiring it needs the route to
 * supply a sibling-scale read and to treat the parent check as optional, which is
 * `apps/portal/app/api/config/**`.
 */
export function findGradingScaleApplicabilityProblems(
  scales: readonly GradingScaleApplicability[],
): string[] {
  const problems: string[] = []
  const label = (scale: GradingScaleApplicability): string =>
    scale.name ? `"${scale.name}"` : `scale ${scale.id ?? '(unnamed)'}`

  const claimants = new Map<string, GradingScaleApplicability[]>()
  for (const scale of scales) {
    for (const level of scale.appliesToLevels) {
      if (level.length === 0) continue
      claimants.set(level, [...(claimants.get(level) ?? []), scale])
    }
  }
  for (const [level, claiming] of [...claimants].sort(([a], [b]) => a.localeCompare(b))) {
    if (claiming.length < 2) continue
    problems.push(
      `level ${level} is claimed by ${claiming.length} scales (${claiming.map(label).join(', ')}); ` +
        'a class at that level would be graded against whichever one the database returned first',
    )
  }

  const defaults = scales.filter((scale) => scale.isDefault)
  if (defaults.length > 1) {
    problems.push(
      `${defaults.length} scales are marked the default (${defaults.map(label).join(', ')}); ` +
        'every level no scale names would fall back to whichever one the database returned first',
    )
  }
  return problems
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

/**
 * Why a subject carries the band it carries — computed, never read back out of an
 * absent value.
 *
 * `band === null` used to mean all of these at once, and the report rendered
 * every one of them as a bare "-": a school with no scale, a child below the
 * scale's floor, a child above its ceiling, a scale whose bands have all been
 * deleted, a percentage in a hole, and a percentage two bands claim. A parent
 * reads "-" as a missing mark, and the faults behind two of those six were
 * invisible across a whole class. The discriminator is what turns the absence
 * into a sentence.
 *
 * | value          | produced when                                                             |
 * |----------------|--------------------------------------------------------------------------|
 * | `ok`           | exactly one band claims the percentage — the only state with a `band`      |
 * | `no-scale`     | no bands were supplied at all (see the note below)                        |
 * | `no-bands`     | bands exist, but not one of them can ever claim a percentage               |
 * | `below-scale`  | the percentage is under the lowest band that can claim anything            |
 * | `above-scale`  | the percentage is over the highest such band                              |
 * | `hole`         | it is between two bands, inside the scale's span, and claimed by neither    |
 * | `ambiguous`    | two or more bands claim it, so the winner would be a function of row order  |
 * | `no-percentage`| there is no percentage to band, or not one a band can hold                 |
 *
 * `no-scale` is deliberately the coarse one. This function is handed the bands
 * and nothing else, and "no scale applies to this class" and "the scale that
 * applies has had every band deleted from it" are the same empty list from here.
 * The report resolves the finer truth — it is told which scale applied.
 */
export type BandStatus =
  | 'ok'
  | 'no-scale'
  | 'no-bands'
  | 'below-scale'
  | 'above-scale'
  | 'hole'
  | 'ambiguous'
  | 'no-percentage'

/** Statuses that mean the scale, not the mark, is what withheld the band. */
const BAND_SCALE_FAULTS: ReadonlySet<BandStatus> = new Set<BandStatus>([
  'no-bands',
  'below-scale',
  'above-scale',
  'hole',
  'ambiguous',
])

/**
 * Which of the `BandStatus` states a percentage is in against a scale.
 *
 * Decided from the percentage and the bands together, because "no band claimed
 * it" is the answer to a question with several different true answers. A band
 * that runs backwards, or that lies wholly outside 0-100, can never claim
 * anything, so it is excluded before the edges are read — otherwise a scale whose
 * only band is `150-200` would report a child at 68% as "below the scale" rather
 * than as a scale that cannot grade at all.
 */
function classifyBand(
  percentage: number | null,
  bands: readonly GradeBand[],
): BandStatus {
  if (
    percentage === null ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  ) {
    return 'no-percentage'
  }
  if (bands.length === 0) return 'no-scale'
  const usable = bands.filter(
    (band) =>
      band.minScore <= band.maxScore &&
      band.maxScore >= 0 &&
      band.minScore <= 100,
  )
  if (usable.length === 0) return 'no-bands'
  const claimants = usable.filter(
    (band) => percentage >= band.minScore && percentage <= band.maxScore,
  )
  if (claimants.length > 1) return 'ambiguous'
  if (claimants.length === 1) return 'ok'
  const floor = Math.min(...usable.map((band) => band.minScore))
  const ceiling = Math.max(...usable.map((band) => band.maxScore))
  if (percentage < floor) return 'below-scale'
  if (percentage > ceiling) return 'above-scale'
  return 'hole'
}

/**
 * The reason a subject's band is not on the card, or null when there is none to
 * give.
 *
 * Two different things can be wrong, and they are reported on different terms:
 *
 * - The scale does not cover 0-100. That is a fact about the SCALE, not about this
 *   subject, so it is stated on every subject whether or not this one resolved —
 *   a class where two subjects grade and one does not is exactly how a partly
 *   broken scale stays invisible. `findGradeBandCoverageGaps` produces the range
 *   strings.
 * - This subject's own percentage fell in something the scale got wrong: a hole,
 *   an overlap, an empty scale. The defect sentences come from
 *   `findGradeBandDefects`, and they are added to the coverage strings rather than
 *   replacing them, because on a scale whose bands are all corrupt the coverage
 *   sentence is true and useless ("no band covers 0-149%") while the defect names
 *   the row to fix.
 *
 * Nothing is reported for a percentage the scale simply does not cover at either
 * end while the child's own band resolved — that scale's edges are the school's
 * decision, not a fault, and a correct grade must not carry a fault beside it.
 */
function bandProblemFor(
  status: BandStatus,
  coverage: readonly string[],
  defects: readonly string[],
): string | null {
  const problems = BAND_SCALE_FAULTS.has(status)
    ? [...coverage, ...defects]
    : [...coverage]
  return problems.length > 0 ? problems.join('; ') : null
}

export interface SubjectSummary {
  subjectId: string
  /** 0-100, weighted within the subject. Null when the subject's weights sum to zero. */
  percentage: number | null
  gradedAssessments: number
  /** How this subject's own percentage was composed. */
  weighting: WeightingBreakdown
  /** The school-configured band this percentage falls in, or null when nothing claims it. */
  band: GradeBand | null
  /** Why `band` is what it is, stated rather than inferred from `band === null`. See `BandStatus`. */
  bandStatus: BandStatus
  /**
   * Why the scale could not grade, in the words `findGradeBandCoverageGaps` and
   * `findGradeBandDefects` produce. Null whenever the scale is sound for this
   * subject — including when there is no scale at all, which `bandStatus` reports
   * as `no-scale`. It travels on the payload so a withheld band is reported as a
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
 * An explicit 0 is NOT "excluded from the average". It is an unusable weight that
 * falls through to the type default, for two reasons. A normalised weighted mean
 * with every weight at 0 has nothing to divide by, so a school that excluded every
 * one of its assessments would get an undefined terminal figure rather than a
 * result; and the read path hands this function `Number(assessment.weight)`, which
 * turns the column's NULL into 0 — so treating 0 as "excluded" would silently drop
 * every assessment that carries no weight of its own, which is the majority of them.
 *
 * The boundary that can act on this now exists and refuses a bare 0 where a teacher
 * can be told: `AssessmentTypeConfig.defaultWeight` is `z.number().positive()`, so a
 * school cannot configure an excluded component and be quietly given its type's
 * weight instead. What remains unreachable is an `Assessment.weight` of exactly 0
 * written by a path other than the schema, and exclusion still needs a stored value
 * NULL cannot impersonate — inventing one here would mis-grade a term rather than
 * protect one. `positiveWeight` is therefore the single place that decides what a
 * usable weight is.
 *
 * This is why `POST /api/assessments` leaves `Assessment.weight` NULL rather than
 * copying the type's `defaultWeight` into the row: a copy is an explicit weight, an
 * explicit weight outranks the type, and every retune of the type afterwards would
 * be inert for a row the school never asked to be pinned.
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
  // Range, not merely finiteness. A percentage outside 0-100 is not a score, and
  // averaging one would report a terminal mark no child earned. The write path
  // refuses to store such a percentage, so what this catches is a row that
  // predates that guard — the guard at the boundary stops new ones, this stops
  // them being read as if they were marks. The assessment then contributes
  // nothing: it is absent from `gradedAssessments`, from `subjects[]` and from
  // both mean percentages, which is the honest description of a mark that
  // cannot be read.
  const graded = assessments.filter(
    (a) =>
      a.percentage !== null &&
      Number.isFinite(a.percentage) &&
      a.percentage >= 0 &&
      a.percentage <= 100,
  )

  // Computed once for the whole summary: each describes the scale, not a score,
  // and they are what turns a withheld band into a stated reason.
  const scaleDefects = findGradeBandDefects(bands)
  // Skipped for an empty scale on purpose. `findGradeBandCoverageGaps([])` answers
  // "the scale has no bands", which would put a statement about a scale that need
  // not exist onto a school that has none; `bandStatus` reports `no-scale` instead
  // and the caller, which knows which scale applied, resolves which it is.
  const scaleCoverage = bands.length > 0 ? findGradeBandCoverageGaps(bands) : []

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
    // Resolved from the percentage against the school's current bands, never from
    // a key frozen on the score when it was graded.
    const band = percentage === null ? null : resolveGradeBand(percentage, bands)
    // Decided alongside the band rather than from its absence: `band` is null in
    // six different states and four of them are faults the head teacher has to see.
    const bandStatus = classifyBand(percentage, bands)
    return {
      subjectId,
      gradedAssessments: rows.length,
      percentage,
      weighting: buildWeightingBreakdown(rows),
      band,
      bandStatus,
      // Stated rather than rendered blank: a band withheld because the scale
      // itself cannot grade is a fault the head teacher has to see, not an empty
      // cell that looks like a missing score.
      bandProblem: bandProblemFor(bandStatus, scaleCoverage, scaleDefects),
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
 * Relative luminance per WCAG 2.x, computed on the sRGB channels.
 *
 * Total on purpose. It is the function a bad colour is supposed to survive, so a
 * value that is not a string at all is a fallback like any other unparseable one:
 * `GradingLevel.color` is `NOT NULL` today, so `contrastTextColor(null)` is
 * unreachable from a stored row, but the call that crashed on it was inside a
 * render — the one place that cannot afford a `TypeError` — and this is the
 * documented safe fallback for input it cannot parse, so it must be.
 *
 * Unparseable input falls back to dark text, which is the safe default on the
 * light report card. The boundary is what makes that fallback rare rather than
 * routine: `GradingLevel.color` is constrained to `#rrggbb` on create and on
 * update, so a named colour that would render at 4.26:1 on dark text ('red') or
 * as a colourless badge ('transparent') cannot be stored in the first place.
 */
export function contrastTextColor(hex: string | null | undefined): '#0f172a' | '#ffffff' {
  const match =
    typeof hex === 'string' ? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim()) : null
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

/**
 * A URL-safe slug: lowercase, hyphen-separated, no accents.
 *
 * Accents are TRANSLITERATED, not deleted, and the order of the two steps is what
 * makes that possible. `\p{Diacritic}` can only match a combining mark, and an
 * accented letter is only a base character plus one once the string has been
 * decomposed — so NFD first, strip second. `Ünïcodé Ñame` becomes
 * `unicode-name`, where it used to become `ncod-ame`.
 *
 * Deleting rather than transliterating was not cosmetic. `[^\w\s-]` without the
 * `u` flag is ASCII-only, so every non-ASCII letter was removed outright, and the
 * result was a *different string* rather than a mangled one: two different names
 * could land on the same slug with nothing to tell them apart. Ghanaian names are
 * overwhelmingly ASCII so this is rare in practice, but the function is exported
 * and any accented display name reaches it.
 *
 * `\p{L}`/`\p{N}` in the stripping step rather than `\w`, so letters and digits
 * outside ASCII survive instead of vanishing — "Καλημέρα" keeps its letters and
 * loses only its accent, rather than collapsing to the empty string the ASCII
 * class produced. `_` stays in the allowed set so the `[\s_-]+` collapse below
 * still treats it as a separator; leaving it out turned `--a__b--` into `ab`.
 *
 * A handful of letters have no canonical decomposition — `ø`, `ł`, `ß`, `æ`, `đ`
 * — so transliteration has nothing to decompose and they are preserved as
 * themselves: `Bjørn` -> `bjørn`, `Łódź` -> `łodz`. Inventing `ø` -> `o` would be
 * a guess about someone's name, and the output is still a valid URL path segment
 * once percent-encoded. Note that `é` and `ü` ARE decomposed, so `Größe` becomes
 * `große` and `Münster` becomes `munster`; the rule is what Unicode can decompose,
 * and it is deliberately not "whatever looks like an ASCII letter".
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
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

// ============================================================================
// Class position / ranking
// ============================================================================

/**
 * A student eligible for ranking.
 *
 * `displayName` is optional but recommended for the deterministic tie-break
 * that keeps the output idempotent across runs. When absent, the tie-break
 * falls back to `studentId` alone.
 */
export interface StudentForRanking {
  studentId: string
  /**
   * The student's overall aggregate percentage for the term (0-100).
   * `null` means the student has no graded, approved work this term and is
   * excluded from the class ranking (position = null), not ranked last.
   */
  overallPercentage: number | null
  displayName?: string
}

/**
 * The result of ranking a student within a class.
 */
export interface RankedStudent {
  studentId: string
  /**
   * The student's position in the class ranking, 1-indexed.
   * `null` when the student has no ranked figure (overallPercentage === null).
   */
  position: number | null
}

/**
 * Class position by term aggregate, descending.
 *
 * Rules (Ghanaian school-report convention, stated explicitly so the portal
 * has one answer to both ask and to test against):
 * 1. Ranked over students with a readable 0-100 overall percentage. A student
 *    whose marks are all ungraded/unapproved has no aggregate and is NOT ranked
 *    — reporting them as "last" would reward absence, and reporting them at all
 *    would mis-represent a card that shows "No marks recorded".
 * 2. Higher percentage ranks first. `rank === 1` is the top of the class.
 * 3. Ties share a position and the next position skips by the tie count
 *    (standard competition ranking, "1 2 2 4"). Two aggregates that are equal
 *    occupy the same slot; the next lower aggregate takes the number of slots
 *    already filled.
 * 4. Among ties, a stable deterministic tie-break (displayName, then studentId)
 *    keeps the output idempotent across runs so the API is idempotent. Ties
 *    still share the position regardless of that order.
 */
export function rankStudents(
  students: readonly StudentForRanking[],
): RankedStudent[] {
  // Filter to students with a valid, readable percentage.
  const ranked = students
    .filter(
      (s) =>
        s.overallPercentage !== null &&
        Number.isFinite(s.overallPercentage) &&
        s.overallPercentage >= 0 &&
        s.overallPercentage <= 100,
    )
    .sort((a, b) => {
      // Higher percentage first.
      if (b.overallPercentage! !== a.overallPercentage!) {
        return b.overallPercentage! - a.overallPercentage!
      }
      // Stable tie-break: displayName asc, then studentId asc.
      const nameA = a.displayName ?? ""
      const nameB = b.displayName ?? ""
      if (nameA !== nameB) return nameA.localeCompare(nameB)
      return a.studentId.localeCompare(b.studentId)
    })

  // Assign standard competition ranks ("1 2 2 4").
  const positions = new Map<string, number>()
  let position = 0
  let previousPercentage: number | null = null
  let i = 0
  for (const student of ranked) {
    i++
    // Filter guarantees non-null percentage, but TS strict indexing needs help.
    const percentage = student.overallPercentage!
    if (previousPercentage === null || percentage !== previousPercentage) {
      // New percentage: rank = 1 + number of students strictly better.
      position = i
      previousPercentage = percentage
    }
    positions.set(student.studentId, position)
  }

  // Return in the original input order with position attached.
  return students.map((s) => ({
    studentId: s.studentId,
    position: positions.get(s.studentId) ?? null,
  }))
}