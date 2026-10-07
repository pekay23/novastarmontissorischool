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
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sprout,
  SquareFunction,
  Users,
} from 'lucide-react'

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
import { Photo } from '@/components/photo'
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
import { SCHOOL_INFO, generateHomeMetadata } from '@/lib/metadata'

export const metadata = generateHomeMetadata()

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
    title: 'Sensorial and motor mastery',
    body: 'Self-correcting apparatus that build coordination, tactile discrimination and the concentration a three-hour work cycle depends on.',
    icon: Compass,
    tone: 'primary',
  },
  {
    title: 'Concrete mathematics',
    body: 'Children move from physical bead materials to decimal abstraction, so arithmetic is understood before it is written down.',
    icon: SquareFunction,
    tone: 'secondary',
  },
  {
    title: 'Language and oratory',
    body: 'English and Twi from the first spoken word, with a sequenced move from phonetic reading to expressive writing and debate.',
    icon: Languages,
    tone: 'tertiary',
  },
  {
    title: 'Science and cosmic education',
    body: 'Astronomy, botany and practical stewardship of the world around Kumasi, taught as questions children pursue rather than facts they receive.',
    icon: FlaskConical,
    tone: 'primary',
  },
]

export default async function HomePage() {
  const [branding, stats, hero, features, testimonials, cta, programs, admissions] =
    await Promise.all([
      getBranding(),
      getHomeStats(),
      getHeroContent(),
      getFeatures(),
      getTestimonials(),
       getCTAContent('home'),
      getAcademicPrograms(),
      getAdmissionsStatus(),
    ])

  const { open } = admissions
  const schoolName = branding?.name || SCHOOL_INFO.name
  const heroTitle = hero?.title || schoolName
  const heroSubtitle =
    hero?.subtitle ||
    'Authentic Montessori education from Crèche to Junior High in Kumasi, Ghana, integrated with Ghana Education Service standards.'
  const ctaTitle = cta?.title || 'Ready to start at Novastar?'
  const ctaSubtitle =
    cta?.subtitle ||
    'From Crèche to Junior High, our mixed-age classrooms and GES-aligned curriculum give every child a prepared environment to learn independently. Book a visit or apply for 2026/27.'
  const ctaButton = cta?.cta || 'Apply for admission'

  const whatsapp = whatsappHref(
    SCHOOL_INFO.whatsapp,
    `Hello ${schoolName}, I would like to enquire about admissions for my child.`,
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
      {/*
        Provenance band.

        Carries only what the codebase can substantiate. The mockup led with a
        "#1 in the region" superlative and a GES registration number; neither is
        verifiable from anything in this repository, and publishing an
        unverifiable ranking on a real school's homepage is a reputational
        liability.

        The maroon left that used to sit on this band's right-hand status is gone
        with the rest of the maroon-as-surface; the status is now a terracotta
        label, which is 7.11:1 rather than 4.52:1 at this size.
      */}
      <div className="border-b border-border bg-surface-container-low">
        <div className="container flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-3">
          <p className="flex items-center gap-3">
            <Eyebrow
              variant={open ? 'solid' : 'tinted'}
              className={open ? undefined : 'bg-surface-container text-muted-foreground'}
            >
              {open ? 'Admissions open' : 'Admissions closed'}
            </Eyebrow>
            <span className="text-sm font-medium text-foreground">
              {open
                ? 'Enquiries for the 2026/27 academic year are being taken now'
                : 'Ask the office about the next intake'}
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

      {/* ------------------------------------------------------------------
          Hero.

          The visual panel used to be a maroon gradient (`from-primary via-
          primary-dark to-wine`) with white text on it. That was the largest
          maroon surface on the site and the reason the page read maroon. It is
          now a smoke-white volume with four stacked planes — see
          `components/hero-field.tsx`.
          ------------------------------------------------------------------ */}
      <section className="border-b border-border bg-gradient-to-b from-tint-warm to-background">
        <div className="container pt-28 pb-16 lg:pt-36 lg:pb-24">
          <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-16">
            <div className="flex flex-col gap-7 lg:col-span-7">
              <Eyebrow>Montessori school · Ayeduase, Kumasi</Eyebrow>

              <h1 className="type-display max-w-[16ch]">{splitHeadline(heroTitle)}</h1>

              <p className="max-w-[58ch] text-lg leading-relaxed text-muted-foreground">
                {heroSubtitle}
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <ArrowLink href="/contact" size="lg" className="group">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  Book a campus visit
                </ArrowLink>
                {/*
                  The secondary branches on `open`. It was previously an
                  unconditional link to /admissions, so the hero could offer an
                  application while the band above it said admissions were
                  closed — the header still has that defect; see
                  docs/technical/2026-10-04_222000-public-site-ui-refinement.md
                  §7.2.
                */}
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
                    <point.icon className="h-4 w-4 text-accent-warm-dark" aria-hidden="true" />
                    {point.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-5">
              {/*
                The stage. `hero-stage` sets the perspective; the planes inside
                read `--px` / `--py`, which `HeroParallax` writes. With no
                JavaScript, or with reduced motion requested, those custom
                properties are never written and every plane sits at its default —
                so the static composition is complete on its own.
              */}
              <div
                id={STAGE_ID}
                className="hero-stage relative isolate overflow-hidden rounded-lg border border-border bg-surface-container-low shadow-floating"
              >
                <HeroField />

                {/*
                  The panel's content sits above the planes, inside the same
                  rounded frame so the grain does not spill past the corners.
                  `isolate` on the stage plus this stacking context keeps the
                  text above every plane.
                */}
                <div className="relative flex min-h-[24rem] flex-col justify-end p-7 lg:min-h-[28rem] lg:p-8">
                  <div className="rounded-md bg-surface-container-lowest/80 p-5 shadow-raised backdrop-blur-[2px]">
                    <Eyebrow className="mb-2">The work cycle</Eyebrow>
                    <p className="type-title text-foreground">
                      Three uninterrupted hours, no bells
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Long stretches of self-directed work at the shelf beside the
                      material, returned in condition.
                    </p>
                  </div>
                </div>

                {/*
                  `left-0 sm:-left-4`, not a flat `-left-4`. This chip overhangs the
                  frame deliberately, and the overhang is measured from the frame,
                  whose left edge is the container's padding edge. A flat -1rem
                  would put the chip 4px past the viewport edge on a phone.
                */}
                <div className="absolute -bottom-4 left-0 flex items-center gap-3 rounded-md border border-border bg-surface-container-lowest p-3 shadow-floating sm:-left-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-primary text-primary-foreground">
                    <Users className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block type-eyebrow uppercase text-accent-warm-dark">
                      Guidance ratio
                    </span>
                    <span className="block type-title text-foreground">1:6</span>
                  </span>
                </div>
              </div>

              {/*
                The one action on the panel. A phone number the parent can act on
                at the moment of intent, rather than a decorative panel — there
                was no tappable phone anywhere above the footer before this.

                `size="md"` is the 44px target (`h-11`, measured 44px); the
                previous footer and pillar links were 16-18px tall and failed
                2.5.8. This was the third hand-rolled `<a>` in this file, at 44px /
                14px / `px-1` — the same height as the button that replaced it,
                reached by a different recipe. `variant="quiet"` keeps it a
                text-weight link (no border and no fill at rest) and moves its
                label onto the site's 15px button step.
              */}
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
      </section>

      {/* ------------------------------------------------------------------
          Gateway — three cards.
          ------------------------------------------------------------------ */}
      {gateway.length > 0 && (
        <section className="container -mt-8 pb-20" aria-labelledby="gateway-heading">
          {/*
            Visually hidden because the design gives this band no visible title —
            the three cards are self-explanatory — but the section still needs a
            heading. Without it the document outline runs h1 straight to the
            GatewayCard h3 and heading navigation skips a level.
          */}
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
        {/*
          One column at the narrowest supported width (360px), not two. Two stat
          cards side by side leaves a 156px column, and `getHomeStats()` returns
          `'Crèche–JHS'` — one token with no break opportunity — which pushed
          `document.scrollWidth` to 375 and made the home page scroll sideways on
          a phone. The bug was in the grid, not in the font; see
          `components/marketing.tsx`'s `Stat.scale` note.
        */}
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {figures.map((figure) => (
            <Card key={figure.label} className={cn(CARD_PAD, 'flex flex-col items-center justify-center text-center')}>
              <Stat {...figure} className="items-center text-center" />
            </Card>
          ))}
        </div>
      </SectionShell>

      {/* Approach + the four strands, as one block */}
      <section className="container section-y">
        <Card tone="flat" className="overflow-hidden p-0">
          <div className="grid lg:grid-cols-12">
            <div className="flex flex-col justify-between gap-6 border-b border-border bg-surface-container p-8 lg:col-span-5 lg:border-b-0 lg:border-r lg:p-10">
              {/*
                The crest, at a size the mark can actually carry. It is a 34px
                circle-and-triangle lockup with live `<text>` in Georgia/Arial;
                the previous version rendered it at 504px wide, which either
                exposed the fallback face or turned the wordmark into wallpaper.
              */}
              <div className="flex h-40 w-40 items-center justify-center rounded-md border border-border bg-surface-container-lowest p-5 shadow-hairline">
                {/* Plain `<img>`: `next/image` optimizes raster formats, and a
                    local SVG has no raster source to encode, so the loader would
                    return the same file while adding a runtime wrapper and a
                    second request to measure it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo_nms.png"
                  /* Decorative: the wordmark inside the SVG duplicates the school
                     name rendered beside it. */
                  alt=""
                  /* logo_nms.png is 1239x793. This pair must keep that 1.562:1 ratio or
                     the browser reserves the wrong box before the stylesheet
                     loads. */
                  width={124}
                  height={80}
                  className="h-auto w-full"
                />
              </div>
              <div>
                <CardTitle as="h3">{SCHOOL_INFO.name}</CardTitle>
                <p className="mt-2 type-eyebrow uppercase text-accent-warm-dark">
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
                We do not simply deliver lessons. We prepare an environment in
                which a child can teach themselves through dignified inquiry.
              </SectionTitle>
              <div className="flex flex-col gap-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
                <p>{SCHOOL_INFO.description}</p>
                <p>
                  The work cycle is uninterrupted. A child chooses a material,
                  takes it to a mat or table, works there, and returns it in
                  condition. There are no bells, and no child waiting to be told
                  what to do next.
                </p>
              <p>
                  Founded in 2016 in Ayeduase, Kumasi, Novastar brings together the
                  Montessori prepared environment with Ghana Education Service
                  standards. Our mixed-age classrooms — Crèche through Junior High —
                  let a six-year-old read to a three-year-old, and a twelve-year-old
                  model problem-solving for a seven-year-old. From the first
                  Practical Life lesson to the Cosmic curriculum, the same campus and
                  the same methods carry every child forward.{' '}
                  <Link href="/academics">Explore our full curriculum</Link>, or
                  learn about our{' '}
                  <Link href="/preschool">preschool</Link> and{' '}
                  <Link href="/primary-school">primary programmes</Link>.
                </p>
              </div>

              {/*
                The four strands, as a list inside this block.

                They were four separate cards, each with its own link, and all four
                links went to /academics — four competing routes to one
                destination, and the reason that page had nine inbound links. One
                row, one link.
              */}
              <ul className={cn('grid gap-x-6 gap-y-3 sm:grid-cols-2', CARD_RULE)}>
                {PILLARS.map((pillar, i) => (
                  <li key={pillar.title} className="flex items-start gap-3">
                    <span className="mt-0.5 font-heading text-sm text-accent-warm-dark">
                      {['I', 'II', 'III', 'IV'][i]}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {pillar.title}
                    </span>
                  </li>
                ))}
              </ul>

              <div className={cn('flex flex-wrap items-center justify-between gap-4', CARD_RULE)}>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Award className="h-4 w-4 text-primary" aria-hidden="true" />
                  Aligned to Ghana Education Service and NaCCA standards
                </p>
                <LinkRow href="/academics">
                  See how the curriculum is sequenced
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </LinkRow>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Programmes — restored from the committed page */}
      {/*
        Guarded on length: `getAcademicPrograms` returns an empty array when no
        database is configured, and a heading above nothing reads as a bug. The
        static ladder that would replace this guard is listed in the plan at §7.6;
        it is a content decision, not a design one, so it is not done here.
      */}
      {programs.length > 0 && (
        <SectionShell tone="band">
          <SectionHeading
            eyebrow="Programmes"
            title="One school, from first steps to final exams"
            lede="A child moves through the same campus from Crèche to Junior High."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {programs.map((program) => (
              <ProgramCard key={program.id} program={program} />
            ))}
          </div>
        </SectionShell>
      )}

      {/*
        Placeholder photography, ahead of the campus section so the page has one
        image-led moment above the fold-adjacent map. See
        `lib/placeholder-images.ts` — openly-licensed, credited, and to be
        replaced with our own rooms.
      */}
      <SectionShell tone="canvas">
        <Photo id="outdoors" ratio="aspect-[3/2]" className="mx-auto max-w-4xl" />
      </SectionShell>

      {/* Campus */}
      <SectionShell tone="canvas">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-5">
            <Eyebrow>Campus</Eyebrow>
            <SectionTitle>{SCHOOL_INFO.location}</SectionTitle>
            <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
              Our campus is in Ayeduase, Kumasi, on Ayeduase Road near the K-5
              Junction traffic light. The low, naturally lit buildings sit on a
              quiet street, with classrooms that open onto outdoor space for
              movement and practical work. We are open Monday to Friday, 7:00 AM
              to 4:00 PM.{' '}
              <Link href="/about">Read our story</Link>.
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
            {/*
              The phone in the campus card was plain text. It is the moment of
              intent for a parent comparing schools, so it is a `tel:` link.

              It was then a hand-rolled `<a>` sitting beside a `MarketingButton`,
              and the pair did not match: measured 44px / 14px / `px-3` against
              44px / 15px / `px-5`. Same height, different type step and different
              padding. Both are `size="md"` now, and `quiet` puts the phone below
              the outlined map button in weight rather than beside it in size.
              `size="md"` is stated rather than inherited so that changing the
              component's default cannot silently desynchronise the pair.
            */}
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

          {/*
            `rounded-md` rather than `rounded-2xl`. An image frame at 28px corners
            reads as a bubble; the frame's job is to hold a rectangle.
          */}
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
      {/*
        Guarded for the same reason as the programme list. Note that
        `getTestimonials` returns `[]` unconditionally today, so this section can
        never render at any build; see the plan at §7.6.
      */}
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
        {/*
          Was `bg-primary` — a full-bleed maroon panel, the second of two on the
          page. Maroon survives as the *action*; as a 100%-width surface it was
          one of the reasons the site read maroon. This is now a bordered card on
          the canvas, with the terracotta pill as the only chroma in the band.
        */}
        <Card tone="flat" className="relative overflow-hidden p-8 lg:p-14">
          <div
            className="pointer-events-none absolute inset-0 grain opacity-[0.035]"
            aria-hidden="true"
          />
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
            {/*
              Three actions, one size.

              The group previously stacked a 52px / 16px `ArrowLink`, a 52px /
              16px `MarketingButton`, and a hand-rolled `<a>` at 44px / 14px —
              measured at 360, 768, 1280 and 1440px, where the 44px control was
              8px shorter than both neighbours and a whole type step smaller. All
              three are `size="lg"` now, so the column is three equal bars.

              `lg` and not `md`: the hero's two CTAs are already `lg` and measured
              52px at every width, and this band is the page's last ask. Dropping
              the closer to `md` would make the page's final action quieter than
              its opening one.

              `variant="quiet"` is what lets three controls share a height without
              reading as three competing buttons: fill, then border, then text.

              The third label is a verb rather than the address because
              `MarketingButton` carries `whitespace-nowrap`. The address renders
              285.69px at 16px/600, so the control would need 285.69 + 16 (icon)
              + 8 (gap) + 56 (`px-7`) = 365.69px, against a 297.98px column at
              360px and a 346px column at 1280px and 1440px — 67.71px and 19.69px
              over. It was also the widest thing in this grid: as one unbreakable
              token it had been setting the track to its own 297.98px, 35.98px
              past the card's 262px content box, which is what dragged all three
              controls past the card's border. The address is still a `mailto:`
              link in the footer of every page and on /contact.

              Alignment: all three carry `justify-start`. `ArrowLink` is
              `justify-between` (label at the start, arrow at the end) and the
              icon buttons are `justify-start`, so every control anchors to the
              left edge of the column. Under `justify-center` the WhatsApp and
              email icons sat mid-button on a `w-full` control — the same
              "neither end nor beginning" defect the ArrowLink had, and on a
              narrow card the gap to the border was invisible.
            */}
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
 *
 * A single-sentence title returns unchanged: an empty `<em>` would still be an
 * element in the accessibility tree and would read as a stray pause.
 *
 * The emphasis is `--color-primary-dark`, not terracotta. Terracotta on the hero
 * tint measured 4.48:1 at display size; the maroon measures 8.70:1, and the
 * italic beat still separates because the face does.
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

/*
 * Where each gateway card points, keyed by the feature title `getFeatures`
 * returns. An unmatched feature falls back to /academics; the previous version
 * also fell back to a *colour*, which meant a renamed feature silently produced
 * two cards of the same fill.
 */
const GATEWAY_TARGETS: Record<string, string> = {
  'Montessori Method': '/academics',
  'GES Curriculum': '/academics',
  'Prepared Environment': '/admissions',
}

/**
 * Gateway card fills, by POSITION rather than by title.
 *
 * The previous map keyed on the CMS title, so one renamed feature collapsed two
 * cards onto the same maroon and the "three deliberately different lightnesses"
 * the comment claimed was gone. Position cannot drift when content changes.
 *
 * These are the three darkest-to-lightest steps of the brand, all of which clear
 * 4.5:1 with white text: 13.66:1, 10.66:1 and 7.49:1.
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

/**
 * One of the three gateway cards.
 *
 * The heading is explicitly `text-primary-foreground`. It was not before, and
 * that was a live WCAG failure: `@layer base` sets every `h1..h6` to
 * `--color-primary-dark` (#772836), so these three headings rendered maroon on
 * maroon, on navy and on terracotta — measured 1.39:1, 1.31:1 and 1.93:1
 * against a 4.5:1 requirement. The file's own comments measured the card *body*
 * at 7.49 / 13.66 / 5.09 and concluded the band was fine; nobody measured the
 * heading, which is the larger text.
 *
 * The cards are separated by a grid gap rather than flush, so the offset focus
 * outline lands on the page background instead of on a neighbouring fill.
 */
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
        {/*
          Full-opacity `--color-primary-foreground`, not `/85`. At 85% the
          lighter card fell under 4.5:1 at 14px. Hierarchy comes from the size
          difference against the body, not from lowering the body's opacity.
        */}
        <CardTitle className="text-primary-foreground">{title}</CardTitle>
        <p className="mt-2.5 text-sm leading-relaxed">{body}</p>
      </div>
    </Link>
  )
}
