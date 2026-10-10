import { Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react'

import { CARD_PAD, Card, CardTitle, HeroBand, SectionTitle, SectionShell } from '@/components/marketing'
import { MarketingButton, whatsappHref } from '@/components/marketing-button'
import { getAdmissionsStatus } from '@/lib/data'
import { SCHOOL_INFO, generateContactMetadata } from '@/lib/metadata'

export const metadata = generateContactMetadata()

/*
 * There is no server to receive a contact form: `output: 'export'` builds a
 * static bundle and `app/api/` cannot run. The previous version rendered a
 * "Send Message" form with no action and no handler, so every submission
 * silently vanished. Contact routes are surfaced as tel:, mailto: and WhatsApp
 * links instead, which work on a static host.
 */
export default async function ContactPage() {
  // One more build-time read, for one sentence and one link. Admissions being
  // closed does not make this page wrong — it is the page a closed school sends
  // people to — but it does make "apply straight away" and an "Apply online
  // instead" button false, so the state has to be read here rather than assumed.
  const { open } = await getAdmissionsStatus()

  const whatsapp = whatsappHref(
    SCHOOL_INFO.whatsapp,
    `Hello ${SCHOOL_INFO.name}, I would like to enquire about admissions.`,
  )

  return (
    <div className="min-h-screen">
      {/* Hero. The band wash is `--color-tint-warm` rather than the maroon-tinted
          `from-primary/10` every inner page carried before; `HeroBand` also owns
          the header clearance, which was re-stated per page. */}
      <HeroBand>
        <h1 className="type-display mx-auto max-w-[18ch] text-center">Contact Us</h1>
        {/*
          Left-aligned inside a centred block. The paragraph was `text-center`
          before, which WCAG 1.4.8 flags for body copy past roughly 50ch: a
          centred block has no consistent left edge, so a returning reader
          re-finds the start of every line. The block is still centred, so the
          heading above it stays optically aligned.
        */}
        <p className="mx-auto mt-6 max-w-[60ch] text-lg leading-relaxed text-muted-foreground">
          We&apos;d love to hear from you. Call, message, or visit our campus in Kumasi.
        </p>
      </HeroBand>

      <SectionShell tone="canvas">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <div>
            <SectionTitle className="mb-8 text-primary">How to reach us</SectionTitle>

            <ul className="space-y-8">
              <li className="flex items-start gap-4">
                <MapPin className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-primary mb-1">Address</h3>
                  <p className="max-w-[60ch] text-muted-foreground">{SCHOOL_INFO.location}</p>
                </div>
              </li>

              <li className="flex items-start gap-4">
                <Phone className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-primary mb-1">Phone</h3>
                  {/*
                    `min-h-11`, not a bare underlined link. This looked like inline
                    prose and is not: it is the sole content of its own row under a
                    heading, on the page whose entire job is giving a parent a way
                    to make contact. It computed to `display: inline` and 21px tall,
                    which is under the WCAG 2.2 SC 2.5.8 minimum of 24.

                    `audit.mjs` used to exempt any link computing to `inline` and
                    so missed both this and the email below. `e2e/design.spec.ts`
                    exempts only links whose parent is a prose element, which is the
                    actual test for "in a sentence", and it caught these. The audit
                    now uses the same rule.
                  */}
                  <a
                    href={`tel:${SCHOOL_INFO.phoneHref}`}
                    className="inline-flex min-h-11 items-center text-muted-foreground underline decoration-border underline-offset-4 transition-colors duration-fast hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {SCHOOL_INFO.phone}
                  </a>
                </div>
              </li>

              <li className="flex items-start gap-4">
                <Mail className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-primary mb-1">Email</h3>
                  <a
                    href={`mailto:${SCHOOL_INFO.email}`}
                    className="inline-flex min-h-11 items-center text-muted-foreground underline decoration-border underline-offset-4 transition-colors duration-fast hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {SCHOOL_INFO.email}
                  </a>
                </div>
              </li>

              <li className="flex items-start gap-4">
                <Clock className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-primary mb-1">Office Hours</h3>
                  <dl className="text-muted-foreground">
                    {SCHOOL_INFO.hours.map((entry) => (
                      <div key={entry.days} className="flex gap-2">
                        <dt>{entry.days}</dt>
                        <dd>{entry.time}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </li>
            </ul>

            {/*
              Complaints, from the school's policy document.

              OUTSTANDING FOR THE OWNER: a direct line for the administrator and
              proprietress. Neither document nor this repository names the
              proprietress or gives a number that reaches her directly, so this
              routes to the channels the school already publishes rather than
              inventing a contact or leaving the row pointing nowhere. What is
              missing is a personal line and a name; ask for both and this block
              becomes the route the policy actually describes.

              Kept out of the list above on purpose. The four rows in it are
              channels; this one is a rule about who a complaint must reach, and
              a prohibition belongs in its own block where it cannot be skimmed
              past as another phone number.
            */}
            <Card className={`${CARD_PAD} mt-10`}>
              <CardTitle as="h3" className="text-primary">
                Complaints
              </CardTitle>
              <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-muted-foreground">
                Parents and guardians are to channel all their grievances directly
                to the school administrator or the proprietress. Please do not
                lodge a complaint with a teacher or any other member of staff.
              </p>
              <div className="mt-4 flex flex-col items-start gap-1 sm:flex-row sm:gap-8">
                {/*
                  The same two anchors as the rows above, restated as controls
                  rather than prose: a parent reading this has just been told who
                  to complain to, and an inline sentence is not somewhere to put
                  a tap target.
                */}
                <a
                  href={`tel:${SCHOOL_INFO.phoneHref}`}
                  className="inline-flex min-h-11 items-center gap-2 text-muted-foreground underline decoration-border underline-offset-4 transition-colors duration-fast hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {SCHOOL_INFO.phone}
                </a>
                <a
                  href={`mailto:${SCHOOL_INFO.email}`}
                  className="inline-flex min-h-11 items-center gap-2 break-all text-muted-foreground underline decoration-border underline-offset-4 transition-colors duration-fast hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {SCHOOL_INFO.email}
                </a>
              </div>
            </Card>

            {/* Keyless Google Maps embed — `output=embed` needs no API key. */}
            <iframe
              src={SCHOOL_INFO.mapEmbedUrl}
              title={`Map showing ${SCHOOL_INFO.name} in Kumasi`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="mt-8 aspect-video w-full rounded-lg border border-border"
            />
            <p className="mt-3 text-sm">
              <a
                href={SCHOOL_INFO.mapLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4"
              >
                Get directions on Google Maps
              </a>
            </p>
          </div>

          {/*
            Every action below is a link, never a `<button>`. `output: 'export'`
            builds a static bundle with no server, so a control that appears to
            submit has nowhere to go — the same failure the removed "Send Message"
            form had. `MarketingButton` carries the marketing scale (44px at the
            default size, so the target clears WCAG 2.5.8), the focus ring, and the
            `external` switch that renders a real `<a>` for `tel:`, `mailto:` and
            wa.me targets instead of routing them through `next/link`.
          */}
          {/*
            `self-start`: at `lg` the two-column grid stretches every item
            to the row height, and the row is set by the contact list
            beside the card (map included) — measured 876px at 1280px and
            913px at 1920px, against 316px of card content. The stretch
            left roughly 500px of empty interior inside the card's border.
          */}
          <Card className={`${CARD_PAD} self-start`}>
            <CardTitle as="h3" className="mb-3 text-primary">
              Talk to the admissions office
            </CardTitle>
            <p className="mb-6 text-muted-foreground">
              WhatsApp is the quickest way to reach us during office hours.{' '}
              {open ? (
                <>
                  If you would rather apply straight away, the online form takes
                  about five minutes.
                </>
              ) : (
                <>
                  Admissions are not open at the moment, so there is no form to
                  fill in yet — an enquiry now is how you hear about the next
                  intake.
                </>
              )}
            </p>

            {/*
              One primary, two secondary, one conditional tertiary — not
              three equals. The lede names WhatsApp first and school
              enquiries in Ghana run through it (see `whatsappHref`), so
              it keeps the filled button and the full row; call and email
              are the quieter outline pair and share a row from `sm` up.
              `sm` is the first breakpoint the pair fits: the longest
              label measures 187px of icon, gap and text plus 56px of
              button padding, and a two-column 640px card gives each
              column 290px. Below `sm` the labels cannot share a 360px
              column, so the grid stays one-wide.

              Measured before: three stacked `h-13` buttons over 12px
              gaps = 180px of controls (232px when admissions are open).
              After: 116px (180px open).
            */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/*
                 Icon stretching was worked around here per-button until
                 2026-10-06, when `MarketingButton`'s `BASE` took
                 `[&_svg]:grow-0`: the shared recipe's `[&_svg]:grow`
                 grew a 16px icon's box to 410px at 768px in a
                 full-width flex row, the glyph stayed 16x16
                 (SVG preserveAspectRatio) but painted centred inside
                 the stretched box, so the visible icon floated ~200px
                 from its label. `BASE` now pins every marketing icon,
                 so these buttons need no override.
               */}
               <MarketingButton
                 href={whatsapp}
                 size="lg"
                 external
                 className="sm:col-span-2"
               >
                 <MessageCircle className="h-4 w-4" aria-hidden="true" />
                 Message us on WhatsApp
               </MarketingButton>
               <MarketingButton
                 href={`tel:${SCHOOL_INFO.phoneHref}`}
                 variant="outline"
                 size="lg"
                 external
               >
                 <Phone className="h-4 w-4" aria-hidden="true" />
                 Call {SCHOOL_INFO.phone}
               </MarketingButton>
               <MarketingButton
                 href={`mailto:${SCHOOL_INFO.email}`}
                 variant="outline"
                 size="lg"
                 external
               >
                 <Mail className="h-4 w-4" aria-hidden="true" />
                 Email the school
               </MarketingButton>
              {/* Only when there is something to apply to. Rendered unconditionally it
                  offered a one-click route to a page that would refuse the
                  visitor's application a scroll later. */}
              {open && (
                <MarketingButton
                  href="/admissions"
                  variant="quiet"
                  size="lg"
                  className="sm:col-span-2"
                >
                  Apply online instead
                </MarketingButton>
              )}
            </div>
          </Card>
        </div>
      </SectionShell>
    </div>
  )
}