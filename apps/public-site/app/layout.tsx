'use client'

import './globals.css'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Menu, X, Globe, Phone, Mail, Clock } from 'lucide-react'
import { Button } from '@novastar/shared-ui'
import { cn } from '@novastar/shared-ui'
import { ToastProvider } from '@novastar/shared-ui'

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
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

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xs">Nova</span>
            </div>
            <span className="font-heading text-xl font-bold text-primary hidden sm:inline">
              Novastar Montessori
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {navKeys.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  pathname === item.href
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => setLocale(locale === 'en' ? 'tw' : 'en')}
            >
              <Globe className="h-4 w-4 mr-1" />
              {locale === 'en' ? 'Twi' : 'English'}
            </Button>
            <Button size="sm" className="hidden sm:inline-flex">
              {t('navigation.applyNow')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden pb-4 border-t border-border/40">
            <nav className="flex flex-col space-y-1 px-2 py-3">
              {navKeys.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'px-3 py-2 rounded-md text-sm font-medium',
                    pathname === item.href
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-accent'
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t(item.labelKey)}
                </Link>
              ))}
            </nav>
            <div className="mt-3 px-2 space-y-2">
              <Button className="w-full">{t('navigation.applyNow')}</Button>
              <Button variant="outline" className="w-full">
                <Globe className="h-4 w-4 mr-1" />
                {t('navigation.languageToggle')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}

function Footer({ navKeys }: { navKeys: typeof NAV_KEYS }) {
  const currentYear = new Date().getFullYear()
  const t = useTranslations('en') // Footer always in English for now

  return (
    <footer className="bg-slate-900 text-slate-100 py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* School Info */}
          <div>
            <h3 className="font-heading text-xl font-bold text-white mb-4">
              Novastar Montessori School
            </h3>
            <p className="text-slate-300 text-sm mb-4">Ayeduase New Site, K-5 Junction, Ayeduase Road, Kumasi, Ghana</p>
            <div className="text-slate-300 text-sm space-y-1">
              <p className="flex items-center gap-2">
                <Phone className="w-4 h-4" /> +233 24 493 5251
              </p>
              <p className="flex items-center gap-2">
                <Mail className="w-4 h-4" /> info@novastarmontissorischool.com
              </p>
              <p className="flex items-center gap-2">
                <Clock className="w-4 h-4" /> Mon-Fri: 7:30 AM - 5:30 PM
              </p>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold text-white mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm">
              {navKeys.slice(1).map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-slate-300 hover:text-white transition-colors">
                    {t(item.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Programs */}
          <div>
            <h4 className="font-semibold text-white mb-4">Programs</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/academics#creche" className="text-slate-300 hover:text-white">Creche & Nursery</Link></li>
              <li><Link href="/academics#kindergarten" className="text-slate-300 hover:text-white">Kindergarten</Link></li>
              <li><Link href="/academics#lower-primary" className="text-slate-300 hover:text-white">Lower Primary</Link></li>
              <li><Link href="/academics#upper-primary" className="text-slate-300 hover:text-white">Upper Primary</Link></li>
              <li><Link href="/academics#jhs" className="text-slate-300 hover:text-white">Junior High</Link></li>
            </ul>
          </div>

          {/* Newsletter */}
          <div>
            <h4 className="font-semibold text-white mb-4">Stay Updated</h4>
            <p className="text-slate-300 text-sm mb-3">Subscribe for news and updates</p>
            <form className="space-y-2">
              <input
                type="email"
                placeholder="Enter your email"
                className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Button size="sm" className="w-full">Subscribe</Button>
            </form>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-6 text-center text-sm text-slate-400">
          <p>&copy; {currentYear} Novastar Montessori School. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}