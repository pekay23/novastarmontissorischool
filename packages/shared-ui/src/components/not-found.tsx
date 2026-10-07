import type { ReactNode } from 'react'

/*
 * A single, shared 404 / "not found" view consumed by every app's route-level
 * `not-found.tsx` files.
 *
 * Design constraints that drove this shape:
 *
 * 1. `packages/shared-ui` is framework-agnostic and has no `next` dependency.
 *    Apps mounted under a `basePath` (portal `/portal`, super-admin `/admin`)
 *    must navigate with `next/link` so the prefix is prepended automatically;
 *    a plain `<a href="/dashboard">` would drop the prefix and 404 again.
 *    The default action therefore renders a plain `<a>` (correct for base-path-
 *    less consumers such as the static public-site), but callers can pass their
 *    own `action` element — typically a `<Link>` carrying
 *    `notFoundActionClasses` — when they need client-side routing.
 *
 * 2. Only Tailwind utilities that resolve in every consuming app are used.
 *    The three apps declare colours differently (public-site via a v4
 *    `@theme` block with `--color-*` names; portal and super-admin via a
 *    `tailwind.config.mts` that maps to `--*` HSL variables) but they all
 *    expose the same utility names — `bg-background`, `text-foreground`,
 *    `text-muted-foreground`, `bg-primary`, `text-primary-foreground`,
 *    `border`, `ring`, `rounded-*`. Custom utilities unique to public-site
 *    (`type-display`, `container`, `bg-surface`) are deliberately avoided so
 *    the component styles correctly everywhere.
 */

/**
 * The shared class list for the not-found action link.
 *
 * Exported so that apps which need `next/link` (for basePath-aware routing)
 * can apply the exact same visual treatment to a `<Link>`:
 *
 * ```tsx
 * import Link from 'next/link'
 * import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'
 *
 * <NotFound
 *   label="404 · Syllabus"
 *   description="…"
 *   action={
 *     <Link href="/dashboard" className={notFoundActionClasses}>
 *       Back to Dashboard
 *     </Link>
 *   }
 * />
 * ```
 */
export const notFoundActionClasses =
  'inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-xs font-bold uppercase text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

export interface NotFoundProps {
  /** Short caption above the heading — e.g. `"404 · Syllabus"`. Omit for none. */
  label?: string
  /** Heading text. Defaults to `"Page not found"`. */
  title?: string
  /** Descriptive body copy explaining what went wrong. */
  description?: string
  /** Href for the default action button. Ignored when `action` is supplied. */
  actionHref?: string
  /** Label for the default action button. Defaults to `"Go back home"`. */
  actionLabel?: string
  /**
   * Override the default action button with custom JSX.
   * Use this when you need `next/link` (basePath apps) or a different variant.
   */
  action?: ReactNode
  /** Optional content rendered below the action button. */
  children?: ReactNode
}

export function NotFound({
  label,
  title = 'Page not found',
  description = 'The page you are looking for could not be found.',
  actionHref = '/',
  actionLabel = 'Go back home',
  action,
  children,
}: NotFoundProps) {
  return (
    <section
      className="flex min-h-[60vh] w-full items-center justify-center"
      aria-label={title}
    >
      <div className="mx-auto max-w-md text-center">
        <svg
          className="mx-auto mb-6 h-12 w-12 text-muted-foreground/40"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" strokeWidth="1.5" opacity="0.5" />
          <path
            d="M9 9l6 6M15 9l-6 6"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>

        {label && (
          <p className="mb-3 text-xs font-black tracking-widest text-primary uppercase">
            {label}
          </p>
        )}

        <h1 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">
          {title}
        </h1>

        {description && (
          <p className="mb-6 text-sm text-muted-foreground">{description}</p>
        )}

        {action ?? (
          <a href={actionHref} className={notFoundActionClasses}>
            {actionLabel}
          </a>
        )}

        {children}
      </div>
    </section>
  )
}
