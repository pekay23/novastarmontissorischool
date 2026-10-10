import { describe, it, expect } from 'bun:test'
import {
  calculatePercentage,
  computeAcademicSummary,
  determineGrade,
  resolveGradeBand,
  type GradeBand,
} from '@novastar/shared-utils'

/**
 * A mark outside its assessment's range never becomes a percentage, and a
 * percentage outside 0-100 never becomes a band.
 *
 * The defect this pins: nothing related `SaveScoreSchema.rawScore`
 * (`z.number().min(0).max(9999)`) to `Assessment.maxScore` (default 100), so a
 * teacher who typed `150` for a child who scored 15 produced 150%, which
 * `determineGrade` — via an escape hatch that handed anything above the top band
 * to "the band with the highest `minScore`" — labelled `level_6`, "Level 6 —
 * Excellent". `Score.grade` is the audit record of what the gradebook decided,
 * so the child was recorded as Excellent on the assessment.
 *
 * Two halves, both behavioural, with the concrete numbers from the review:
 * manufacturing a percentage (`calculatePercentage`) and grading one
 * (`resolveGradeBand` / `determineGrade` / `computeAcademicSummary`). The
 * route-level proof that an out-of-range mark cannot reach `score.upsert` at all
 * is in `data-integrity.test.ts`, which drives the real handler.
 */

/** The seeded Ghana Primary bands, the shape every helper here accepts. */
const PRIMARY: GradeBand[] = [
  { key: 'level_6', label: 'Level 6', minScore: 85, maxScore: 100, color: '#047857' },
  { key: 'level_5', label: 'Level 5', minScore: 70, maxScore: 84, color: '#2563eb' },
  { key: 'level_4', label: 'Level 4', minScore: 60, maxScore: 69, color: '#0891b2' },
  { key: 'level_3', label: 'Level 3', minScore: 50, maxScore: 59, color: '#ca8a04' },
  { key: 'level_2', label: 'Level 2', minScore: 40, maxScore: 49, color: '#b45309' },
  { key: 'level_1', label: 'Level 1', minScore: 0, maxScore: 39, color: '#b91c1c' },
]

const keyFor = (bands: readonly GradeBand[], percentage: number): string | null =>
  resolveGradeBand(percentage, bands)?.key ?? null

// ---------------------------------------------------------------------------
// Manufacturing a percentage
// ---------------------------------------------------------------------------

describe('calculatePercentage - a mark outside its assessment is not a percentage', () => {
  it('answers for a mark inside the assessment, rounding as before', () => {
    // The typo the defect needed: 15 on a 100-mark assessment.
    expect(calculatePercentage(15, 100)).toBe(15)
    expect(calculatePercentage(85, 100)).toBe(85)
    expect(calculatePercentage(100, 100)).toBe(100)
    expect(calculatePercentage(0, 100)).toBe(0)
    // Rounding is unchanged: 66.666... still reports 66.67, not 66.6666.
    expect(calculatePercentage(2, 3)).toBe(66.67)
    expect(calculatePercentage(15, 20)).toBe(75)
  })

  it('refuses a mark above the maximum rather than reporting over 100%', () => {
    expect(calculatePercentage(150, 100)).toBeNull()
    expect(calculatePercentage(120, 100)).toBeNull()
    expect(calculatePercentage(100.5, 100)).toBeNull()
    expect(calculatePercentage(300, 100)).toBeNull()
    // The value that overflowed `Score.percentage Decimal(5,2)`: 9999/1 is
    // 999900, which cannot be stored and used to surface as a 500.
    expect(calculatePercentage(9999, 1)).toBeNull()
    // 9999 is also out of range on a 100-mark assessment, whatever the arithmetic.
    expect(calculatePercentage(9999, 100)).toBeNull()
    expect(calculatePercentage(99, 100)).toBe(99)
  })

  it('refuses a negative mark, a non-finite mark, and an unusable maximum', () => {
    expect(calculatePercentage(-1, 100)).toBeNull()
    expect(calculatePercentage(-0.5, 100)).toBeNull()
    expect(calculatePercentage(Number.NaN, 100)).toBeNull()
    expect(calculatePercentage(Number.POSITIVE_INFINITY, 100)).toBeNull()
    expect(calculatePercentage(Number.NEGATIVE_INFINITY, 100)).toBeNull()
    // A zero or non-numeric maximum cannot carry a percentage at all. The old
    // answer was 0%, which is a mark the child did not earn.
    expect(calculatePercentage(5, 0)).toBeNull()
    expect(calculatePercentage(0, 0)).toBeNull()
    expect(calculatePercentage(5, Number.NaN)).toBeNull()
    expect(calculatePercentage(5, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('never returns a percentage past 999.99, so Decimal(5,2) always holds it', () => {
    for (const [marks, total] of [
      [9999, 1],
      [9999, 2],
      [100.5, 1],
      [1e6, 3],
    ] as const) {
      const percentage = calculatePercentage(marks, total)
      expect(percentage === null || (percentage >= 0 && percentage <= 100)).toBe(true)
      if (percentage !== null) expect(percentage).toBeLessThanOrEqual(999.99)
    }
  })
})

// ---------------------------------------------------------------------------
// Grading a percentage
// ---------------------------------------------------------------------------

describe('resolveGradeBand and determineGrade - out of range is not the top band', () => {
  it('grades a real percentage normally', () => {
    expect(keyFor(PRIMARY, 15)).toBe('level_1')
    expect(keyFor(PRIMARY, 85)).toBe('level_6')
    expect(keyFor(PRIMARY, 100)).toBe('level_6')
    expect(keyFor(PRIMARY, 0)).toBe('level_1')
    expect(determineGrade(85, PRIMARY)).toEqual({
      grade: 'Level 6',
      key: 'level_6',
      label: 'Level 6',
    })
  })

  it('yields no band for every out-of-range value the review listed', () => {
    for (const percentage of [100.5, 120, 150, 300, 850, 999.99, 999900]) {
      expect(keyFor(PRIMARY, percentage)).toBeNull()
      expect(determineGrade(percentage, PRIMARY)).toBeNull()
    }
    expect(keyFor(PRIMARY, -1)).toBeNull()
    expect(determineGrade(-1, PRIMARY)).toBeNull()
    // The exact defect: 150 on a 100-mark assessment is a 15 with a stray zero,
    // and it used to resolve to level_6, 'Level 6 — Excellent'.
    expect(determineGrade(150, PRIMARY)).toBeNull()
  })

  it('does not depend on how far the scale reaches', () => {
    // A school that reports nothing above 69 and one that reports everything to
    // 100 must reach the same conclusion about 150.
    const narrow: GradeBand[] = [
      { key: 'low', label: 'Low', minScore: 0, maxScore: 49, color: '#dc2626' },
      { key: 'high', label: 'High', minScore: 50, maxScore: 69, color: '#059669' },
    ]
    const floor50: GradeBand[] = [
      { key: 'pass', label: 'Pass', minScore: 50, maxScore: 100, color: '#059669' },
    ]
    expect(keyFor(narrow, 85)).toBeNull()
    expect(keyFor(floor50, 150)).toBeNull()
    expect(keyFor(PRIMARY, 150)).toBeNull()
    // And the legitimate configurations keep working: inside their own span they
    // grade, and a mark below the school's floor stays ungraded as it always was.
    expect(keyFor(narrow, 60)).toBe('high')
    expect(keyFor(floor50, 100)).toBe('pass')
    expect(keyFor(floor50, 49.99)).toBeNull()
    expect(keyFor(floor50, 45)).toBeNull()
  })

  it('still answers nothing for a non-finite percentage', () => {
    expect(keyFor(PRIMARY, Number.NaN)).toBeNull()
    expect(keyFor(PRIMARY, Number.POSITIVE_INFINITY)).toBeNull()
    expect(determineGrade(Number.NaN, PRIMARY)).toBeNull()
    expect(determineGrade(Number.POSITIVE_INFINITY, PRIMARY)).toBeNull()
  })

  it('still refuses a hole and an overlap, so the escape hatch was not the only guard', () => {
    const hole = PRIMARY.map((band) =>
      band.key === 'level_4' ? { ...band, minScore: 66 } : band,
    )
    expect(keyFor(hole, 65)).toBeNull()
    const overlap = PRIMARY.map((band) =>
      band.key === 'level_4' ? { ...band, minScore: 55 } : band,
    )
    expect(keyFor(overlap, 57)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Composing percentages into a summary
// ---------------------------------------------------------------------------

describe('computeAcademicSummary - an out-of-range percentage is not averaged in', () => {
  const row = (percentage: number | null, subjectId = 'maths') => ({
    subjectId,
    percentage,
    weight: 1,
    assessmentType: 'Classwork',
    assessmentTypeCode: 'CLASSWORK',
  })

  it('drops it rather than reporting a terminal mark no child earned', () => {
    const summary = computeAcademicSummary([row(150)], PRIMARY)
    expect(summary.gradedAssessments).toBe(0)
    expect(summary.weightedPercentage).toBeNull()
    expect(summary.overallPercentage).toBeNull()
    expect(summary.subjectCount).toBe(0)
    expect(summary.subjects).toEqual([])
  })

  it('does not let one bad row contaminate the rows around it', () => {
    const summary = computeAcademicSummary([row(150), row(75), row(40)], PRIMARY)
    // Two of three survive, and the mean is of those two alone.
    expect(summary.gradedAssessments).toBe(2)
    expect(summary.weightedPercentage).toBe(57.5)
    expect(summary.overallPercentage).toBe(57.5)
    expect(summary.subjects[0]?.band?.key).toBe('level_3')
    expect(summary.subjects[0]?.percentage).toBe(57.5)
  })

  it('drops a negative percentage, and a non-finite one, on the same terms', () => {
    expect(computeAcademicSummary([row(-1)], PRIMARY).gradedAssessments).toBe(0)
    expect(computeAcademicSummary([row(Number.NaN)], PRIMARY).gradedAssessments).toBe(0)
    expect(
      computeAcademicSummary([row(Number.POSITIVE_INFINITY)], PRIMARY).gradedAssessments,
    ).toBe(0)
    expect(computeAcademicSummary([row(null)], PRIMARY).gradedAssessments).toBe(0)
    // 100 is in range: a full mark is still a mark.
    expect(computeAcademicSummary([row(100)], PRIMARY).weightedPercentage).toBe(100)
  })
})