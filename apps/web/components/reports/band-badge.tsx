'use client'

import { contrastTextColor, type BandStatus } from '@novastar/shared-utils'

/**
 * A band of the school's own grading scale, resolved from the percentage.
 *
 * Coloured by the band's own `color` and never by the size of the score: bands
 * are school-configured and the seeded JHS scale runs the other way (grade 9 is
 * the worst result), so magnitude-based colouring would mislabel half the school.
 */
export interface ReportBand {
  key: string
  label: string
  color: string
  minScore: number
  maxScore: number
  description?: string | null
}

/**
 * What the card says in place of a band, per `bandStatus`.
 *
 * Every state gets its own words, because a single "-" said "no mark recorded" for
 * six different reasons and four of them are faults in the school's own settings
 * that nobody was shown.
 */
export const BAND_STATUS_LABEL: Record<BandStatus, string> = {
  ok: '',
  'no-scale': 'No grading scale',
  'no-bands': 'Scale cannot grade',
  'below-scale': 'Below the scale',
  'above-scale': 'Above the scale',
  hole: 'Gap in the scale',
  ambiguous: 'Two bands claim this',
  'no-percentage': 'No mark to band',
}

/**
 * Whether a state is the scale's fault rather than an absence of configuration.
 *
 * Only these are drawn as an error, so a school that simply has not built a scale
 * yet is not told it is broken.
 */
export const BAND_STATUS_IS_FAULT: Record<BandStatus, boolean> = {
  ok: false,
  'no-scale': false,
  'no-bands': true,
  'below-scale': true,
  'above-scale': true,
  hole: true,
  ambiguous: true,
  'no-percentage': false,
}

/**
 * A band badge in the school's own colour, with text contrast decided from that
 * colour rather than from the score.
 *
 * With no band there is still a statement to make, so this never prints a bare
 * "-" when it knows why: `status` names the state (every subject and every
 * per-assessment row carries one of its own), `problem` carries the ranges to
 * fix, and `scaleName` resolves the one state the summary cannot — `no-scale`
 * means either "no scale applies" or "the scale that applies has no bands", and
 * only this component is told which scale applied.
 *
 * The reason is text, in both the senses that matter. The state is the badge's
 * own visible content, not a colour and not a `title`, so it survives
 * `prefers-contrast: more`, a monochrome printout and a screen reader; the ranges
 * to fix are printed beside it for the same reason — a tooltip carrying them was
 * unreachable by keyboard and gone from the printed card. And the
 * `sr-only` span in front of it says that a band was *withheld* and whether the
 * scale is at fault, so the words are not read as a mark nobody entered.
 *
 * Lives here rather than inside either report page because both the report card
 * and the report list render a band for the same child from the same payload.
 * When the list carried its own copy it took no `status`, so it printed the bare
 * "-" this component exists to remove, and there was no second place to change
 * when the vocabulary changed.
 */
export const BandBadge = ({
  band,
  status = null,
  problem = null,
  scaleName = null,
  percentage = null,
}: {
  band: ReportBand | null
  /** Which state the missing band is in; null when the caller has no verdict. */
  status?: BandStatus | null
  /** The ranges or defects the scale is at fault for, when there are any. */
  problem?: string | null
  /** The scale that applied to this class, when one did. */
  scaleName?: string | null
  /** The percentage the band was resolved from, quoted in the explanation. */
  percentage?: number | null
}) => {
  if (band) {
    return (
      <span
        className="inline-flex items-center rounded-xl px-2.5 py-0.5 text-xs font-medium"
        style={{ backgroundColor: band.color, color: contrastTextColor(band.color) }}
        title={`${band.minScore}-${band.maxScore}%`}
      >
        {band.label}
      </span>
    )
  }

  if (status) {
    // A scale that applies but carries no bands is a misconfiguration, not an
    // absence of one, so it is drawn as the fault it is even though `no-scale`
    // covers both.
    const fault =
      BAND_STATUS_IS_FAULT[status] || (status === 'no-scale' && scaleName !== null)
    // The scale the school would have to fix, named so a parent reading the
    // printed card can be told what to look at.
    const detail =
      status === 'no-scale'
        ? scaleName
          ? `The scale "${scaleName}" has no bands, so no percentage can be given one.`
          : 'No grading scale applies to this class, so no band can be assigned.'
        : status === 'no-bands'
          ? 'No band on this scale can claim a percentage: each one runs backwards or falls outside 0-100.'
          : percentage !== null && problem
            ? `${percentage.toFixed(1)}% is not inside any band — ${problem}`
            : problem
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span
          className={
            fault
              ? 'inline-flex items-center rounded-xl border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive'
              : 'inline-flex items-center rounded-xl border border-muted-foreground/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground'
          }
        >
          <span className="sr-only">
            {fault ? 'Band withheld, grading scale problem: ' : 'No band: '}
          </span>
          {BAND_STATUS_LABEL[status]}
        </span>
        {/* The ranges to fix are the badge's own visible content, not a `title`. A
            tooltip is unreachable by keyboard and by a screen reader, it is not
            announced at all on touch, and it vanishes on the printed card — which is
            where a parent reads the reason a child has no grade. */}
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    )
  }

  // A caller with a problem and no verdict of its own. Every row on this card now
  // passes a `status`, so this is not the assessment table's path any more; it
  // stays because "the scale is at fault and I cannot say which way" is a truer
  // thing to print than "-", and because removing it would make a future caller
  // with no status fall through to the dash below.
  if (problem) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span className="inline-flex items-center rounded-xl border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
          <span className="sr-only">Band withheld, grading scale error: </span>
          Scale error
        </span>
        <span className="text-xs text-muted-foreground">{problem}</span>
      </span>
    )
  }

  return <span className="text-muted-foreground">-</span>
}