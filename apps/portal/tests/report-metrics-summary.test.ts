import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  computeAcademicSummary,
  findGradingScaleApplicabilityProblems,
  resolveApplicableGradingScale,
  resolveAssessmentWeight,
  type ReportableAssessment,
} from '@novastar/shared-utils'

/**
 * The report's summary arithmetic, proved without a database.
 *
 * `computeAcademicSummary` is the whole of `/api/reports/academic/[studentId]`'s
 * summary block: the route supplies a flat list of assessments and serialises
 * whatever comes back. That makes it the one place a wrong number reaches a
 * report card, and the defects this file pins are all of the same shape — a
 * figure computed over the wrong population.
 *
 * 1. `overallPercentage` averaged assessments unweighted, so ten HOMEWORK rows
 *    outvoted one FINAL even though `Assessment.weight` exists to say otherwise.
 * 2. Nothing here ever returns 0 to mean "nothing to say". Zero is a real score;
 *    "no data" is null.
 * 3. There is no `gpa` and no grade point. This school reports percentages, so
 *    a 0-4 average has nothing to average; the last assertion below fails if
 *    either key comes back.
 */

function assessment(overrides: Partial<ReportableAssessment>): ReportableAssessment {
  return {
    subjectId: 'sub-default',
    percentage: null,
    weight: 1,
    assessmentType: 'Classwork',
    assessmentTypeCode: 'CLASSWORK',
    ...overrides,
  }
}

/** Ten HOMEWORK rows at 50%, each worth 0.1, against one FINAL at 90%. */
const HOMEWORK_HEAVY: ReportableAssessment[] = [
  ...Array.from({ length: 10 }, () =>
    assessment({
      subjectId: 'maths',
      percentage: 50,
      weight: 0.1,
      assessmentType: 'Homework',
      assessmentTypeCode: 'HOMEWORK',
    }),
  ),
  assessment({
    subjectId: 'english',
    percentage: 90,
    weight: 10,
    assessmentType: 'Final Exam',
    assessmentTypeCode: 'FINAL',
  }),
]

describe('computeAcademicSummary - percentage scales and population', () => {
  it('keeps weightedPercentage on the 0-100 scale', () => {
    const summary = computeAcademicSummary([
      assessment({ subjectId: 'maths', percentage: 100, weight: 1 }),
      assessment({ subjectId: 'maths', percentage: 0, weight: 1 }),
    ])
    expect(summary.weightedPercentage).toBe(50)
    expect(summary.weightedPercentage).toBeGreaterThanOrEqual(0)
    expect(summary.weightedPercentage).toBeLessThanOrEqual(100)
  })

  it('does not let ten low-weight assessments outweigh one high-weight assessment', () => {
    const summary = computeAcademicSummary(HOMEWORK_HEAVY)

    // Per subject: maths 50, english 90. Averaged once each: 70.
    expect(summary.overallPercentage).toBe(70)
    // The old unweighted per-assessment mean was 590 / 11 = 53.64 — homework
    // dominating a term it is worth 1/11 of.
    expect(summary.overallPercentage).not.toBe(53.64)
    expect(summary.subjectCount).toBe(2)
    expect(
      summary.subjects.map((s) => ({
        subjectId: s.subjectId,
        percentage: s.percentage,
        gradedAssessments: s.gradedAssessments,
      })),
    ).toEqual([
      { subjectId: 'maths', percentage: 50, gradedAssessments: 10 },
      { subjectId: 'english', percentage: 90, gradedAssessments: 1 },
    ])
  })

  it('reports weightedPercentage as the mean mark, which is a different number', () => {
    const summary = computeAcademicSummary(HOMEWORK_HEAVY)
    // sum(pct x weight) / sum(weight) = 950 / 11.
    expect(summary.weightedPercentage).toBe(86.36)
    expect(summary.overallPercentage).toBe(70)
  })

  it('groups by subject identity, so two subjects sharing a name stay separate', () => {
    const summary = computeAcademicSummary([
      assessment({ subjectId: 'sub-a', percentage: 100, weight: 1 }),
      assessment({ subjectId: 'sub-b', percentage: 40, weight: 1 }),
    ])
    expect(summary.subjectCount).toBe(2)
    expect(summary.overallPercentage).toBe(70)
  })

  it('treats an unset or zero weight as one, so a subject cannot divide by zero', () => {
    const summary = computeAcademicSummary([
      assessment({ subjectId: 'maths', percentage: 80, weight: null }),
      assessment({ subjectId: 'maths', percentage: 60, weight: 0 }),
    ])
    expect(summary.weightedPercentage).toBe(70)
    expect(summary.subjects[0]?.percentage).toBe(70)
  })

  it('resolves each subject percentage to a band from the school scale it was given', () => {
    const bands = [
      { key: 'pass', label: 'Pass', minScore: 0, maxScore: 49, color: '#dc2626' },
      { key: 'credit', label: 'Credit', minScore: 50, maxScore: 69, color: '#ca8a04' },
      { key: 'excellent', label: 'Excellent', minScore: 70, maxScore: 100, color: '#047857' },
    ]
    const summary = computeAcademicSummary(
      [
        assessment({ subjectId: 'maths', percentage: 72 }),
        assessment({ subjectId: 'english', percentage: 41 }),
      ],
      bands,
    )
    expect(summary.subjects[0]?.band?.label).toBe('Excellent')
    // The band's own colour travels with it: the report colours by band, so a
    // school that picks a colour gets exactly that colour.
    expect(summary.subjects[0]?.band?.color).toBe('#047857')
    expect(summary.subjects[1]?.band?.label).toBe('Pass')
  })

  it('leaves the band null when the school has no scale for the class', () => {
    const summary = computeAcademicSummary([assessment({ percentage: 72 })])
    expect(summary.weightedPercentage).toBe(72)
    expect(summary.subjects[0]?.band).toBeNull()
  })
})

describe('computeAcademicSummary - no data is null, never 0', () => {
  it('returns null for every metric when there is no assessment at all', () => {
    const summary = computeAcademicSummary([])
    expect(summary.weightedPercentage).toBeNull()
    expect(summary.overallPercentage).toBeNull()
    expect(summary.subjects).toEqual([])
    expect(summary.weighting.components).toEqual([])
    // The counts are the only zeros: a metric that fell back to 0 here would
    // put a fabricated "0%" on a report card with nothing to report.
    expect(summary.gradedAssessments).toBe(0)
    expect(summary.subjectCount).toBe(0)
  })

  it('returns null for every metric when no assessment has been graded', () => {
    const summary = computeAcademicSummary([
      assessment({ subjectId: 'maths', percentage: null, weight: 1 }),
      assessment({ subjectId: 'english', percentage: null, weight: 1 }),
    ])
    expect(summary.weightedPercentage).toBeNull()
    expect(summary.overallPercentage).toBeNull()
    expect(summary.gradedAssessments).toBe(0)
    expect(summary.subjectCount).toBe(0)
  })

  it('reports a real zero score as 0, so the nulls above are not vacuous', () => {
    const summary = computeAcademicSummary([
      assessment({ subjectId: 'maths', percentage: 0, weight: 1 }),
    ])
    expect(summary.weightedPercentage).toBe(0)
    expect(summary.overallPercentage).toBe(0)
  })

  it('never produces NaN, whatever the weights are', () => {
    // An all-zero weight set is what an admin can produce by setting every
    // assessment type's defaultWeight to 0. Nothing may divide by zero here, so
    // every unusable weight falls through to equal weighting and the figures
    // stay finite — never NaN, never Infinity, and never a fabricated 0.
    const summary = computeAcademicSummary([
      assessment({ percentage: 50, weight: 0, typeDefaultWeight: 0 }),
      assessment({ percentage: 80, weight: 0, typeDefaultWeight: 0 }),
    ])
    expect(summary.weightedPercentage).toBe(65)
    expect(summary.overallPercentage).toBe(65)
    expect(Number.isFinite(summary.weightedPercentage as number)).toBe(true)
    expect(Number.isFinite(summary.overallPercentage as number)).toBe(true)
  })
})

describe('computeAcademicSummary - the payload carries no grade point', () => {
  it('has no gpa key and no point, in the summary or on a subject', () => {
    const summary = computeAcademicSummary([
      assessment({ subjectId: 'maths', percentage: 72 }),
    ])
    expect('gpa' in summary).toBe(false)
    expect('point' in summary).toBe(false)
    expect('point' in summary.subjects[0]!).toBe(false)
    expect('gpa' in summary.subjects[0]!).toBe(false)
  })
})

describe('resolveAssessmentWeight - the precedence, in one place', () => {
  it('prefers the weight set on the assessment itself', () => {
    expect(
      resolveAssessmentWeight({ weight: 0.4, typeDefaultWeight: 0.1 }),
    ).toEqual({ weight: 0.4, source: 'assessment' })
  })

  it('honours an explicit weight of exactly 1.00 instead of discarding it', () => {
    // The defect this pins: `Assessment.weight` was `NOT NULL DEFAULT 1`, so 1.00
    // had to mean "unset" for a type's configured weight to be reachable — and a
    // teacher who deliberately set one assessment to weigh fully had it thrown
    // away. The column is nullable now, so there is no sentinel and 1.00 means
    // what it says.
    expect(
      resolveAssessmentWeight({ weight: 1, typeDefaultWeight: 0.3 }),
    ).toEqual({ weight: 1, source: 'assessment' })
    expect(resolveAssessmentWeight({ weight: 1 })).toEqual({
      weight: 1,
      source: 'assessment',
    })
  })

  it('falls back to the type the school configured when the assessment carries none', () => {
    // NULL is the only thing that means unset. An unusable value (0, negative,
    // NaN) falls through the same way, because none of them is a weight that can
    // be divided by.
    expect(
      resolveAssessmentWeight({ weight: null, typeDefaultWeight: 0.25 }),
    ).toEqual({ weight: 0.25, source: 'assessment_type' })
    expect(
      resolveAssessmentWeight({ weight: 0, typeDefaultWeight: 0.1 }),
    ).toEqual({ weight: 0.1, source: 'assessment_type' })
  })

  it('falls back to equal weighting when neither the assessment nor its type carries one', () => {
    expect(resolveAssessmentWeight({ weight: null, typeDefaultWeight: null })).toEqual({
      weight: 1,
      source: 'default',
    })
    // A zero type default is not a weight of zero: it is an unconfigured type.
    expect(resolveAssessmentWeight({ weight: 0, typeDefaultWeight: 0 })).toEqual({
      weight: 1,
      source: 'default',
    })
    expect(
      resolveAssessmentWeight({ weight: Number.NaN, typeDefaultWeight: Number.NaN }),
    ).toEqual({ weight: 1, source: 'default' })
  })

  it('is what actually moves the number, so the fallback is not cosmetic', () => {
    const rows: ReportableAssessment[] = [
      assessment({ subjectId: 'maths', percentage: 100, weight: null, typeDefaultWeight: 0.1 }),
      assessment({ subjectId: 'maths', percentage: 50, weight: null, typeDefaultWeight: 0.3, assessmentType: 'School-Based Assessment', assessmentTypeCode: 'SBA' }),
    ]
    // (100 x 0.1 + 50 x 0.3) / 0.4 = 25 / 0.4
    expect(computeAcademicSummary(rows).subjects[0]?.percentage).toBe(62.5)

    // Give the first assessment a weight of its own and the composed figure moves.
    const overridden = computeAcademicSummary([
      { ...rows[0]!, weight: 0.5 },
      rows[1]!,
    ])
    // (100 x 0.5 + 50 x 0.3) / 0.8 = 65 / 0.8
    expect(overridden.subjects[0]?.percentage).toBe(81.25)

    // And the defect's own scenario: an SBA assessment explicitly set to 1.00 in a
    // school whose SBA type is worth 0.30 counts as 1.00, not 0.30. Weighted
    // against a second SBA row carrying the type's 0.30: (90 x 1 + 30 x 0.3) / 1.3.
    const explicitOne = computeAcademicSummary([
      assessment({ subjectId: 'maths', percentage: 90, weight: 1, typeDefaultWeight: 0.3 }),
      assessment({ subjectId: 'maths', percentage: 30, weight: null, typeDefaultWeight: 0.3, assessmentType: 'School-Based Assessment', assessmentTypeCode: 'SBA' }),
    ])
    expect(explicitOne.subjects[0]?.percentage).toBe(76.15)
    // Under the old sentinel the explicit 1.00 was discarded, both SBA rows
    // counted at 0.30, and the school's own weighting never reached the report.
    const discarded = computeAcademicSummary([
      assessment({ subjectId: 'maths', percentage: 90, weight: null, typeDefaultWeight: 0.3 }),
      assessment({ subjectId: 'maths', percentage: 30, weight: null, typeDefaultWeight: 0.3, assessmentType: 'School-Based Assessment', assessmentTypeCode: 'SBA' }),
    ])
    expect(discarded.subjects[0]?.percentage).toBe(60)
  })
})

describe('the weighting breakdown is the composition, not the number again', () => {
  it('groups by assessment type and states each share of the total', () => {
    const summary = computeAcademicSummary([
      assessment({ subjectId: 'maths', percentage: 100, weight: null, typeDefaultWeight: 0.1 }),
      assessment({ subjectId: 'maths', percentage: 50, weight: null, typeDefaultWeight: 0.3, assessmentType: 'School-Based Assessment', assessmentTypeCode: 'SBA' }),
    ])

    expect(summary.weighting.rule).toBe('normalised-weighted-mean')
    expect(summary.weighting.totalWeight).toBe(0.4)
    // Heaviest share first, and the share is what it carries of the total.
    expect(
      summary.weighting.components.map((c) => ({
        code: c.code,
        count: c.count,
        weight: c.weight,
        weightShare: c.weightShare,
        percentage: c.percentage,
      })),
    ).toEqual([
      { code: 'SBA', count: 1, weight: 0.3, weightShare: 75, percentage: 50 },
      { code: 'CLASSWORK', count: 1, weight: 0.1, weightShare: 25, percentage: 100 },
    ])
  })

  it('counts a type recorded three times as three entries, which is why SBA dominates a term', () => {
    const sba = (percentage: number): ReportableAssessment =>
      assessment({
        subjectId: 'maths',
        percentage,
        weight: null,
        typeDefaultWeight: 0.3,
        assessmentType: 'School-Based Assessment',
        assessmentTypeCode: 'SBA',
      })

    const summary = computeAcademicSummary([
      sba(70),
      sba(80),
      sba(90),
      assessment({ subjectId: 'maths', percentage: 60, weight: null, typeDefaultWeight: 0.1 }),
    ])

    const byCode = new Map(summary.weighting.components.map((c) => [c.code, c]))
    expect(byCode.get('SBA')).toMatchObject({
      count: 3,
      weight: 0.9,
      weightShare: 90,
      percentage: 80,
    })
    expect(byCode.get('CLASSWORK')).toMatchObject({ count: 1, weightShare: 10 })
    expect(summary.weighting.totalWeight).toBe(1)
  })

  it('names the untyped bucket rather than dropping an assessment with no type row', () => {
    const summary = computeAcademicSummary([
      assessment({
        subjectId: 'maths',
        percentage: 80,
        weight: null,
        typeDefaultWeight: null,
        assessmentType: null,
        assessmentTypeCode: null,
      }),
    ])
    expect(summary.weighting.components).toEqual([
      { code: null, name: 'Untyped', count: 1, weight: 1, weightShare: 100, percentage: 80 },
    ])
  })
})

describe('the zero-weight guard', () => {
  it('cannot divide by zero, because an unusable weight is never used as a weight', () => {
    for (const weight of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const resolved = resolveAssessmentWeight({
        weight,
        typeDefaultWeight: 0,
      })
      expect(Number.isFinite(resolved.weight)).toBe(true)
      expect(resolved.weight).toBeGreaterThan(0)
    }
  })

  it('refuses to seed a scheme whose weights cannot compose anything', () => {
    // An all-zero or negative set leaves every terminal percentage undefined,
    // and finding that out from a blank report card after the school has been
    // seeded is the worst possible moment. The seed has to refuse instead.
    const seedSrc = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'tools', 'seed', 'index.ts'),
      'utf-8',
    )
    expect(seedSrc).toContain('Seed refused: assessment-type weights must be finite and sum above 0')
    expect(seedSrc).toContain('weights must be finite and not negative')
  })

  it('refuses to seed bands that do not cover 0-100 exactly once', () => {
    const seedSrc = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'tools', 'seed', 'index.ts'),
      'utf-8',
    )
    // The assertion follows the definition: the check itself moved to
    // @novastar/shared-utils so the admin write path and the seed share ONE
    // implementation, and it is asserted on the module that now owns it rather
    // than on the seed's copy of the wording.
    const sharedUtilsSrc = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'packages', 'shared-utils', 'index.ts'),
      'utf-8',
    )
    expect(sharedUtilsSrc).toContain('does not cover 0-100 exactly once')
    // And it is actually called on both seeded scales rather than merely defined.
    expect(seedSrc).toMatch(
      /assertBandsCoverZeroToHundred\(scale\.name, scale\.levels\)/,
    )
    expect(seedSrc).toContain(
      "import { assertBandsCoverZeroToHundred } from '../../packages/shared-utils'",
    )
  })

  it('seeds weights that a head teacher can read off the page', () => {
    // Relative weights are normalised at composition time, so the set is not
    // required to sum to 1. It sums to 1 anyway because that is what reads
    // easiest — and 1.30 was the value before this was checked.
    const seedSrc = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'tools', 'seed', 'index.ts'),
      'utf-8',
    )
    const block = seedSrc.slice(
      seedSrc.indexOf('const assessmentTypes = ['),
      seedSrc.indexOf('\n  ]', seedSrc.indexOf('const assessmentTypes = [')),
    )
    const weights = [...block.matchAll(/defaultWeight:\s*([\d.]+)/g)].map((m) => Number(m[1]))
    expect(weights.length).toBe(7)
    expect(Math.round(weights.reduce((a, b) => a + b, 0) * 100) / 100).toBe(1)
  })
})

describe('resolveApplicableGradingScale - one rule, shared with the gradebook', () => {
  const scales = [
    { id: 'scale-b1', appliesToLevels: ['B1'], isDefault: false },
    { id: 'scale-default', appliesToLevels: [], isDefault: true },
    { id: 'scale-plain', appliesToLevels: ['B5'], isDefault: false },
  ]

  it('prefers a scale naming the level code', () => {
    expect(resolveApplicableGradingScale(scales, ['B1', 'Basic 1'])?.id).toBe('scale-b1')
  })

  it('matches the level name when the code is absent, because the seed stores codes', () => {
    // The seed writes codes, but a scale configured by hand through the UI may
    // name the level instead.
    expect(
      resolveApplicableGradingScale(
        [{ id: 'scale-by-name', appliesToLevels: ['Basic 5'], isDefault: false }],
        [null, 'Basic 5'],
      )?.id,
    ).toBe('scale-by-name')
  })

  it('falls back to the tenant default when the level is not named', () => {
    expect(resolveApplicableGradingScale(scales, ['B9', 'Basic 9'])?.id).toBe('scale-default')
    expect(resolveApplicableGradingScale(scales, [])?.id).toBe('scale-default')
    expect(resolveApplicableGradingScale(scales, [null, undefined])?.id).toBe('scale-default')
  })

  it('resolves the seeded primary/JHS split with no code change per level', () => {
    // The two seeded defaults name disjoint levels, so a school on the default
    // template gets the primary bands for B1-B6 and the JHS bands for B7-B9
    // purely from configuration.
    const seeded = [
      { id: 'primary', appliesToLevels: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'], isDefault: true },
      { id: 'jhs', appliesToLevels: ['B7', 'B8', 'B9'], isDefault: false },
    ]
    expect(resolveApplicableGradingScale(seeded, ['B4', 'Basic 4'])?.id).toBe('primary')
    expect(resolveApplicableGradingScale(seeded, ['B7', 'JHS 1'])?.id).toBe('jhs')
    // A level neither names falls back to the `isDefault` one, which is why the
    // primary template is the default and not the JHS one.
    expect(resolveApplicableGradingScale(seeded, ['KG1', 'KG 1'])?.id).toBe('primary')
  })

  it('returns null rather than inventing a scale when there is no default either', () => {
    const noDefault = [{ id: 'scale-b1', appliesToLevels: ['B1'], isDefault: false }]
    expect(resolveApplicableGradingScale(noDefault, ['B4'])).toBeNull()
    expect(resolveApplicableGradingScale([], ['B1'])).toBeNull()
  })
})

/**
 * Two scales claiming one level used to be decided by the row order the database
 * returned. `Array.find` takes the first match, so `([C, B], ['B9'])` resolved to
 * `C` and `([B, C], ['B9'])` to `B` with both marked default — and a routine VACUUM
 * was enough to move a cohort of children from one band to another, with no error
 * on any card. These cases pin the answer to the configuration instead of the array.
 */
describe('resolveApplicableGradingScale - the same answer whatever order the rows arrive in', () => {
  const ambiguous = [
    { id: 'b', name: 'Ghana Primary (GES 6-level)', appliesToLevels: ['B9'], isDefault: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'c', name: 'Ghana Primary 2026', appliesToLevels: ['B9'], isDefault: true, createdAt: '2026-06-01T00:00:00Z' },
  ]

  it('resolves both permutations to the same scale, and to the OLDER one', () => {
    // A copy of a scale must never displace the original it was copied from: the
    // older scale is the one the school has been reporting against.
    expect(resolveApplicableGradingScale([ambiguous[0]!, ambiguous[1]!], ['B9'])?.id).toBe('b')
    expect(resolveApplicableGradingScale([ambiguous[1]!, ambiguous[0]!], ['B9'])?.id).toBe('b')
  })

  it('does not mutate the caller\'s array while sorting', () => {
    const input = [...ambiguous].reverse()
    resolveApplicableGradingScale(input, ['B9'])
    expect(input.map((scale) => scale.id)).toEqual(['c', 'b'])
  })

  it('prefers a default that claims the level over one that does not', () => {
    const scales = [
      { id: 'plain', appliesToLevels: ['B9'], isDefault: false, createdAt: '2020-01-01T00:00:00Z' },
      { id: 'default', appliesToLevels: [], isDefault: true, createdAt: '2026-01-01T00:00:00Z' },
    ]
    expect(resolveApplicableGradingScale(scales, ['B9'])?.id).toBe('plain')
    expect(resolveApplicableGradingScale([...scales].reverse(), ['B9'])?.id).toBe('plain')
  })

  it('resolves the default fallback deterministically when several are marked default', () => {
    const scales = [
      { id: 'newer', appliesToLevels: [], isDefault: true, createdAt: '2026-06-01T00:00:00Z' },
      { id: 'older', appliesToLevels: [], isDefault: true, createdAt: '2026-01-01T00:00:00Z' },
    ]
    expect(resolveApplicableGradingScale(scales, ['KG1'])?.id).toBe('older')
    expect(resolveApplicableGradingScale([...scales].reverse(), ['KG1'])?.id).toBe('older')
  })

  it('falls back to the id when createdAt cannot separate two scales', () => {
    // `createdAt` is a timestamp, not a unique key. Without the id as a last key
    // the order would still not be a total one.
    const sameInstant = '2026-01-01T00:00:00Z'
    const scales = [
      { id: 'z', appliesToLevels: [], isDefault: true, createdAt: sameInstant },
      { id: 'a', appliesToLevels: [], isDefault: true, createdAt: sameInstant },
    ]
    expect(resolveApplicableGradingScale(scales, ['KG1'])?.id).toBe('a')
    expect(resolveApplicableGradingScale([...scales].reverse(), ['KG1'])?.id).toBe('a')
  })

  it('orders a scale with no timestamp after every scale that has one', () => {
    // A real row read through Prisma always carries `createdAt`; this only decides
    // the hand-built fixtures, and it must not throw or compare NaN.
    const scales = [
      { id: 'undated', appliesToLevels: [], isDefault: true },
      { id: 'dated', appliesToLevels: [], isDefault: true, createdAt: '2026-01-01T00:00:00Z' },
    ]
    expect(resolveApplicableGradingScale(scales, ['KG1'])?.id).toBe('dated')
    expect(resolveApplicableGradingScale([...scales].reverse(), ['KG1'])?.id).toBe('dated')
  })

  it('resolves the seeded split unchanged', () => {
    const seeded = [
      { id: 'primary', appliesToLevels: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'], isDefault: true, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'jhs', appliesToLevels: ['B7', 'B8', 'B9'], isDefault: false, createdAt: '2026-01-01T00:00:00Z' },
    ]
    expect(resolveApplicableGradingScale(seeded, ['B4', 'Basic 4'])?.id).toBe('primary')
    expect(resolveApplicableGradingScale([...seeded].reverse(), ['B7', 'JHS 1'])?.id).toBe('jhs')
  })
})

describe('findGradingScaleApplicabilityProblems - naming the configuration that makes resolution arbitrary', () => {
  const scale = (
    id: string,
    name: string,
    appliesToLevels: string[],
    isDefault = false,
  ) => ({ id, name, appliesToLevels, isDefault })

  it('accepts the seeded primary/JHS split', () => {
    expect(
      findGradingScaleApplicabilityProblems([
        scale('primary', 'Ghana Primary (GES 6-level)', ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'], true),
        scale('jhs', 'Ghana JHS (BECE 1-9)', ['B7', 'B8', 'B9']),
      ]),
    ).toEqual([])
  })

  it('names two scales claiming one level, which is the duplicate-name case @@unique cannot stop', () => {
    // `@@unique([tenantId, schoolId, name])` stops two scales sharing a NAME, so a
    // copied scale is a legal row that claims the same levels.
    const problems = findGradingScaleApplicabilityProblems([
      scale('a', 'Ghana Primary (GES 6-level)', ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'], true),
      scale('b', 'Ghana Primary 2026', ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']),
    ])
    expect(problems).toHaveLength(6)
    expect(problems[0]).toContain('level B1 is claimed by 2 scales')
    expect(problems[0]).toContain('"Ghana Primary (GES 6-level)"')
    expect(problems[0]).toContain('"Ghana Primary 2026"')
  })

  it('names two scales marked default, which decides every level no scale names', () => {
    const problems = findGradingScaleApplicabilityProblems([
      scale('a', 'Primary', ['B1'], true),
      scale('b', 'Primary copy', ['B2'], true),
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('2 scales are marked the default')
  })

  it('reports both defects when a copy is also marked default', () => {
    const problems = findGradingScaleApplicabilityProblems([
      scale('a', 'Primary', ['B1'], true),
      scale('b', 'Primary copy', ['B1'], true),
    ])
    expect(problems).toHaveLength(2)
  })

  it('ignores empty level codes rather than reporting every scale as clashing', () => {
    expect(findGradingScaleApplicabilityProblems([scale('a', 'A', ['']), scale('b', 'B', ['', ''])])).toEqual([])
  })

  it('falls back to the id when a scale has no name', () => {
    const problems = findGradingScaleApplicabilityProblems([
      { id: 'scale-1', appliesToLevels: ['B1'], isDefault: true },
      { id: 'scale-2', appliesToLevels: ['B1'], isDefault: true },
    ])
    expect(problems[0]).toContain('scale scale-1')
  })
})