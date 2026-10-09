// --- Academic Summary Metrics ---

import type { GradeBand, NamedGradeBand, ResolvedBand } from './grading'
import { findGradeBandDefects, findGradeBandCoverageGaps, resolveGradeBand } from './grading'
import { weightedMean, positiveWeight, FALLBACK_ASSESSMENT_WEIGHT } from './weights'

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

/**
 * A student's aggregate data for class ranking.
 *
 * `overallPercentage` is the term aggregate (0-100). `null` means the student
 * has no graded, approved work this term and is excluded from the class
 * ranking (position = null), not ranked last.
 */
export interface StudentForRanking {
  studentId: string
  overallPercentage: number | null
  displayName?: string
}

/** A student with their class position attached. */
export interface RankedStudent {
  studentId: string
  position: number | null
}

/**
 * Class position by term aggregate, descending.
 *
 * Students with `overallPercentage === null` are excluded from the ranking
 * (they receive `position: null`) rather than being ranked last. This is the
 * standard competition ranking ("1 2 2 4"): ties share the same rank, and the
 * next rank is incremented by the number of ties.
 */
export function rankStudents(
  students: readonly StudentForRanking[],
): RankedStudent[] {
  const ranked = students
    .filter(
      (s) =>
        s.overallPercentage !== null &&
        Number.isFinite(s.overallPercentage) &&
        s.overallPercentage >= 0 &&
        s.overallPercentage <= 100,
    )
    .sort((a, b) => {
      if (b.overallPercentage! !== a.overallPercentage!) {
        return b.overallPercentage! - a.overallPercentage!
      }
      const nameA = a.displayName ?? ''
      const nameB = b.displayName ?? ''
      if (nameA !== nameB) return nameA.localeCompare(nameB)
      return a.studentId.localeCompare(b.studentId)
    })

  const positions = new Map<string, number>()
  let position = 0
  let previousPercentage: number | null = null
  let i = 0
  for (const student of ranked) {
    i++
    const percentage = student.overallPercentage!
    if (previousPercentage === null || percentage !== previousPercentage) {
      position = i
      previousPercentage = percentage
    }
    positions.set(student.studentId, position)
  }

  return students.map((s) => ({
    studentId: s.studentId,
    position: positions.get(s.studentId) ?? null,
  }))
}

