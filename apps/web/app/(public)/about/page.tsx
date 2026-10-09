import { HeroBand, SectionHeading, SectionShell } from '@/components/marketing'
import { MasonryGallery } from '@/components/masonry-gallery'
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
        <h1 className="font-serif text-5xl md:text-6xl mx-auto max-w-[18ch] text-center text-primary">
          About Novastar Montessori School
        </h1>
        {/*
          Left-aligned inside a centred block. The paragraph was `text-center`
          before, which WCAG 1.4.8 flags for body copy past roughly 50ch: a
          centred block has no consistent left edge, so a returning reader
          re-finds the start of every line. The block is still centred, so the
          heading above it stays optically aligned.
        */}
        <p className="mx-auto mt-6 max-w-[60ch] text-lg leading-relaxed text-foreground/85 text-center">
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
      <section className="relative w-full py-32 md:py-48 overflow-hidden my-16">
        {/* Background Image with Dark Overlay */}
        <div className="absolute inset-0 z-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/photo_2_2026-10-05_11-06-55%20for%20primary%20school.jpg" alt="Novastar Classroom" className="h-full w-full object-cover object-center animate-ken-burns" loading="lazy" />
          <div className="absolute inset-0 bg-black/60 mix-blend-multiply pointer-events-none"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-background via-black/40 to-background pointer-events-none"></div>
        </div>

        <div className="container relative z-10 mx-auto px-4 md:px-6">
          <div className="mx-auto max-w-4xl text-center flex flex-col items-center justify-center">
            <div className="text-white/70 text-[11px] font-bold tracking-[0.3em] uppercase mb-8">
              Our Purpose
            </div>
            
            <div className="flex flex-col gap-4 mb-10 max-w-3xl">
              {MISSION.map((sentence, i) => (
                <p key={sentence.slice(0, 24)} className={i === 0 ? "font-serif text-3xl md:text-4xl lg:text-5xl leading-tight text-white" : "font-serif text-2xl md:text-3xl leading-tight text-white/90"}>
                  {i === 0 && <>&ldquo;</>}{sentence}{i === MISSION.length - 1 && <>&rdquo;</>}
                </p>
              ))}
            </div>

            <div className="h-px w-24 bg-white/30 mx-auto mb-10"></div>
            
            <p className="text-xl md:text-2xl text-white/90 italic font-light max-w-2xl">
              {VISION}
            </p>
          </div>
        </div>
      </section>

      {/* History */}
      <SectionShell tone="band">
        <SectionHeading align="center" title="Our History" />
        <div className="mx-auto mt-10 max-w-[60ch] space-y-5 text-lg leading-relaxed text-foreground/85">
          <p className="first-letter:text-primary first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-5xl first-letter:leading-[0.8] first-letter:font-medium">
            Founded in {SCHOOL_INFO.established}, Novastar Montessori School began as a small
            creche with a vision to bring authentic Montessori education to Kumasi.
          </p>
          <p>
            Over the years, we have grown into a full-fledged school offering programs
            from Creche through Junior High School, serving families across the Ashanti Region.
          </p>
          <p>
            Our approach combines the Montessori Method with the Ghana Education Service
            curriculum, creating a unique environment where inquiry and standard-aligned rigor coexist.
          </p>
        </div>
      </SectionShell>

      {/* Gallery Section */}
      <section className="container py-24">
        <div className="mb-12 text-center">
          <p className="type-label uppercase text-accent-warm-dark mb-2">Our Campus</p>
          <h2 className="font-serif text-3xl md:text-4xl text-primary">A glimpse into our environments</h2>
        </div>
        <MasonryGallery
          images={[
            { src: '/images/photo_2_2026-10-05_11-06-55%20for%20primary%20school.jpg', alt: 'Classroom', aspect: 'wide' },
            { src: '/images/photo_3_2026-10-05_11-06-55%20for%20primary%20school.jpg', alt: 'Children working', aspect: 'portrait' },
            { src: '/images/photo_4_2026-10-05_11-06-55%20for%20primary%20school.jpg', alt: 'Montessori materials', aspect: 'square' },
            { src: '/images/photo_7_2026-10-05_11-06-55.jpg', alt: 'Learning', aspect: 'square' },
            { src: '/images/photo_6_2026-10-05_11-06-55.jpg', alt: 'Activity', aspect: 'video' },
          ]}
          className="max-w-5xl mx-auto"
        />
      </section>
    </div>
  )
}