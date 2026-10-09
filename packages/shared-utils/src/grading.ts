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

