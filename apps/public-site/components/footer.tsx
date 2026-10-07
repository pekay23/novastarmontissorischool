import Link from 'next/link'
import { Clock, Mail, MapPin, Phone } from 'lucide-react'

import { getAcademicPrograms, getContactInfo } from '@/lib/data'
import { SCHOOL_INFO } from '@/lib/metadata'
import { programSlug } from '@/lib/programs'

/*
 * Rendered from the server layout with no props, so it loads its own data.
 * `getContactInfo` returns null when the branding row is missing (no DB at build
 * time), hence the fallback — the footer must never blank out the contact details
 * people rely on. The fallback mirrors SCHOOL_INFO so a parent never sees two
 * different phone numbers on one page.
 */

const FALLBACK = {
  name: SCHOOL_INFO.name,
  address: SCHOOL_INFO.location,
  phone: SCHOOL_INFO.phone,
  email: SCHOOL_INFO.email,
  hours: SCHOOL_INFO.hours.map((entry) => `${entry.days}: ${entry.time}`).join(' · '),
}

/*
 * "Academic Programs" and "Contact Us" are intentionally absent from Quick Links:
 * the Programs column below anchors every program to `/academics#<slug>` (or falls
 * back to the page itself), and the Visit Us column's "Book a campus visit" CTA
 * already links to `/contact`. Keeping them here too would show the same
 * destination twice per viewport-width column.
 */
const QUICK_LINKS = [
  { href: '/about', label: 'About Us' },
  { href: '/admissions', label: 'Admissions' },
  { href: '/fees', label: 'Fee Structure' },
  { href: '/policies', label: 'Policies for Parents' },
  { href: '/news', label: 'News' },
  { href: '/events', label: 'Events' },
]

export async function Footer() {
  const [contact, programs] = await Promise.all([
    getContactInfo(),
    getAcademicPrograms(),
  ])

  const school = contact ?? FALLBACK
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t border-border bg-surface-container">
      <div className="container py-14">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            {/*
              The footer's four headings. `type-title` with an explicit `text-primary`
              rather than relying on the base heading rule, because the base rule
              resolves to `--color-primary-dark` and the previous version put
              `font-heading text-xl` headings on a maroon field where they read
              at 1.4:1.
            */}
            <h2 className="type-title mb-4 text-foreground">{school.name}</h2>
            {school.address && (
              <p className="mb-4 flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{school.address}</span>
              </p>
            )}
            <ul className="space-y-1 text-sm">
              {school.phone && (
                <li>
                  <a
                    href={`tel:${school.phone.replace(/[^\d+]/g, '')}`}
                    className="inline-flex min-h-11 items-center gap-2 text-muted-foreground transition-colors duration-fast hover:text-primary"
                  >
                    <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {school.phone}
                  </a>
                </li>
              )}
              {school.email && (
                <li>
                  <a
                    href={`mailto:${school.email}`}
                    className="inline-flex min-h-11 items-center gap-2 break-all text-muted-foreground transition-colors duration-fast hover:text-primary"
                  >
                    <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {school.email}
                  </a>
                </li>
              )}
              <li className="flex items-start gap-2 py-2 text-sm text-muted-foreground">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{school.hours}</span>
              </li>
            </ul>
          </div>

          <nav aria-label="Footer">
            <h2 className="type-title mb-4 text-foreground">Quick Links</h2>
            {/*
              `space-y-0`, replacing `space-y-1`. Measured in Chromium at a 1440px
              viewport: a quick link's text box is 18px, `min-h-11` makes the row
              44px, and `space-y-1` added 4px between rows. That put consecutive
              lines 48px apart with 30px of clear air between the text boxes —
              1.67x the height of the text, which is what read as a list of
              unrelated items rather than one group. Dropping the gap leaves 26px
              of air (1.44x) at a 44px row pitch, and takes 24px off the column
              (332px -> 308px over the 7 rows).

              44px is a floor rather than a preference. WCAG 2.5.8 requires every
              target to be 44x44, so a 44px row can only be tightened further by
              letting the hit area bleed into the row below, and two overlapping
              targets are how the wrong link gets pressed. Row gap is therefore
              the only value free to move, and it now sits at zero. Verified at
              360 / 768 / 1280 / 1440 / 1920px: pitch 44px and every target 44px
              tall at all five, with zero overlapping boxes.
            */}
            <ul className="space-y-0 text-sm">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center text-muted-foreground transition-colors duration-fast hover:text-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/*
            Anchors into the single /academics page rather than per-program routes,
            which do not exist. Both sides derive the slug from the program name via
            `programSlug`, so the links stay in step with the data.
          */}
          <nav aria-label="Programs">
            <h2 className="type-title mb-4 text-foreground">Programs</h2>
            {/*
              Same 44px row pitch as Quick Links. These two columns are identical in
              shape and sit side by side, so a shared rhythm is the only thing that
              keeps them reading as a pair rather than as two lists at different
              densities.
            */}
            <ul className="space-y-0 text-sm">
              {programs.length > 0 ? (
                programs.map((program) => (
                  <li key={program.id}>
                    <Link
                      href={`/academics#${programSlug(program.name)}`}
                      className="inline-flex min-h-11 items-center text-muted-foreground transition-colors duration-fast hover:text-primary"
                    >
                      {program.name}
                    </Link>
                  </li>
                ))
              ) : (
                <li>
                  <Link
                    href="/academics"
                    className="inline-flex min-h-11 items-center text-muted-foreground transition-colors duration-fast hover:text-primary"
                  >
                    Academic Programs
                  </Link>
                </li>
              )}
            </ul>
          </nav>

          <div>
            <h2 className="type-title mb-4 text-foreground">Visit Us</h2>
            <p className="mb-4 max-w-[34ch] text-sm text-muted-foreground">
              Visits run during school hours. There is no cost and no obligation.
            </p>
            {/*
              Was a `bg-primary` button on a `bg-primary-dark` surface: #5a1121 on
              #772836 measured 1.40:1, which is an invisible rectangle. It is now
              the same outline treatment as the rest of the site.
            */}
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface-container-lowest px-4 text-sm font-semibold text-primary shadow-hairline transition-colors duration-fast hover:border-primary/35 hover:bg-surface hover:text-primary-hover"
            >
              Book a campus visit
            </Link>
          </div>
        </div>

        {/*
          Centred, not left-aligned. This band sits below the four-column grid and
          is the only block in the footer that belongs to no column, so it has no
          column edge to line up with. The container is full width (`.container`
          carries `max-width: none`), so the wrapper measures 1376px at a 1440px
          viewport and 1824px at 1920px, while the line itself is a fixed 365.3px.
          Left-aligned that put 505.3px of empty space to the right at 1440px and
          729.3px at 1920px, under a rule spanning the whole footer — a void that
          grows with the viewport, which is what read as accidental rather than
          composed.

          Left alignment was the alternative and was checked first, because every
          other `border-t` band on the site is left-aligned (`photo.tsx` credits,
          the `academics` payment-method rows, `prepared-environments` schedules).
          It cannot be made to read as deliberate from this position: a left-aligned
          line inside a full-width block renders identically whatever the wrapper's
          width, measure or the `p`'s own box is, so there is no structural change
          to make. Centring completes the band on the axis its rule already spans,
          and it stays exactly centred at every width (measured offset 0.0px at
          360 / 768 / 1280 / 1440 / 1920).
        */}
        <div className="mt-10 border-t border-border pt-6 text-center text-sm text-muted-foreground">
          <p>
            &copy; {currentYear} {school.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
