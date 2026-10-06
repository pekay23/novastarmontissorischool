'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Clock, Mail, Menu, Phone, X } from 'lucide-react'
import { cn } from '@novastar/shared-ui'
import { MarketingButton } from '@/components/marketing-button'
import type { NavigationLabels } from '@/lib/navigation'

interface HeaderProps {
  navigation: NavigationLabels
  /*
   * Accessible name for the home link. The mark is an SVG that already contains
   * the wordmark, so there is no text to name the link with any more — the
   * image's `alt` carries it. Passed in for the same reason `contact` is: this
   * is a client component, and importing `SCHOOL_INFO` here would drag
   * `lib/metadata.ts`, including the `new URL()` in `baseMetadata`, into the
   * browser bundle to read one string.
   */
  siteName: string
  /*
   * Contact details for the utility bar, passed from the server layout rather
   * than imported here so `lib/metadata.ts` never enters the client bundle.
   */
  contact: {
    phone: string
    phoneHref: string
    email: string
    weekdayHours: string
  }
}

export default function Header({ navigation, siteName, contact }: HeaderProps) {
  /*
   * `next.config.ts` sets `trailingSlash: true`, so `usePathname()` returns
   * "/academics/" while the `href` in `navItems` is "/academics". Comparing
   * them directly means `aria-current="page"` never matches and the active
   * state is silently lost on every page. Both sides are normalised instead.
   */
  const pathname = usePathname().replace(/\/+$/, '') || '/'
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  /*
   * Eight items, in the order the owner specified: Home, Academics, Admissions,
   * Fees, News, Events, About Us, Contact.
   *
   * This reverses the earlier five-item row, which omitted Admissions, News and
   * Events on the reasoning that News and Events render permanent empty states
   * ("No news posted yet") and so competed for attention while unable to answer
   * a question. The owner has now seen the site and wants every section
   * reachable from the primary row, so all eight are here. The empty-state pages
   * are a content gap, not a navigation problem, and burying them in the footer
   * is what made them look unwritten.
   *
   * Home leads and About Us / Contact close the row, which is the conventional
   * shape: orientation at the front, trust and reach at the end.
   *
   * The list is load-bearing for the breakpoint on the nav below. At the old
   * five items the inline row fitted at 1024px; at eight it does not, and the
   * row is hidden below `xl` instead of `lg` so that no width overflows it. See
   * the note on the `<header>`.
   */
  const navItems = [
    { label: navigation.home, href: '/', key: 'home' },
    { label: navigation.academics, href: '/academics', key: 'academics' },
    { label: navigation.admissions, href: '/admissions', key: 'admissions' },
    { label: navigation.fees, href: '/fees', key: 'fees' },
    { label: navigation.news, href: '/news', key: 'news' },
    { label: navigation.events, href: '/events', key: 'events' },
    { label: navigation.about, href: '/about', key: 'about' },
    { label: navigation.contact, href: '/contact', key: 'contact' },
  ]

  /*
   * The menu is a disclosure, so it closes on Escape. Without this a keyboard
   * user who opens it can only dismiss it by tabbing to the trigger again.
   */
  useEffect(() => {
    if (!mobileMenuOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobileMenuOpen])

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95">
      {/*
        `xl:flex` on the nav, not `md:flex` and not `lg:flex`.

        Measured at 768px the row ran from x=276 to x=832 — 64px past the viewport
        edge — on every route, because `md` is where the desktop nav appeared and
        it did not fit at 768. `lg` fixed that width but not the next one: at
        eight nav items plus the logo and the CTA, the row no longer fits at 1024
        either. Both changes are needed; either alone leaves a width where the row
        overflows. At `xl` (1280px) the row measures ~1080px inside ~1216px of
        gutter-adjusted space, so it fits with room to spare, and 1024–1279 falls
        back to the disclosure menu — which carries all eight items, so nothing is
        orphaned at that width.

        `backdrop-blur` is gone. On a near-white background it is invisible at any
        opacity, and `backdrop-filter` forces a compositing layer on a full-width
        element that repaints on every scroll frame.
      */}
      {/*
        Utility bar, from the design's header. Hidden below `md` because the
        strip's two links would otherwise crowd the main row on a phone, where the
        contact page and the footer both already carry these details.

        The links were 16px tall, which fails WCAG 2.5.8 — they are standalone
        links, not inline in a sentence, so the inline exemption does not apply.
        `py-2` gives them 32px, and the phone link gets `min-h-11` because it is
        the one a parent is most likely to press on a phone.
      */}
      <div className="hidden border-b border-border bg-surface-container-low md:block">
        <div className="container flex items-center justify-between gap-6 py-0.5 text-sm">
          <p className="flex min-h-11 items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4 text-accent-warm-dark" aria-hidden="true" />
            Weekdays {contact.weekdayHours}
          </p>
          <div className="flex items-center gap-5">
            <a
              href={`mailto:${contact.email}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-sm px-1 text-muted-foreground transition-colors duration-fast hover:text-primary"
            >
              <Mail className="h-4 w-4 text-accent-warm-dark" aria-hidden="true" />
              {contact.email}
            </a>
            <a
              href={`tel:${contact.phoneHref}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-sm px-1 font-semibold text-primary transition-colors duration-fast hover:text-primary-hover"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              {contact.phone}
            </a>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="flex h-16 items-center justify-between gap-6">
          <Link href="/" className="flex shrink-0 items-center">
            <Image
              src="/logo.svg"
              /* The wordmark lives inside the SVG, so the image IS the link's
                 accessible name. This was `alt=""` only while the "Novastar"
                 text span sat beside it; removing that span without changing this
                 would have left the home link with no name at all. */
              alt={siteName}
              /* logo.svg is 340x54, so the intrinsic box must keep that 6.296:1
                 ratio or next/image warns and distorts the mark. */
              width={252}
              height={40}
              className="h-9 w-auto"
              /* `priority` is deprecated in 16.3 in favour of `preload`. */
              preload
            />
          </Link>

          {/*
            `xl`, not `lg` — see the note on the `<header>` above. Eight items.
            Admissions, News and Events are in the row because the owner wants
            every section one click away; the empty states on the latter two are
            a content gap to fill, not a reason to hide the section.
          */}
          <nav aria-label="Main" className="hidden items-center gap-0.5 xl:flex">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-sm px-3 text-sm font-medium transition-colors duration-fast',
                  pathname === item.href
                    ? 'bg-tint-warm text-primary'
                    : 'text-foreground hover:bg-surface-container hover:text-primary'
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {/*
              MarketingButton rather than the shared Button: the shared scale tops
              out at h-9, which is a control size, and the hero CTA needs to be
              the same object as this one. See components/marketing-button.tsx for
              why shared-ui's Button is not edited.

              `md` (h-11), not `sm` (h-9). Every nav link in this row is
              `min-h-11`, so a 36px CTA sat 8px shorter than the links it is
              meant to outweigh. 36px clears WCAG 2.5.8 AA (24px minimum) but not
              the 44px this row already uses, and the mismatch is visible as the
              header row not lining up on a common baseline.
            */}
            <MarketingButton href="/contact" size="md" className="hidden sm:inline-flex">
              Book a campus visit
            </MarketingButton>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
              className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-foreground transition-colors duration-fast hover:bg-surface-container xl:hidden"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div id="mobile-menu" className="pb-4 xl:hidden">
            <nav aria-label="Mobile" className="flex flex-col gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={pathname === item.href ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center rounded-sm px-3 text-sm font-medium transition-colors duration-fast',
                    pathname === item.href
                      ? 'bg-tint-warm text-primary'
                      : 'text-foreground hover:bg-surface-container hover:text-primary'
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-3">
              <MarketingButton href="/contact" size="md" className="w-full">
                Book a campus visit
              </MarketingButton>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}