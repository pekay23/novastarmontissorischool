import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Award,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Compass,
  FlaskConical,
  Languages,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
  Sprout,
  SquareFunction,
  Users,
} from 'lucide-react'

import { cn, Button } from '@novastar/shared-ui'
import { Eyebrow, HeroBand, IconTile, SectionHeading, Stat } from '@/components/marketing'
import { getBranding, getCTAContent, getFeatures, getHeroContent, getHomeStats, getTestimonials, getAcademicPrograms, getAdmissionsStatus } from '@/lib/data'
import { SCHOOL_INFO, generateHomeMetadata } from '@/lib/metadata'
import { ProgramCard } from '@/components/program-card'

export const metadata = generateHomeMetadata()

/*
 * `getFeatures().icon` is an untyped string from the content layer, so it needs
 * an explicit map. A lookup keyed by a variable and rendered as a component
 * would trip `react-hooks/static-components`, so each case returns the element
 * directly — the same reason `lib/programs.tsx` uses a switch for `PhaseIcon`.
 */
function FeatureIcon({ name, className }: { name: string; className?: string }) {
  switch (name) {
    case 'book-open':
      return <BookOpen className={className} aria-hidden="true" />
    case 'graduation-cap':
      return <Award className={className} aria-hidden="true" />
    case 'award':
      return <Sprout className={className} aria-hidden="true" />
    default:
      return <Sparkles className={className} aria-hidden="true" />
  }
}

/*
 * The four strands the design system organises the curriculum around. These are
 * standard Montessori domains rather than claims unique to this school, so they
 * are safe to state; the specific apparatus counts and award numbers the
 * mockup paired with them are not, and are deliberately absent.
 */
const PILLARS: { title: string; body: string; icon: LucideIcon; tone: 'primary' | 'secondary' | 'tertiary'; link: string; cta: string }[] = [
  {
    title: 'Sensorial and motor mastery',
    body: 'Self-correcting apparatus that build coordination, tactile discrimination and the concentration a three-hour work cycle depends on.',
    icon: Compass,
    tone: 'primary',
    link: '/academics',
    cta: 'Explore the prepared environment',
  },
  {
    title: 'Concrete mathematics',
    body: 'Children move from physical bead materials to decimal abstraction, so arithmetic is understood before it is written down.',
    icon: SquareFunction,
    tone: 'secondary',
    link: '/academics',
    cta: 'See the mathematics continuum',
  },
  {
    title: 'Language and oratory',
    body: 'English and Twi from the first spoken word, with a sequenced move from phonetic reading to expressive writing and debate.',
    icon: Languages,
    tone: 'tertiary',
    link: '/academics',
    cta: 'See the language continuum',
  },
  {
    title: 'Science and cosmic education',
    body: 'Astronomy, botany and practical stewardship of the world around Kumasi, taught as questions children pursue rather than facts they receive.',
    icon: FlaskConical,
    tone: 'primary',
    link: '/academics',
    cta: 'See the science continuum',
  },
]

export default async function HomePage() {
  const [branding, stats, hero, features, testimonials, cta, programs, admissions] = await Promise.all([
    getBranding(),
    getHomeStats(),
    getHeroContent(),
    getFeatures(),
    getTestimonials(),
    getCTAContent(),
    getAcademicPrograms(),
    getAdmissionsStatus(),
  ])

  const { open } = admissions
  const schoolName = branding?.name || SCHOOL_INFO.name
  const heroTitle = hero?.title || schoolName
  const heroSubtitle =
    hero?.subtitle ||
    'Authentic Montessori education from Crèche to Junior High in Kumasi, Ghana, integrated with Ghana Education Service standards.'
  const ctaTitle = cta?.title || 'Ready to join our community?'
  const ctaSubtitle =
    cta?.subtitle ||
    'Give your child the foundation for a lifetime of learning through authentic Montessori education'
  const ctaButton = cta?.cta || 'Apply now'

  const whatsappHref = `https://wa.me/${SCHOOL_INFO.whatsapp}?text=${encodeURIComponent(
    `Hello ${schoolName}, I would like to enquire about admissions for my child.`,
  )}`

  /*
   * `getHomeStats` always resolves to at least one entry — it falls back to a
   * set of literals when no database is reachable — so there is no empty-state
   * branch to write here. The tone is cycled rather than hardcoded so the
   * alternation the design uses survives whatever the data layer returns.
   */
  const figures = stats.map((s, i) => ({
    value: s.value,
    label: s.label,
    tone: (['primary', 'secondary', 'tertiary', 'primary'] as const)[i % 4],
  }))

  const trustPoints = [
    { icon: CheckCircle2, label: 'Individualized sensitive periods' },
    { icon: CheckCircle2, label: 'Mixed-age, self-directed classrooms' },
    { icon: ShieldCheck, label: 'Supervised, GES-aligned programme' },
  ]

  return (
    <>
      {/*
        Provenance band. The mockup led with an "#1 in the region" superlative
        and a GES registration number. Neither is verifiable from anything in
        this repository, and publishing an unverifiable ranking on a real
        school's homepage is a reputational liability, so the band instead
        carries only what the codebase can substantiate.
      */}
      <div className="border-b border-border bg-surface-container-high">
        <div className="container flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-2.5 text-xs">
          <p className="flex items-center gap-3">
            {open ? (
              <>
                <Eyebrow variant="slant" className="shrink-0">
                  Admissions open
                </Eyebrow>
                <span className="font-semibold text-primary">
                  Enquiries for the 2026/27 academic year are being taken now
                </span>
              </>
            ) : (
              <Eyebrow variant="slant" className="shrink-0">
                Admissions closed
              </Eyebrow>
            )}
          </p>
          <p className="flex items-center gap-5 text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
              Aligned to GES standards
            </span>
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <Users className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
              Mixed-age classrooms
            </span>
            {open && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" aria-hidden="true" />
                Inquiries open
              </span>
            )}
          </p>
        </div>
      </div>

      <HeroBand className="border-b-0">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-7">
            <Eyebrow variant="outline" className="w-fit">
              Montessori school · Kumasi
            </Eyebrow>

            <h1 className="text-display-hero text-balance">
              {/*
                The mockup splits the headline across two beats with the second
                in italic. The database title is a single string, so the split
                is taken on its first full stop rather than hardcoded — that way
                a CMS edit cannot desynchronise the visual treatment from the
                words.
              */}
              {splitHeadline(heroTitle)}
            </h1>

            <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">{heroSubtitle}</p>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <Button size="lg" asChild>
                <Link href="/contact">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  Book a campus visit
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/admissions">
                  {ctaButton}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>

            <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-xs font-semibold text-muted-foreground">
              {trustPoints.map((point) => (
                <li key={point.label} className="inline-flex items-center gap-2">
                  <point.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  {point.label}
                </li>
              ))}
            </ul>
          </div>

          {/*
            Visual panel. The mockup used a photograph. There is no photography
            in this repository, and the generated image the mockup linked is a
            Stitch asset that would rot, so the panel is built from the crest
            and the palette instead. The gradient overlay and the floating
            statistic chip are kept because they are the design's signature
            treatment, not the photograph itself.
          */}
          <div className="lg:col-span-5">
            <div className="relative rounded-2xl border border-border bg-surface-container-lowest p-3 shadow-xl">
              <div className="relative flex min-h-[26rem] flex-col justify-end overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary-dark to-wine p-7">
                <div
                  className="absolute inset-0 opacity-[0.07]"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 14px)',
                  }}
                  aria-hidden="true"
                />
                <div className="relative">
                  <Eyebrow variant="slant" className="mb-2 bg-primary-foreground text-primary">
                    Prepared environment
                  </Eyebrow>
                  <p className="text-headline-sm text-primary-foreground">
                    The three-hour uninterrupted work cycle
                  </p>
                  <p className="mt-1.5 text-sm text-primary-fixed-dim">
                    Long stretches of self-directed work, uninterrupted by bells or
                    premature grading.
                  </p>
                </div>
              </div>

              {/*
                `left-0 sm:-left-5`, not a flat `-left-5`. This chip deliberately
                overhangs the panel, but the overhang is measured from the panel,
                and the panel's left edge is the container's padding edge — 1rem
                below `sm`, 1.5rem from `sm`, 2rem from `lg`. A flat -1.25rem
                therefore puts the chip 4px past the left edge of the viewport on
                a phone. Pulling it flush below `sm` keeps the overhang where
                there is room for it and keeps it on-screen where there is not.
              */}
              <div className="absolute -bottom-5 left-0 flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 shadow-xl sm:-left-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Users className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-label-sm uppercase tracking-[0.08em] text-primary">
                    Guidance ratio
                  </span>
                  <span className="block text-xl font-extrabold text-foreground">1:6</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </HeroBand>

      {/* Triple gateway — the design's three tall colour cards. */}
      {features.length > 0 && (
        <section className="container -mt-4 pb-16" aria-labelledby="gateway-heading">
          {/*
            Visually hidden because the design gives this band no visible title —
            the three cards are self-explanatory — but the section still needs a
            heading. Without it the document outline runs h1 straight to the
            GatewayCard h3 and heading navigation skips a level.
          */}
          <h2 id="gateway-heading" className="sr-only">
            Where to start
          </h2>
          <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border shadow-xl md:grid-cols-3">
            {features.map((feature) => (
              <GatewayCard
                key={feature.title}
                title={feature.title}
                body={feature.desc}
                icon={<FeatureIcon name={feature.icon} className="h-9 w-9" />}
                /*
                 * Destination and fill are keyed by the feature, not by its
                 * position. Deriving them from `i` silently mislabels the cards
                 * the moment a feature is added, removed or reordered in the CMS.
                 */
                href={GATEWAY_TARGETS[feature.title]?.href ?? '/academics'}
                tone={GATEWAY_TARGETS[feature.title]?.tone ?? 'primary'}
              />
            ))}
          </div>
        </section>
      )}

      {/* Figures */}
      <section className="border-y border-border bg-surface-container-low">
        <div className="container section-y">
          <SectionHeading
            align="center"
            eyebrow="Novastar by the numbers"
            title="Measured in attention, not adjectives"
          />
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            {figures.map((figure) => (
              <Stat
                key={figure.label}
                value={figure.value}
                label={figure.label}
                tone={figure.tone}
              />
            ))}
          </div>
        </div>
      </section>

      {/*
        Approach statement. The mockup ran a portrait and a quote attributed to
        a named Head of School. Neither the person nor the words exist anywhere
        in this repository, so this keeps the design's editorial shape — offset
        portrait column, oversized quote mark, credential footer — but states
        the school's own positioning from `SCHOOL_INFO` instead of inventing a
        headmaster and a PhD.
      */}
      <section className="container section-y">
        <div className="rounded-2xl border border-border bg-surface-container-low p-8 shadow-md lg:p-14">
          <div className="grid items-center gap-10 lg:grid-cols-12">
            <div className="flex flex-col items-center gap-4 text-center lg:col-span-4">
              <div className="flex h-52 w-52 items-center justify-center rounded-2xl border-4 border-surface bg-gradient-to-br from-primary-soft to-surface shadow-xl lg:h-64 lg:w-64">
                {/*
                  Plain `<img>` rather than `next/image`, and the lint rule is
                  switched off for this line on purpose. `next/image` optimizes
                  raster formats; a local SVG has no raster source to encode, so
                  the loader would hand back the same file while adding a
                  runtime wrapper and a second request to measure it.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo.svg"
                  /* Decorative: the wordmark in the SVG duplicates the school
                     name rendered beside it. */
                  alt=""
                  /* logo.svg is 340x54, so this pair must keep that 6.296:1
                     ratio. The browser derives `aspect-ratio` from these
                     attributes before the stylesheet loads, so a stale pair
                     would reserve the wrong box. */
                  width={504}
                  height={80}
                  /* `w-full` with `h-auto`, not a fixed `h-32 w-auto`. The tile
                     above is a square, and an explicit height plus `w-auto`
                     made the lockup resolve to 544px wide inside a 256px flex
                     item; flex-shrink then clamped it to the tile and squashed
                     it to 2:1. Letting the width drive and the height follow
                     keeps the ratio whatever the tile measures. */
                  className="h-auto w-full"
                />
              </div>
              <div>
                <p className="text-headline-sm">{SCHOOL_INFO.name}</p>
                <p className="mt-1 text-label-sm uppercase tracking-[0.08em] text-tertiary-container">
                  {SCHOOL_INFO.motto}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Established {SCHOOL_INFO.established} · {SCHOOL_INFO.location}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-5 lg:col-span-8">
              <div className="flex items-center gap-3 text-tertiary-container">
                <span
                  className="font-heading text-4xl leading-none"
                  aria-hidden="true"
                >
                  &ldquo;
                </span>
                <span className="text-label-md uppercase tracking-[0.06em] font-bold">
                  Our approach
                </span>
              </div>
              <h2 className="text-headline-lg">
                We do not simply deliver lessons. We prepare an environment in
                which a child can teach themselves through dignified inquiry.
              </h2>
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
                <p>{SCHOOL_INFO.description}</p>
                <p>
                  The work cycle is uninterrupted. A child chooses a material,
                  works at the shelf beside it, and returns it in condition. There
                  are no bells, and no child waiting to be told what to do next.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
                <p className="flex items-center gap-2 text-xs font-semibold">
                  <Award className="h-5 w-5 text-primary" aria-hidden="true" />
                  Aligned to Ghana Education Service and NaCCA standards
                </p>
                <Button size="sm" asChild>
                  <Link href="/about">
                    Read about the school
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Four pillars */}
      <section className="container section-y">
        <SectionHeading
          eyebrow="Four foundations"
          title="Themes of a Novastar education"
          lede="Structured deliberately across sensorial, mathematical, linguistic and cosmic spheres of learning."
        />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((pillar, i) => (
            <article
              key={pillar.title}
              className="flex flex-col justify-between rounded-xl border border-border border-t-4 border-t-primary bg-surface-container-low p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div>
                <IconTile icon={pillar.icon} tone={pillar.tone} className="mb-4" />
                <p className="text-label-sm uppercase tracking-[0.08em] text-primary">
                  Pillar {['I', 'II', 'III', 'IV'][i]}
                </p>
                <h3 className="mt-1 text-headline-sm text-foreground">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                <Link
                  href={pillar.link}
                  className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                >
                  {pillar.cta}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Programmes — restored from the committed page */}
      {/*
        The Stitch mockup had no programme listing; it sent visitors straight to
        the academics page. The committed page did list the live programmes here,
        and the request was to merge the design into the existing page rather than
        replace it, so the listing stays and reuses the existing `ProgramCard`
        instead of being rebuilt as a new component.

        Guarded on length: `getAcademicPrograms` returns an empty array when no
        database is configured, and a heading above nothing reads as a bug.
      */}
      {programs.length > 0 && (
        <section className="container section-y">
          <SectionHeading
            eyebrow="Programmes"
            title="One school, from first steps to final exams"
            lede="A child moves through the same campus from Crèche to Junior High."
          />
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {programs.map((program) => (
              <ProgramCard key={program.id} program={program} />
            ))}
          </div>
        </section>
      )}

      {/* Campus */}
      <section className="border-y border-border bg-surface-container-low">
        <div className="container section-y">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Eyebrow variant="tinted" className="w-fit">
                Campus
              </Eyebrow>
              <h2 className="text-headline-lg">{SCHOOL_INFO.location}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Classrooms are arranged so that children can move between work,
                and there is outdoor space for movement and practical work.
              </p>
              <dl className="grid gap-3 pt-1 text-sm sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-card px-4 py-3">
                  <dt className="flex items-center gap-2 font-bold text-primary">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    Ayeduase, Kumasi
                  </dt>
                  <dd className="mt-1 text-muted-foreground">
                    Ayeduase Road, Ashanti Region
                  </dd>
                </div>
                <div className="rounded-lg border border-border bg-card px-4 py-3">
                  <dt className="flex items-center gap-2 font-bold text-secondary">
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    {SCHOOL_INFO.phone}
                  </dt>
                  <dd className="mt-1 text-muted-foreground">
                    Weekdays {SCHOOL_INFO.hours[0].time}
                  </dd>
                </div>
              </dl>
              <div className="pt-1">
                <Button variant="outline" asChild>
                  <a href={SCHOOL_INFO.mapLinkUrl} target="_blank" rel="noopener noreferrer">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    Open in Google Maps
                  </a>
                </Button>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-border shadow-xl">
              <iframe
                src={SCHOOL_INFO.mapEmbedUrl}
                title={`Map showing ${SCHOOL_INFO.name} in Kumasi`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="aspect-video w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials — restored from the committed page */}
      {/*
        Also absent from the mockup, and guarded for the same reason as the
        programme listing above.
      */}
      {testimonials.length > 0 && (
        <section className="border-y border-border bg-surface-container-low">
          <div className="container section-y">
            <SectionHeading
              align="center"
              eyebrow="In their words"
              title="What parents tell us"
              lede="Families describe the difference they see at home, which is the only measure that counts."
            />
            {/*
              A blockquote with a cite rather than a <p> plus a name. The
              attribution is part of the quotation's meaning, and screen readers
              announce "cite" so the parent is heard as the source rather than as
              body copy.
            */}
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {testimonials.map((testimonial) => (
                <figure
                  key={`${testimonial.name}-${testimonial.relation}`}
                  className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
                >
                  <span
                    className="font-heading text-4xl leading-none text-primary"
                    aria-hidden="true"
                  >
                    &ldquo;
                  </span>
                  <blockquote className="flex-1 leading-relaxed text-foreground/85">
                    {testimonial.quote}
                  </blockquote>
                  <figcaption className="border-t border-border pt-4">
                    <span className="block font-semibold text-foreground">
                      {testimonial.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {testimonial.relation}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Closing call to action */}
      <section className="container section-y">
        <div className="rounded-2xl border border-primary-foreground/20 bg-primary p-8 shadow-2xl lg:p-14">
          <div className="grid items-center gap-8 lg:grid-cols-12">
            <div className="flex flex-col gap-3 lg:col-span-8">
              {open ? (
                <span className="w-fit rounded-full bg-primary-container px-3 py-1 text-label-sm uppercase tracking-[0.06em] text-primary-foreground">
                  Now enrolling for 2026/2027
                </span>
              ) : (
                <span className="w-fit rounded-full bg-primary-container px-3 py-1 text-label-sm uppercase tracking-[0.06em] text-primary-foreground">
                  Admissions closed — enquire for future intake
                </span>
              )}
              <h2 className="text-headline-lg text-primary-foreground">{ctaTitle}</h2>
              <p className="max-w-2xl text-sm leading-relaxed text-primary-foreground/85">
                {ctaSubtitle}
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:col-span-4">
              <Button size="lg" asChild className="bg-primary-foreground text-primary hover:bg-surface">
                <Link href="/admissions">{ctaButton}</Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Ask on WhatsApp
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

/**
 * Splits a headline on its first full stop and renders the remainder in italic.
 *
 * A single-sentence title returns unchanged: an empty `<em>` would still be an
 * element in the accessibility tree and would read as a stray pause.
 */
function splitHeadline(title: string) {
  const boundary = title.indexOf('.')
  if (boundary === -1) return title

  const lead = title.slice(0, boundary + 1).trim()
  const rest = title.slice(boundary + 1).trim()
  if (!rest) return title

  return (
    <>
      {lead} <em className="font-normal text-tertiary-container">{rest}</em>
    </>
  )
}

interface GatewayCardProps {
  title: string
  body: string
  icon: React.ReactNode
  href: string
  /**
   * Which of the design's three solid fills to use. The three are deliberately
   * different lightnesses so the band reads as three cards rather than one
   * panel, so this cannot be derived from position inside the component —
   * it is passed in from the single map site.
   */
  tone: 'secondary' | 'primary' | 'tertiary'
}

/*
 * Where each gateway card points, keyed by the feature title `getFeatures`
 * returns. An unmatched feature falls back to /academics and the primary fill.
 */
const GATEWAY_TARGETS: Record<string, { href: string; tone: GatewayCardProps['tone'] }> = {
  'Montessori Method': { href: '/academics', tone: 'secondary' },
  'GES Curriculum': { href: '/academics', tone: 'primary' },
  'Prepared Environment': { href: '/admissions', tone: 'tertiary' },
}

const GATEWAY_FILLS: Record<GatewayCardProps['tone'], string> = {
  secondary: 'bg-secondary hover:bg-secondary/90',
  /*
   * `--color-primary-hover`, not `--color-primary-dark`. The latter is *lighter*
   * than `--color-primary` (see the note in globals.css), so using it as the
   * hover shade would lighten the card on hover and, in dark mode where both
   * resolve to the same value, produce no hover change at all.
   */
  primary: 'bg-primary hover:bg-primary-hover',
  tertiary: 'bg-tertiary-container hover:bg-tertiary-container/90',
}

/**
 * One of the three full-bleed colour cards in the gateway band.
 *
 * The divider is drawn by the grid gap rather than a border so that on mobile,
 * where the cards stack, there is no stray vertical rule in the gutter. The
 * border-l utilities only apply from `md` up.
 */
function GatewayCard({ title, body, icon, href, tone }: GatewayCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col justify-between gap-6 p-8 text-primary-foreground transition-colors',
        'border-b border-primary-foreground/10 last:border-b-0 md:border-b-0 md:border-l md:first:border-l-0',
        /*
         * The cards sit flush with no grid gap, so the default offset focus
         * outline paints onto the neighbouring card's fill instead of the page
         * background — and at one point landed on a fill of the same colour as
         * the ring. Insetting the outline keeps it inside the card, where it
         * always has a contrasting surface behind it.
         */
        'focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-primary-foreground',
        GATEWAY_FILLS[tone],
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-primary-foreground/85">{icon}</span>
        <ArrowRight
          className="h-5 w-5 text-primary-foreground/70 transition-transform group-hover:translate-x-1 group-hover:text-primary-foreground"
          aria-hidden="true"
        />
      </div>
      {/*
          The body is full-opacity `--color-primary-foreground`, not `/85`. At 85%
          the terracotta card measured 4.12:1, under the 4.5:1 that 14px text
          needs; at full opacity all three cards clear the bar in both schemes
          (7.49 / 13.66 / 5.09 light, 8.78 / 10.40 / 6.76 dark). The visual
          hierarchy against the title comes from the size difference instead.
        */}
      <div>
        <h3 className="text-headline-sm">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-primary-foreground">{body}</p>
      </div>
    </Link>
  )
}