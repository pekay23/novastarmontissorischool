import {
  determineGrade,
  findGradeBandCoverageGaps,
  findGradeBandDefects,
  resolveApplicableGradingScale,
  resolveGradeBand,
  round2,
  weightedMean,
  buildWeightingBreakdown,
  bandProblemFor,
  classifyBand,
  resolveAssessmentWeight,
  type AcademicSummaryMetrics,
  type BandStatus,
  type GradeBand,
  type ReportableAssessment,
  type SubjectSummary,
  type WeightingBreakdown,
  type WeightingComponent,
} from './grading'

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
