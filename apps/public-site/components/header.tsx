'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Menu, X, Globe } from 'lucide-react'
import { cn } from '@novastar/shared-ui'
import { Button } from '@novastar/shared-ui'

interface NavItem {
  label: string
  href: string
  key: string
}

interface HeaderProps {
  navigation: {
    home: string
    about: string
    academics: string
    admissions: string
    fees: string
    facilities: string
    news: string
    events: string
    gallery: string
    contact: string
    applyNow: string
    languageToggle: string
  }
}

const navItems: NavItem[] = [
  { label: 'About', href: '/about', key: 'about' },
  { label: 'Academics', href: '/academics', key: 'academics' },
  { label: 'Admissions', href: '/admissions', key: 'admissions' },
  { label: 'Fees', href: '/fees', key: 'fees' },
  { label: 'News', href: '/news', key: 'news' },
  { label: 'Events', href: '/events', key: 'events' },
  { label: 'Contact', href: '/contact', key: 'contact' },
]

export default function Header({ navigation }: HeaderProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <Image
              src="/logo.svg"
              alt="Novastar Montessori School"
              width={40}
              height={40}
              className="h-10 w-auto"
              priority
            />
            <span className="font-heading text-xl font-bold text-primary">Novastar</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  'px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  pathname === item.href
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center space-x-2">
            {/* Language Toggle */}
            <Button variant="ghost" size="sm">
              <Globe className="h-4 w-4 mr-1" />
              Twi
            </Button>

            {/* Apply Button */}
            <Button size="sm" className="hidden sm:inline-flex">
              {navigation.applyNow}
            </Button>

            {/* Mobile Menu Button */}
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
          <div className="md:hidden pb-4">
            <nav className="flex flex-col space-y-1 px-2">
              {navItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    'px-3 py-2 rounded-md text-sm font-medium',
                    pathname === item.href
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-accent'
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-3 px-2">
              <Button className="w-full">{navigation.applyNow}</Button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}