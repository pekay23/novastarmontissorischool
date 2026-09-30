'use client'

import './globals.css'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { Menu, X, Globe, Phone, Mail, Clock, MessageCircle, MapPin } from 'lucide-react'
import { Button } from '@novastar/shared-ui'
import { cn } from '@novastar/shared-ui'
import { ToastProvider } from '@novastar/shared-ui'
import { Inter, Fraunces } from 'next/font/google'

/*
 * Real webfonts. globals.css named Poppins and Inter in the font stacks, but
 * nothing ever loaded them, so every heading rendered in the system fallback
 * serif. next/font downloads at build time and self-hosts, which matters here
 * because this site is a static export: no runtime call to Google.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  weight: ['500', '600', '700'],
  variable: '--font-fraunces',
})

// Import messages directly for static export
import enMessages from '@/messages/en.json'
import twMessages from '@/messages/tw.json'

type Locale = 'en' | 'tw'
type Messages = typeof enMessages

const messages: Record<Locale, Messages> = { en: enMessages, tw: twMessages }

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  return path.split('.').reduce((acc: unknown, key: string) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key]
    }
    return path
  }, obj) as string
}

function useTranslations(locale: Locale) {
  const t = (key: string): string => {
    return getNestedValue(messages[locale], key) || key
  }
  return t
}

const NAV_KEYS = [
  { labelKey: 'navigation.home', href: '/' },
  { labelKey: 'navigation.about', href: '/about' },
  { labelKey: 'navigation.academics', href: '/academics' },
  { labelKey: 'navigation.admissions', href: '/admissions' },
  { labelKey: 'navigation.fees', href: '/fees' },
  { labelKey: 'navigation.news', href: '/news' },
  { labelKey: 'navigation.events', href: '/events' },
  { labelKey: 'navigation.contact', href: '/contact' },
]

const SCHOOL = {
  name: 'Novastar Montessori School',
  phone: '+233 24 493 5251',
  phoneHref: 'tel:+233244935251',
  whatsapp: '233244935251',
  email: 'info@novastarmontissorischool.com',
  address: 'Ayeduase New Site, K-5 Junction, Ayeduase Road, Kumasi, Ghana',
  hours: 'Mon–Fri 7:30am – 5:30pm · Sat 9:00am – 1:00pm',
} as const

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${fraunces.variable}`}>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
        <meta name="theme-color" content="#1f5c43" />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ToastProvider>
          <div className="min-h-screen flex flex-col">
            <Header navKeys={NAV_KEYS} />
            <main className="flex-1">{children}</main>
            <Footer navKeys={NAV_KEYS} />
          </div>
        </ToastProvider>
      </body>
    </html>
  )
}

function Header({ navKeys }: { navKeys: typeof NAV_KEYS }) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [locale, setLocale] = useState<Locale>('en')
  const t = useTranslations(locale)
  const whatsappHref = `https://wa.me/${SCHOOL.whatsapp}?text=${encodeURIComponent(
    'Hello Novastar Montessori School, I would like to enquire about admissions.',
  )}`

  // Close the mobile menu on navigation, otherwise it stays open over the page
  // the visitor just chose. The ref guard ensures we only call setState when the
  // pathname truly changed; calling it unconditionally on every effect run
  // triggers a cascading render.
  const prevPathnameRef = useRef(pathname)
  useEffect(() => {
    if (pathname !== prevPathnameRef.current) {
      prevPathnameRef.current = pathname
      setMobileMenuOpen(false)
    }
  }, [pathname])

  return (
    <header className="sticky top-0 z-50 w-full">
      {/*
        Utility bar. Research across Ghanaian, UK and US school sites was
        consistent that contact details and admissions status sit above the
        navigation, not buried in the footer.
      */}
      <div className="hidden bg-primary-dark text-primary-foreground lg:block">
        <div className="container flex h-10 items-center justify-between text-sm">
          <div className="flex items-center gap-6">
            <a href={SCHOOL.phoneHref} className="flex items-center gap-1.5 hover:underline">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              {SCHOOL.phone}
            </a>
            <a href={`mailto:${SCHOOL.email}`} className="flex items-center gap-1.5 hover:underline">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              {SCHOOL.email}
            </a>
            <span className="flex items-center gap-1.5 opacity-90">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {SCHOOL.hours}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="rounded-full bg-secondary px-3 py-0.5 font-medium">
              Admissions open · 2026/27
            </span>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:underline"
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
              WhatsApp us
            </a>
          </div>
        </div>
      </div>

      <div className="border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="container flex h-18 items-center justify-between gap-4 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label={`${SCHOOL.name} home`}>
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary font-heading text-sm font-bold text-primary-foreground"
            >
              N
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-heading text-lg font-semibold text-primary-dark">Novastar</span>
              <span className="text-xs tracking-wide text-muted-foreground">Montessori School</span>
            </span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {navKeys.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary-soft text-primary-dark'
                      : 'text-foreground hover:bg-muted hover:text-primary-dark',
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              )
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="hidden xl:inline-flex"
              onClick={() => setLocale(locale === 'en' ? 'tw' : 'en')}
              aria-label={locale === 'en' ? 'Switch language to Twi' : 'Switch language to English'}
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
              {locale === 'en' ? 'Twi' : 'English'}
            </Button>

            {/*
              Two actions, not one. Every strong school site in the research put
              a visit and an enquiry in the first screen. The previous version
              rendered this as a Button with no href and no onClick, so the
              primary call to action did nothing at all.
            */}
            <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild>
              <a href={SCHOOL.phoneHref}>Book a visit</a>
            </Button>
            <Button size="sm" asChild>
              <Link href="/admissions">{t('navigation.applyNow')}</Link>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
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
          <div className="border-t border-border bg-surface lg:hidden">
            <nav aria-label="Mobile" className="container flex flex-col gap-1 py-4">
              {navKeys.map((item) => {
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-md px-3 py-2.5 text-base font-medium',
                      active ? 'bg-primary-soft text-primary-dark' : 'text-foreground hover:bg-muted',
                    )}
                  >
                    {t(item.labelKey)}
                  </Link>
                )
              })}
            </nav>
            <div className="container flex flex-col gap-2 pb-5">
              <Button asChild>
                <Link href="/admissions">{t('navigation.applyNow')}</Link>
              </Button>
              <Button variant="outline" asChild>
                <a href={SCHOOL.phoneHref}>Book a visit — {SCHOOL.phone}</a>
              </Button>
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-base font-medium text-foreground"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Chat on WhatsApp
              </a>
              <button
                type="button"
                onClick={() => setLocale(locale === 'en' ? 'tw' : 'en')}
                className="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-base font-medium text-muted-foreground"
              >
                <Globe className="h-4 w-4" aria-hidden="true" />
                {locale === 'en' ? 'Switch to Twi' : 'Switch to English'}
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}

function Footer({ navKeys }: { navKeys: typeof NAV_KEYS }) {
  const currentYear = new Date().getFullYear()
  const t = useTranslations('en')
  const whatsappHref = `https://wa.me/${SCHOOL.whatsapp}?text=${encodeURIComponent(
    'Hello Novastar Montessori School, I would like to enquire about admissions.',
  )}`

  const programmes = [
    { href: '/academics#creche', label: 'Crèche & Nursery' },
    { href: '/academics#kindergarten', label: 'Kindergarten' },
    { href: '/academics#lower-primary', label: 'Lower Primary' },
    { href: '/academics#upper-primary', label: 'Upper Primary' },
    { href: '/academics#jhs', label: 'Junior High' },
  ]

  return (
    <footer className="bg-primary-dark text-primary-foreground">
      <div className="container py-14">
        {/*
          Closing call to action. The research was consistent that a fee-paying
          school site ends with one unmistakable action, and a WhatsApp thread
          is the channel Ghanaian parents actually use.
        */}
        <div className="mb-12 flex flex-col items-start justify-between gap-6 rounded-2xl bg-primary p-8 md:flex-row md:items-center lg:p-10">
          <div>
            <h2 className="font-heading text-2xl text-primary-foreground md:text-3xl">
              Come and see the classrooms for yourself
            </h2>
            <p className="mt-2 max-w-xl text-primary-foreground/85">
              Visits run Monday to Friday during school hours. Meet the head teacher, walk the
              prepared environment, and ask the questions that matter to you.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" variant="secondary" asChild>
              <a href={SCHOOL.phoneHref}>Book a visit</a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              asChild
            >
              <Link href="/admissions">Apply online</Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="mb-4 flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-foreground/10 font-heading text-sm font-bold"
              >
                N
              </span>
              <span className="font-heading text-lg font-semibold">{SCHOOL.name}</span>
            </div>
            <address className="space-y-2 text-sm not-italic text-primary-foreground/75">
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {SCHOOL.address}
              </p>
              <p className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                <a href={SCHOOL.phoneHref} className="hover:underline">{SCHOOL.phone}</a>
              </p>
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                <a href={`mailto:${SCHOOL.email}`} className="hover:underline">{SCHOOL.email}</a>
              </p>
              <p className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                {SCHOOL.hours}
              </p>
            </address>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Chat on WhatsApp
            </a>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary-foreground/60">
              Explore
            </h3>
            <ul className="space-y-2 text-sm">
              {navKeys.slice(1).map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-primary-foreground/75 transition-colors hover:text-primary-foreground"
                  >
                    {t(item.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary-foreground/60">
              Programmes
            </h3>
            <ul className="space-y-2 text-sm">
              {programmes.map((p) => (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    className="text-primary-foreground/75 transition-colors hover:text-primary-foreground"
                  >
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary-foreground/60">
              Key dates · 2026/27
            </h3>
            <ul className="space-y-3 text-sm text-primary-foreground/75">
              <li>
                <span className="block text-primary-foreground">Applications close</span>
                31 March
              </li>
              <li>
                <span className="block text-primary-foreground">Assessment</span>
                April – May
              </li>
              <li>
                <span className="block text-primary-foreground">Term begins</span>
                September
              </li>
              <li>
                <span className="block text-primary-foreground">Open mornings</span>
                First Saturday of each term
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-primary-foreground/15 pt-6 text-sm text-primary-foreground/60 sm:flex-row sm:items-center sm:justify-between">
          <p>© {currentYear} {SCHOOL.name}. All rights reserved.</p>
          <p>Montessori education from Crèche through Junior High, Kumasi, Ghana.</p>
        </div>
      </div>
    </footer>
  )
}