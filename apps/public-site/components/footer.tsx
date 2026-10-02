import Link from 'next/link'
import { Clock, Mail, MapPin, Phone } from 'lucide-react'
import { getAcademicPrograms, getContactInfo } from '@/lib/data'
import { SCHOOL_INFO } from '@/lib/metadata'
import { programSlug } from '@/lib/programs'

/*
 * Rendered from the server layout with no props, so it loads its own data.
 * `getContactInfo` returns null when the branding row is missing (no DB at
 * build time), hence the fallback — the footer must never blank out the
 * contact details people rely on. The fallback mirrors SCHOOL_INFO so a
 * parent never sees two different phone numbers on one page.
 */

const FALLBACK = {
  name: SCHOOL_INFO.name,
  address: SCHOOL_INFO.location,
  phone: SCHOOL_INFO.phone,
  email: SCHOOL_INFO.email,
  hours: SCHOOL_INFO.hours
    .map((entry) => `${entry.days}: ${entry.time}`)
    .join(' · '),
}

const QUICK_LINKS = [
  { href: '/about', label: 'About Us' },
  { href: '/academics', label: 'Academic Programs' },
  { href: '/admissions', label: 'Admissions' },
  { href: '/fees', label: 'Fee Structure' },
  { href: '/news', label: 'News' },
  { href: '/contact', label: 'Contact Us' },
]

export async function Footer() {
  const [contact, programs] = await Promise.all([
    getContactInfo(),
    getAcademicPrograms(),
  ])

  const school = contact ?? FALLBACK
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-primary-dark py-12 text-primary-soft">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 grid grid-cols-1 gap-8 md:grid-cols-4">
          <div>
            <h2 className="mb-4 font-heading text-xl font-bold text-primary-soft">
              {school.name}
            </h2>
            {school.address && (
              <p className="mb-4 flex items-start gap-2 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{school.address}</span>
              </p>
            )}
            <ul className="space-y-2 text-sm">
              {school.phone && (
                <li className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <a href={`tel:${school.phone.replace(/[^\d+]/g, '')}`} className="hover:text-primary-soft">
                    {school.phone}
                  </a>
                </li>
              )}
              {school.email && (
                <li className="flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <a href={`mailto:${school.email}`} className="hover:text-primary-soft">
                    {school.email}
                  </a>
                </li>
              )}
              <li className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{school.hours}</span>
              </li>
            </ul>
          </div>

          <nav aria-label="Footer">
            <h2 className="mb-4 font-heading text-base font-semibold text-primary-soft">
              Quick Links
            </h2>
            <ul className="space-y-2 text-sm">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-primary-soft">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/*
            Anchors into the single /academics page rather than per-program
            routes, which do not exist. Both sides derive the slug from the
            program name via `programSlug`, so the links stay in step with the
            data.
          */}
          <nav aria-label="Programs">
            <h2 className="mb-4 font-heading text-base font-semibold text-primary-soft">
              Programs
            </h2>
            <ul className="space-y-2 text-sm">
              {programs.length > 0 ? (
                programs.map((program) => (
                  <li key={program.id}>
                    <Link
                      href={`/academics#${programSlug(program.name)}`}
                      className="hover:text-primary-soft"
                    >
                      {program.name}
                    </Link>
                  </li>
                ))
              ) : (
                <li>
                  <Link href="/academics" className="hover:text-primary-soft">
                    Academic Programs
                  </Link>
                </li>
              )}
            </ul>
          </nav>

          <div>
            <h2 className="mb-4 font-heading text-base font-semibold text-primary-soft">
              Stay Updated
            </h2>
            <p className="mb-4 text-sm">
              School news, term dates and events as they happen.
            </p>
            <Link
              href="/news"
              className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Read the latest news
            </Link>
          </div>
        </div>

        <div className="border-t border-primary-soft/20 pt-6 text-center text-sm">
          <p>
            &copy; {currentYear} {school.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}