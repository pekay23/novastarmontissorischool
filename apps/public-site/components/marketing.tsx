import type { LucideIcon } from 'lucide-react'

import { cn } from '@novastar/shared-ui'

/*
 * Marketing primitives shared by the public pages.
 *
 * These exist because the home and academics pages reach for the same shapes.
 * They are deliberately server components: nothing here holds state, so a client
 * boundary would only add hydration cost.
 *
 * Every visual decision here traces to the site's Stitch design system
 * ("Warm Academic Prestige") — see the token block in `app/globals.css`.
 */

/*
 * Type scale, mirroring the design's named steps so pages can ask for
 * "headline-md" instead of guessing `text-2xl`. Defined in globals.css.
 */
type ScaleClass = 'text-display-hero' | 'text-headline-lg' | 'text-headline-md' | 'text-headline-sm'

interface EyebrowProps {
  children: React.ReactNode
  /**
   * `slant` clips the trailing corner for achievement-style badges. Use it only
   * on short uppercase labels: the cut removes padding on the right, so long
   * text crowds the diagonal.
   */
  variant?: 'solid' | 'tinted' | 'outline' | 'slant'
  className?: string
}

/**
 * The small uppercase kicker that opens every section heading.
 *
 * `solid` and `tinted` are decorative repetition of the section label and are
 * announced as plain text; they carry no meaning a screen reader needs beyond
 * what the heading already says, so they are not given a role.
 */
export function Eyebrow({ children, variant = 'solid', className }: EyebrowProps) {
  const styles = {
    solid: 'bg-primary text-primary-foreground',
    tinted: 'bg-primary-soft text-primary',
    outline: 'border border-border text-primary',
    slant: 'bg-primary text-primary-foreground shape-badge-slant',
  } as const

  return (
    <span
      className={cn(
        'inline-block px-3 py-1 text-label-sm uppercase tracking-[0.08em]',
        styles[variant],
        // The slant cut eats the right padding, so pad it back to keep the label
        // optically centred inside the diagonal.
        variant === 'slant' && 'pr-4',
        className,
      )}
    >
      {children}
    </span>
  )
}

interface SectionHeadingProps {
  eyebrow?: string
  title: string
  /**
   * Optional supporting sentence. Rendered beside the heading on wide screens,
   * which is the layout the design uses for its section intros.
   */
  lede?: string
  /** Heading level. Pick the level that fits the document outline, not the size. */
  as?: 'h1' | 'h2' | 'h3'
  align?: 'start' | 'center'
  className?: string
}

/**
 * Section title block: optional eyebrow, title, optional lede.
 *
 * The colour comes from the global heading rule in globals.css, so this only
 * controls size and alignment.
 */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  as: Tag = 'h2',
  align = 'start',
  className,
}: SectionHeadingProps) {
  const centered = align === 'center'

  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        lede && 'md:flex-row md:items-end md:justify-between md:gap-10',
        centered && 'items-center text-center md:flex-col md:items-center',
        className,
      )}
    >
      <div className={cn('flex flex-col gap-2', centered && 'items-center')}>
        {eyebrow ? <Eyebrow variant="tinted">{eyebrow}</Eyebrow> : null}
        <Tag className="text-headline-lg">{title}</Tag>
      </div>
      {lede ? (
        <p className={cn('max-w-xl text-muted-foreground', centered && 'mx-auto')}>{lede}</p>
      ) : null}
    </div>
  )
}

interface StatProps {
  value: string
  label: string
  caption?: string
  /**
   * Overrides the value colour. The design alternates between maroon, slate and
   * terracotta across a stat row, so this is a real axis rather than a
   * hardcoded single colour.
   */
  tone?: 'primary' | 'secondary' | 'tertiary'
  className?: string
}

const STAT_TONES = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary-container',
} as const

/**
 * A single figure with its label and optional caption.
 *
 * The value is a `<p>`, not a heading: it is a figure inside the surrounding
 * section, and promoting every stat to a heading would bloat the outline with
 * six empty top-level entries per page.
 */
export function Stat({ value, label, caption, tone = 'primary', className }: StatProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-6 py-7 text-center',
        className,
      )}
    >
      {/*
        Deliberately not passed through `cn`. `cn` is tailwind-merge, and
        tailwind-merge has no knowledge of the custom `text-display-hero` scale —
        it classifies any unrecognised `text-*` value as a *colour* class, so
        merging it with `text-primary` resolved in favour of the colour and
        silently dropped the size. The rendered markup came out as
        `class="leading-none text-primary"` with the display size gone.

        A plain string keeps both. Any future addition here must stay off `cn` for
        the same reason, or the scale step has to move to a non-`text-` prefix.
      */}
      <span className={`text-display-hero leading-none ${STAT_TONES[tone]}`}>{value}</span>
      <span className="text-label-md uppercase tracking-[0.08em] text-foreground">{label}</span>
      {caption ? (
        <span className="max-w-[24ch] text-xs leading-relaxed text-muted-foreground">{caption}</span>
      ) : null}
    </div>
  )
}

interface IconTileProps {
  icon: LucideIcon
  /**
   * Pastel tile fill with a saturated foreground, per the design's fixed-role
   * colours. `primary` is the default; pick another when a row of tiles needs
   * to read as separate pillars.
   */
  tone?: 'primary' | 'secondary' | 'tertiary'
  size?: 'md' | 'lg'
  className?: string
}

const TILE_TONES = {
  primary: 'bg-primary-fixed text-primary',
  secondary: 'bg-secondary-fixed text-secondary',
  tertiary: 'bg-tertiary-fixed text-tertiary-container',
} as const

/**
 * Rounded pastel square holding a single icon.
 *
 * The icon is `aria-hidden` throughout the public site: every tile sits beside
 * a text label, so announcing the glyph would duplicate that label.
 */
export function IconTile({ icon: Icon, tone = 'primary', size = 'md', className }: IconTileProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg',
        size === 'md' ? 'h-12 w-12' : 'h-14 w-14',
        TILE_TONES[tone],
        className,
      )}
    >
      <Icon className={size === 'md' ? 'h-6 w-6' : 'h-7 w-7'} aria-hidden="true" />
    </span>
  )
}

/**
 * Page-level hero wrapper.
 *
 * Every page's hero is the same shape: a tinted band that clears the sticky
 * header, then the heading block. Centralising it keeps the top padding
 * consistent, which is the part that is easy to get subtly wrong per page.
 */
export function HeroBand({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'border-b border-border bg-gradient-to-b from-primary-soft to-background',
        className,
      )}
    >
      {/* Clears the h-14 sticky header plus the scroll-padding-top in globals.css. */}
      <div className="container pt-32 pb-16 lg:pt-40 lg:pb-20">{children}</div>
    </section>
  )
}

export type { ScaleClass }