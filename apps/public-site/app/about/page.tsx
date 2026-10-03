import { SCHOOL_INFO, generateAboutMetadata } from '@/lib/metadata'
import { Button } from '@novastar/shared-ui'

/*
 * A plain object export, not `export { generateAboutMetadata as metadata }` —
 * aliasing a function to the name `metadata` breaks prerendering under
 * `output: 'export'`.
 */
export const metadata = generateAboutMetadata()

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container text-center">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">
            About Novastar Montessori School
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {SCHOOL_INFO.description}
          </p>
        </div>
      </section>

      {/* Mission & Vision */}
      <section className="py-12 md:py-16">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="text-center p-6 bg-muted/30 rounded-lg">
              <h2 className="text-2xl font-heading font-semibold text-primary mb-3">Our Mission</h2>
              <p className="text-foreground/80">
                Bringing quality care and experience to learning through authentic
                Montessori education that nurtures each child&apos;s natural curiosity,
                independence, and love for discovery.
              </p>
            </div>
            <div className="text-center p-6 bg-muted/30 rounded-lg">
              <h2 className="text-2xl font-heading font-semibold text-primary mb-3">Our Vision</h2>
              <p className="text-foreground/80">
                To be the leading Montessori school in Ghana, providing excellence
                in education that prepares children for lifelong learning and service.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* History */}
      <section className="py-12 md:py-16 bg-muted/30">
        <div className="container">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-responsive-h2 font-heading text-primary text-center mb-8">Our History</h2>
            {/* No `prose` here: @tailwindcss/typography is not a dependency, so those
                utilities generate nothing and the paragraphs ran together. */}
            <div className="mx-auto max-w-2xl space-y-5 text-center leading-relaxed text-foreground/80">
              <p>
                Founded in {SCHOOL_INFO.established}, Novastar Montessori School began as a small
                creche with a vision to bring authentic Montessori education to Kumasi.
              </p>
              <p>
                Over the years, we have grown into a full-fledged school offering programs
                from Creche through Junior High School, serving families across the Ashanti Region.
              </p>
              <p>
                Our approach combines the Montessori Method with the Ghana Education Service
                curriculum, achieving excellence including 100% Grade 1 in BECE Science (2021).
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Location */}
      <section className="py-12 md:py-16">
        <div className="container">
          <div className="text-center">
            <h2 className="text-responsive-h2 font-heading text-primary text-center mb-8">Find Us</h2>
            <p className="text-muted-foreground mb-6">{SCHOOL_INFO.location}</p>
            <iframe
              src={SCHOOL_INFO.mapEmbedUrl}
              title={`Map showing ${SCHOOL_INFO.name} in Kumasi`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="aspect-video w-full max-w-4xl rounded-lg border border-border mx-auto"
            />
            <div className="mt-6">
              <Button size="lg" asChild>
                <a href={SCHOOL_INFO.mapLinkUrl} target="_blank" rel="noopener noreferrer">
                  Get Directions via Google Maps
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}