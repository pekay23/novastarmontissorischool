import Image from 'next/image'

import { PHOTOS, type PhotoId } from '@/lib/placeholder-images'

/*
 * Placeholder photography, rendered from the design tokens.
 *
 * Everything visual here is token-driven: `rounded-md`, `border-border`,
 * `shadow-raised`, and the type scale. No magic radius, no stock shadow — the
 * e2e suite asserts that, and it would fail on a hand-written value.
 *
 * Two deliberate choices:
 *
 * 1. `width`/`height` are the image's INTRINSIC size, not the display size, and
 *    CSS does the scaling. next/image warns when the declared ratio differs from
 *    the intrinsic one, and the natural way to avoid that is to declare the real
 *    numbers and let `w-full h-auto` do the rest.
 *
 * 2. The credit line is not optional while these files are CC BY-SA. It is
 *    rendered as a `<figcaption>`, which is also what makes it a caption rather
 *    than a licence notice bolted on the side. It is gated on `photo.credit`
 *    being non-empty, NOT on the file being remote — the copies now live in this
 *    repository, and gating on remoteness had already silently dropped the
 *    attribution once when the gate was written.
 */

export function Photo({
  id,
  alt,
  className,
  sizes = '(min-width: 1024px) 60vw, 100vw',
  priority = false,
  ratio = 'aspect-[3/2]',
}: {
  id: PhotoId
  /** Overrides the stored description. Only for a genuinely different view. */
  alt?: string
  className?: string
  sizes?: string
  priority?: boolean
  /** Any CSS aspect-ratio utility; must match `ratio` intent, not the source file. */
  ratio?: string
}) {
  const photo = PHOTOS[id]

  return (
    <figure className={className}>
      <div
        className={`relative overflow-hidden rounded-md border border-border bg-surface-container shadow-raised ${ratio}`}
      >
        <Image
          src={photo.src}
          alt={alt ?? photo.alt}
          width={photo.width}
          height={photo.height}
          sizes={sizes}
          /* `priority` is deprecated in 16.3 in favour of `preload`. */
          {...(priority ? { preload: true } : {})}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>

      <figcaption className="mt-3 flex flex-col gap-1 text-sm text-muted-foreground">
        <span>{photo.caption}</span>
        {/*
          Full-opacity `text-muted-foreground`, not `/80`.

          The `/80` modifier was a contrast failure and axe caught it on all four
          routes that render a `<Photo>`. Blending #5c574f at 80% over the section
          surfaces computes to rgb(122,118,110) on `bg-surface`, which is 4.01:1 —
          under the 4.5:1 that WCAG AA requires for text this small (12px is not
          "large" text, so no 3:1 relaxation applies). At full opacity the token is
          6.36:1 on `bg-surface` and 4.95:1 on the darkest surface it lands on,
          both passing. Hierarchy is now carried by the size step from the
          `text-sm` caption above, not by fading the ink.
        */}
        {photo.credit && (
          <span className="text-xs text-muted-foreground">
            {photo.placeholder ? 'Placeholder photograph' : 'Photograph'} — {photo.credit} ({photo.licence}).
            {photo.placeholder && ' To be replaced with a photograph of our own classroom.'}
          </span>
        )}
      </figcaption>
    </figure>
  )
}