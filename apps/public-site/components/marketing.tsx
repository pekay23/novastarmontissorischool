import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'

import { cn } from '@novastar/shared-ui'

/*
 * Marketing primitives shared by the public pages.
 *
 * These exist because the home, academics and the inner pages reach for the same
 * shapes. They are deliberately server components: nothing here holds state, so a
 * client boundary would only add hydration cost.
 *
 * Every visual decision here traces to `app/globals.css` — the single place
 * tokens are defined. Two conventions are enforced rather than remembered:
 *
 *  1. The type scale is named `type-*`, never `text-*`. `cn` is tailwind-merge,
 *     which classifies an unrecognised `text-*` value as a colour class and
 *     resolves in favour of the colour, silently deleting the size. `type-*` is
 *     outside that namespace, so a size and a colour can be passed together.
 *  2. Radii, shadows and durations come from tokens, never from an arbitrary
 *     value. `e2e/design.spec.ts` fails if a computed radius or shadow is not a
 *     member of the declared scale.
 */

type Tone = 'primary' | 'secondary' | 'tertiary'

/* ---------------------------------------------------------------------------
 * Type scale — thin re-exports so pages ask for a role, not a size.
 * ------------------------------------------------------------------------- */

export function DisplayTitle({
  children,
  as: Tag = 'h1',
  className,
}: {
  children: React.ReactNode
  as?: 'h1' | 'h2'
  className?: string
}) {
  return <Tag className={cn('type-display', className)}>{children}</Tag>
}

export function SectionTitle({
  children,
  as: Tag = 'h2',
  className,
}: {
  children: React.ReactNode
  as?: 'h2' | 'h3'
  className?: string
}) {
  return <Tag className={cn('type-headline', className)}>{children}</Tag>
}

export function CardTitle({
  children,
  as: Tag = 'h3',
  className,
}: {
  children: React.ReactNode
  as?: 'h3' | 'h4'
  className?: string
}) {
  return <Tag className={cn('type-title text-foreground', className)}>{children}</Tag>
}

/* ---------------------------------------------------------------------------
 * Eyebrow
 * ------------------------------------------------------------------------- */

interface EyebrowProps {
  children: React.ReactNode
  /**
   * `solid` is the section label repeated as a chip; `tinted` is the quiet
   * version. Both are decorative repetition of text the heading already carries,
   * so neither is given a role — a screen reader should not hear the label
   * twice.
   */
  variant?: 'solid' | 'tinted'
  className?: string
}

export function Eyebrow({ children, variant = 'tinted', className }: EyebrowProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center type-eyebrow uppercase',
        variant === 'solid'
          ? 'rounded-xs bg-primary px-2.5 py-1 text-primary-foreground'
          : 'rounded-xs bg-tint-warm px-2.5 py-1 text-accent-warm-dark',
        className,
      )}
    >
      {children}
    </span>
  )
}

/* ---------------------------------------------------------------------------
 * SectionHeading
 * ------------------------------------------------------------------------- */

interface SectionHeadingProps {
  eyebrow?: string
  title: string
  lede?: string
  as?: 'h1' | 'h2' | 'h3'
  align?: 'start' | 'center'
  layout?: 'default' | 'centered' | 'offset'
  className?: string
  titleClassName?: string
}

/**
 * Section title block: optional eyebrow, title, optional lede.
 *
 * Layout options:
 * - 'default': lede sits beside title on wide screens, stacks below on mobile
 * - 'centered': title and lede centered, lede below title
 * - 'offset': title at 2/5 (40%) from left, lede below title, both left-aligned
 */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  as: Tag = 'h2',
  align = 'start',
  layout = 'default',
  className,
  titleClassName,
}: SectionHeadingProps) {
  const isCentered = layout === 'centered' || align === 'center'
  const isOffset = layout === 'offset'

  return (
    <div
      className={cn(
        'flex flex-col gap-5',
        layout === 'default' && lede && !isCentered && 'md:flex-row md:items-end md:justify-between md:gap-12',
        (isCentered || isOffset) && 'items-start',
        isCentered && 'text-center',
        className,
      )}
    >
      <div className={cn(
        'flex flex-col gap-3 w-full',
        isCentered && 'items-center',
        isOffset && 'ml-[40%]',
      )}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Tag className={cn('type-headline max-w-[22ch]', isOffset && 'max-w-[60%]', titleClassName)}>{title}</Tag>
        {lede && (
          <p className={cn(
            'max-w-[60ch] text-muted-foreground',
            isCentered && 'mx-auto',
            isOffset && 'w-full',
          )}>
            {lede}
          </p>
        )}
      </div>
      {/* Default layout: lede in separate column on wide screens */}
      {layout === 'default' && lede && !isCentered && (
        <p className={cn(
          'max-w-[60ch] text-muted-foreground',
          'hidden md:block',
        )}>
          {lede}
        </p>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Card — the one card recipe on the site
 * ------------------------------------------------------------------------- */

interface CardProps {
  children: React.ReactNode
  /**
   * `flat` for a card inside a band that already separates itself; `raised` for
   * a card that has to read as an object on the canvas.
   */
  tone?: 'raised' | 'flat'
  /**
   * Lift on hover. Only for cards that are themselves the link or contain one
   * primary action — a card that lifts but goes nowhere is a lie about its
   * affordance.
   */
  interactive?: boolean
  as?: 'div' | 'article' | 'figure' | 'li'
  /**
   * Anchor target. The programme cards are deep-linked from the footer and from
   * `ProgramCard` as `/academics#<programSlug>`, so the card itself has to carry
   * the `id` — wrapping it in another element would put the scroll offset on the
   * wrapper and land the heading below the sticky header.
   */
  id?: string
  className?: string
}

/**
 * The single card recipe.
 *
 * Before this, six pages each declared their own card with three different
 * radii (`rounded-lg`, `rounded-xl`, `rounded-2xl`) and three different stock
 * Tailwind shadows, so no two cards on the site matched. Padding, radius, border
 * and elevation are decided once, here.
 *
 * Hover carries depth on `transform` and `box-shadow` only. Both survive
 * `transition-duration: 0.01ms` under reduced motion, so a user who has asked
 * for less motion still gets a card that responds rather than one that appears
 * inert.
 */
export function Card({
  children,
  tone = 'raised',
  interactive = false,
  as: Tag = 'div',
  id,
  className,
}: CardProps) {
  return (
    <Tag
      id={id}
      className={cn(
        'rounded-md border border-border',
        tone === 'raised' ? 'bg-surface-container-lowest' : 'bg-surface-container-low',
        interactive &&
          'shadow-raised transition-[transform,box-shadow,border-color] duration-base ease-out-soft hover:-translate-y-px hover:border-border hover:shadow-floating motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

/**
 * The card's internal padding, as one value so a grid of cards lines up on all
 * four sides regardless of what each card contains.
 */
export const CARD_PAD = 'p-6 lg:p-7'

/**
 * The card's optional footer rule. `border-border` at 1.45:1 on the canvas is a
 * quiet divider, which is what it is for; it is not trying to be a boundary.
 */
export const CARD_RULE = 'mt-6 border-t border-border pt-4'

/* ---------------------------------------------------------------------------
 * Stat
 * ------------------------------------------------------------------------- */

interface StatProps {
  value: string
  label: string
  caption?: string
  /**
   * The design alternates maroon, navy and terracotta across a stat row. Terracotta
   * text uses the DARK terracotta: #b94c25 clears the surface by 0.02, which is
   * not a margin, and these are display sizes rather than 12px labels.
   */
  tone?: Tone
  /**
   * Which step the figure is set at.
   *
   * `headline` (40px) is the default because a stat inside a grid is not a page
   * hero. `display` (56px) is for a figure that is the largest thing in its own
   * region — the academics hero's `1:6`, and nothing else.
   *
   * This prop exists because the default was wrong once. The home stat row rendered
   * every figure at `type-display`, and `getHomeStats()` returns `'Crèche–JHS'` as
   * one unbreakable token. At 360px that is a 156px grid column, so the value ran
   * ~90px past its column and pushed `document.scrollWidth` from 360 to 375: the
   * page scrolled sideways on a phone. `overflow-sweep.mjs` and
   * `overflow-bisect.mjs` in `tools/ui-audit/` are what found it, because an
   * element-level overflow sweep reported nothing — the document overflowed while
   * no single element did.
   */
  scale?: 'headline' | 'display'
  className?: string
}

const STAT_TONES: Record<Tone, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-accent-warm-dark',
}

/**
 * A single figure with its label and optional caption.
 *
 * The value is a `<span>`, not a heading: it is a figure inside the surrounding
 * section, and promoting every stat to a heading would bloat the document
 * outline with a dozen empty entries per page.
 *
 * `break-words` is not decoration. `type-*` goes through `cn` here, which is safe
 * because the prefix puts the size outside tailwind-merge's colour namespace, but
 * `overflow-wrap: break-word` is what stops a single-token value from widening the
 * document on the narrowest supported viewport (360px).
 *
 * `tabular-nums` keeps a row of figures optically aligned: proportional digits
 * make `1:6` and `11` render at different widths in adjacent columns.
 */
export function Stat({
  value,
  label,
  caption,
  tone = 'primary',
  scale = 'headline',
  className,
}: StatProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <span
        className={cn(
          scale === 'display' ? 'type-display' : 'type-headline',
          'break-words leading-none tabular-nums',
          STAT_TONES[tone],
        )}
      >
        {value}
      </span>
      <span className="type-label uppercase text-foreground">{label}</span>
      {caption ? (
        <span className="max-w-[28ch] text-sm leading-relaxed text-muted-foreground">
          {caption}
        </span>
      ) : null}
    </div>
  )
}

/**
 * The stat as a self-contained card. Separate from `Stat` because the academics
 * hero renders the same figure with no card around it — the card is the wrapper's
 * job there, not the figure's.
 */
export function StatCard(props: StatProps) {
  return (
    <Card className={cn(CARD_PAD, 'flex flex-col justify-center gap-2', props.className)}>
      <Stat {...props} className="gap-2" />
    </Card>
  )
}

/* ---------------------------------------------------------------------------
 * IconTile
 * ------------------------------------------------------------------------- */

interface IconTileProps {
  icon: LucideIcon
  /**
   * Pastel fill with a saturated foreground. Three tones is one too many for a
   * row of four tiles, so a row that needs separation should vary `tone` across
   * at most two.
   */
  tone?: Tone
  size?: 'md' | 'lg'
  className?: string
}

const TILE_TONES: Record<Tone, string> = {
  primary: 'bg-primary-fixed text-primary',
  secondary: 'bg-secondary-fixed text-secondary',
  tertiary: 'bg-tertiary-fixed text-accent-warm-dark',
}

/**
 * Rounded square holding a single icon.
 *
 * The icon is `aria-hidden` throughout the public site: every tile sits beside a
 * text label, so announcing the glyph would duplicate that label.
 */
export function IconTile({ icon: Icon, tone = 'primary', size = 'md', className }: IconTileProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm',
        size === 'md' ? 'h-11 w-11' : 'h-12 w-12',
        TILE_TONES[tone],
        className,
      )}
    >
      <Icon className={size === 'md' ? 'h-5 w-5' : 'h-6 w-6'} aria-hidden="true" />
    </span>
  )
}

/* ---------------------------------------------------------------------------
 * HeroBand
 * ------------------------------------------------------------------------- */

interface HeroBandProps {
  children: React.ReactNode
  /**
   * `plain` for a page whose content starts immediately under the header;
   * `flush` for one that wants the band's own top padding removed so a stacked
   * visual can run to the header.
   */
  tone?: 'tinted' | 'plain'
  className?: string
}

/**
 * Page-level hero wrapper.
 *
 * Every page's hero is the same shape: a tinted band that clears the sticky
 * header, then the heading block. Centralising it keeps the top padding
 * consistent, which is the part that is easy to get subtly wrong per page — and
 * it was wrong per page before this existed.
 *
 * The band tint is `--color-tint-warm` (`#f8f3ec`), not the maroon-derived
 * `--color-primary-soft` (`#f8eef1`). Both are pale; one is pink and one is
 * smoke. That single hex change is the largest part of "stop the pink".
 */
export function HeroBand({ children, tone = 'tinted', className }: HeroBandProps) {
  return (
    <section
      className={cn(
        'border-b border-border',
        tone === 'tinted' && 'bg-gradient-to-b from-tint-warm to-background',
        className,
      )}
    >
      {/*
        Top padding reduced from `pt-28 lg:pt-36` to `pt-20 lg:pt-28` — 112px to
        80px on a phone, 144px to 112px at `lg`.

        The old comment here claimed this padding existed to "clear the h-14
        sticky header plus the scroll-padding-top above". It does not, and never
        had to: the header is `sticky top-0`, which keeps it in normal flow, so it
        already occupies its own 64px (114px with the utility bar) of layout
        space above this section. The 112/144px was pure breathing room, and it
        pushed the `<h1>` far enough down that the hero read as an empty band
        rather than a headline.

        80/112 keeps the hero more open than an ordinary band — `section-y` is
        64/88/112 symmetric — without being the tallest thing on the page. The
        bottom padding is untouched, so the hand-off into the next band is
        unchanged.
      */}
      <div className="container pt-20 pb-14 lg:pt-28 lg:pb-20">{children}</div>
    </section>
  )
}

/* ---------------------------------------------------------------------------
 * SectionShell
 * ------------------------------------------------------------------------- */

interface SectionShellProps {
  children: React.ReactNode
  /**
   * A filled band rather than the canvas. The ramp steps are 1.45:1 apart at
   * most, which is enough to separate bands without a border and without a
   * shadow — the alternative was a hairline top and bottom on every band.
   */
  tone?: 'canvas' | 'band' | 'deep'
  className?: string
  id?: string
  'aria-labelledby'?: string
}

const SECTION_TONES = {
  canvas: 'bg-background',
  band: 'bg-surface-container-low',
  deep: 'bg-surface-container',
} as const

export function SectionShell({
  children,
  tone = 'canvas',
  className,
  ...rest
}: SectionShellProps) {
  return (
    <section className={cn(SECTION_TONES[tone], className)} {...rest}>
      <div className="container section-y">{children}</div>
    </section>
  )
}

/* ---------------------------------------------------------------------------
 * LinkRow — a text link with a real hit area
 * ------------------------------------------------------------------------- */

/**
 * A text link whose hit area is at least 44px tall.
 *
 * The pillar card CTAs and every footer link were previously bare `<a>` elements
 * at 16-18px tall. WCAG 2.5.8 exempts a target that sits inline in a sentence,
 * which these do not — they are standalone links in a grid, so the exemption
 * does not reach them. The padding is what fixes it, and it is padding rather
 * than a min-height so the visible underline stays tight to the text.
 */
export function LinkRow({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary',
        'underline decoration-primary/25 underline-offset-4 transition-colors duration-fast',
        'hover:decoration-primary',
        className,
      )}
    >
      {children}
    </Link>
  )
}
