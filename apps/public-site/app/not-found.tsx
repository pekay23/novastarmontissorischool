import { ArrowLeft } from 'lucide-react'

import { MarketingButton } from '@/components/marketing-button'
import { SCHOOL_INFO } from '@/lib/metadata'

export const metadata = {
  // Bare title: the layout's `%s | Novastar Montessori School` template appends
  // the suffix, so adding the school name here would double it.
  title: 'Page not found',
  description: 'The page you are looking for could not be found.',
  alternates: { canonical: SCHOOL_INFO.website },
}

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      {/*
        No `p-6` on this wrapper, and the narrow measure lives on an inner
        element rather than alongside `container`.

        The `p-6` was 24px of padding on a flex container, so the `.container`
        inside it started at left:24px while every other container on the page —
        the header and the footer, both from `app/layout.tsx` — starts at left:0.
        The e2e contract is "all containers agree on one left edge", and with a
        `max-width` on `.container` the old padding was absorbed into centring, so
        this only surfaced once the container went full width. `.container`
        supplies its own gutters, so the padding was double-counting anyway.

        `max-w-2xl` cannot sit on the same element as `container`: `.container` is
        a later same-specificity declaration, so it wins and the cap is dropped.
        See the `.container` note in `app/globals.css`.
      */}
      <div className="container text-center">
        <div className="mx-auto max-w-2xl">
          <h1 className="type-display mb-4 text-primary">404 — Page not found</h1>
          <p className="mb-8 mx-auto max-w-xl text-lg text-muted-foreground">
            The page you are looking for could not be found. It may have been moved or no longer exists.
          </p>
          {/*
            The site's call-to-action recipe, not a hand-rolled link. This was a
            bare `<a>` at 16px of text with no focus ring and no 44px hit area;
            `MarketingButton` supplies the outline variant, the visible focus
            treatment and the target size every other page's action already has.
          */}
          <MarketingButton href="/" variant="outline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Go back home
          </MarketingButton>
        </div>
      </div>
    </div>
  )
}