import {
  ShieldCheck,
  Users,
  MessageCircle,
  Baby,
  Puzzle,
  BookOpen,
} from 'lucide-react'

import { cn } from '@novastar/shared-ui'
import {
  CARD_PAD,
  Card,
  CardTitle,
  Eyebrow,
  SectionHeading,
  SectionShell,
  SectionTitle,
  IconTile
} from '@/components/marketing'
import { ArrowLink, MarketingButton, whatsappHref } from '@/components/marketing-button'
import { ImageHero } from '@/components/image-hero'
import { DailyTimeline, type TimelineEvent } from '@/components/daily-timeline'
import { PhotoMosaic } from '@/components/photo-mosaic'
import { CurriculumAccordion, CurriculumFocusList } from '@/components/curriculum-accordion'

import {
  getAdmissionsStatus,
  getBranding,
  getCTAContent,
} from '@/lib/data'
import { SCHOOL_INFO, generatePreschoolMetadata } from '@/lib/metadata'

export const metadata = generatePreschoolMetadata()

const PRESCHOOL_TIMELINE: TimelineEvent[] = [
  { time: '7:00 AM', title: 'Arrival & Free Choice', description: 'Children arrive, greet teachers, and select initial activities.' },
  { time: '7:30 AM', title: 'Morning Work Cycle', description: 'Uninterrupted three-hour block. Children engage in practical life, sensorial, language, and math activities.' },
  { time: '10:30 AM', title: 'Outdoor Play & Snack', description: 'Time for gross motor movement and socialising over healthy snacks.' },
  { time: '11:00 AM', title: 'Group Lesson & Circle Time', description: 'Stories, songs, and communal presentations.' },
  { time: '12:00 PM', title: 'Lunch & Rest', description: 'Children assist in setting the table, followed by quiet rest time.' },
  { time: '1:30 PM', title: 'Afternoon Activities', description: 'Continued exploration with materials, arts, and cultural subjects.' },
  { time: '3:30 PM', title: 'Dismissal Begins', description: 'Closing circle and parent pick-up.' },
]

export default async function PreschoolPage() {
  const [branding, cta, admissions] = await Promise.all([
    getBranding(),
    getCTAContent('preschool'),
    getAdmissionsStatus(),
  ])

  const { open } = admissions
  const schoolName = branding?.name || SCHOOL_INFO.name

  const ctaTitle = cta?.title || 'Ready to join our preschool community?'
  const ctaSubtitle =
    cta?.subtitle ||
    'Give your child the foundation for a lifetime of learning through authentic Montessori education during the absorbent mind years, ages 6 months to 5.'
  const ctaButton = cta?.cta || 'Apply for preschool'

  const whatsapp = whatsappHref(
    SCHOOL_INFO.whatsapp,
    `Hello ${schoolName}, I would like to enquire about preschool admissions for my child.`,
  )

  return (
    <>
      {/* Provenance band */}
      <div className="border-b border-border bg-surface-container-low">
        <div className="container flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-1.5">
          <p className="flex items-center gap-3">
            <Eyebrow variant={open ? 'solid' : 'tinted'} className={open ? undefined : 'bg-surface-container text-muted-foreground'}>
              {open ? 'Admissions open' : 'Admissions closed'}
            </Eyebrow>
            <span className="type-label text-muted-foreground">
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

      {/* Image Hero */}
      <ImageHero
        eyebrow="Preschool · Ages 6 months to 5 years"
        title="Where curiosity begins"
        subtitle="In the first plane of development, everything is absorbed through the senses. We prepare an environment where children can teach themselves through dignified, joyful inquiry."
        imageSrc="/images/photo_1_2026-10-05_11-06-55%20for%20preschool.jpg"
        imageAlt="Children working with materials in our preschool classroom"
        actions={
          <>
            <MarketingButton href="/contact" size="lg" className="bg-white text-[11px] font-bold tracking-[0.25em] text-primary uppercase transition hover:bg-white/90">
              Book a campus visit
            </MarketingButton>
            {open && (
              <MarketingButton href="/admissions" variant="outline" size="lg" className="border border-white/40 bg-transparent text-[11px] font-bold tracking-[0.25em] text-white uppercase transition hover:bg-white hover:text-primary">
                Apply for admission
              </MarketingButton>
            )}
          </>
        }
      />

      {/* Overview: The Absorbent Mind Years */}
      <section className="relative w-full py-32 md:py-40 overflow-hidden section-y mt-0 border-y border-border/40">
        <div className="absolute inset-0 z-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src="/images/photo_4_2026-10-05_11-06-55%20for%20preschool.jpg" 
            alt="Preschool materials" 
            className="object-cover object-center w-full h-full opacity-30 mix-blend-luminosity scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-background/30"></div>
        </div>
        
        <div className="container relative z-10">
          <Card tone="flat" className="overflow-hidden p-8 md:p-12 border-0 bg-surface-container-lowest/80 backdrop-blur-xl shadow-floating max-w-3xl">
            <div className="flex flex-col gap-6">
              <div className="text-primary/80 text-[11px] font-bold tracking-[0.3em] uppercase">
                — The Absorbent Mind Years
              </div>
              <h2 className="text-primary max-w-2xl font-serif text-3xl leading-[1.2] font-medium sm:text-4xl">
                Building the foundation of concentration
              </h2>
              
              <div className="flex flex-col gap-5 text-lg leading-relaxed text-foreground/85">
                <p className="first-letter:text-primary first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-6xl first-letter:leading-[0.8] first-letter:font-medium">
                  From six months to five years, a child's mind forms itself from
                  the environment. They do not merely learn about the world; they absorb it.
                </p>
                <p>
                  Our preschool classrooms are set entirely to the child's scale: low
                  shelves, child-sized furniture, and materials that invite touch,
                  sound, and movement. Through self-directed activity in a carefully prepared
                  environment, children develop coordination, concentration, and independence.
                </p>
                <p className="border-l-2 border-primary/30 pl-5 my-2 italic text-muted-foreground text-base">
                  There are no bells, and no child is forced to wait to be told what to do next. 
                  Instead, they choose a material, take it to a mat, work until satisfied, and 
                  return it in condition.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Age Groups Cards */}
      <SectionShell tone="band">
        <SectionHeading
          align="center"
          title="Growing with your child"
          lede="Classrooms are mixed-age communities where younger children learn from older peers."
        />
        <div className="mt-12 grid sm:grid-cols-3 gap-6">
          <Card tone="flat" interactive className={cn(CARD_PAD, "flex flex-col gap-6 border-transparent transition-all duration-700 hover:shadow-floating hover:-translate-y-1 bg-surface-container-lowest")}>
            <IconTile icon={Baby} tone="primary" />
            <div>
              <CardTitle as="h3" className="font-serif text-2xl">Crèche</CardTitle>
              <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-primary mt-2">6 to 18 months</p>
              <p className="mt-4 text-[0.9375rem] text-muted-foreground leading-relaxed">
                A nurturing environment focused on gross motor development, language acquisition, and trusting relationships.
              </p>
            </div>
          </Card>
          
          <Card tone="flat" interactive className={cn(CARD_PAD, "flex flex-col gap-6 border-transparent transition-all duration-700 hover:shadow-floating hover:-translate-y-1 bg-surface-container-lowest")}>
            <IconTile icon={Puzzle} tone="secondary" />
            <div>
              <CardTitle as="h3" className="font-serif text-2xl">Nursery</CardTitle>
              <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-secondary mt-2">18 months to 3 years</p>
              <p className="mt-4 text-[0.9375rem] text-muted-foreground leading-relaxed">
                Emphasis on practical life skills, potty training, vocabulary building, and fine motor coordination.
              </p>
            </div>
          </Card>

          <Card tone="flat" interactive className={cn(CARD_PAD, "flex flex-col gap-6 border-transparent transition-all duration-700 hover:shadow-floating hover:-translate-y-1 bg-surface-container-lowest")}>
            <IconTile icon={BookOpen} tone="tertiary" />
            <div>
              <CardTitle as="h3" className="font-serif text-2xl">Kindergarten 1 & 2</CardTitle>
              <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-accent-warm-dark mt-2">3 to 5 years</p>
              <p className="mt-4 text-[0.9375rem] text-muted-foreground leading-relaxed">
                Introduction to the full Montessori curriculum including phonetic reading, decimal math, and cultural subjects.
              </p>
            </div>
          </Card>
        </div>
      </SectionShell>

      {/* A Day in Preschool */}
      <SectionShell tone="canvas">
        <SectionHeading
          align="center"
          title="A day in the life"
          lede="A predictable routine provides the security children need to explore freely."
        />
        <div className="mt-16 max-w-4xl mx-auto">
          <DailyTimeline events={PRESCHOOL_TIMELINE} />
        </div>
      </SectionShell>

{/* Curriculum Areas — Visual Curriculum Accordions */}
      <SectionShell tone="band">
        <SectionHeading
          eyebrow="The Curriculum"
          title="Areas of discovery"
          lede="The classroom is divided into distinct areas, each containing materials that progress sequentially from simple to complex, concrete to abstract."
        />
        <div className="mt-8 max-w-4xl">
          <CurriculumAccordion
            items={[
              {
                id: 'practical-life',
                title: 'Practical Life',
                summary: 'Coordination, concentration, independence through daily activities',
                icon: 'LayoutDashboard',
                content: (
                  <CurriculumFocusList
                    items={[
                      {
                        title: 'Care of Self',
                        body: 'Dressing frames, hand washing, food preparation — children master the sequences of daily living.',
                        icon: 'Baby',
                      },
                      {
                        title: 'Care of Environment',
                        body: 'Sweeping, polishing, watering plants, arranging flowers — real responsibility for shared spaces.',
                        icon: 'Globe',
                      },
                      {
                        title: 'Grace & Courtesy',
                        body: 'Turn-taking, quiet movement, table manners, greeting — social confidence through practiced ritual.',
                        icon: 'Users',
                      },
                      {
                        title: 'Control of Movement',
                        body: 'Walking on the line, silence game, carrying materials — body awareness and self-regulation.',
                        icon: 'Brain',
                      },
                    ]}
                  />
                ),
              },
              {
                id: 'sensorial',
                title: 'Sensorial',
                summary: 'Refining the senses — dimension, colour, texture, sound, weight',
                icon: 'Brain',
                content: (
                  <CurriculumFocusList
                    items={[
                      {
                        title: 'Visual Discrimination',
                        body: 'Pink tower, brown stair, red rods, colour boxes — grading by size, hue, and intensity.',
                        icon: 'LayoutDashboard',
                      },
                      {
                        title: 'Tactile & Baric',
                        body: 'Touch boards, fabric boxes, baric tablets — texture, weight, temperature perception.',
                        icon: 'Brain',
                      },
                      {
                        title: 'Auditory & Olfactory',
                        body: 'Sound cylinders, bells, smelling bottles — pitch, volume, scent identification.',
                        icon: 'Music',
                      },
                      {
                        title: 'Stereognostic Sense',
                        body: 'Mystery bag, geometric solids — recognising form through touch alone.',
                        icon: 'Puzzle',
                      },
                    ]}
                  />
                ),
              },
              {
                id: 'language',
                title: 'Language',
                summary: 'From spoken vocabulary to phonetic reading and writing',
                icon: 'BookOpen',
                content: (
                  <CurriculumFocusList
                    items={[
                      {
                        title: 'Oral Language',
                        body: 'Vocabulary enrichment, storytelling, songs, nomenclature — the foundation of all literacy.',
                        icon: 'MessageCircle',
                      },
                      {
                        title: 'Phonetic Awareness',
                        body: 'Sound games, sandpaper letters — analysing spoken words into component sounds.',
                        icon: 'BookOpen',
                      },
                      {
                        title: 'Writing Before Reading',
                        body: 'Movable alphabet, metal insets — composing words before decoding them on paper.',
                        icon: 'Brain',
                      },
                      {
                        title: 'Reading & Grammar',
                        body: 'Phonetic reading, puzzle words, grammar symbols — function of words made visible.',
                        icon: 'BookOpen',
                      },
                    ]}
                  />
                ),
              },
              {
                id: 'mathematics',
                title: 'Mathematics',
                summary: 'Concrete quantity to abstract symbol — the decimal system made tangible',
                icon: 'LayoutDashboard',
                content: (
                  <CurriculumFocusList
                    items={[
                      {
                        title: 'Numbers 1–10',
                        body: 'Number rods, sandpaper numerals, spindle box, cards & counters — quantity and symbol.',
                        icon: 'LayoutDashboard',
                      },
                      {
                        title: 'Decimal System',
                        body: 'Golden beads, number cards, bank game — place value experienced as physical exchange.',
                        icon: 'Brain',
                      },
                      {
                        title: 'Operations',
                        body: 'Collective exercises with golden beads — addition, subtraction, multiplication, division as group work.',
                        icon: 'Users',
                      },
                      {
                        title: 'Geometry & Fractions',
                        body: 'Geometric cabinet, constructive triangles, fraction insets — shape and part-whole relationships.',
                        icon: 'Puzzle',
                      },
                    ]}
                  />
                ),
              },
            ]}
            type="multiple"
            tone="flat"
            divided
          />
          <div className="mt-4 text-center">
            <ArrowLink href="/academics" variant="outline">
              Read full syllabus
            </ArrowLink>
          </div>
        </div>
      </SectionShell>

      {/* Photo Gallery / Media */}
      <SectionShell tone="canvas">
        <SectionHeading
          align="center"
          title="See our classrooms"
          lede="Step inside the prepared environment."
        />
        <div className="mt-12">
          <PhotoMosaic 
            primaryImage="/images/photo_4_2026-10-05_11-06-55%20for%20preschool.jpg"
            primaryAlt="Classroom materials"
            secondaryImage="/images/photo_1_2026-10-05_11-06-55%20for%20preschool.jpg"
            secondaryAlt="Children at work"
            tertiaryImage="/images/photo_3_2026-10-05_11-06-55%20for%20primary%20school.jpg"
            tertiaryAlt="Bright classroom space"
          />
        </div>
      </SectionShell>

      {/* Transition to Primary */}
      <section className="relative w-full py-32 overflow-hidden my-16">
        <div className="absolute inset-0 z-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src="/images/photo_2_2026-10-05_11-06-55%20for%20primary%20school.jpg" 
            alt="Primary students" 
            className="w-full h-full object-cover object-center animate-ken-burns" 
          />
          <div className="absolute inset-0 bg-black/70"></div>
          <div className="absolute inset-0 bg-primary/60"></div>
        </div>
        
        <div className="container relative z-10 flex">
           <div className="flex flex-col gap-6 max-w-2xl">
              <div className="text-white/70 text-[11px] font-bold tracking-[0.3em] uppercase">
                — Looking ahead
              </div>
              <h3 className="font-serif text-4xl font-medium sm:text-5xl text-white">Ready for Primary School</h3>
              <p className="text-xl text-white/90 leading-relaxed font-light">
                Moving from Kindergarten to Lower Primary is a gradual shift, not a cliff. 
                Children carry their concentration stamina, their grace around materials, and their comfort 
                with mixed-age collaboration into the primary classroom, seamlessly beginning the Great Lessons.
              </p>
              <div className="mt-8 flex">
                <MarketingButton href="/primary-school" className="bg-white text-primary hover:bg-white/90 text-[11px] font-bold tracking-[0.25em] uppercase h-12">
                  Explore Primary School
                </MarketingButton>
              </div>
           </div>
        </div>
      </section>

      {/* Centered Single-Column CTA */}
      <SectionShell tone="canvas">
        <div className="max-w-3xl mx-auto text-center flex flex-col items-center gap-6 py-12">
           <Eyebrow>Take the next step</Eyebrow>
           <SectionTitle className="max-w-xl mx-auto">{ctaTitle}</SectionTitle>
           <p className="text-[0.9375rem] text-muted-foreground leading-relaxed max-w-2xl mx-auto">
             {ctaSubtitle}
           </p>
           <div className="flex flex-wrap items-center justify-center gap-4 mt-6">
              <MarketingButton href="/admissions" className="bg-primary text-white hover:bg-primary-hover text-[11px] font-bold tracking-[0.25em] uppercase h-12 px-8">
                {ctaButton}
              </MarketingButton>
              <MarketingButton href={whatsapp} variant="outline" size="lg" external className="border-primary/20 bg-transparent text-[11px] font-bold tracking-[0.25em] text-primary uppercase transition hover:bg-primary hover:text-white h-12 px-8">
                <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                Message on WhatsApp
              </MarketingButton>
           </div>
        </div>
      </SectionShell>
    </>
  )
}