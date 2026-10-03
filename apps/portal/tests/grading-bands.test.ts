import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NACCA_6_LEVEL } from '@novastar/ghana-education'
import { resolveGradeBand, type GradeBand } from '@novastar/shared-utils'

/**
 * Grade bands as a school configures them, proved without a database.
 *
 * A band is a percentage range plus the label and colour the school reports it
 * under. Two properties are worth more than the specific numbers:
 *
 * - the bands of a scale must cover 0-100 EXACTLY ONCE. A gap leaves a
 *   percentage with no label; an overlap hands it to whichever band sorts first.
 *   Both are off-by-one mistakes and both mis-grade a child silently, so every
 *   boundary value is asserted here, and then every integer in between.
 * - the application must contain no idea what a band means. The owner asked for
 *   the school's own scheme, so a school that invents bands nothing like either
 *   default has to work with no code change. That is the test named below.
 */

const PORTAL = join(import.meta.dir, '..')
const REPO = join(PORTAL, '..', '..')
const seedSrc = readFileSync(join(REPO, 'tools', 'seed', 'index.ts'), 'utf-8')

/**
 * The seeded primary bands, built the way the seed builds them: from the NaCCA
 * 6-level scale, with NaCCA's level number kept in the key and `order` assigned
 * best-first. The seed derives them rather than re-typing them, so the test does
 * too — and the assertions below pin the derivation as well as the numbers.
 */
const PRIMARY_BANDS: GradeBand[] = [...NACCA_6_LEVEL.levels]
  .map((band) => ({
    key: `level_${band.key.replace(/^level/, '')}`,
    label: band.label,
    minScore: band.minScore,
    maxScore: band.maxScore,
    color: band.color,
    description: band.description ?? '',
  }))
  .sort((a, b) => b.maxScore - a.maxScore)
  .map((band, index) => ({ ...band, order: index + 1 }))

/**
 * The seeded JHS bands, read out of the seed source.
 *
 * These are literal rows in `tools/seed/index.ts` rather than a derivation, so
 * the only honest way to test what a school would actually be seeded with is to
 * read them from there. If the seed's shape changes, the extractor finds nothing
 * and this file fails loudly instead of silently testing nothing.
 */
function seededBands(constName: string): GradeBand[] {
  const decl = seedSrc.indexOf(`const ${constName}`)
  expect(decl).toBeGreaterThan(-1)
  const open = seedSrc.indexOf('[', decl)
  const close = seedSrc.indexOf('\n]', open)
  expect(close).toBeGreaterThan(open)
  const body = seedSrc.slice(open, close)
  const row =
    /\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)',\s*minScore:\s*(\d+),\s*maxScore:\s*(\d+),\s*color:\s*'([^']+)',\s*description:\s*'([^']*)',\s*order:\s*(\d+)\s*\},/g
  const bands: GradeBand[] = []
  for (const match of body.matchAll(row)) {
    bands.push({
      key: match[1]!,
      label: match[2]!,
      minScore: Number(match[3]),
      maxScore: Number(match[4]),
      color: match[5]!,
      description: match[6]!,
      order: Number(match[7]),
    })
  }
  expect(bands.length).toBeGreaterThan(0)
  return bands
}

const JHS_BANDS = seededBands('JHS_DEFAULT_BANDS')

/** The label a percentage is reported under, or null when no band holds it. */
const labelFor = (bands: readonly GradeBand[], percentage: number): string | null =>
  resolveGradeBand(percentage, bands)?.label ?? null

/** Bands must tile 0-100 with no gap and no overlap. */
function expectExhaustiveAndDisjoint(bands: readonly GradeBand[]): void {
  for (let percentage = 0; percentage <= 100; percentage += 1) {
    const matches = bands.filter(
      (band) => percentage >= band.minScore && percentage <= band.maxScore,
    )
    expect(
      matches.length,
      `${percentage}% matched ${matches.length} bands (${matches.map((b) => b.key).join(', ')})`,
    ).toBe(1)
  }
}

describe('Ghana Primary default - NaCCA 6-level bands', () => {
  it('maps every boundary value to the band a Ghanaian primary school expects', () => {
    const expected: Array<[number, string]> = [
      [100, 'Level 6 — Excellent'],
      [85, 'Level 6 — Excellent'],
      [84, 'Level 5 — Proficient'],
      [70, 'Level 5 — Proficient'],
      [69, 'Level 4 — Adequate'],
      [60, 'Level 4 — Adequate'],
      [59, 'Level 3 — Elementary'],
      [50, 'Level 3 — Elementary'],
      [49, 'Level 2 — Partial'],
      [40, 'Level 2 — Partial'],
      [39, 'Level 1 — Below Partial'],
      [0, 'Level 1 — Below Partial'],
    ]
    for (const [percentage, label] of expected) {
      expect(labelFor(PRIMARY_BANDS, percentage)).toBe(label)
    }
  })

  it('covers 0-100 exactly once, and keeps `order` unique', () => {
    expectExhaustiveAndDisjoint(PRIMARY_BANDS)
    expect(new Set(PRIMARY_BANDS.map((b) => b.key)).size).toBe(6)
    expect(new Set(PRIMARY_BANDS.map((b) => b.order)).size).toBe(6)
  })

  it('is keyed level_1..level_6 and ordered best first, higher level better', () => {
    // `key` is persisted on `Score.grade`, so it is school-facing and stable.
    expect(PRIMARY_BANDS.map((b) => b.key)).toEqual([
      'level_6',
      'level_5',
      'level_4',
      'level_3',
      'level_2',
      'level_1',
    ])
    expect(PRIMARY_BANDS.map((b) => b.order)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('is derived from the curriculum engine by import, not re-typed in the seed', () => {
    // If this fails, the seed has started carrying its own copy of the NaCCA
    // bands and the two can drift apart.
    expect(seedSrc).toContain("import { NACCA_6_LEVEL } from '../../packages/ghana-education'")
    expect(seedSrc).toContain('PRIMARY_DEFAULT_BANDS')
    // The primary template's own boundaries must not be typed out again.
    expect(seedSrc).not.toMatch(/NACCA_6_LEVEL[\s\S]{0,200}minScore:\s*85/)
  })
})

describe('Ghana JHS default - WAEC published BECE 1-9 percentage bands', () => {
  it('maps every boundary value to the published interpretation', () => {
    const expected: Array<[number, string]> = [
      [100, 'Grade 1 (Excellent)'],
      [75, 'Grade 1 (Excellent)'],
      [74, 'Grade 2 (Very Good)'],
      [70, 'Grade 2 (Very Good)'],
      [69, 'Grade 3 (Good)'],
      [65, 'Grade 3 (Good)'],
      [64, 'Grade 4 (Credit)'],
      [60, 'Grade 4 (Credit)'],
      [59, 'Grade 5 (Credit)'],
      [55, 'Grade 5 (Credit)'],
      [54, 'Grade 6 (Credit)'],
      [50, 'Grade 6 (Credit)'],
      [49, 'Grade 7 (Pass)'],
      [45, 'Grade 7 (Pass)'],
      [44, 'Grade 8 (Pass)'],
      [40, 'Grade 8 (Pass)'],
      [39, 'Grade 9 (Fail)'],
      [0, 'Grade 9 (Fail)'],
    ]
    for (const [percentage, label] of expected) {
      expect(labelFor(JHS_BANDS, percentage)).toBe(label)
    }
  })

  it('covers 0-100 exactly once, with nine unique keys and unique order positions', () => {
    expectExhaustiveAndDisjoint(JHS_BANDS)
    expect(JHS_BANDS.map((b) => b.key)).toEqual([
      'grade_1',
      'grade_2',
      'grade_3',
      'grade_4',
      'grade_5',
      'grade_6',
      'grade_7',
      'grade_8',
      'grade_9',
    ])
    // `@@unique([gradingScaleId, order])`: a duplicate would make the winning
    // band a function of row order rather than of the score.
    expect(new Set(JHS_BANDS.map((b) => b.order)).size).toBe(9)
  })

  it('runs the other way to the primary scale: a LOWER grade number is better', () => {
    expect(labelFor(JHS_BANDS, 95)).toBe('Grade 1 (Excellent)')
    expect(labelFor(JHS_BANDS, 20)).toBe('Grade 9 (Fail)')
    // The single fact a UI must not get wrong: the best result has the
    // smallest key, so nothing may sort or colour by key magnitude.
    const excellent = JHS_BANDS.find((b) => b.key === 'grade_1')!
    const fail = JHS_BANDS.find((b) => b.key === 'grade_9')!
    expect(excellent.minScore).toBeGreaterThan(fail.minScore)
    // `GradeBand.order` is optional because the report tolerates a caller that
    // omits it. The seeded JHS scale always sets it, so both are narrowed here
    // rather than the assertion being weakened to accept `undefined`.
    expect(excellent.order!).toBeLessThan(fail.order!)
  })

  it('carries the compliance note in the source, not only in a commit message', () => {
    // WAEC marking is norm-referenced (stanine) and shifts with the national
    // cohort each year. These bands reproduce the published percentage
    // interpretation for internal reporting only, and the software must not be
    // represented as generating official BECE results. That belongs in the repo.
    //
    // Matched against the comment with its line wrapping and `*` gutter
    // flattened: the sentence is prose, and prose gets re-wrapped by every
    // formatter, so a raw substring match would fail on a reflow that changed
    // nothing about the note.
    const prose = seedSrc.replace(/\s*\n\s*\*?\s*/g, ' ')
    expect(prose).toContain('norm-referenced')
    expect(prose).toContain('must not be represented as generating official BECE results')
    expect(prose).toContain('may be presented as an official result')
  })

  it('says which direction it runs, so the report can quote the school', () => {
    // The UI surfaces the scale description rather than inferring a direction.
    const jhsBlock = seedSrc.slice(
      seedSrc.indexOf("name: 'Ghana JHS (BECE 1-9)'"),
      seedSrc.indexOf("name: 'Ghana JHS (BECE 1-9)'") + 700,
    )
    expect(jhsBlock).toContain('LOWER grade number is better')
  })
})

describe('a custom school scale works with no code change', () => {
  /**
   * The owner's requirement, stated as a test: a school that rejects both
   * defaults and configures bands of its own — different boundaries, different
   * labels, its own keys, and a third direction convention — must be reported
   * against its own bands, with nothing in the application edited.
   */
  it('reports a percentage under the custom bands, not either default', () => {
    const SCALE_NAME = "Osei-Tutu House Scale (head teacher's own)"
    const customBands: GradeBand[] = [
      // Deliberately unlike either default: odd boundaries, a 20-point top band,
      // house-worded labels, and keys that mean nothing to the product.
      { key: 'not_yet', label: 'Not Yet', minScore: 0, maxScore: 19, color: '#7f1d1d', order: 1 },
      { key: 'begun', label: 'Begun', minScore: 20, maxScore: 44, color: '#b45309', order: 2 },
      { key: 'steady', label: 'Steady', minScore: 45, maxScore: 63, color: '#ca8a04', order: 3 },
      { key: 'shining', label: 'Shining', minScore: 64, maxScore: 84, color: '#0d9488', order: 4 },
      { key: 'exceptional', label: 'Exceptional', minScore: 85, maxScore: 100, color: '#fde047', order: 5 },
    ]

    expectExhaustiveAndDisjoint(customBands)

    // 72% on the custom scale is "Shining". It is NOT Level 5/Proficient
    // (70-84) on the primary default, and NOT Grade 3/Good (65-69) on the JHS
    // one, which is the whole point: the label came from the school.
    expect(labelFor(customBands, 72)).toBe('Shining')
    expect(labelFor(PRIMARY_BANDS, 72)).toBe('Level 5 — Proficient')
    expect(labelFor(JHS_BANDS, 72)).toBe('Grade 2 (Very Good)')

    // The band's own colour is carried through, because the report colours by
    // band and never by the magnitude of the score.
    expect(resolveGradeBand(72, customBands)?.color).toBe('#0d9488')
    expect(SCALE_NAME).not.toBe('')
  })

  it('needs no direction of its own to be reported correctly', () => {
    // A custom scale whose worst band has the HIGHEST minScore: a UI that
    // assumed "bigger number is better" would colour this backwards. Resolution
    // only ever compares a percentage against each band's own range.
    const inverted: GradeBand[] = [
      { key: 'gold', label: 'Gold', minScore: 0, maxScore: 9, color: '#ca8a04', order: 1 },
      { key: 'silver', label: 'Silver', minScore: 10, maxScore: 19, color: '#94a3b8', order: 2 },
      { key: 'bronze', label: 'Bronze', minScore: 20, maxScore: 100, color: '#b45309', order: 3 },
    ]
    expect(labelFor(inverted, 5)).toBe('Gold')
    expect(labelFor(inverted, 15)).toBe('Silver')
    expect(labelFor(inverted, 95)).toBe('Bronze')
  })

  it('clamps a score above the whole scale to the nearest band beneath it', () => {
    const narrow: GradeBand[] = [
      { key: 'low', label: 'Low', minScore: 0, maxScore: 49, color: '#dc2626', order: 1 },
      { key: 'high', label: 'High', minScore: 50, maxScore: 69, color: '#059669', order: 2 },
    ]
    expect(labelFor(narrow, 60)).toBe('High')
    // 85 is past the top band, so nothing contains it. `High` is the last label
    // the school defined before the score ran out of scale, and reporting it is
    // honest; inventing a better band would not be.
    expect(labelFor(narrow, 85)).toBe('High')
    expect(labelFor(narrow, 1000)).toBe('High')
  })

  it('leaves a score below the whole scale ungraded, because nothing lies beneath it', () => {
    const narrow: GradeBand[] = [
      { key: 'low', label: 'Low', minScore: 10, maxScore: 49, color: '#dc2626', order: 1 },
      { key: 'high', label: 'High', minScore: 50, maxScore: 69, color: '#059669', order: 2 },
    ]
    // 5 is under the scale floor. Every band starts above it, so there is no
    // band beneath 5 to fall back to and calling it "Low" would be a
    // fabrication — the honest answer is no band at all.
    expect(labelFor(narrow, 5)).toBeNull()
    expect(labelFor(narrow, -20)).toBeNull()
    // The floor itself is inside the scale, so the band resolves normally.
    expect(labelFor(narrow, 10)).toBe('Low')
  })
})

describe('the report surface reports percentages and nothing grade-pointed', () => {
  const routeSrc = readFileSync(
    join(PORTAL, 'app', 'api', 'reports', 'academic', '[studentId]', 'route.ts'),
    'utf-8',
  )
  const studentPageSrc = readFileSync(
    join(PORTAL, 'app', '(portal)', 'reports', '[studentId]', 'page.tsx'),
    'utf-8',
  )
  const listPageSrc = readFileSync(
    join(PORTAL, 'app', '(portal)', 'reports', 'page.tsx'),
    'utf-8',
  )

  /**
   * Every production file that could reintroduce the concept, listed rather
   * than globbed so the check cannot quietly shrink. Each is a path a reviewer
   * can open; none of them may contain the word as a token at all, which is why
   * the prose that explains the removal says "0-4 average" and not the old name.
   */
  const GRADING_SURFACE = [
    join(REPO, 'packages', 'database', 'prisma', 'schema.prisma'),
    join(
      REPO,
      'packages',
      'database',
      'prisma',
      'migrations',
      '20261003000000_unifiedtransform_port_wave0',
      'migration.sql',
    ),
    join(REPO, 'packages', 'shared-utils', 'index.ts'),
    join(REPO, 'packages', 'shared-types', 'entity-schemas.ts'),
    join(REPO, 'packages', 'shared-types', 'entity-api-config.ts'),
    join(REPO, 'packages', 'shared-types', 'config-schema.ts'),
    join(REPO, 'packages', 'ghana-education', 'index.ts'),
    join(REPO, 'tools', 'seed', 'index.ts'),
    join(PORTAL, 'app', 'api', 'reports', 'academic', '[studentId]', 'route.ts'),
    join(PORTAL, 'app', '(portal)', 'reports', '[studentId]', 'page.tsx'),
    join(PORTAL, 'app', '(portal)', 'reports', 'page.tsx'),
    join(PORTAL, 'app', 'api', 'assessments', 'route.ts'),
  ] as const

  it('has no gpa and no point in the payload or on either page', () => {
    for (const [name, src] of [
      ['route', routeSrc],
      ['reports/[studentId]/page.tsx', studentPageSrc],
      ['reports/page.tsx', listPageSrc],
    ] as const) {
      expect(src, `${name} still mentions gpa`).not.toMatch(/\bgpa\b/i)
      // `point` as a field name or identifier, not the English word: both pages
      // legitimately contain "decimal point" and "grade-point average" in prose.
      expect(src, `${name} still carries a point field`).not.toMatch(/\bpoint\s*[:?]/)
      expect(src, `${name} still names a grade point`).not.toMatch(/grade_?point/i)
    }
  })

  it('says the word nowhere on the grading surface at all', () => {
    for (const file of GRADING_SURFACE) {
      const src = readFileSync(file, 'utf-8')
      const rel = file.slice(REPO.length + 1)
      expect(src, `${rel} still says gpa`).not.toMatch(/\bgpa\b/i)
    }
  })

  it('has no grade-point column on the band model, in the schema or in the API field list', () => {
    const schema = readFileSync(join(REPO, 'packages', 'database', 'prisma', 'schema.prisma'), 'utf-8')
    const model = schema.slice(
      schema.indexOf('model GradingLevel {'),
      schema.indexOf('model GradingLevel {') + 1200,
    )
    expect(model, 'GradingLevel still declares a point column').not.toMatch(/\bpoint\b/)

    const apiConfig = readFileSync(
      join(REPO, 'packages', 'shared-types', 'entity-api-config.ts'),
      'utf-8',
    )
    const fields = apiConfig.match(/model: 'gradingLevel',\s*\n\s*fields: \[([^\]]*)\]/)
    expect(fields, 'grading_level fields list not found').not.toBeNull()
    expect(fields![1]).not.toMatch(/'point'/)
  })

  it('labels every headline figure with its unit and range', () => {
    expect(studentPageSrc).toContain('Overall % (0&ndash;100)')
    expect(studentPageSrc).toContain('Weighted % (0&ndash;100)')
    expect(studentPageSrc).toContain('Attendance (0&ndash;100)')
  })

  it('colours by the band it was given, not by the size of the score', () => {
    // A magnitude threshold in the markup is the defect: the JHS default is
    // better the lower the grade number, so 95% is the best result there.
    expect(studentPageSrc).not.toMatch(/percentage\s*>=\s*\d/)
    expect(studentPageSrc).toContain('backgroundColor: band.color')
    expect(listPageSrc).toContain('backgroundColor: band.color')
  })

  it('quotes the scale description rather than assuming a direction', () => {
    expect(studentPageSrc).toContain('grading.description')
    expect(studentPageSrc).toContain('grading.name')
  })

  it('shows the weighting breakdown, not just the number it produced', () => {
    expect(studentPageSrc).toContain('WeightingBreakdown')
    expect(studentPageSrc).toContain('weighting.components')
    expect(routeSrc).toContain('weighting: summaryMetrics.weighting')
  })
})