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
      <div className="bg-surface-container-low border-b border-border">
        <div className="container flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-1.5">
          <p className="flex items-center gap-3">
            <Eyebrow
              variant={open ? 'solid' : 'tinted'}
              className={open ? undefined : "text-muted-foreground bg-surface-container"}
            >
              {open ? 'Admissions open' : 'Admissions closed'}
            </Eyebrow>
            <span className="text-muted-foreground type-label">
              {open
                ? 'Enquiries for the 2026/27 academic year are being taken now'
                : 'Ask the office about the next intake'}
            </span>
          </p>
          <p className="flex items-center gap-5 text-muted-foreground text-sm">
            <span className="items-center gap-1.5 inline-flex">
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
      <section className="flex relative items-end h-[85vh] min-h-150 w-full overflow-hidden">
        <div className="absolute inset-0 z-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/photo_3_2026-10-05_11-06-55%20for%20primary%20school.jpg"
            alt="Novastar Students"
            className="h-full w-full animate-ken-burns object-center object-cover"
            loading="eager"
          />
          {/* Dark gradient overlay only at bottom for text readability */}
          <div className="absolute bg-linear-to-t from-background/95 inset-0 pointer-events-none to-transparent via-background/30" />
        </div>

        <div className="container relative mx-auto pb-24 pt-20 px-4 md:pb-32 text-center z-10">
          <div className="items-center gap-2 mb-6 px-3 py-1 font-bold text-xs tracking-widest bg-background/80 border border-foreground/10 rounded-full opacity-0 animate-reveal-up backdrop-blur-md inline-flex uppercase" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
            <Sprout className="h-4 w-4 text-primary" /> Montessori school · Ayeduase, Kumasi
          </div>
          <h1 className="max-w-4xl mx-auto font-serif leading-[1.1] text-5xl text-foreground lg:text-8xl md:text-7xl opacity-0 animate-reveal-up" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}>
            {splitHeadline(heroTitle)}
          </h1>
          <p className="max-w-2xl mt-6 mx-auto font-light text-lg text-muted-foreground md:text-xl opacity-0 animate-reveal-up" style={{ animationDelay: '0.5s', animationFillMode: 'forwards' }}>
            {heroSubtitle}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-10 opacity-0 animate-reveal-up" style={{ animationDelay: '0.7s', animationFillMode: 'forwards' }}>
            <MarketingButton href="/contact" size="lg" className="font-bold text-[11px] text-primary-foreground tracking-[0.25em] bg-primary hover:bg-primary-hover transition uppercase">
              Book a campus visit
            </MarketingButton>
            {open ? (
              <MarketingButton href="/admissions" variant="outline" size="lg" className="font-bold text-[11px] text-primary tracking-[0.25em] hover:text-primary-foreground bg-transparent border border-primary/30 hover:bg-primary transition uppercase">
                Apply for admission
              </MarketingButton>
            ) : (
              <MarketingButton href={whatsapp} variant="outline" size="lg" external className="font-bold text-[11px] text-primary tracking-[0.25em] hover:text-primary-foreground bg-transparent border border-primary/30 hover:bg-primary transition uppercase">
                <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                Message us on WhatsApp
              </MarketingButton>
            )}
          </div>
        </div>
      </section>

{/* Quick Action Icons */}
      <section className="container relative max-w-5xl mb-20 mx-auto px-4 lg:px-8 -mt-16 z-20">
        <div className="flex flex-wrap sm:flex-nowrap justify-evenly gap-6 p-6 md:p-8 bg-surface-container-low border border-border/50 rounded-xl shadow-floating opacity-0 animate-reveal-up" style={{ animationDelay: '0.9s', animationFillMode: 'forwards' }}>
           <Link href="/admissions" className="flex flex-col items-center w-full sm:w-auto text-center group">
             <div className="flex items-center justify-center h-16 w-16 mb-4 text-primary bg-tint-warm rounded-full group-hover:shadow-raised duration-300 transition-all group-hover:-translate-y-1">
               <Award className="h-7 w-7" />
             </div>
             <h3 className="font-medium font-serif text-foreground text-lg group-hover:text-primary transition-colors">Apply Now</h3>
             <p className="hidden md:block mt-1 text-muted-foreground text-sm">Start your journey</p>
           </Link>
           <Link href="/events" className="flex flex-col items-center w-full sm:w-auto text-center group">
             <div className="flex items-center justify-center h-16 w-16 mb-4 text-primary bg-tint-warm rounded-full group-hover:shadow-raised duration-300 transition-all group-hover:-translate-y-1">
               <Compass className="h-7 w-7" />
             </div>
             <h3 className="font-medium font-serif text-foreground text-lg group-hover:text-primary transition-colors">Calendar</h3>
             <p className="hidden md:block mt-1 text-muted-foreground text-sm">Important dates</p>
           </Link>
           <Link href="/fees" className="flex flex-col items-center w-full sm:w-auto text-center group">
             <div className="flex items-center justify-center h-16 w-16 mb-4 text-primary bg-tint-warm rounded-full group-hover:shadow-raised duration-300 transition-all group-hover:-translate-y-1">
               <BookOpen className="h-7 w-7" />
             </div>
             <h3 className="font-medium font-serif text-foreground text-lg group-hover:text-primary transition-colors">Tuition & Fees</h3>
             <p className="hidden md:block mt-1 text-muted-foreground text-sm">View schedules</p>
           </Link>
           <Link href="/portal/login" className="flex flex-col items-center w-full sm:w-auto text-center group">
             <div className="flex items-center justify-center h-16 w-16 mb-4 text-primary bg-tint-warm rounded-full group-hover:shadow-raised duration-300 transition-all group-hover:-translate-y-1">
               <Users className="h-7 w-7" />
             </div>
             <h3 className="font-medium font-serif text-foreground text-lg group-hover:text-primary transition-colors">Parent Portal</h3>
             <p className="hidden md:block mt-1 text-muted-foreground text-sm">Access resources</p>
           </Link>
        </div>
      </section>

      {/* Novastar By The Numbers */}
      <section className="container py-16">
        <div className="relative p-8 lg:p-16 md:p-12 text-center bg-background border border-border rounded-xl shadow-floating overflow-hidden">
          <div className="absolute opacity-[0.02] grain inset-0 pointer-events-none" aria-hidden="true" />
          <div className="relative max-w-4xl mx-auto z-10">
            <h2 className="mb-12 font-serif text-3xl text-primary-dark md:text-5xl">Novastar by the numbers</h2>
            <div className="grid gap-8 md:gap-12 divide-border divide-y grid-cols-1 md:divide-x md:divide-y-0 md:grid-cols-3">
              <div className="flex flex-col items-center pt-8 md:pt-0">
                <div className="mb-2 font-bold font-serif text-5xl text-primary-dark md:text-6xl">
                  <AnimatedCounter value={10} suffix="+" />
                </div>
                <div className="mt-2 font-bold text-accent-warm-dark text-xs tracking-widest uppercase">Years of Excellence</div>
                <p className="max-w-62.5 mt-3 leading-relaxed text-muted-foreground text-sm">Serving the Kumasi community with authentic Montessori education.</p>
              </div>
              <div className="flex flex-col items-center pt-8 md:pt-0">
                <div className="mb-2 font-bold font-serif text-5xl text-primary-dark md:text-6xl">
                  <span className="tabular-nums">1:6</span>
                </div>
                <div className="mt-2 font-bold text-accent-warm-dark text-xs tracking-widest uppercase">Guidance Ratio</div>
                <p className="max-w-62.5 mt-3 leading-relaxed text-muted-foreground text-sm">Highly personalized attention ensures every child learns at their own pace.</p>
              </div>
              <div className="flex flex-col items-center pt-8 md:pt-0">
                <div className="mb-2 font-bold font-serif text-5xl text-primary-dark md:text-6xl">
                  <AnimatedCounter value={100} suffix="%" />
                </div>
                <div className="mt-2 font-bold text-accent-warm-dark text-xs tracking-widest uppercase">GES Aligned</div>
                <p className="max-w-62.5 mt-3 leading-relaxed text-muted-foreground text-sm">Fully integrated with the Ghana Education Service national standards.</p>
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
        <div className="grid gap-12 mt-16 grid-cols-1 md:grid-cols-3">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex items-center justify-center h-16 w-16 mb-2 text-primary bg-primary/10 rounded-full shadow-floating transition-transform hover:scale-110">
              <Users className="h-7 w-7" />
            </div>
            <h3 className="font-serif text-2xl text-primary">Mixed-Age Classrooms</h3>
            <p className="leading-relaxed text-[0.9375rem] text-foreground/80">
              Younger children learn by observing older peers, while older children build confidence and reinforce their knowledge by mentoring.
            </p>
          </div>
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex items-center justify-center h-16 w-16 mb-2 text-accent-warm-dark bg-accent-warm/20 rounded-full shadow-floating transition-transform hover:scale-110">
              <Compass className="h-7 w-7" />
            </div>
            <h3 className="font-serif text-2xl text-primary">Self-Directed Learning</h3>
            <p className="leading-relaxed text-[0.9375rem] text-foreground/80">
              Uninterrupted work cycles allow children to follow their intellectual curiosity deeply, building true academic stamina.
            </p>
          </div>
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex items-center justify-center h-16 w-16 mb-2 text-secondary-dark bg-secondary/10 rounded-full shadow-floating transition-transform hover:scale-110">
              <Award className="h-7 w-7" />
            </div>
            <h3 className="font-serif text-2xl text-primary">GES Aligned</h3>
            <p className="leading-relaxed text-[0.9375rem] text-foreground/80">
              A pure, authentic Montessori foundation that seamlessly integrates with the standards and rigor required for the BECE.
            </p>
          </div>
        </div>
      </SectionShell>

      {/* Our Programmes Quick Links */}
      <SectionShell tone="canvas" className="pb-12 pt-0">
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
        <Card tone="flat" className="p-0 bg-transparent border-0 shadow-none overflow-hidden">
          <div className="grid items-center gap-12 lg:gap-16 lg:grid-cols-[1.4fr_1fr]">
            
            {/* Image / Branding Side */}
            <div className="flex flex-col gap-6 lg:order-2">
               <div className="relative w-full bg-surface-container-low rounded-sm shadow-floating aspect-4/3 group overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src="/images/photo_4_2026-10-05_11-06-55%20for%20preschool.jpg" 
                    alt="Montessori Approach" 
                    className="h-full w-full duration-[2s] transition-transform object-cover group-hover:scale-105" 
                  />
                  <div className="absolute border border-black/10 rounded-sm inset-0"></div>
               </div>
               <div className="flex items-center gap-4 p-4 bg-surface-container-low border border-border rounded-sm">
                 <div className="flex items-center justify-center h-16 w-16 p-2 bg-white rounded-sm shadow-hairline">
                   {/* eslint-disable-next-line @next/next/no-img-element */}
                   <img src="/logo_nms.png" alt="" className="h-auto w-full object-contain" />
                 </div>
                 <div>
                    <h3 className="font-medium font-serif text-primary text-xl">{SCHOOL_INFO.name}</h3>
                    <p className="mt-1 text-accent-warm-dark type-eyebrow uppercase">
                      {SCHOOL_INFO.motto}
                    </p>
                 </div>
               </div>
            </div>

            {/* Content Side */}
            <div className="flex flex-col gap-6 lg:order-1">
              <div className="font-bold text-[11px] text-primary/60 tracking-[0.3em] uppercase">
                — Our Approach
              </div>
              <h2 className="max-w-2xl font-medium font-serif leading-[1.2] text-3xl text-primary sm:text-4xl">
                We do not simply deliver lessons. We prepare an environment in
                which a child can teach themselves through dignified inquiry.
              </h2>
              
              <div className="flex flex-col gap-5 leading-relaxed text-foreground/85 text-lg">
                <p className="first-letter:mr-2 first-letter:font-medium first-letter:font-serif first-letter:leading-[0.8] first-letter:text-6xl first-letter:text-primary first-letter:float-left">
                  {SCHOOL_INFO.description}
                </p>
                <p>
                  Founded in 2016 in Ayeduase, Kumasi, Novastar brings together the
                  Montessori prepared environment with Ghana Education Service
                  standards. Our mixed-age classrooms let a six-year-old read to a 
                  three-year-old, and a twelve-year-old model problem-solving for a seven-year-old. 
                </p>
                <p className="my-2 pl-5 text-base text-muted-foreground border-l-2 border-primary/30 italic">
                  From Crèche to Junior High, our <LinkRow href="/preschool" className="items-baseline min-h-0 m-0 p-0 font-normal decoration-primary inline-flex hover:decoration-primary/80">preschool</LinkRow> lays 
                  the foundation with uninterrupted work cycles, and our <LinkRow href="/primary-school" className="items-baseline min-h-0 m-0 p-0 font-normal decoration-primary inline-flex hover:decoration-primary/80">primary school</LinkRow> carries 
                  that stamina forward into the Great Lessons and BECE preparation.
                </p>
              </div>

              <div className={cn("flex flex-wrap items-center justify-between gap-4 mt-6 pt-6 border-border/50 border-t")}>
                <p className="flex items-center gap-2 font-serif text-muted-foreground text-sm italic">
                  <Award className="h-4 w-4 text-accent-warm-dark" aria-hidden="true" />
                  Aligned to GES and NaCCA standards
                </p>
                <LinkRow href="/academics" className="font-serif text-base italic">
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
        <div className="flex flex-col items-center max-w-3xl gap-6 mx-auto text-center">
          <div className="font-bold text-[11px] text-primary/60 tracking-[0.3em] uppercase">
            — Our Campus
          </div>
          <h2 className="font-medium font-serif leading-[1.2] text-3xl text-primary sm:text-4xl">
            {SCHOOL_INFO.location}
          </h2>
          <p className="leading-relaxed text-foreground/85 text-lg">
            Our campus is in Ayeduase, Kumasi, on Ayeduase Road near the K-5
            Junction traffic light. The low, naturally lit buildings sit on a
            quiet street, with classrooms that open onto outdoor space for
            movement and practical work.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
            <MarketingButton href="/contact" className="h-12 px-8 font-bold text-[11px] text-white tracking-[0.25em] bg-primary hover:bg-primary-hover uppercase">
              Visit & directions
            </MarketingButton>
            <MarketingButton
              href={`tel:${SCHOOL_INFO.phone.replace(/[^\d+]/g, '')}`}
              variant="outline"
              external
              className="h-12 px-8 font-bold text-[11px] text-primary tracking-[0.25em] hover:text-white border-primary/20 hover:bg-primary uppercase"
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
          <div className="grid gap-5 mt-12 md:grid-cols-3">
            {testimonials.map((testimonial) => (
              <figure
                key={`${testimonial.name}-${testimonial.relation}`}
                className="flex flex-col gap-4"
              >
                <Card interactive className={cn(CARD_PAD, "flex flex-col h-full gap-4")}>
                  <span
                    className="font-heading leading-none text-4xl text-accent-warm-dark"
                    aria-hidden="true"
                  >
                    &ldquo;
                  </span>
                  <blockquote className="leading-relaxed text-muted-foreground flex-1">
                    {testimonial.quote}
                  </blockquote>
                  <figcaption className="mt-auto pt-4 border-border border-t">
                    <span className="block font-semibold text-foreground">
                      {testimonial.name}
                    </span>
                    <span className="text-muted-foreground text-sm">
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
        <Card tone="flat" className="relative p-8 lg:p-14 text-foreground bg-background border-primary shadow-floating overflow-hidden">
          <div
            className="absolute opacity-[0.035] grain inset-0 pointer-events-none"
            aria-hidden="true"
          />
          <div className="grid relative items-center gap-8 lg:grid-cols-12">
            <div className="flex flex-col gap-4 lg:col-span-8">
              <div className="font-bold text-[11px] text-primary/80 tracking-[0.3em] uppercase">
                {open ? 'Now enrolling for 2026/2027' : 'Ask about the next intake'}
              </div>
              <h2 className="font-medium font-serif text-3xl text-primary-dark sm:text-4xl">{ctaTitle}</h2>
              <p className="max-w-[58ch] leading-relaxed text-[1.0625rem] text-muted-foreground">
                {ctaSubtitle}
              </p>
            </div>
            {/*
              Three actions, one size.
            */}
            <div className="flex flex-col gap-3 lg:col-span-4">
              <MarketingButton href="/admissions" className="justify-start h-12 w-full font-bold text-[11px] text-primary-foreground tracking-[0.25em] bg-primary hover:bg-primary-hover uppercase">
                {ctaButton}
              </MarketingButton>
              <MarketingButton href={whatsapp} variant="outline" external className="justify-start h-12 w-full font-bold text-[11px] text-primary tracking-[0.25em] hover:text-primary-foreground bg-transparent border-primary/30 hover:bg-primary uppercase">
                <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                Message us on WhatsApp
              </MarketingButton>
              <MarketingButton
                href={`mailto:${SCHOOL_INFO.email}`}
                variant="quiet"
                external
                className="justify-start h-12 w-full font-bold text-[11px] text-primary tracking-[0.25em] hover:bg-primary/10 uppercase"
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
      {lead} <em className="font-normal text-primary-dark/85 italic">{rest}</em>
    </>
  )
}

