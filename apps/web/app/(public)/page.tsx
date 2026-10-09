import Link from 'next/link'

import {
  ArrowRight,
  Award,
  BookOpen,
  Compass,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sprout,
  Users,
} from 'lucide-react'

import { cn } from '@novastar/shared-ui'
import {
  CARD_PAD,
  Card,
  Eyebrow,
  LinkRow,
  SectionHeading,
  SectionShell,
} from '@/components/marketing'
import {
  MarketingButton,
  whatsappHref,
} from '@/components/marketing-button'
import { AnimatedCounter } from '@/components/animated-counter'

import { ProgrammeHighlight } from '@/components/programme-highlight'
import {
  getAdmissionsStatus,
  getBranding,
  getCTAContent,
  getHeroContent,
  getTestimonials,
} from '@/lib/data'
import { SCHOOL_INFO, generateHomeMetadata } from '@/lib/metadata'

export const metadata = generateHomeMetadata()

export default async function HomePage() {
  const [branding, hero, testimonials, cta, admissions] =
    await Promise.all([
      getBranding(),
      getHeroContent(),
      getTestimonials(),
      getCTAContent('home'),
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
        <div className="container flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-1.5">
          <p className="flex items-center gap-3">
            <Eyebrow
              variant={open ? 'solid' : 'tinted'}
              className={open ? undefined : 'bg-surface-container text-muted-foreground'}
            >
              {open ? 'Admissions open' : 'Admissions closed'}
            </Eyebrow>
            <span className="type-label text-muted-foreground">
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

      {/* Full-Bleed Animated Hero */}
      <section className="relative w-full h-[85vh] min-h-[600px] overflow-hidden flex items-end">
        <div className="absolute inset-0 z-0">
          <img
            src="/images/photo_3_2026-10-05_11-06-55%20for%20primary%20school.jpg"
            alt="Novastar Students"
            className="h-full w-full object-cover object-center animate-ken-burns"
          />
          {/* Dark gradient overlay only at bottom for text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/30 to-transparent pointer-events-none" />
        </div>

        <div className="container relative z-10 mx-auto px-4 text-center pt-20 pb-24 md:pb-32">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-foreground/10 bg-background/80 backdrop-blur-md text-xs font-bold tracking-widest uppercase mb-6 animate-reveal-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
            <Sprout className="h-4 w-4 text-primary" /> Montessori school · Ayeduase, Kumasi
          </div>
          <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl max-w-4xl mx-auto leading-[1.1] text-foreground animate-reveal-up opacity-0" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}>
            {splitHeadline(heroTitle)}
          </h1>
          <p className="max-w-2xl mx-auto mt-6 text-lg md:text-xl font-light text-muted-foreground animate-reveal-up opacity-0" style={{ animationDelay: '0.5s', animationFillMode: 'forwards' }}>
            {heroSubtitle}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-10 animate-reveal-up opacity-0" style={{ animationDelay: '0.7s', animationFillMode: 'forwards' }}>
            <MarketingButton href="/contact" size="lg" className="bg-primary text-primary-foreground hover:bg-primary-hover text-[11px] font-bold tracking-[0.25em] uppercase transition">
              Book a campus visit
            </MarketingButton>
            {open ? (
              <MarketingButton href="/admissions" variant="outline" size="lg" className="border border-primary/30 bg-transparent text-[11px] font-bold tracking-[0.25em] text-primary uppercase transition hover:bg-primary hover:text-primary-foreground">
                Apply for admission
              </MarketingButton>
            ) : (
              <MarketingButton href={whatsapp} variant="outline" size="lg" external className="border border-primary/30 bg-transparent text-[11px] font-bold tracking-[0.25em] text-primary uppercase transition hover:bg-primary hover:text-primary-foreground">
                <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                Message us on WhatsApp
              </MarketingButton>
            )}
          </div>
        </div>
      </section>

{/* Quick Action Icons */}
      <section className="relative z-20 -mt-16 container mx-auto px-4 lg:px-8 max-w-5xl mb-20">
        <div className="bg-surface-container-low rounded-xl shadow-floating border border-border/50 p-6 md:p-8 flex flex-wrap sm:flex-nowrap justify-evenly gap-6 animate-reveal-up opacity-0" style={{ animationDelay: '0.9s', animationFillMode: 'forwards' }}>
           <Link href="/admissions" className="group flex flex-col items-center text-center w-full sm:w-auto">
             <div className="w-16 h-16 rounded-full bg-tint-warm flex items-center justify-center text-primary group-hover:-translate-y-1 group-hover:shadow-raised transition-all duration-300 mb-4">
               <Award className="h-7 w-7" />
             </div>
             <h3 className="font-serif text-lg font-medium text-foreground group-hover:text-primary transition-colors">Apply Now</h3>
             <p className="hidden md:block text-sm text-muted-foreground mt-1">Start your journey</p>
           </Link>
           <Link href="/events" className="group flex flex-col items-center text-center w-full sm:w-auto">
             <div className="w-16 h-16 rounded-full bg-tint-warm flex items-center justify-center text-primary group-hover:-translate-y-1 group-hover:shadow-raised transition-all duration-300 mb-4">
               <Compass className="h-7 w-7" />
             </div>
             <h3 className="font-serif text-lg font-medium text-foreground group-hover:text-primary transition-colors">Calendar</h3>
             <p className="hidden md:block text-sm text-muted-foreground mt-1">Important dates</p>
           </Link>
           <Link href="/fees" className="group flex flex-col items-center text-center w-full sm:w-auto">
             <div className="w-16 h-16 rounded-full bg-tint-warm flex items-center justify-center text-primary group-hover:-translate-y-1 group-hover:shadow-raised transition-all duration-300 mb-4">
               <BookOpen className="h-7 w-7" />
             </div>
             <h3 className="font-serif text-lg font-medium text-foreground group-hover:text-primary transition-colors">Tuition & Fees</h3>
             <p className="hidden md:block text-sm text-muted-foreground mt-1">View schedules</p>
           </Link>
           <Link href="/portal/login" className="group flex flex-col items-center text-center w-full sm:w-auto">
             <div className="w-16 h-16 rounded-full bg-tint-warm flex items-center justify-center text-primary group-hover:-translate-y-1 group-hover:shadow-raised transition-all duration-300 mb-4">
               <Users className="h-7 w-7" />
             </div>
             <h3 className="font-serif text-lg font-medium text-foreground group-hover:text-primary transition-colors">Parent Portal</h3>
             <p className="hidden md:block text-sm text-muted-foreground mt-1">Access resources</p>
           </Link>
        </div>
      </section>

      {/* Novastar By The Numbers */}
      <section className="container py-16">
        <div className="bg-background rounded-xl p-8 md:p-12 lg:p-16 text-center shadow-floating relative overflow-hidden border border-border">
          <div className="pointer-events-none absolute inset-0 opacity-[0.02] grain" aria-hidden="true" />
          <div className="relative z-10 max-w-4xl mx-auto">
            <h2 className="font-serif text-3xl md:text-5xl mb-12 text-primary-dark">Novastar by the numbers</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 divide-y md:divide-y-0 md:divide-x divide-border">
              <div className="flex flex-col items-center pt-8 md:pt-0">
                <div className="text-5xl md:text-6xl font-bold font-serif mb-2 text-primary-dark">
                  <AnimatedCounter value={10} suffix="+" />
                </div>
                <div className="text-accent-warm-dark uppercase tracking-widest text-xs font-bold mt-2">Years of Excellence</div>
                <p className="text-muted-foreground mt-3 text-sm max-w-[250px] leading-relaxed">Serving the Kumasi community with authentic Montessori education.</p>
              </div>
              <div className="flex flex-col items-center pt-8 md:pt-0">
                <div className="text-5xl md:text-6xl font-bold font-serif mb-2 text-primary-dark">
                  <span className="tabular-nums">1:6</span>
                </div>
                <div className="text-accent-warm-dark uppercase tracking-widest text-xs font-bold mt-2">Guidance Ratio</div>
                <p className="text-muted-foreground mt-3 text-sm max-w-[250px] leading-relaxed">Highly personalized attention ensures every child learns at their own pace.</p>
              </div>
              <div className="flex flex-col items-center pt-8 md:pt-0">
                <div className="text-5xl md:text-6xl font-bold font-serif mb-2 text-primary-dark">
                  <AnimatedCounter value={100} suffix="%" />
                </div>
                <div className="text-accent-warm-dark uppercase tracking-widest text-xs font-bold mt-2">GES Aligned</div>
                <p className="text-muted-foreground mt-3 text-sm max-w-[250px] leading-relaxed">Fully integrated with the Ghana Education Service national standards.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Figures */}
      <SectionShell tone="canvas">
        <SectionHeading
          align="center"
          eyebrow="The Novastar Difference"
          title="Education that respects the child"
        />
        <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-3">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2 shadow-floating transition-transform hover:scale-110">
              <Users className="h-7 w-7" />
            </div>
            <h3 className="font-serif text-2xl text-primary">Mixed-Age Classrooms</h3>
            <p className="text-foreground/80 leading-relaxed text-[0.9375rem]">
              Younger children learn by observing older peers, while older children build confidence and reinforce their knowledge by mentoring.
            </p>
          </div>
          <div className="flex flex-col items-center text-center gap-4">
            <div className="h-16 w-16 rounded-full bg-accent-warm/20 text-accent-warm-dark flex items-center justify-center mb-2 shadow-floating transition-transform hover:scale-110">
              <Compass className="h-7 w-7" />
            </div>
            <h3 className="font-serif text-2xl text-primary">Self-Directed Learning</h3>
            <p className="text-foreground/80 leading-relaxed text-[0.9375rem]">
              Uninterrupted work cycles allow children to follow their intellectual curiosity deeply, building true academic stamina.
            </p>
          </div>
          <div className="flex flex-col items-center text-center gap-4">
            <div className="h-16 w-16 rounded-full bg-secondary/10 text-secondary-dark flex items-center justify-center mb-2 shadow-floating transition-transform hover:scale-110">
              <Award className="h-7 w-7" />
            </div>
            <h3 className="font-serif text-2xl text-primary">GES Aligned</h3>
            <p className="text-foreground/80 leading-relaxed text-[0.9375rem]">
              A pure, authentic Montessori foundation that seamlessly integrates with the standards and rigor required for the BECE.
            </p>
          </div>
        </div>
      </SectionShell>

      {/* Our Programmes Quick Links */}
      <SectionShell tone="canvas" className="pt-0 pb-12">
        <div className="grid gap-6 md:grid-cols-2">
          <ProgrammeHighlight
            title="Preschool"
            description="From six months to five years, the absorbent mind forms itself through touch, sound, and movement in a prepared environment."
            href="/preschool"
            imageSrc="/images/photo_4_2026-10-05_11-06-55%20for%20preschool.jpg"
            imageAlt="Preschool classroom"
          />
          <ProgrammeHighlight
            title="Primary School"
            description="For children aged 6 to 11, the reasoning mind explores the Great Lessons, building research skills and academic stamina."
            href="/primary-school"
            imageSrc="/images/photo_2_2026-10-05_11-06-55%20for%20primary%20school.jpg"
            imageAlt="Primary school classroom"
          />
        </div>
      </SectionShell>

      {/* Approach Card (Refined to be more elegant) */}
      <section className="container section-y">
        <Card tone="flat" className="overflow-hidden p-0 border-0 bg-transparent shadow-none">
          <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16 items-center">
            
            {/* Image / Branding Side */}
            <div className="flex flex-col gap-6 lg:order-2">
               <div className="aspect-[4/3] w-full overflow-hidden rounded-sm bg-surface-container-low shadow-floating relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src="/images/photo_4_2026-10-05_11-06-55%20for%20preschool.jpg" 
                    alt="Montessori Approach" 
                    className="h-full w-full object-cover transition-transform duration-[2s] group-hover:scale-105" 
                  />
                  <div className="absolute inset-0 border border-black/10 rounded-sm"></div>
               </div>
               <div className="flex items-center gap-4 bg-surface-container-low p-4 rounded-sm border border-border">
                 <div className="flex h-16 w-16 items-center justify-center rounded-sm bg-white p-2 shadow-hairline">
                   {/* eslint-disable-next-line @next/next/no-img-element */}
                   <img src="/logo_nms.png" alt="" className="h-auto w-full object-contain" />
                 </div>
                 <div>
                    <h3 className="font-serif text-xl text-primary font-medium">{SCHOOL_INFO.name}</h3>
                    <p className="type-eyebrow uppercase text-accent-warm-dark mt-1">
                      {SCHOOL_INFO.motto}
                    </p>
                 </div>
               </div>
            </div>

            {/* Content Side */}
            <div className="flex flex-col gap-6 lg:order-1">
              <div className="text-primary/60 text-[11px] font-bold tracking-[0.3em] uppercase">
                — Our Approach
              </div>
              <h2 className="text-primary max-w-2xl font-serif text-3xl leading-[1.2] font-medium sm:text-4xl">
                We do not simply deliver lessons. We prepare an environment in
                which a child can teach themselves through dignified inquiry.
              </h2>
              
              <div className="flex flex-col gap-5 text-lg leading-relaxed text-foreground/85">
                <p className="first-letter:text-primary first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-6xl first-letter:leading-[0.8] first-letter:font-medium">
                  {SCHOOL_INFO.description}
                </p>
                <p>
                  Founded in 2016 in Ayeduase, Kumasi, Novastar brings together the
                  Montessori prepared environment with Ghana Education Service
                  standards. Our mixed-age classrooms let a six-year-old read to a 
                  three-year-old, and a twelve-year-old model problem-solving for a seven-year-old. 
                </p>
                <p className="border-l-2 border-primary/30 pl-5 my-2 italic text-muted-foreground text-base">
                  From Crèche to Junior High, our <LinkRow href="/preschool" className="inline-flex min-h-0 items-baseline p-0 m-0 decoration-primary hover:decoration-primary/80 font-normal">preschool</LinkRow> lays 
                  the foundation with uninterrupted work cycles, and our <LinkRow href="/primary-school" className="inline-flex min-h-0 items-baseline p-0 m-0 decoration-primary hover:decoration-primary/80 font-normal">primary school</LinkRow> carries 
                  that stamina forward into the Great Lessons and BECE preparation.
                </p>
              </div>

              <div className={cn('flex flex-wrap items-center justify-between gap-4 mt-6 pt-6 border-t border-border/50')}>
                <p className="flex items-center gap-2 text-sm font-serif italic text-muted-foreground">
                  <Award className="h-4 w-4 text-accent-warm-dark" aria-hidden="true" />
                  Aligned to GES and NaCCA standards
                </p>
                <LinkRow href="/academics" className="font-serif italic text-base">
                  Explore our full curriculum
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </LinkRow>
              </div>
            </div>
          </div>
        </Card>
      </section>
      {/* Campus — lean version, map lives on /contact */}
      <section className="container section-y">
        <div className="mx-auto max-w-3xl text-center flex flex-col items-center gap-6">
          <div className="text-primary/60 text-[11px] font-bold tracking-[0.3em] uppercase">
            — Our Campus
          </div>
          <h2 className="text-primary font-serif text-3xl leading-[1.2] font-medium sm:text-4xl">
            {SCHOOL_INFO.location}
          </h2>
          <p className="text-lg leading-relaxed text-foreground/85">
            Our campus is in Ayeduase, Kumasi, on Ayeduase Road near the K-5
            Junction traffic light. The low, naturally lit buildings sit on a
            quiet street, with classrooms that open onto outdoor space for
            movement and practical work.
          </p>

          <div className="flex flex-wrap justify-center items-center gap-3 pt-4">
            <MarketingButton href="/contact" className="bg-primary text-white hover:bg-primary-hover text-[11px] font-bold tracking-[0.25em] uppercase h-12 px-8">
              Visit & directions
            </MarketingButton>
            <MarketingButton
              href={`tel:${SCHOOL_INFO.phone.replace(/[^\d+]/g, '')}`}
              variant="outline"
              external
              className="border-primary/20 text-primary text-[11px] font-bold tracking-[0.25em] uppercase h-12 px-8 hover:bg-primary hover:text-white"
            >
              <Phone className="h-4 w-4 mr-2" aria-hidden="true" />
              Call the office
            </MarketingButton>
          </div>
        </div>
      </section>

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
          Was a full-bleed maroon panel. Now a bordered card on the canvas with
          primary accent border and primary buttons — the maroon survives as the
          *action color* not a surface fill.
        */}
        <Card tone="flat" className="relative overflow-hidden p-8 lg:p-14 bg-background text-foreground border-primary shadow-floating">
          <div
            className="pointer-events-none absolute inset-0 grain opacity-[0.035]"
            aria-hidden="true"
          />
          <div className="relative grid items-center gap-8 lg:grid-cols-12">
            <div className="flex flex-col gap-4 lg:col-span-8">
              <div className="text-primary/80 text-[11px] font-bold tracking-[0.3em] uppercase">
                {open ? 'Now enrolling for 2026/2027' : 'Ask about the next intake'}
              </div>
              <h2 className="font-serif text-3xl font-medium text-primary-dark sm:text-4xl">{ctaTitle}</h2>
              <p className="max-w-[58ch] text-[1.0625rem] leading-relaxed text-muted-foreground">
                {ctaSubtitle}
              </p>
            </div>
            {/*
              Three actions, one size.
            */}
            <div className="flex flex-col gap-3 lg:col-span-4">
              <MarketingButton href="/admissions" className="bg-primary text-primary-foreground hover:bg-primary-hover text-[11px] font-bold tracking-[0.25em] uppercase w-full justify-start h-12">
                {ctaButton}
              </MarketingButton>
              <MarketingButton href={whatsapp} variant="outline" external className="bg-transparent border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground text-[11px] font-bold tracking-[0.25em] uppercase w-full justify-start h-12">
                <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                Message us on WhatsApp
              </MarketingButton>
              <MarketingButton
                href={`mailto:${SCHOOL_INFO.email}`}
                variant="quiet"
                external
                className="text-primary hover:bg-primary/10 text-[11px] font-bold tracking-[0.25em] uppercase w-full justify-start h-12"
              >
                <Mail className="h-4 w-4 mr-2" aria-hidden="true" />
                Email the office
              </MarketingButton>
            </div>
          </div>
        </Card>
      </SectionShell>
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

