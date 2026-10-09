import Link from 'next/link'
import {
  Mail,
  MessageCircle,
  ShieldCheck,
  Users,
} from 'lucide-react'

import {

  Card,
  CardTitle,
  Eyebrow,
  SectionHeading,
  SectionShell,
  SectionTitle,
} from '@/components/marketing'
import { ArrowLink, MarketingButton, whatsappHref } from '@/components/marketing-button'
import { SubjectCard } from '@/components/subject-card'
import { ProgressionPath, type ProgressionStep } from '@/components/progression-path'
import { CurriculumAccordion, CurriculumSubjectList } from '@/components/curriculum-accordion'
import { ScrollableCardGrid } from '@/components/horizontal-scroll'

import {
  getAdmissionsStatus,
  getBranding,
  getCTAContent,
} from '@/lib/data'
import { SCHOOL_INFO, generatePrimarySchoolMetadata } from '@/lib/metadata'

export const metadata = generatePrimarySchoolMetadata()

const BECE_PROGRESSION: ProgressionStep[] = [
  { label: 'Lower Primary', caption: 'Basic 1-3 (Ages 6-8)' },
  { label: 'Upper Primary', caption: 'Basic 4-6 (Ages 9-11)' },
  { label: 'Junior High', caption: 'JHS 1-3 (Ages 12-14)' },
  { label: 'BECE', caption: 'National Exams', active: true },
]

export default async function PrimarySchoolPage() {
  const [branding, cta, admissions] = await Promise.all([
    getBranding(),
    getCTAContent('primary'),
    getAdmissionsStatus(),
  ])

  const { open } = admissions
  const schoolName = branding?.name || SCHOOL_INFO.name

  const ctaTitle = cta?.title || 'Ready to join our primary school community?'
  const ctaSubtitle =
    cta?.subtitle ||
    'Give your child the foundation for a lifetime of learning through authentic Montessori education during the reasoning mind years, ages 6 to 11.'
  const ctaButton = cta?.cta || 'Apply for primary'

  const whatsapp = whatsappHref(
    SCHOOL_INFO.whatsapp,
    `Hello ${schoolName}, I would like to enquire about primary school admissions for my child.`,
  )

  return (
    <>
      {/* Provenance band */}
      <div className="border-b border-border bg-surface-container-low">
        <div className="container flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-1.5">
          <p className="flex items-center gap-3">
            <Eyebrow variant={open ? 'solid' : 'tinted'} className={open ? 'bg-secondary text-secondary-foreground' : 'bg-surface-container text-muted-foreground'}>
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

      {/* Split Typographic Hero */}
      <section className="bg-gradient-to-b from-tint-warm to-background border-b border-border overflow-hidden">
        <div className="container pt-24 pb-16 lg:pt-36 lg:pb-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="flex flex-col gap-6 lg:max-w-xl relative z-10">
              <div className="text-secondary/60 text-[11px] font-bold tracking-[0.3em] uppercase mb-[-1rem]">
                — Primary School · Ages 6 to 11
              </div>
              <h1 className="type-display font-serif text-secondary-dark leading-[1.1] mt-4">
                Academic rigour built on self-directed inquiry
              </h1>
              <p className="text-lg leading-relaxed text-foreground/80 font-medium">
                Authentic Montessori primary education integrated with Ghana Education Service standards. 
                We prepare the reasoning mind for the BECE and beyond.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-3">
                <MarketingButton href="/contact" size="lg" className="bg-secondary text-secondary-foreground text-[11px] font-bold tracking-[0.25em] uppercase transition hover:bg-secondary/90">
                  Book a campus visit
                </MarketingButton>
                {open ? (
                  <MarketingButton href="/admissions" variant="outline" size="lg" className="border border-secondary/20 bg-transparent text-[11px] font-bold tracking-[0.25em] text-secondary-dark uppercase transition hover:bg-secondary hover:text-white">
                    Apply for admission
                  </MarketingButton>
                ) : (
                  <MarketingButton href={whatsapp} variant="outline" size="lg" external className="border border-secondary/20 bg-transparent text-[11px] font-bold tracking-[0.25em] text-secondary-dark uppercase transition hover:bg-secondary hover:text-white">
                    <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                    Message us
                  </MarketingButton>
                )}
              </div>
            </div>
            
            <div className="flex justify-center lg:justify-end relative z-10">
              <div className="relative w-full max-w-sm flex flex-col gap-6">
                <div className="flex items-center justify-center w-full rounded-md mix-blend-multiply opacity-90 pb-8 pt-4">
                   {/* eslint-disable-next-line @next/next/no-img-element */}
                   <img src="/logo_primaryschool.png" alt="Novastar Primary School Crest" className="h-40 md:h-56 w-auto drop-shadow-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div className="flex flex-col items-center justify-center p-4 rounded-md bg-secondary/5 border border-secondary/20 transition-all hover:bg-secondary/10">
                     <span className="font-serif text-2xl text-secondary">Grades 1–6</span>
                     <span className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] mt-1">Lower & Upper</span>
                   </div>
                   <div className="flex flex-col items-center justify-center p-4 rounded-md bg-secondary/5 border border-secondary/20 transition-all hover:bg-secondary/10">
                     <span className="font-serif text-2xl text-secondary">GES & NaCCA</span>
                     <span className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] mt-1">Aligned</span>
                   </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Reasoning Mind Philosophy */}
      <section className="relative w-full py-32 overflow-hidden section-y mt-0 border-y border-border/40">
        <div className="absolute inset-0 z-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src="/images/photo_3_2026-10-05_11-06-55%20for%20primary%20school.jpg" 
            alt="Primary students in class" 
            className="object-cover object-center w-full h-full opacity-30 mix-blend-luminosity scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/30"></div>
        </div>

        <div className="container relative z-10">
          <Card tone="flat" className="overflow-hidden p-8 md:p-12 border-0 bg-surface-container-lowest/80 backdrop-blur-xl shadow-floating max-w-3xl">
            <div className="flex flex-col gap-6">
              <div className="text-secondary/80 text-[11px] font-bold tracking-[0.3em] uppercase">
                — The Second Plane of Development
              </div>
              <h2 className="text-secondary max-w-2xl font-serif text-3xl leading-[1.2] font-medium sm:text-4xl">
                Between six and twelve, children move from the absorbent mind to the reasoning mind.
              </h2>
              
              <div className="flex flex-col gap-5 text-lg leading-relaxed text-foreground/85">
                <p className="first-letter:text-secondary first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-6xl first-letter:leading-[0.8] first-letter:font-medium">
                  While a preschooler asks "what is it?", a primary child asks "why is it?" and "how does it work?". 
                  They are entering a period of enormous intellectual and moral curiosity.
                </p>
                <p>
                  Our primary classrooms meet this curiosity with expansive research. Children follow questions across 
                  uninterrupted three-hour work cycles, building collaborative projects that span history, biology, and geometry. 
                </p>
                <p className="border-l-2 border-secondary/30 pl-5 my-2 italic text-muted-foreground text-base">
                  They transition from concrete materials to abstract thinking—moving from bead frames to written algorithms, 
                  from the movable alphabet to expository essays.
                </p>
              </div>

              <div className="mt-6 flex flex-wrap gap-4 pt-6 border-t border-border/50">
                <Link href="/preschool" className="text-secondary font-serif italic text-base hover:underline flex items-center gap-1">
                  Coming from our nursery?
                </Link>
                <span className="text-border hidden sm:block">|</span>
                <Link href="/academics" className="text-secondary font-serif italic text-base hover:underline flex items-center gap-1">
                  Review academic progression
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Subject Accordions — Visual Curriculum Accordions */}
      <SectionShell tone="band">
        <SectionHeading
          align="center"
          title="A comprehensive syllabus"
          lede="The Montessori framework delivers the GES curriculum with depth and understanding. Click any subject to explore its progression from concrete materials to abstract reasoning."
        />
        <div className="mt-8 max-w-4xl">
          <CurriculumAccordion
            items={[
              {
                id: 'mathematics',
                title: 'Mathematics',
                summary: 'From physical bead materials to decimal abstraction and algebraic geometry',
                icon: 'SquareFunction',
                badge: 'Core',
                content: (
                  <CurriculumSubjectList
                    items={[
                      {
                        name: 'Golden Bead Materials',
                        description: 'Place value built from units, tens, hundreds, thousands — quantity held, then symbolised.',
                        icon: 'Calculator',
                        tone: 'secondary',
                      },
                      {
                        name: 'Stamp Game & Bead Frames',
                        description: 'Operations as physical exchanges — addition, subtraction, multiplication, division checked by the child.',
                        icon: 'Calculator',
                        tone: 'secondary',
                      },
                      {
                        name: 'Checkerboard & Geometry',
                        description: 'Long multiplication on a grid, fraction insets, area models, algebraic binomial/trinomial cubes.',
                        icon: 'Atom',
                        tone: 'secondary',
                      },
                      {
                        name: 'Problem Solving & Applications',
                        description: 'Word problems, measurement, data handling — mathematics applied to real questions.',
                        icon: 'BookOpen',
                        tone: 'secondary',
                      },
                    ]}
                  />
                ),
              },
              {
                id: 'english-language',
                title: 'English Language',
                summary: 'Reading comprehension, grammar analysis, literature, and expository writing',
                icon: 'Library',
                badge: 'Core',
                content: (
                  <CurriculumSubjectList
                    items={[
                      {
                        name: 'Phonetics & Grammar Analysis',
                        description: 'Sandpaper phonograms, movable alphabet, grammar boxes with geometric symbols for parts of speech.',
                        icon: 'BookOpen',
                        tone: 'secondary',
                      },
                      {
                        name: 'Reading & Literature',
                        description: 'Phonetic readers to chapter books; book discussions, character studies, comparative analysis.',
                        icon: 'Library',
                        tone: 'secondary',
                      },
                      {
                        name: 'Writing Workshop',
                        description: 'Expository essays, creative narratives, poetry, research reports — writing as thinking made visible.',
                        icon: 'BookOpen',
                        tone: 'secondary',
                      },
                      {
                        name: 'Oracy & Public Speaking',
                        description: 'Prepared addresses, debates, poetry recitation — oratory as a taught competence.',
                        icon: 'BookOpen',
                        tone: 'secondary',
                      },
                    ]}
                  />
                ),
              },
              {
                id: 'science',
                title: 'Science',
                summary: 'Botany, zoology, anatomy, and physical sciences through hands-on experiments',
                icon: 'FlaskConical',
                badge: 'Core',
                content: (
                  <CurriculumSubjectList
                    items={[
                      {
                        name: 'Botany & Zoology',
                        description: 'Leaf cabinet, anatomy puzzles, classification by shared characteristics — direct observation first.',
                        icon: 'FlaskConical',
                        tone: 'secondary',
                      },
                      {
                        name: 'Human Anatomy & Health',
                        description: 'Body systems, nutrition, hygiene — the child as researcher of their own organism.',
                        icon: 'Heart',
                        tone: 'secondary',
                      },
                      {
                        name: 'Physical Sciences',
                        description: 'Magnetism, light, sound, simple machines — experiments designed and interpreted by the child.',
                        icon: 'Atom',
                        tone: 'secondary',
                      },
                      {
                        name: 'Earth & Space',
                        description: 'Rock cycle, water cycle, solar system — cosmic context for local geography.',
                        icon: 'Globe2',
                        tone: 'secondary',
                      },
                    ]}
                  />
                ),
              },
              {
                id: 'ghanaian-language',
                title: 'Ghanaian Language (Twi)',
                summary: 'Fluency in Twi and appreciation of local literature and cultural context',
                icon: 'Languages',
                badge: 'Core',
                content: (
                  <CurriculumSubjectList
                    items={[
                      {
                        name: 'Oral Proficiency',
                        description: 'Conversational Twi, proverbs, storytelling — language as living culture.',
                        icon: 'MessageCircle',
                        tone: 'tertiary',
                      },
                      {
                        name: 'Reading & Writing',
                        description: 'Twi orthography, literature study, composition — literacy in the mother tongue.',
                        icon: 'BookOpen',
                        tone: 'tertiary',
                      },
                      {
                        name: 'Cultural Studies',
                        description: 'Adinkra symbols, traditional festivals, Ashanti history — identity rooted in place.',
                        icon: 'Landmark',
                        tone: 'tertiary',
                      },
                    ]}
                  />
                ),
              },
              {
                id: 'social-studies',
                title: 'Social Studies',
                summary: 'History, geography, and civics from the formation of the earth',
                icon: 'Globe2',
                badge: 'Core',
                content: (
                  <CurriculumSubjectList
                    items={[
                      {
                        name: 'History & Cosmic Stories',
                        description: 'Universe, life, humans — impressionistic narratives that frame all later history study.',
                        icon: 'Sparkles',
                        tone: 'secondary',
                      },
                      {
                        name: 'Geography of Ghana & Ashanti',
                        description: 'Local region first — rivers, towns, resources — then continent, then world.',
                        icon: 'Globe2',
                        tone: 'secondary',
                      },
                      {
                        name: 'Civics & Citizenship',
                        description: 'Rights, responsibilities, governance, community service — the child as active citizen.',
                        icon: 'Users',
                        tone: 'secondary',
                      },
                    ]}
                  />
                ),
              },
              {
                id: 'creative-arts',
                title: 'Creative Arts',
                summary: 'Visual arts, music theory, and performance integrated into academic research',
                icon: 'Music',
                badge: 'Enrichment',
                content: (
                  <CurriculumSubjectList
                    items={[
                      {
                        name: 'Visual Arts',
                        description: 'Drawing, painting, clay, textiles — techniques taught, then applied to illustrate research.',
                        icon: 'Palette',
                        tone: 'tertiary',
                      },
                      {
                        name: 'Music Theory & Practice',
                        description: 'Bells, tone bars, notation, composition — music as mathematical pattern and cultural expression.',
                        icon: 'Music',
                        tone: 'tertiary',
                      },
                      {
                        name: 'Drama & Performance',
                        description: 'Class plays, assemblies, presentations — confidence through rehearsed expression.',
                        icon: 'Mic',
                        tone: 'tertiary',
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
        </div>
      </SectionShell>

      {/* The Five Great Lessons */}
<section className="container section-y">
         <div className="mb-10 text-center flex flex-col items-center">
           <div className="text-secondary/80 text-[11px] font-bold tracking-[0.3em] uppercase">
             Cosmic Education
           </div>
           <h2 className="font-serif text-3xl md:text-4xl font-medium mt-4 max-w-2xl text-secondary-dark">The Five Great Lessons</h2>
           <p className="mt-4 text-[1.0625rem] text-foreground/80 leading-relaxed max-w-3xl">
             At the beginning of each year, the primary curriculum is introduced through five impressionistic stories that spark imagination and set the context for all future studies.
           </p>
         </div>
<ScrollableCardGrid 
              minCardWidth="min-w-[300px] sm:min-w-[340px]" 
              gap="gap-6" 
              className="md:hidden"
            >
              {[
                { title: 'Story of the Universe', desc: 'Creation, astronomy, chemistry, and earth sciences.' },
                { title: 'Story of Life', desc: 'Biology, botany, zoology, and evolution of living things.' },
                { title: 'Story of Humans', desc: 'History, culture, invention, and human resilience.' },
                { title: 'Story of Writing', desc: 'Communication, language arts, reading, and literature.' },
                { title: 'Story of Numbers', desc: 'Mathematics, geometry, trade, and engineering.' }
              ].map((lesson, i) => (
                <Card key={i} tone="flat" interactive className="h-full p-8 flex flex-col gap-6 bg-surface-container-lowest border-transparent transition-all duration-700 hover:shadow-floating hover:-translate-y-1">
                  <span className="font-serif text-5xl italic text-secondary/30">0{i + 1}</span>
                  <div>
                    <CardTitle as="h3" className="font-serif text-2xl text-secondary-dark">{lesson.title}</CardTitle>
                    <p className="mt-3 text-[0.9375rem] text-muted-foreground leading-relaxed">{lesson.desc}</p>
                  </div>
                </Card>
              ))}
            </ScrollableCardGrid>
            
            {/* Horizontal scroll version for desktop */}
            <ScrollableCardGrid 
              minCardWidth="min-w-[300px] sm:min-w-[340px]" 
              gap="gap-6" 
              className="hidden md:block"
            >
              {[
                { title: 'Story of the Universe', desc: 'Creation, astronomy, chemistry, and earth sciences.' },
                { title: 'Story of Life', desc: 'Biology, botany, zoology, and evolution of living things.' },
                { title: 'Story of Humans', desc: 'History, culture, invention, and human resilience.' },
                { title: 'Story of Writing', desc: 'Communication, language arts, reading, and literature.' },
                { title: 'Story of Numbers', desc: 'Mathematics, geometry, trade, and engineering.' }
              ].map((lesson, i) => (
                <Card key={i} tone="flat" interactive className="h-full p-8 flex flex-col gap-6 bg-surface-container-lowest border-transparent transition-all duration-700 hover:shadow-floating hover:-translate-y-1">
                  <span className="font-serif text-5xl italic text-secondary/30">0{i + 1}</span>
                  <div>
                    <CardTitle as="h3" className="font-serif text-2xl text-secondary-dark">{lesson.title}</CardTitle>
                    <p className="mt-3 text-[0.9375rem] text-muted-foreground leading-relaxed">{lesson.desc}</p>
                  </div>
                </Card>
              ))}
            </ScrollableCardGrid>
       </section>

      {/* Visuals */}
      <section className="relative w-full h-[600px] md:h-[800px] overflow-hidden my-16">
        <div className="absolute inset-0 z-0">
           {/* eslint-disable-next-line @next/next/no-img-element */}
           <img src="/images/photo_2_2026-10-05_11-06-55%20for%20primary%20school.jpg" alt="Primary students working" className="w-full h-full object-cover animate-ken-burns" />
        </div>
        
        <div className="absolute inset-0 bg-black/20 mix-blend-multiply z-10"></div>
        <div className="absolute bottom-0 w-full h-1/2 bg-gradient-to-t from-background to-transparent z-10"></div>

        <div className="container relative z-20 h-full flex items-end pb-16">
          <div className="grid md:grid-cols-12 gap-8 w-full">
            <div className="md:col-span-8"></div>
            <div className="md:col-span-4 flex flex-col gap-4 h-full justify-end">
               <div className="rounded-sm overflow-hidden shadow-floating bg-surface-container-lowest p-8 flex flex-col justify-center border border-border/50 backdrop-blur-md">
                  <h3 className="font-serif text-2xl text-secondary-dark mb-4">Campus Life</h3>
                  <p className="text-base text-foreground/80 leading-relaxed">
                    Classrooms that open onto outdoor space for movement and practical stewardship of the environment.
                  </p>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* Progression Path */}
      <SectionShell tone="canvas">
         <div className="flex flex-col lg:flex-row gap-12 lg:gap-16 lg:items-center">
            <div className="lg:w-1/3 flex flex-col gap-5">
               <Eyebrow>The Pathway Forward</Eyebrow>
               <SectionTitle as="h2">Preparation for the BECE</SectionTitle>
               <p className="text-[0.9375rem] text-muted-foreground leading-relaxed">
                 The three-hour work cycle gives students the stamina for sustained, exam-driven workload of Junior High. 
                 By the time they reach JHS, self-directed study is second nature.
               </p>
               <div className="mt-2 flex">
                 <ArrowLink href="/academics" variant="outline">
                   View full curriculum
                 </ArrowLink>
               </div>
            </div>
            <div className="lg:w-2/3 overflow-hidden">
               <ProgressionPath steps={BECE_PROGRESSION} />
            </div>
         </div>
      </SectionShell>

      {/* Dark CTA */}
      <section className="container section-y">
        <Card tone="flat" className="relative overflow-hidden p-8 lg:p-14 bg-secondary-dark text-white border-0 shadow-floating">
          <div className="pointer-events-none absolute inset-0 grain opacity-[0.05]" aria-hidden="true" />
          <div className="relative grid items-center gap-8 lg:grid-cols-12">
            <div className="flex flex-col gap-4 lg:col-span-8">
              <div className="text-white/80 text-[11px] font-bold tracking-[0.3em] uppercase">
                {open ? 'Now enrolling for 2026/2027' : 'Ask about the next intake'}
              </div>
              <h2 className="font-serif text-3xl font-medium text-white sm:text-4xl">{ctaTitle}</h2>
              <p className="max-w-[58ch] text-[1.0625rem] leading-relaxed text-white/85">
                {ctaSubtitle}
              </p>
              <p className="mt-2 text-sm font-serif italic text-white/60">
                Want to know about tuition? <Link href="/admissions" className="underline hover:text-white">View our fee structure</Link>.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:col-span-4">
              <MarketingButton href="/admissions" className="bg-white text-secondary-dark hover:bg-white/90 text-[11px] font-bold tracking-[0.25em] uppercase w-full justify-start h-12">
                {ctaButton}
              </MarketingButton>
              <MarketingButton href={whatsapp} variant="outline" external className="bg-transparent border-white/30 text-white hover:bg-white hover:text-secondary-dark text-[11px] font-bold tracking-[0.25em] uppercase w-full justify-start h-12">
                <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                Message us on WhatsApp
              </MarketingButton>
              <MarketingButton
                href={`mailto:${SCHOOL_INFO.email}`}
                variant="quiet"
                external
                className="text-white hover:bg-white/10 text-[11px] font-bold tracking-[0.25em] uppercase w-full justify-start h-12"
              >
                <Mail className="h-4 w-4 mr-2" aria-hidden="true" />
                Email the office
              </MarketingButton>
            </div>
          </div>
        </Card>
      </section>
    </>
  )
}