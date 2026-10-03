'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Clock, Mail, Menu, Phone, X } from 'lucide-react'
import { cn, Button } from '@novastar/shared-ui'
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

  const navItems = [
    { label: navigation.about, href: '/about', key: 'about' },
    { label: navigation.academics, href: '/academics', key: 'academics' },
    { label: navigation.admissions, href: '/admissions', key: 'admissions' },
    { label: navigation.fees, href: '/fees', key: 'fees' },
    { label: navigation.news, href: '/news', key: 'news' },
    { label: navigation.events, href: '/events', key: 'events' },
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
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/*
        Utility bar, from the design's header. Hidden below `md` because the
        strip's three links would otherwise crowd the main row on a phone, where
        the contact page and the footer both already carry these details.
      */}
      <div className="hidden border-b border-border/40 bg-surface-container-low md:block">
        <div className="container flex items-center justify-between gap-6 py-1.5 text-xs">
          <p className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-tertiary-container" aria-hidden="true" />
            Weekdays {contact.weekdayHours}
          </p>
          <div className="flex items-center gap-5">
            <a
              href={`mailto:${contact.email}`}
              className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-primary"
            >
              <Mail className="h-3.5 w-3.5 text-tertiary-container" aria-hidden="true" />
              {contact.email}
            </a>
            <a
              href={`tel:${contact.phoneHref}`}
              className="inline-flex items-center gap-1.5 font-semibold text-primary transition-colors hover:underline"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              {contact.phone}
            </a>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center">
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
              className="h-10 w-auto"
              /* `priority` is deprecated in 16.3 in favour of `preload`. */
              preload
            />
          </Link>

          <nav aria-label="Main" className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  pathname === item.href
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Button size="sm" className="hidden sm:inline-flex" asChild>
              <Link href="/admissions">{navigation.applyNow}</Link>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div id="mobile-menu" className="md:hidden pb-4">
            <nav aria-label="Mobile" className="flex flex-col gap-1 px-2">
              {navItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={pathname === item.href ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    pathname === item.href
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-3 px-2">
              <Button className="w-full" asChild>
                <Link href="/admissions">{navigation.applyNow}</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}