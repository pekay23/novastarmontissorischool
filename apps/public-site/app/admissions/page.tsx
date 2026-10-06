import type { Metadata } from 'next'

import { cn } from '@novastar/shared-ui'

import { AdmissionsForm } from '@/components/admissions-form'
import { CARD_PAD, Card, HeroBand, SectionHeading, SectionTitle, SectionShell } from '@/components/marketing'
import { MarketingButton } from '@/components/marketing-button'
import { Photo } from '@/components/photo'
import { getAdmissionsStatus } from '@/lib/data'
import { generateAdmissionsMetadata, SCHOOL_INFO } from '@/lib/metadata'

/*
 * Server Component: it owns the page's `metadata`, which Next resolves on the
 * server. The interactive multi-step form lives in `components/admissions-form`.
 *
 * The export is an async `generateMetadata` function, not a plain object.
 * `generateAdmissionsMetadata` now requires the `open` flag, which we fetch
 * at build time via `getAdmissionsStatus`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { open } = await getAdmissionsStatus()
  return generateAdmissionsMetadata(open)
}

export default async function AdmissionsPage() {
  const { open } = await getAdmissionsStatus()

  return (
    <div className="min-h-screen">
      {/* Hero. The band wash is `--color-tint-warm` rather than the maroon-tinted
          `from-primary/10` every inner page carried before; `HeroBand` also owns
          the header clearance, which was re-stated per page. */}
      <HeroBand>
        <h1 className="type-display max-w-[18ch]">Admissions</h1>
        {/* Branches with the rest of the page. Left unconditional it read
            "Apply online" in the hero while the panel directly below said
            applications were not being accepted — the same page contradicting
            itself, which is worse for a parent than either message alone. */}
        <p className="mt-6 max-w-[60ch] text-lg leading-relaxed text-muted-foreground">
          {open ? (
            <>
              We&apos;d love to welcome your child to our learning community. Apply online
              or contact us for more information.
            </>
          ) : (
            <>
              We&apos;d love to welcome your child to our learning community. Admissions
              are not open right now — contact us to hear about the next intake.
            </>
          )}
        </p>
      </HeroBand>

      {/* Placeholder photography — see `lib/placeholder-images.ts`. */}
      <SectionShell tone="canvas">
        <Photo id="learning" ratio="aspect-[3/2]" className="mx-auto max-w-3xl" />
      </SectionShell>

      {open ? (
        <>
          <SectionShell tone="canvas">
            <SectionHeading
              align="center"
              title="Admission Process"
              lede="Simple 4-step process to get your child enrolled at Novastar Montessori School."
            />
            <ol className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ProcessStep number="1" title="Apply Online" desc="Fill our online application form" />
              <ProcessStep number="2" title="Documents" desc="Submit required documents" />
              <ProcessStep number="3" title="Assessment" desc="Student assessment and interview" />
              <ProcessStep number="4" title="Enroll" desc="Receive acceptance and register" />
            </ol>
          </SectionShell>

          <SectionShell tone="band">
            {/*
              The measure is on an inner element, not on `container`. `.container`
              is a later same-specificity declaration than any `max-w-*` utility,
              so the two on one element silently renders at the 80rem cap. See
              the `.container` note in `app/globals.css`.
            */}
            <div className="mx-auto max-w-3xl">
              <AdmissionsForm />
            </div>
          </SectionShell>
        </>
      ) : (
        <SectionShell tone="band">
          <div className="mx-auto max-w-2xl text-center">
            <Card className={CARD_PAD}>
              <SectionTitle className="mb-4 text-primary">
                Admissions currently closed
              </SectionTitle>
              <p className="mb-6 max-w-xl mx-auto text-muted-foreground">
                We are not accepting applications at this time. The next intake window will
                be announced here and on our social channels.
              </p>
              <div className="flex flex-col items-center gap-4">
                {/* A link, not a submit: `output: 'export'` has no server to post to. */}
                <MarketingButton href="/contact" size="lg" className="w-full sm:w-auto">
                  Contact us to enquire
                </MarketingButton>
                {/*
                  A phone number at the moment of intent is a primary action on an
                  admissions page, not a footnote, so it gets a 44px target rather
                  than the 20px it inherited from `text-sm`. Inline prose links are
                  exempt under WCAG 2.5.8; this one sits next to a button, so it
                  does not qualify for the exemption. The text says "Or", which is
                  the right word: it is the alternative to the form above it.
                */}
                <a
                  href={`tel:${SCHOOL_INFO.phoneHref}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm font-medium text-primary transition-colors duration-fast hover:bg-tint-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Or call us at {SCHOOL_INFO.phone}
                </a>
              </div>
            </Card>
          </div>
        </SectionShell>
      )}
    </div>
  )
}

function ProcessStep({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    /*
      `Card as="li"` keeps the step inside the `<ol>`'s own list semantics; the
      card recipe is the same one every other panel on the site uses.

      The number badge is `rounded-sm`, not a full-circle radius. Every radius on
      the site has to be a `--radius-*` token — a full circle computes to 9999px,
      which is a value outside the declared scale, and
      `tests/design-tokens.test.ts` fails any `rounded-*` outside it. Tailwind v4
      emits no warning for the class; it simply produces no rule, so this badge
      would have rendered as a square with no error anywhere. `--radius-sm` is
      the icon-tile radius, and this is an icon tile.
    */
    <Card as="li" className={cn(CARD_PAD, 'flex h-full flex-col items-center text-center')}>
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-sm bg-primary font-bold text-primary-foreground">
        {number}
      </span>
      <h3 className="type-title text-primary">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
    </Card>
  )
}