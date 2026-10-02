
import Link from 'next/link'
import { ArrowRight, CalendarDays, MessageCircle, ShieldCheck, Sprout, Users } from 'lucide-react'
import { getBranding, getHomeStats, getHeroContent, getFeatures, getTestimonials, getCTAContent, getAcademicPrograms } from '@/lib/data'
import { ProgramCard } from '@/components/program-card'
import { Button } from '@novastar/shared-ui'
import { SCHOOL_INFO, generateHomeMetadata } from '@/lib/metadata'

export const metadata = generateHomeMetadata()

export default async function HomePage() {
  const [branding, stats, hero, features, testimonials, cta, programs] = await Promise.all([
    getBranding(),
    getHomeStats(),
    getHeroContent(),
    getFeatures(),
    getTestimonials(),
    getCTAContent(),
    getAcademicPrograms(),
  ])

  const schoolName = branding?.name || 'Novastar Montessori School'
  const heroTitle = hero?.title || schoolName
  const heroSubtitle = hero?.subtitle || 'Authentic Montessori education from Crèche to Junior High in Kumasi, Ghana'
  const ctaTitle = cta?.title || 'Ready to join our community?'
  const ctaSubtitle = cta?.subtitle || 'Give your child the foundation for a lifetime of learning through authentic Montessori education'
  const ctaButton = cta?.cta || 'Apply now'

  const whatsappHref = `https://wa.me/${SCHOOL_INFO.whatsapp}?text=${encodeURIComponent(
    `Hello ${schoolName}, I would like to enquire about admissions for my child.`,
  )}`

  // The research was consistent that operational facts beat adjectives, because
  // a parent can verify a ratio but not a claim about teaching quality.
  const facts = [
    { value: '1:6', label: 'Guide to children in the early years' },
    { value: 'Crèche–JHS', label: 'One school, Crèche to Junior High' },
    { value: 'GES', label: 'Aligned to Ghana Education Service standards' },
    { value: '3', label: 'Terms per academic year' },
  ]

  return (
    <>
      {/*
        Hero. Research across Ghana, the UK and the US was consistent on two
        points: a two-beat headline rather than a feature list, and two actions
        in the first screen, always a visit and an enquiry. The previous hero
        had one button that was not a link and went nowhere.
      */}
      <section className="relative overflow-hidden bg-gradient-to-b from-primary-soft via-background to-background">
        <div className="container section-y grid gap-12 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-surface px-4 py-1.5 text-sm font-medium text-primary-dark ring-1 ring-border">
              <Sprout className="h-4 w-4 text-secondary" aria-hidden="true" />
              Admissions open for 2026/27
            </p>

            <h1 className="text-responsive-h1 mb-6">
              {heroTitle.split('.').filter(Boolean).map((line, i) => (
                <span key={i} className="block">
                  {i === 0 ? line : <em className="font-normal text-secondary">{line}</em>}
                </span>
              ))}
            </h1>

            <p className="mb-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
              {heroSubtitle}
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/admissions">
                  {ctaButton}
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href={`tel:${SCHOOL_INFO.phoneHref}`}>Book a visit</a>
              </Button>
            </div>

            <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-primary-dark hover:underline"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Message us on WhatsApp
              </a>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                Visits Mon–Fri, 8am–4pm
              </span>
            </p>
          </div>

          {/*
            Trust panel. Replaces the previous stat row, which sat below the
            fold in a plain grid with no hierarchy.
          */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-border bg-surface p-7 shadow-sm">
              <h2 className="mb-5 font-heading text-lg text-primary-dark">
                What you can hold us to
              </h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt className="font-heading text-2xl text-primary">{f.value}</dt>
                    <dd className="mt-0.5 text-sm text-muted-foreground">{f.label}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 flex items-start gap-2 border-t border-border pt-5 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                Safe, supervised, mixed-age classrooms where children work at
                their own pace with materials within reach.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats from the database, when configured */}
      {stats.length > 0 && (
        <section className="border-y border-border bg-surface">
          <div className="container grid grid-cols-2 gap-6 py-10 md:grid-cols-4">
            {stats.map((stat, i) => (
              <StatCard key={i} label={stat.label} value={stat.value} />
            ))}
          </div>
        </section>
      )}

      {/* Programmes */}
      <section className="section-y">
        <div className="container">
          <div className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-secondary">
              Academic programmes
            </p>
            <h2 className="text-responsive-h2 mb-4">One school, from first steps to final exams</h2>
            <p className="text-lg text-muted-foreground">
              Authentic Montessori education integrated with Ghana Education Service
              standards, so children move through Crèche to Junior High without
              changing school.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((program) => (
              <ProgramCard key={program.id} program={program} />
            ))}
          </div>
        </div>
      </section>

      {/* Why Novastar */}
      {features.length > 0 && (
        <section className="section-y bg-muted">
          <div className="container">
            <div className="mb-12 max-w-2xl">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-secondary">
                Why Novastar
              </p>
              <h2 className="text-responsive-h2">
                A prepared environment, and the adults to run it
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {features.map((feature, i) => (
                <FeatureCard key={i} title={feature.title} desc={feature.desc} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Parent voice, attributed by stage */}
      {testimonials.length > 0 && (
        <section className="section-y">
          <div className="container">
            <div className="mb-12 max-w-2xl">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-secondary">
                Parent voice
              </p>
              <h2 className="text-responsive-h2">What parents tell us</h2>
            </div>

            <div className="grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-2">
              {testimonials.map((testimonial, i) => (
                <TestimonialCard
                  key={i}
                  name={testimonial.name}
                  relation={testimonial.relation}
                  quote={testimonial.quote}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Closing call to action */}
      <section className="section-y bg-primary">
        <div className="container text-center">
          <h2 className="text-responsive-h2 mb-4 text-primary-foreground">{ctaTitle}</h2>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-primary-foreground/85">{ctaSubtitle}</p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" variant="secondary" asChild>
              <Link href="/admissions">{ctaButton}</Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              asChild
            >
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                Ask a question on WhatsApp
              </a>
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center md:text-left">
      <div className="font-heading text-3xl text-primary md:text-4xl">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  )
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-7">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary-soft text-primary">
        <Users className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="mb-2 text-lg text-primary-dark">{title}</h3>
      <p className="text-muted-foreground">{desc}</p>
    </div>
  )
}

function TestimonialCard({
  name,
  relation,
  quote,
}: {
  name: string
  relation: string
  quote: string
}) {
  return (
    <figure className="rounded-xl border border-border bg-surface p-7">
      {/* role="img" is required: a plain div resolves to role="generic", which
          prohibits naming, so the rating was silently dropped. */}
      <div
        className="mb-4 flex gap-0.5 text-secondary"
        role="img"
        aria-label="Rated five out of five"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <svg key={i} viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            <path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.36 4.18a1 1 0 0 0 .95.69h4.4c.97 0 1.37 1.24.59 1.81l-3.56 2.58a1 1 0 0 0-.36 1.11l1.36 4.18c.3.92-.76 1.69-1.54 1.11l-3.56-2.58a1 1 0 0 0-1.18 0l-3.56 2.58c-.78.58-1.84-.19-1.54-1.11l1.36-4.18a1 1 0 0 0-.36-1.11L1.74 9.61C.96 9.04 1.36 7.8 2.33 7.8h4.4a1 1 0 0 0 .95-.69L9.05 2.93Z" />
          </svg>
        ))}
      </div>
      <blockquote className="mb-4 text-foreground/85">“{quote}”</blockquote>
      <figcaption>
        <span className="block font-semibold text-primary-dark">{name}</span>
        <span className="text-sm text-muted-foreground">{relation}</span>
      </figcaption>
    </figure>
  )
}
