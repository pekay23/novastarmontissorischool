import { describe, it, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  computeAcademicSummary,
  contrastTextColor,
  type GradeBand,
} from '@novastar/shared-utils'
import {
  ENTITY_CONFIG_MAP,
  GradingLevelCreateSchema,
} from '@novastar/shared-types'
import { BandBadge } from '@/app/(portal)/reports/[studentId]/page'

/**
 * What a report card says when it cannot show a band, and the one colour value
 * that can reach its `style` attribute.
 *
 * Two defects, both about a report that lies or goes blank:
 *
 * 1. `band === null` carried no reason, so six different states rendered as the
 *    same "-". A parent reads "-" as a missing mark. The card now renders the
 *    state's own words, and these are rendered here — through the real component,
 *    with the real percentages `computeAcademicSummary` produces — rather than
 *    asserted as source text, because the claim being made is a claim about what
 *    a person is shown.
 * 2. `contrastTextColor` is the fallback for a colour it cannot parse, and it
 *    crashed on `null` instead: `.trim()` on a null inside a render. The column
 *    is `NOT NULL` so it is unreachable from a stored row, which is exactly why
 *    it went unnoticed. It is total now, and the boundary refuses a colour that
 *    is not hex in the first place.
 */

const band = (
  key: string,
  minScore: number,
  maxScore: number,
  label: string,
  color = '#047857',
): GradeBand => ({ key, minScore, maxScore, label, color, order: 0, description: null })

/** What the card renders for one subject of one subject's summary. */
const renderFor = (percentage: number, bands: readonly GradeBand[], scaleName: string | null) => {
  const summary = computeAcademicSummary(
    [
      {
        subjectId: 'maths',
        percentage,
        weight: 1,
        assessmentType: 'Classwork',
        assessmentTypeCode: 'CLASSWORK',
      },
    ],
    bands,
  )
  const subject = summary.subjects[0]
  return {
    subject,
    html: renderToStaticMarkup(
      createElement(BandBadge, {
        band: subject?.band ?? null,
        status: subject?.bandStatus ?? null,
        problem: subject?.bandProblem ?? null,
        scaleName,
        percentage: subject?.percentage ?? null,
      }),
    ),
  }
}

/**
 * The text a person actually sees, with the screen-reader-only prefix removed —
 * a badge that reads "No band: No grading scale" shows "No grading scale".
 */
const textOf = (html: string): string =>
  html
    .replace(/<span class="sr-only">.*?<\/span>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const FULL_SCALE: GradeBand[] = [
  band('level_6', 85, 100, 'Level 6'),
  band('level_5', 70, 84, 'Level 5'),
  band('level_4', 60, 69, 'Level 4'),
  band('level_3', 50, 59, 'Level 3'),
  band('level_2', 40, 49, 'Level 2'),
  band('level_1', 0, 39, 'Level 1'),
]

describe('the report card states which of the six "no band" states it is in', () => {
  it('shows the band, in the school\'s colour, when the percentage resolves', () => {
    const { html, subject } = renderFor(72, FULL_SCALE, 'Ghana Primary GES 6-level')
    expect(subject?.bandStatus).toBe('ok')
    expect(textOf(html)).toBe('Level 5')
    // The badge is the school's own colour, and its text contrast comes from that
    // colour rather than from the size of the score.
    expect(html).toContain('background-color:#047857')
  })

  it('never prints a bare dash for a state it can name', () => {
    // Every row of the table in the review: the same `band: null`, five different
    // reasons, all of which used to render as "-".
    const cases: ReadonlyArray<{
      percentage: number
      bands: readonly GradeBand[]
      scaleName: string | null
      expected: string
    }> = [
      {
        percentage: 68,
        bands: [],
        scaleName: null,
        expected: 'No grading scale',
      },
      {
        percentage: 68,
        bands: [],
        scaleName: 'Ghana Primary GES 6-level',
        expected: 'No grading scale',
      },
      {
        percentage: 45,
        bands: [band('level_4', 50, 100, 'Level 4')],
        scaleName: 'Half scale',
        expected: 'Below the scale',
      },
      {
        percentage: 85,
        bands: [band('level_1', 0, 69, 'Level 1')],
        scaleName: 'Low scale',
        expected: 'Above the scale',
      },
      {
        percentage: 62,
        bands: FULL_SCALE.map((b) => (b.key === 'level_4' ? { ...b, minScore: 66 } : b)),
        scaleName: 'Mistyped',
        expected: 'Gap in the scale',
      },
      {
        percentage: 57,
        bands: FULL_SCALE.map((b) => (b.key === 'level_4' ? { ...b, minScore: 55 } : b)),
        scaleName: 'Overlapping',
        expected: 'Two bands claim this',
      },
      {
        percentage: 65,
        bands: [band('backwards', 90, 10, 'Backwards')],
        scaleName: 'Broken',
        expected: 'Scale cannot grade',
      },
    ]
    for (const testCase of cases) {
      const { html, subject } = renderFor(
        testCase.percentage,
        testCase.bands,
        testCase.scaleName,
      )
      expect(subject?.band).toBeNull()
      expect(textOf(html)).toContain(testCase.expected)
      // The defect: no cell in the report may read as a missing mark.
      expect(textOf(html)).not.toBe('-')
    }
  })

  it('distinguishes "no scale applies" from "the scale has no bands"', () => {
    // `computeAcademicSummary` is handed bands and nothing else, so both arrive as
    // `no-scale`. Only the report is told which scale applied, so only the report
    // can say which of the two it is.
    const withoutScale = renderToStaticMarkup(
      createElement(BandBadge, { band: null, status: 'no-scale', scaleName: null }),
    )
    const emptiedScale = renderToStaticMarkup(
      createElement(BandBadge, {
        band: null,
        status: 'no-scale',
        scaleName: 'Ghana Primary GES 6-level',
      }),
    )
    expect(textOf(withoutScale)).toBe('No grading scale')
    expect(textOf(emptiedScale)).toBe('No grading scale')
    expect(emptiedScale).toContain('has no bands')
    expect(withoutScale).not.toContain('has no bands')
    expect(withoutScale).toContain('No grading scale applies to this class')
    // And the difference is visible: an emptied scale is a fault, a school that has
    // not built one yet is not.
    expect(emptiedScale).toContain('border-destructive')
    expect(withoutScale).not.toContain('border-destructive')
  })

  it('quotes the ranges to fix, so the fault is actionable and not just labelled', () => {
    const gap = renderFor(
      62,
      FULL_SCALE.map((b) => (b.key === 'level_4' ? { ...b, minScore: 66 } : b)),
      'Mistyped',
    )
    expect(gap.html).toContain('60-65%')
    // The child's own percentage is named too, so the fault is not read as being
    // about somebody else on the card.
    expect(gap.html).toContain('62.0%')

    const emptied = renderFor(68, [band('level_6', 85, 100, 'Level 6')], 'Ghana Primary GES')
    expect(emptied.html).toContain('no band covers 0-84%')
  })

  it('says so on the per-assessment row too, where nothing is known about the row', () => {
    // A row with no band of its own and no status: the subject's problem is all
    // that is known, and it is more honest than a dash.
    const row = renderToStaticMarkup(
      createElement(BandBadge, { band: null, problem: 'no band covers 0-49%' }),
    )
    expect(textOf(row)).toContain('Scale error')
    // Nothing known at all is still a dash — there is no claim to make.
    const silent = renderToStaticMarkup(createElement(BandBadge, { band: null }))
    expect(textOf(silent)).toBe('-')
  })
})

describe('contrastTextColor is total, and only a hex colour can reach it', () => {
  it('answers for every value it cannot parse, including null and undefined', () => {
    // The defect: `.trim()` on the argument, so `contrastTextColor(null)` threw
    // `TypeError: null is not an object` inside the render that was supposed to
    // survive a bad colour.
    for (const value of [
      null,
      undefined,
      '',
      '   ',
      'red',
      'transparent',
      '#abc',
      'rgb(1,2,3)',
      'var(--band)',
      'not a colour at all',
    ]) {
      expect(contrastTextColor(value)).toBe('#0f172a')
    }
  })

  it('still decides dark-on-light and light-on-dark from the colour it is given', () => {
    expect(contrastTextColor('#ffffff')).toBe('#0f172a')
    expect(contrastTextColor('#fde047')).toBe('#0f172a')
    expect(contrastTextColor('#047857')).toBe('#ffffff')
    expect(contrastTextColor(' #000000 ')).toBe('#ffffff')
    expect(contrastTextColor('#abc')).toBe('#0f172a')
  })

  it('accepts a six-digit hex colour on create and on update, and nothing else', () => {
    // The schemas the route itself parses with, so this cannot pass while the
    // write path validates something else.
    const entry = ENTITY_CONFIG_MAP.grading_level
    const createSchema = entry?.createSchema
    const updateSchema = entry?.updateSchema
    if (!createSchema || !updateSchema) throw new Error('grading_level declares no write schemas')
    expect(createSchema).toBe(GradingLevelCreateSchema)

    const base = {
      gradingScaleId: 'scale-primary',
      key: 'level_4',
      label: 'Level 4',
      minScore: 60,
      maxScore: 69,
      description: null,
      order: 4,
    }
    for (const color of ['#047857', '#AABBCC', '#000000', '#ffffff']) {
      expect(createSchema.safeParse({ ...base, color }).success).toBe(true)
      expect(updateSchema.safeParse({ color }).success).toBe(true)
    }
    // A named colour renders the badge at 4.26:1 on dark text — below AA for the
    // 12px label — and 'transparent' renders a badge with no background. Neither
    // is a thing a head teacher can see is wrong, so neither may be stored.
    for (const color of ['red', 'transparent', 'rgb(1,2,3)', '#abc', '', ' #047857']) {
      const created = createSchema.safeParse({ ...base, color })
      expect(created.success).toBe(false)
      expect(updateSchema.safeParse({ color }).success).toBe(false)
    }
    // The rejected shape is the one the contrast helper cannot read, so the value
    // that reaches the report's `style` is always one it can.
    for (const color of ['red', 'transparent', 'rgb(1,2,3)', '#abc']) {
      expect(contrastTextColor(color)).toBe('#0f172a')
    }
  })
})