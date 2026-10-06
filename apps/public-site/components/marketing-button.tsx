import Link from 'next/link'
import { cn } from '@novastar/shared-ui'
import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'

/*
 * Marketing button sizing.
 *
 * This file deliberately has NO `'use client'` directive. Nothing in it uses a
 * hook, a ref, or an event handler: `MarketingButton` renders a `next/link` (or
 * an `<a>`) and `ArrowLink` composes it, so both are pure functions of props.
 *
 * Marking it `'use client'` — which it was until 2026-10-04 — put every export
 * behind a client boundary. `whatsappHref()` is a plain string builder called
 * during server render by `app/page.tsx` and `components/footer.tsx`, and React
 * refuses to invoke a client-module function from the server:
 *
 *   Attempted to call whatsappHref() from the server but whatsappHref is on the
 *   client. It's not possible to invoke a client function from the server, it can
 *   only be rendered as a Component or passed to props of a Client Component.
 *
 * Every route then returned HTTP 500 while typecheck, lint and `bun test` all
 * stayed green — the three of them never render a component. Removing the
 * directive fixes the 500 and shrinks the client bundle. `components/header.tsx`
 * is a genuine client component (it owns the mobile menu's open state) and
 * imports this one; that direction is fine, since a client component importing a
 * server-safe module simply pulls it into the client bundle.
 *
 * `@novastar/shared-ui`'s Button is NOT edited. It is imported by 52 files in
 * apps/portal and 12 in apps/super-admin, and all three apps compile
 * `packages/shared-ui/src` through `@source` — so a class that only public-site
 * could resolve would emit nothing in the other two, with green typecheck, green
 * lint and green build. Local sizing rides in on `className` instead, where
 * tailwind-merge resolves `h-10` against `h-13` in favour of the local value.
 *
 * Why override at all: the shared scale tops out at `h-10` (40px) with
 * `text-sm`. On a 1440px display a 40px hero call to action reads as a form
 * control. The marketing scale below runs 36 / 44 / 52px and steps the type with
 * the height, which is what makes a button look deliberate rather than merely
 * large.
 *
 * `active:translate-y-px` is the press state. It is carried by `transform` so it
 * still fires under `prefers-reduced-motion: reduce`, where the global override
 * collapses `transition-duration` to 0.01ms — the press becomes instant instead
 * of disappearing.
 */

type Variant = 'primary' | 'outline' | 'quiet' | 'onDark' | 'onDarkOutline'
type Size = 'sm' | 'md' | 'lg'

/**
 * The shared button recipe, restated locally rather than imported.
 *
 * `@novastar/shared-ui`'s Button is NOT edited and its `buttonVariants` is NOT
 * imported here. It is used by 52 files in apps/portal and 12 in
 * apps/super-admin, and all three apps compile `packages/shared-ui/src` through
 * `@source` — so a token or class that only public-site can resolve would emit
 * nothing in the other two, with green typecheck, green lint and green build.
 * Restating the recipe here keeps every marketing decision inside this app.
 *
 * The parts kept verbatim from the shared version are deliberate: the focus ring
 * (`focus-visible:ring-ring ring-offset-2`), the disabled treatment, and the
 * `[&_svg]` shrink/grow rules, because those are behaviour rather than styling
 * and there is no reason for the marketing site to differ on them.
 */

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap select-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:grow'

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-11 px-5 text-[0.9375rem]',
  lg: 'h-13 px-7 text-base',
}

const VARIANTS: Record<Variant, string> = {
  // 13.66:1 with white text — the loudest element on the page, deliberately.
  // Maroon is demoted from surface to action; this is the action it survives for.
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  outline:
    'border border-border bg-surface-container-lowest text-primary shadow-hairline ' +
    'hover:border-primary/35 hover:bg-surface hover:text-primary-hover',
  quiet: 'text-primary hover:bg-surface-container',
  onDark:
    'bg-surface-container-lowest text-primary shadow-raised hover:bg-white hover:shadow-floating',
  onDarkOutline:
    'border border-primary-foreground/35 bg-transparent text-primary-foreground ' +
    'hover:border-primary-foreground/60 hover:bg-primary-foreground/10',
}

function classes(variant: Variant, size: Size, className?: string) {
  return cn(
    BASE,
    'rounded-sm font-semibold tracking-[-0.005em]',
    SIZES[size],
    VARIANTS[variant],
    // Press depth on `transform`, so it survives the reduced-motion override
    // that collapses transition-duration to 0.01ms.
    'active:translate-y-px',
    'transition-[transform,box-shadow,background-color,border-color,color] duration-base ease-out-soft',
    className,
  )
}

interface MarketingButtonProps {
  children: ReactNode
  href: string
  variant?: Variant
  size?: Size
  className?: string
  /** Renders an external/anchor target. Internal paths use `next/link`. */
  external?: boolean
  'aria-label'?: string
}

/**
 * A call to action that navigates. Every marketing CTA on the site is a link,
 * not a form submission: this is a static export with no server, so a `<button>`
 * that appears to submit and does not is the failure mode the admissions form
 * already documents.
 */
export function MarketingButton({
  children,
  href,
  variant = 'primary',
  size = 'md',
  className,
  external,
  'aria-label': ariaLabel,
}: MarketingButtonProps) {
  const cls = classes(variant, size, className)

  if (external) {
    return (
      <a href={href} className={cls} aria-label={ariaLabel}>
        {children}
      </a>
    )
  }

  return (
    <Link href={href} className={cls} aria-label={ariaLabel}>
      {children}
    </Link>
  )
}

/**
 * The hero's primary action, with its trailing arrow. The arrow nudges 4px on
 * hover, which is the cheapest honest affordance available and does not move the
 * label.
 */
export function ArrowLink({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className,
}: MarketingButtonProps) {
  return (
    <MarketingButton href={href} variant={variant} size={size} className={className}>
      {children}
      <ArrowRight
        className="h-4 w-4 transition-transform duration-base ease-out-soft group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </MarketingButton>
  )
}

/**
 * The WhatsApp route. Ghanaian school enquiries run through WhatsApp far more
 * than through a web form, and under `output: 'export'` there is nowhere for a
 * form to post to — this is the honest mechanism rather than a form that pretends
 * to submit.
 */
export function whatsappHref(number: string, message: string) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}
