'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { cn, Button } from '@novastar/shared-ui'
import type { NavigationLabels } from '@/lib/navigation'

interface HeaderProps {
  navigation: NavigationLabels
}

export default function Header({ navigation }: HeaderProps) {
  const pathname = usePathname()
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

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center space-x-2">
            <Image
              src="/logo.svg"
              /* Decorative: the wordmark in the SVG duplicates the "Novastar" text beside
                 it, so naming the image makes the link read twice. */
              alt=""
              /* logo.svg is 340x80, so the intrinsic box must keep that 4.25:1
                 ratio or next/image warns and distorts the mark. */
              width={170}
              height={40}
              className="h-10 w-auto"
              priority
            />
            <span className="font-heading text-xl font-bold text-primary">Novastar</span>
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