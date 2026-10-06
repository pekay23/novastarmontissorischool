import { cn } from '@novastar/shared-ui'

import { CARD_PAD, Card, CardTitle, HeroBand, SectionHeading, SectionShell } from '@/components/marketing'
import { MarketingButton } from '@/components/marketing-button'
import { Photo } from '@/components/photo'
import { SCHOOL_INFO, generateAboutMetadata } from '@/lib/metadata'

/*
 * A plain object export, not `export { generateAboutMetadata as metadata }` —
 * aliasing a function to the name `metadata` breaks prerendering under
 * `output: 'export'`.
 */
export const metadata = generateAboutMetadata()

/*
 * The school's vision and mission, in the proprietress's own words.
 *
 * Verbatim, and not to be tidied. These sentences are the one piece of About
 * copy that is not written here, they replace copy this file used to invent,
 * and their whole value is that they are hers — so the wording, the clause
 * order and the three-sentence length of the mission are all load-bearing. The
 * hyphen in "world‐class" and in "life‐long" is U+2010, not an ASCII hyphen,
 * because that is the character in the source document.
 *
 * The mission is three sentences and the vision is one. That asymmetry is the
 * owner's, not ours, and the layout below is built around it rather than
 * levelling it away.
 */
const VISION =
  'To provide a world‐class Montessori education to children and prepare them to become responsible citizens capable of leading meaningful and morally sound adult life.'

const MISSION = [
  'Novastar exists to provide a safe, developmentally appropriate environment for preschool and school age children.',
  'Our focus is to provide a stimulating early care and education experience which promotes each child\'s social/emotional, physical and cognitive development.',
  'Our goal is to support children\'s desire to be life‐long learners.',
] as const

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      {/* Hero. `HeroBand` owns the band gradient, the header clearance and the
          section rhythm, which used to be re-stated slightly differently on
          every page. The wash is `--color-tint-warm`, not the maroon-tinted
          `from-primary/10` this band carried before. */}
      <HeroBand>
        <h1 className="type-display mx-auto max-w-[18ch] text-center">
          About Novastar Montessori School
        </h1>
        {/*
          Left-aligned inside a centred block. The paragraph was `text-center`
          before, which WCAG 1.4.8 flags for body copy past roughly 50ch: a
          centred block has no consistent left edge, so a returning reader
          re-finds the start of every line. The block is still centred, so the
          heading above it stays optically aligned.
        */}
        <p className="mx-auto mt-6 max-w-[60ch] text-lg leading-relaxed text-muted-foreground">
          {SCHOOL_INFO.description}
        </p>
      </HeroBand>

      {/*
        Mission & Vision.

        These were two equal cards in an `md:grid-cols-2`, which is what made
        the owner's own wording look like a mistake. The vision is one sentence
        and the mission is three, and a grid row stretches both cards to the
        height of the taller one, so the vision card shipped dead air inside its
        own border with its heading stranded at the top and nothing under it.

        Measured in Chromium, old grid against the same copy, holding out every
        other variable:

          width    vision card   its own content   empty interior
          1440px      244px           89px           99px
          1280px      269px          114px           99px
          1024px      318px          138px          124px
           768px      333px          162px          124px

        99px of nothing is 41% of that card's content box, and it only appears
        at `md` and above — below `md` the grid collapses to one column and the
        same markup measured 2px of void, so this is entirely the grid's doing
        and not a property of the copy.

        Two changes fix it, and both remove a constraint rather than dress the
        imbalance up:

        1. One column. A grid cell is what forces two unequal statements into
           one box. Stacked, each card is exactly as tall as its own content:
           the void measures 2px at 360 / 390 / 768 / 1024 / 1280 / 1440, at
           every one of the six widths, which is sub-pixel rounding and nothing
           more. Nothing is centred or stretched, so no `justify-*` was needed.
        2. A measure. Unconstrained the column is the full container — 1376px of
           15px type, which is about 145 characters of line. `max-w-[68ch]`
           lands the prose box at 738px, or 78 characters per line, against the
           702px that the site's `max-w-[60ch]` prose produces elsewhere.

        The pair reads as a pair because both cards share one width (796px at
        every width from 1024 up), one left edge (measured left-edge difference
        0px at all six widths), one padding and one radius, and because the
        section announces them as a single subject instead of leaving two
        headings floating side by side.
      */}
      <SectionShell tone="canvas">
        <SectionHeading align="center" title="Our Mission and Vision" />
        <div className="mx-auto mt-12 flex max-w-[68ch] flex-col gap-5">
          <Card className={cn(CARD_PAD, 'flex flex-col gap-3')}>
            <CardTitle as="h3" className="text-primary">
              Our Mission
            </CardTitle>
            {/* Three paragraphs rather than one run of prose, because the owner
                wrote three sentences and the breaks are hers. */}
            <div className="flex flex-col gap-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
              {MISSION.map((sentence) => (
                <p key={sentence.slice(0, 24)}>{sentence}</p>
              ))}
            </div>
          </Card>

          <Card className={cn(CARD_PAD, 'flex flex-col gap-3')}>
            <CardTitle as="h3" className="text-primary">
              Our Vision
            </CardTitle>
            {/*
              This card used to read "To be the leading Montessori school in
              Ghana". "Leading" was a ranking claim nothing in this repository
              substantiates — no accreditation record, no inspection result, no
              register — and the rest of the codebase deliberately removed the
              same class of claim: see the notes on `getFeatures` and
              `getHomeStats` in `lib/data.ts`, where invented enrolment counts,
              "years of excellence" and a staff certification were deleted for
              exactly this reason.

              It now reads the school's own vision instead, and that is the
              difference worth recording: this is the proprietress's claim about
              her own school, not ours about hers. "World-class" is her word,
              carried over unaltered, and it is published as written. The
              earlier objection was to an unevidenced ranking we had invented on
              her behalf; it was never an objection to ambition, and softening
              this sentence into something more modest would be the same
              substitution in reverse — a stranger's paraphrase replacing what
              the owner actually says.
            */}
            <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
              {VISION}
            </p>
          </Card>
        </div>
      </SectionShell>

      {/*
        Placeholder photography. See `lib/placeholder-images.ts` — this is an
        openly-licensed photograph of another school's classroom, credited in the
        caption, and it must be replaced with a photograph of our own rooms before
        any parent sees it.
      */}
      <SectionShell tone="canvas">
        <Photo
          id="classroom"
          ratio="aspect-[3/2]"
          className="mx-auto max-w-3xl"
        />
      </SectionShell>

      {/* History */}
      <SectionShell tone="band">
        <SectionHeading align="center" title="Our History" />
        {/* No `prose` here: @tailwindcss/typography is not a dependency, so those
            utilities generate nothing and the paragraphs ran together. */}
        <div className="mx-auto mt-10 max-w-[60ch] space-y-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
          <p>
            Founded in {SCHOOL_INFO.established}, Novastar Montessori School began as a small
            creche with a vision to bring authentic Montessori education to Kumasi.
          </p>
          <p>
            Over the years, we have grown into a full-fledged school offering programs
            from Creche through Junior High School, serving families across the Ashanti Region.
          </p>
          {/*
            The third paragraph ended "...achieving excellence including 100% Grade 1
            in BECE Science (2021)". That is an invented examination statistic:
            there is no results record in this repository, it is five years stale,
            and it is unverifiable by a parent who was not in that cohort. One
            fabricated number discredits every true sentence around it, so the
            figure is gone and the sentence keeps only what the school's own
            approach can substantiate — that Montessori runs alongside the GES
            curriculum.
          */}
          <p>
            Our approach combines the Montessori Method with the Ghana Education Service
            curriculum.
          </p>
        </div>
      </SectionShell>

      {/* Location */}
      <SectionShell tone="canvas">
        <SectionHeading align="center" title="Find Us" />
        <p className="mx-auto mt-6 max-w-[60ch] text-muted-foreground">{SCHOOL_INFO.location}</p>
        <iframe
          src={SCHOOL_INFO.mapEmbedUrl}
          title={`Map showing ${SCHOOL_INFO.name} in Kumasi`}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="mx-auto mt-8 aspect-video w-full max-w-4xl rounded-lg border border-border"
        />
        <div className="mt-6 flex justify-center">
          {/* A link, not a submit: `output: 'export'` has no server to post to. */}
          <MarketingButton
            href={SCHOOL_INFO.mapLinkUrl}
            variant="outline"
            size="lg"
            external
          >
            Get Directions via Google Maps
          </MarketingButton>
        </div>
      </SectionShell>
    </div>
  )
}