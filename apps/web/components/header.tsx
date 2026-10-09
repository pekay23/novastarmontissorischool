'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Clock, Menu, Phone, X, Search, User, ChevronDown } from 'lucide-react'
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
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})

  const toggleCategory = (label: string) => {
    setExpandedCategories((prev) => ({ ...prev, [label]: !prev[label] }))
  }

/*
   * Ten items, in the order the owner specified: Home, Preschool, Primary School,
   * Academics, Admissions, Fees, News, Events, About Us, Contact.
   *
   * This reverses the earlier five-item row, which omitted Admissions, News and
   * Events on the reasoning that News and Events render permanent empty states
   * ("No news posted yet") and so competed for attention while unable to answer
   * a question. The owner has now seen the site and wants every section
   * reachable from the primary row, so all ten are here. The empty-state pages
   * are a content gap, not a navigation problem, and burying them in the footer
   * is what made them look unwritten.
   *
   * Home leads, About Us / Contact close the row, which is the conventional
   * shape: orientation at the front, trust and reach at the end.
   *
   * The list is load-bearing for the breakpoint on the nav below. At the old
   * five items the inline row fitted at 1024px; at ten it does not, and the
   * row is hidden below `xl` instead of `lg` so that no width overflows it. See
   * the note on the `<header>`.
   */
  const megaMenu = [
    {
      label: 'Discover',
      href: '/about',
      items: [
        { label: 'Welcome', href: '/', desc: 'Return to our homepage' },
        { label: navigation.about, href: '/about', desc: 'Our history and mission' },
        { label: navigation.contact, href: '/contact', desc: 'Get in touch' },
      ],
    },
    {
      label: 'Academics',
      href: '/academics',
      items: [
        { label: navigation.academics, href: '/academics', desc: 'Our curriculum approach' },
        { label: navigation.preschool, href: '/preschool', desc: 'Ages 6 months to 5 years' },
        { label: navigation.primarySchool, href: '/primary-school', desc: 'Ages 6 to 11 years' },
      ],
    },
    {
      label: 'Admissions',
      href: '/admissions',
      items: [
        { label: navigation.admissions, href: '/admissions', desc: 'How to apply' },
        { label: navigation.fees, href: '/fees', desc: 'Tuition and fee structure' },
      ],
    },
    {
      label: 'Community',
      href: '/news',
      items: [
        { label: navigation.news, href: '/news', desc: 'Latest updates' },
        { label: navigation.events, href: '/events', desc: 'Upcoming activities' },
      ],
    },
  ]

  /*
   * The menu is a disclosure, so it closes on Escape. Without this a keyboard
   * user who opens it can only dismiss it by tabbing to the trigger again.
   */
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (!mobileMenuOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobileMenuOpen])

  return (
    <header className={cn(
      "sticky top-0 z-50 w-full transition-all duration-300",
      isScrolled ? "bg-background/85 backdrop-blur-md shadow-raised border-b-transparent" : "bg-background/95 border-b border-border"
    )}>
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
      <div className="hidden border-b border-border bg-primary-dark md:block text-tint-warm">
        <div className="container flex items-center justify-between gap-6 py-1.5 text-sm">
          <p className="flex min-h-8 items-center gap-2 text-tint-warm/80">
            <Clock className="h-4 w-4 text-accent-warm" aria-hidden="true" />
            Weekdays {contact.weekdayHours}
          </p>
          <div className="flex items-center gap-5">
            <a
              href={`tel:${contact.phoneHref}`}
              className="inline-flex min-h-8 items-center gap-2 rounded-sm px-1 font-semibold transition-colors duration-fast hover:text-white"
            >
              <Phone className="h-4 w-4 text-accent-warm" aria-hidden="true" />
              {contact.phone}
            </a>
            <span className="w-px h-4 bg-tint-warm/20"></span>
            <Link
              href="/portal/login"
              className="inline-flex min-h-8 items-center gap-2 rounded-sm px-1 font-semibold text-accent-warm transition-colors duration-fast hover:text-accent-warm-light"
            >
              <User className="h-4 w-4" aria-hidden="true" />
              Parent Portal
            </Link>
            <button
              className="inline-flex min-h-8 items-center gap-2 rounded-sm px-1 transition-colors duration-fast hover:text-white"
              aria-label="Search"
            >
              <Search className="h-4 w-4 text-accent-warm" aria-hidden="true" />
              Search
            </button>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="flex h-16 items-center justify-between gap-6">
          <Link href="/" className="flex shrink-0 items-center gap-3">
            <Image
              src="/logo_nms.png"
              /* The mark is a decorative graphic; the wordart beside it is the
                 accessible name. */
              alt=""
              width={124}
              height={80}
              className="h-10 w-auto"
              preload
            />
            <div className="flex flex-col">
              <span className="type-title text-foreground leading-tight">
                Novastar
              </span>
              <span className="type-label text-muted-foreground leading-tight">
                Montessori School
              </span>
            </div>
          </Link>

          {/*
            `xl`, not `lg` — see the note on the `<header>` above. Eight items.
            Admissions, News and Events are in the row because the owner wants
            every section one click away; the empty states on the latter two are
            a content gap to fill, not a reason to hide the section.
          */}
          <nav aria-label="Main" className="hidden items-center gap-1 xl:flex h-full">
            {megaMenu.map((category) => (
              <div key={category.label} className="group relative flex items-center h-16">
                <Link
                  href={category.href}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1 rounded-sm px-3 text-sm font-medium transition-colors duration-fast',
                    pathname.startsWith(category.href) || (category.href === '/about' && pathname === '/')
                      ? 'text-primary'
                      : 'text-foreground hover:bg-surface-container hover:text-primary'
                  )}
                >
                  {category.label}
                  <ChevronDown className="h-4 w-4 opacity-50 transition-transform duration-200 group-hover:rotate-180" aria-hidden="true" />
                </Link>

                {/* Dropdown Menu */}
                <div className="absolute top-[60px] left-1/2 -translate-x-1/2 w-72 pt-4 opacity-0 invisible translate-y-2 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 transition-all duration-200 z-50">
                  <div className="bg-background rounded-xl shadow-floating border border-border/60 overflow-hidden p-2 flex flex-col gap-1 backdrop-blur-xl">
                    {category.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'block rounded-lg p-3 transition-colors duration-fast hover:bg-surface-container/80',
                          pathname === item.href ? 'bg-tint-warm text-primary' : 'text-foreground'
                        )}
                      >
                        <div className={cn(
                          'text-sm font-medium',
                          pathname === item.href ? 'text-primary' : 'text-foreground'
                        )}>
                          {item.label}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {item.desc}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
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
          <div id="mobile-menu" className="pb-6 xl:hidden overflow-y-auto max-h-[calc(100vh-4rem)]">
            <nav aria-label="Mobile" className="flex flex-col gap-4 mt-2">
              {megaMenu.map((category) => {
                const isExpanded = expandedCategories[category.label] ?? false
                return (
                  <div key={category.label} className="flex flex-col gap-1 border-b border-border/50 pb-4 last:border-0">
                    <button
                      type="button"
                      onClick={() => toggleCategory(category.label)}
                      aria-expanded={isExpanded}
                      aria-controls={`mobile-menu-${category.label}`}
                      className="flex items-center justify-between px-3 font-serif text-primary text-lg mb-1"
                    >
                      {category.label}
                      <ChevronDown className={`h-5 w-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                    <div
                      id={`mobile-menu-${category.label}`}
                      className={`overflow-hidden transition-all duration-200 ${isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}
                    >
                      {category.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={pathname === item.href ? 'page' : undefined}
                          className={cn(
                            'inline-flex min-h-11 items-center rounded-sm px-3 text-sm font-medium transition-colors duration-fast pl-6',
                            pathname === item.href
                              ? 'bg-tint-warm text-primary'
                              : 'text-foreground hover:bg-surface-container hover:text-primary'
                          )}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })}
              <div className="flex flex-col gap-1 pb-4">
                <Link
                  href="/portal/login"
                  className="inline-flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm font-medium text-foreground hover:bg-surface-container hover:text-primary transition-colors duration-fast"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <User className="h-4 w-4" />
                  Parent Portal Login
                </Link>
              </div>
            </nav>
            <div className="mt-2 px-3">
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