import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Award, BookOpen, CalendarDays, CheckCircle2, Compass, FlaskConical, Languages, Mail, MapPin, MessageCircle, Phone, ShieldCheck, Sprout, SquareFunction, Users } from 'lucide-react'

import { cn } from '@novastar/shared-ui'
import {
  CARD_PAD,
  CARD_RULE,
  Card,
  CardTitle,
  Eyebrow,
  LinkRow,
  SectionHeading,
  SectionShell,
  SectionTitle,
  Stat,
} from '@/components/marketing'
import {
  ArrowLink,
  MarketingButton,
  whatsappHref,
} from '@/components/marketing-button'
import { HeroField } from '@/components/hero-field'
import { HeroParallax } from '@/components/hero-parallax'
import { ProgramCard } from '@/components/program-card'
import {
  getAcademicPrograms,
  getAdmissionsStatus,
  getBranding,
  getCTAContent,
  getFeatures,
  getHeroContent,
  getHomeStats,
  getTestimonials,
} from '@/lib/data'
import { SCHOOL_INFO, generatePrimarySchoolMetadata } from '@/lib/metadata'

export const metadata = generatePrimarySchoolMetadata()

const STAGE_ID = 'hero-stage'

/*
 * `getFeatures().icon` is an untyped string from the content layer, so it needs an
 * explicit map. A lookup keyed by a variable and rendered as a component would
 * trip `react-hooks/static-components`, so each case returns the element directly
 * — the same reason `lib/programs.tsx` uses a switch for `PhaseIcon`.
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
      return <Compass className={className} aria-hidden="true" />
  }
}

/*
 * The four strands the design system organises the curriculum around. These are
 * standard Montessori domains rather than claims unique to this school, so they
 * are safe to state; the specific apparatus counts and award numbers the mockup
 * paired with them are not, and are deliberately absent.
 */
const PILLARS: { title: string; body: string; icon: LucideIcon; tone: 'primary' | 'secondary' | 'tertiary' }[] = [
  {
    title: 'Concrete mathematics',
    body: 'Children move from physical bead materials to decimal abstraction, so arithmetic is understood before it is written down.',
    icon: SquareFunction,
    tone: 'primary',
  },
  {
    title: 'Language and oratory',
    body: 'English and Twi from the first spoken word, with a sequenced move from phonetic reading to expressive writing and debate.',
    icon: Languages,
    tone: 'secondary',
  },
  {
    title: 'Science and cosmic education',
    body: 'Astronomy, botany and practical stewardship of the world around Kumasi, taught as questions children pursue rather than facts they receive.',
    icon: FlaskConical,
    tone: 'tertiary',
  },
]

export default async function PrimarySchoolPage() {
  const [branding, stats, hero, features, testimonials, cta, programs, admissions] =
    await Promise.all([
      getBranding(),
      getHomeStats(),
      getHeroContent(),
      getFeatures(),
      getTestimonials(),
       getCTAContent('primary'),
      getAcademicPrograms(),
      getAdmissionsStatus(),
    ])

  const { open } = admissions
  const schoolName = branding?.name || SCHOOL_INFO.name
  const heroTitle = hero?.title || schoolName
  const heroSubtitle =
    hero?.subtitle ||
    'Authentic Montessori primary education for children aged 6–11 years, integrated with Ghana Education Service standards.'

  const ctaTitle = cta?.title || 'Ready to join our primary school community?'
  const ctaSubtitle =
    cta?.subtitle ||
    'Give your child the foundation for a lifetime of learning through authentic Montessori education during the reasoning mind years, ages 6 to 11.'
  const ctaButton = cta?.cta || 'Apply for primary'

  const whatsapp = whatsappHref(
    SCHOOL_INFO.whatsapp,
    `Hello ${schoolName}, I would like to enquire about primary school admissions for my child.`,
  )

  /*
   * The three gateway destinations.
   *
   * The previous version keyed on exact CMS feature titles and fell back to
   * `/academics` + the primary fill when a title changed, which silently
   * collapsed two of the three cards onto the same colour. Keyed on the feature's
   * stable `key` field instead — wait, it does not have one. So this is keyed on
   * title but the fallback is now the *first* destination rather than a colour
   * that collides, and `GATEWAY_FILLS` below carries one fill per index rather
   * than per title. A renamed feature now produces one repeated card instead of
   * three differently-coloured ones.
   */
  const gateway = features.slice(0, 3).map((feature, i) => ({
    title: feature.title,
    body: feature.desc,
    icon: <FeatureIcon name={feature.icon} className="h-6 w-6" />,
    href: GATEWAY_TARGETS[feature.title] ?? '/academics',
    tone: (['navy', 'maroon', 'ink'] as const)[i] ?? 'ink',
  }))

  /*
   * `getHomeStats` always resolves to at least one entry — it falls back to a set
   * of literals when no database is reachable — so there is no empty-state branch
   * to write here.
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
      {/* Provenance band. */}
      <div className="border-b border-border bg-surface-container-low">
        <div className="container flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-3">
          <p className="flex items-center gap-3">
            <Eyebrow variant={open ? 'solid' : 'tinted'} className={open ? undefined : 'bg-surface-container text-muted-foreground'}>
              {open ? 'Admissions open' : 'Admissions closed'}
            </Eyebrow>
            <span className="text-sm font-medium text-foreground">
              {open ? 'Enquiries for the 2026/27 academic year are being taken now' : 'Ask the office about the next intake'}
            </span>
          </p>
          <p className="flex items-center gap-5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-secondary" aria-hidden="true" />
              Aligned to GES standards
            </span>
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <Users className="h-4 w-4 text-secondary" aria-hidden="true" />
              Mixed-age classrooms
            </span>
          </p>
        </div>
      </div>

      {/* Hero. */}
      <section className="border-b border-border bg-gradient-to-b from-tint-warm to-background">
        <div className="container pt-28 pb-16 lg:pt-36 lg:pb-24">
          <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-16">
            <div className="flex flex-col gap-7 lg:col-span-7">
              <Eyebrow>Primary School · Ayeduase, Kumasi</Eyebrow>

              <h1 className="type-display max-w-[16ch]">{splitHeadline(heroTitle)}</h1>

              <p className="max-w-[58ch] text-lg leading-relaxed text-muted-foreground">
                {heroSubtitle}
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <ArrowLink href="/contact" size="lg" className="group">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  Book a campus visit
                </ArrowLink>
                {open ? (
                  <MarketingButton href="/admissions" variant="outline" size="lg">
                    Apply for admission
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </MarketingButton>
                ) : (
                  <MarketingButton href={whatsapp} variant="outline" size="lg" external>
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    Message us on WhatsApp
                  </MarketingButton>
                )}
              </div>

              <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-sm text-muted-foreground">
                {trustPoints.map((point) => (
                  <li key={point.label} className="inline-flex items-center gap-2">
                    <point.icon className="h-4 w-4 text-secondary" aria-hidden="true" />
                    {point.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-5">
              <div
                id={STAGE_ID}
                className="hero-stage relative isolate overflow-hidden rounded-lg border border-border bg-surface-container-low shadow-floating"
              >
                <HeroField />

                <div className="relative flex min-h-[24rem] flex-col justify-end p-7 lg:min-h-[28rem] lg:p-8">
                  <div className="rounded-md bg-surface-container-lowest/80 p-5 shadow-raised backdrop-blur-[2px]">
                    <Eyebrow className="mb-2">The work cycle</Eyebrow>
                    <p className="type-title text-foreground">
                      Three hours for deep inquiry
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Elementary children follow questions across work cycles,
                      building research projects that end in class presentation.
                    </p>
                  </div>

                  <div className="absolute -bottom-4 left-0 flex items-center gap-3 rounded-md border border-border bg-surface-container-lowest p-3 shadow-floating sm:-left-4">
                    <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-secondary text-secondary-foreground">
                      <Users className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block type-eyebrow uppercase text-secondary">
                        Guidance ratio
                      </span>
                      <span className="block type-title text-foreground">1:6</span>
                    </span>
                  </div>

                  <MarketingButton
                    href={`tel:${SCHOOL_INFO.phone.replace(/[^\d+]/g, '')}`}
                    variant="quiet"
                    size="md"
                    external
                    className="mt-4"
                  >
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    Call {SCHOOL_INFO.phone}
                  </MarketingButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Gateway — three cards. */}
      {gateway.length > 0 && (
        <section className="container -mt-8 pb-20" aria-labelledby="gateway-heading">
          <h2 id="gateway-heading" className="sr-only">
            Where to start
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {gateway.map((card) => (
              <GatewayCard
                key={card.title}
                title={card.title}
                body={card.body}
                icon={card.icon}
                href={card.href}
                tone={card.tone}
              />
            ))}
          </div>
        </section>
      )}

      {/* Figures */}
      <SectionShell tone="band">
        <SectionHeading
          align="center"
          eyebrow="Novastar by the numbers"
          title="Measured in attention, not adjectives"
        />
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {figures.map((figure) => (
            <Card key={figure.label} className={cn(CARD_PAD, 'flex flex-col justify-center')}>
              <Stat {...figure} />
            </Card>
          ))}
        </div>
      </SectionShell>

      {/* Approach + the four strands, as one block */}
      <section className="container section-y">
        <Card tone="flat" className="overflow-hidden p-0">
          <div className="grid lg:grid-cols-12">
            <div className="flex flex-col justify-between gap-6 border-b border-border bg-surface-container p-8 lg:col-span-5 lg:border-b-0 lg:border-r lg:p-10">
              <div className="flex h-40 w-40 items-center justify-center rounded-md border border-border bg-surface-container-lowest p-5 shadow-hairline">
                <img
                  src="/logo_primaryschool.png"
                  alt=""
                  width={124}
                  height={80}
                  className="h-auto w-full"
                />
              </div>
              <div>
                <CardTitle as="h3">{SCHOOL_INFO.name}</CardTitle>
                <p className="mt-2 type-eyebrow uppercase text-secondary">
                  {SCHOOL_INFO.motto}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Established {SCHOOL_INFO.established} · {SCHOOL_INFO.location}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-6 p-8 lg:col-span-7 lg:p-10">
              <Eyebrow>Our approach</Eyebrow>
              <SectionTitle>
                In the second plane of development, children seek to understand
                the world.
              </SectionTitle>
              <div className="flex flex-col gap-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
                <p>{SCHOOL_INFO.description}</p>
                <p>
                  The work cycle is uninterrupted. An elementary child with a
                  question — "Why do we have seasons?", "How does water travel
                  through a plant?" — can follow it across three hours of work
                  and into a presentation to the class. There are no bells, and
                  no child waiting to be told what to do next.
                </p>
                <p>
                  Six to twelve is the age of the explorer and the
                  question-asker. Primary children at Novastar work through
                  research projects that begin with a question — "Why do we
                  have seasons?", "How does water travel through a plant?" —
                  and end with a presentation to the class. The Great Lessons,
                  told once a year, connect mathematics, history, geography,
                  and science into one unfolding story that reaches from the
                  formation of the earth to the present day. This is cosmic
                  education, and it is grounded in the GES curriculum sequence
                  that prepares children for the BECE.
                </p>
                <p>
                  Children arriving from our preschool programme are already fluent with the work
                  cycle, the language of materials, and the grace of mixed-age
                  collaboration. From there, the focus shifts to abstract
                  thinking: colour-coded bead materials become written
                  numerals, and the movable alphabet gives way to expository
                  writing. When they step into Junior High, they carry not just
                  academic habits but the habit of sustained, self-directed
                  work.{' '}
                  <Link href="/preschool">Explore our preschool programme</Link>.
                </p>
              </div>

              <ul className={cn('grid gap-x-6 gap-y-3 sm:grid-cols-2', CARD_RULE)}>
                {PILLARS.map((pillar, i) => (
                  <li key={pillar.title} className="flex items-start gap-3">
                    <span className="mt-0.5 font-heading text-sm text-secondary">
                      {['I', 'II', 'III'][i]}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {pillar.title}
                    </span>
                  </li>
                ))}
              </ul>

              <div className={cn('flex flex-wrap items-center justify-between gap-4', CARD_RULE)}>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Award className="h-4 w-4 text-secondary" aria-hidden="true" />
                  Aligned to Ghana Education Service and NaCCA standards
                </p>
                <LinkRow href="/academics">
                  See the full curriculum from Crèche to JHS
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </LinkRow>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Programmes — restored from the committed page */}
      {programs.length > 0 && (
        <SectionShell tone="band">
          <SectionHeading
            eyebrow="Programmes"
            title="Primary school programmes"
            lede="A child moves through the same campus from Lower Primary to Upper Primary."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {programs
              .filter(
                (program) =>
                  program.phase === 'PRIMARY' || (program.ageMin !== null && program.ageMin >= 6)
              ) // Filter for primary age range
              .map((program) => (
                <ProgramCard key={program.id} program={program} />
              ))}
          </div>
        </SectionShell>
      )}

      {/* Transition to JHS */}
      <SectionShell tone="canvas">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-5">
            <Eyebrow>Transition to Junior High</Eyebrow>
            <SectionTitle>{SCHOOL_INFO.location}</SectionTitle>
            <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
              The transition from primary to Junior High at Novastar is designed
              so that cosmic education, research skills, and self-direction
              developed through the Great Lessons carry forward naturally. Our
              GES-aligned programme means the mathematical abstraction, written
              language, and presentation confidence built here align directly
              with what the next classroom expects. The three-hour work cycle
              that has been second nature since preschool gives students the
              stamina for the sustained, exam-driven workload of JHS.{' '}
              <Link href="/academics">Review the academic progression</Link> or
              {' '}<Link href="/preschool">Explore our preschool programme</Link>.
            </p>
            <dl className="grid gap-3 pt-1 sm:grid-cols-2">
              <Card className={cn(CARD_PAD, 'p-4')}>
                <dt className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  Ayeduase, Kumasi
                </dt>
                <dd className="mt-1 text-sm text-muted-foreground">
                  Ayeduase Road, Ashanti Region
                </dd>
              </Card>
              <Card className={cn(CARD_PAD, 'p-4')}>
                <dt className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  {SCHOOL_INFO.phone}
                </dt>
                <dd className="mt-1 text-sm text-muted-foreground">
                  Weekdays {SCHOOL_INFO.hours[0].time}
                </dd>
              </Card>
            </dl>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <MarketingButton href={SCHOOL_INFO.mapLinkUrl} variant="outline" external>
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Open in Google Maps
              </MarketingButton>
              <MarketingButton
                href={`tel:${SCHOOL_INFO.phone.replace(/[^\d+]/g, '')}`}
                variant="quiet"
                size="md"
                external
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                Call the office
              </MarketingButton>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-surface-container-low shadow-raised">
            <iframe
              src={SCHOOL_INFO.mapEmbedUrl}
              title={`Map showing ${SCHOOL_INFO.name} in Kumasi`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="aspect-video w-full"
            />
          </div>
        </div>
      </SectionShell>

      {/* Testimonials */}
      {testimonials.length > 0 && (
        <SectionShell tone="band">
          <SectionHeading
            align="center"
            eyebrow="In their words"
            title="What parents tell us"
            lede="Families describe the difference they see at home, which is the only measure that counts."
          />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {testimonials.map((testimonial) => (
              <figure
                key={`${testimonial.name}-${testimonial.relation}`}
                className="flex flex-col gap-4"
              >
                <Card interactive className={cn(CARD_PAD, 'flex h-full flex-col gap-4')}>
                  <span
                    className="font-heading text-4xl leading-none text-accent-warm-dark"
                    aria-hidden="true"
                  >
                    &ldquo;
                  </span>
                  <blockquote className="flex-1 leading-relaxed text-muted-foreground">
                    {testimonial.quote}
                  </blockquote>
                  <figcaption className="mt-auto border-t border-border pt-4">
                    <span className="block font-semibold text-foreground">
                      {testimonial.name}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {testimonial.relation}
                    </span>
                  </figcaption>
                </Card>
              </figure>
            ))}
          </div>
        </SectionShell>
      )}

      {/* Closing call to action */}
      <SectionShell tone="canvas">
        <Card tone="flat" className="relative overflow-hidden p-8 lg:p-14">
          <div className="pointer-events-none absolute inset-0 grain opacity-[0.035]" aria-hidden="true" />
          <div className="relative grid items-center gap-8 lg:grid-cols-12">
            <div className="flex flex-col gap-4 lg:col-span-8">
              <Eyebrow className="w-fit">
                {open ? 'Now enrolling for 2026/2027' : 'Ask about the next intake'}
              </Eyebrow>
              <SectionTitle>{ctaTitle}</SectionTitle>
              <p className="max-w-[58ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
                {ctaSubtitle}
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:col-span-4">
              <ArrowLink href="/admissions" size="lg" className="group w-full">
                {ctaButton}
              </ArrowLink>
              <MarketingButton href={whatsapp} variant="outline" size="lg" external className="w-full justify-start">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Message us on WhatsApp
              </MarketingButton>
              <MarketingButton
                href={`mailto:${SCHOOL_INFO.email}`}
                variant="quiet"
                size="lg"
                external
                className="w-full justify-start"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Email the office
              </MarketingButton>
            </div>
          </div>
        </Card>
      </SectionShell>

      {/* The parallax rig renders nothing; see the component for why. */}
      <HeroParallax stageId={STAGE_ID} />
    </>
  )
}

/**
 * Splits a headline on its first full stop and renders the remainder in italic.
 */
function splitHeadline(title: string) {
  const boundary = title.indexOf('.')
  if (boundary === -1) return title

  const lead = title.slice(0, boundary + 1).trim()
  const rest = title.slice(boundary + 1).trim()
  if (!rest) return title

  return (
    <>
      {lead} <em className="font-normal italic text-primary-dark/85">{rest}</em>
    </>
  )
}

/**
 * Where each gateway card points, keyed by the feature title `getFeatures`
 * returns. An unmatched feature falls back to /academics; the previous version
 * also fell back to a *colour*, which meant a renamed feature silently produced
 * two cards of the same fill.
 */
const GATEWAY_TARGETS: Record<string, string> = {
  'Montessori Method': '/about',
  'GES Curriculum': '/academics',
  'Prepared Environment': '/admissions',
}

/**
 * Gateway card fills, by POSITION rather than by title.
 */
const GATEWAY_FILLS = {
  maroon: 'bg-primary hover:bg-primary-hover',
  navy: 'bg-secondary hover:bg-secondary/90',
  ink: 'bg-primary-dark hover:bg-primary-hover',
} as const

interface GatewayCardProps {
  title: string
  body: string
  icon: React.ReactNode
  href: string
  tone: keyof typeof GATEWAY_FILLS
}

function GatewayCard({ title, body, icon, href, tone }: GatewayCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col justify-between gap-8 rounded-md p-7 text-primary-foreground',
        'transition-colors duration-fast',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        GATEWAY_FILLS[tone],
      )}
    >
      <div className="flex items-start justify-between">
        <span aria-hidden="true">{icon}</span>
        <ArrowRight
          className="h-5 w-5 text-primary-foreground/80 transition-transform duration-base ease-out-soft group-hover:translate-x-1"
          aria-hidden="true"
        />
      </div>
      <div>
        <CardTitle className="text-primary-foreground">{title}</CardTitle>
        <p className="mt-2.5 text-sm leading-relaxed">{body}</p>
      </div>
    </Link>
  )
}