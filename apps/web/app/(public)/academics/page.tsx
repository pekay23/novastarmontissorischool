import { cn } from '@novastar/shared-ui'
import { Award, BookOpen, Calculator, Landmark, Mic, Sparkles } from 'lucide-react'

import {
  Card,
  CARD_PAD,
  CardTitle,
  SectionHeading,
  SectionShell,
  Stat,
} from '@/components/marketing'
import { ArrowLink, MarketingButton } from '@/components/marketing-button'
import { Photo } from '@/components/photo'
import { PreparedEnvironments, type EnvironmentPanel } from '@/components/prepared-environments'
import { ProgressionPath } from '@/components/progression-path'
import { CurriculumAccordion, CurriculumFocusList } from '@/components/curriculum-accordion'
import { getAcademicPrograms, getAdmissionsStatus } from '@/lib/data'
import { ageRange, phaseBadge, PhaseIcon, programSlug } from '@/lib/programs'
import { generateAcademicsMetadata } from '@/lib/metadata'

/*
 * Note the export shape: a plain object call, not
 * `export { generateAcademicsMetadata as metadata }`. Aliasing a *function* to
 * the name `metadata` makes Next treat it as the dynamic `generateMetadata` API
 * and call it during prerendering, which fails the static export with
 * `Cannot read properties of undefined (reading '$$typeof')`.
 */
export const metadata = generateAcademicsMetadata()

type Program = Awaited<ReturnType<typeof getAcademicPrograms>>[number]

/*
 * Maria Montessori's four planes, which is how the design mockup organised its
 * environments.
 *
 * These are named as *environments* rather than as school wings on purpose. The
 * mockup's tab ladder topped out at Grade 5, which contradicts this school's
 * actual Crèche-to-Junior-High scope, and the real programme list is rendered
 * from the database further down this page. Its intake ages were fine — the
 * seeded Crèche starts at six months — so only the ceiling was dropped.
 */
const ENVIRONMENTS: EnvironmentPanel[] = [
  {
    id: 'practical-life',
    tab: 'Practical life',
    plane: 'First plane · the absorbent mind',
    heading: 'Order, concentration and independence',
    body: 'The earliest work in a Montessori classroom is not academic. Children pour, carry, sweep, dress themselves and prepare food, because every one of those exercises trains the sustained concentration that everything later depends on.',
    focus: [
      {
        title: 'Self-care and dressing frames',
        body: 'Buttons, laces and zips practised on frames until the sequence needs no thought.',
      },
      {
        title: 'Care of the environment',
        body: 'Water carried, surfaces polished, flowers watered — real responsibility, not pretend.',
      },
      {
        title: 'Grace and courtesy',
        body: 'Turn-taking, quiet movement and shared meals practised as a form of consideration.',
      },
      {
        title: 'Language through song',
        body: 'Nomenclature, songs and oral work before anything is expected on paper.',
      },
    ],
    schedule: 'Uninterrupted work cycle, three terms per academic year',
  },
  {
    id: 'sensorial',
    tab: 'Sensorial',
    plane: 'First plane · the absorbent mind',
    heading: 'A precise, self-correcting language for the senses',
    body: 'Each material isolates one sensation — colour, weight, form, texture — and contains its own error control, so a child can tell alone whether the work is right.',
    focus: [
      {
        title: 'Geometric solids and puzzles',
        body: 'Form and volume made visible through solids that only fit one way round.',
      },
      {
        title: 'The colour and weight boxes',
        body: 'Gradations narrow enough to demand deliberate attention rather than guessing.',
      },
      {
        title: 'Sorting and seriation',
        body: 'Order discovered by touch, then confirmed by eye.',
      },
      {
        title: 'Care of the apparatus',
        body: 'Every material returned in condition, which is the discipline the work teaches.',
      },
    ],
    schedule: 'Materials renewed seasonally at each break',
  },
  {
    id: 'mathematics',
    tab: 'Mathematics',
    plane: 'Second plane · the reasoning mind',
    heading: 'From counting beads to abstract proof',
    body: 'Mathematics is introduced as a concrete fact the child manipulates, not a symbol the child is asked to accept. Abstraction arrives only after the quantity has been physically held.',
    focus: [
      {
        title: 'Golden and bead materials',
        body: 'Place value built from units, tens, hundreds and thousands that can be counted by touch.',
      },
      {
        title: 'Number rods and spindle',
        body: 'Quantity and numeral finally reconciled, which is where written arithmetic begins.',
      },
      {
        title: 'Stamp and bead games',
        body: 'Addition and subtraction as physical exchanges, checked by the child.',
      },
      {
        title: 'Algebraic and geometric material',
        body: 'Binomial and trinomial powers made tangible in three dimensions.',
      },
    ],
    schedule: 'Continuum reviewed each term against Ghana Education Service standards',
  },
  {
    id: 'language',
    tab: 'Language',
    plane: 'Second plane · the reasoning mind',
    heading: 'Reading built from the sounds of speech',
    body: 'The child first analyses spoken words into phonetic sounds, then traces those sounds, and only afterwards assembles them into words to read. Writing typically arrives before fluent reading.',
    focus: [
      {
        title: 'Sandpaper phonograms',
        body: 'Letter shapes traced with three fingers, so the motor memory supports the visual one.',
      },
      {
        title: 'Movable alphabet',
        body: 'Spontaneous composition: a child builds words and sentences without holding a pencil.',
      },
      {
        title: 'The language basket',
        body: 'Classified vocabulary presented in groups that invite the child to make connections.',
      },
      {
        title: 'Twi and English from the start',
        body: 'Both languages taught as first languages rather than one translated into the other.',
      },
    ],
    schedule: 'Oracy and storytelling integrated into the daily work cycle',
  },
  {
    id: 'cosmic',
    tab: 'Cosmic and science',
    plane: 'Third plane · the universal child',
    heading: 'The universe as a question, not a fact',
    body: 'Older children study the earth, its life and its place in the solar system as research they conduct, drawing their own conclusions from evidence rather than reciting a lesson.',
    focus: [
      {
        title: 'The great cosmic stories',
        body: 'Formation of the universe, the coming of life, and the appearance of humans.',
      },
      {
        title: 'Botany and zoology',
        body: 'Classification from direct observation, using local flora and the plants children meet on the way to school.',
      },
      {
        title: 'Practical science and measurement',
        body: 'Experiment designed and interpreted by the child, following Ghana Education Service requirements.',
      },
      {
        title: 'Geography of Ashanti',
        body: 'The child’s own region studied in detail before the wider continent.',
      },
    ],
    schedule: 'Practical work and field observation each term',
  },
]

/*
 * Recurring academic traditions, described as Montessori practice rather than as
 * this school's schedule.
 *
 * The first draft gave each one a frequency — "weekly", "each term", "annually".
 * Those were the most checkable claims on the page: any parent would know within
 * a fortnight whether the weekly reading circle had happened, and nothing in the
 * repository records that the school has committed to any of them. So the
 * pedagogies are kept and the frequencies are not.
 */
const TRADITIONS = [
  {
    title: 'The great cosmic lessons',
    body: 'Lower elementary work opens with the narrative of how the universe, life and language arrived, told with models the children handle themselves.',
    icon: Sparkles,
  },
  {
    title: 'Reading and storytelling circles',
    body: 'Older pupils read aloud to younger classes in both English and Twi, which keeps the older child responsible for what they have understood.',
    icon: BookOpen,
  },
  {
    title: 'Public speaking in English and Twi',
    body: 'Children take turns preparing and delivering a short address, because oratory is a taught competence rather than a personality trait.',
    icon: Mic,
  },
  {
    title: 'Mathematics exhibition',
    body: 'Work with the bead and stamp materials is presented to parents and explained by the child, not the teacher.',
    icon: Calculator,
  },
] as const

/*
 * The four academic strands traced from the concrete to the abstract. The
 * columns are Montessori environments rather than year groups, so the table
 * describes how a subject develops instead of competing with the programme list.
 */
const CONTINUUM: {
  domain: string
  method: string
  early: string
  middle: string
  advanced: string
}[] = [
  {
    domain: 'Mathematics',
    method: 'Concrete to abstract',
    early: 'Sorting and seriation with graduated materials; number rods and spindle.',
    middle: 'Golden bead place value, stamp game operations, bead frames.',
    advanced: 'Checkerboard and bead multiplication, fraction and area models, algorithms applied to problems.',
  },
  {
    domain: 'Language',
    method: 'Sound to meaning',
    early: 'Nomenclature and oral vocabulary; rhyming and songs in both languages.',
    middle: 'Sandpaper phonetics and the movable alphabet; grammar analysis with geometric symbols.',
    advanced: 'Morphology, composition, and sustained written argument across a range of texts.',
  },
  {
    domain: 'Science',
    method: 'Observation to classification',
    early: 'Living and non-living sorting; direct sensory observation of plants and water.',
    middle: 'Leaf and anatomy cabinets; classification by shared characteristics.',
    advanced: 'Independent research questions, experiments the child sets up, and interprets.',
  },
  {
    domain: 'Practical and social',
    method: 'Participation to responsibility',
    early: 'Self-care, dressing frames, hand washing, care of materials.',
    middle: 'Food preparation, plant care, table setting, repair of belongings.',
    advanced: 'Custodial tasks for a real part of the campus, planned and reviewed by the group.',
  },
]

export default async function AcademicsPage() {
  const [programs, admissions] = await Promise.all([
    getAcademicPrograms(),
    getAdmissionsStatus(),
  ])

  const { open } = admissions

  return (
    <div className="min-h-screen">
      {/*
        Hero. The mockup's version led with an "AMI accredited" badge. No
        accreditation record for this school exists anywhere in the repository,
        so the strip carries the GES and NaCCA alignment that the existing page
        already asserted and that the programme data backs.
      */}
      <section className="border-b border-border bg-gradient-to-b from-tint-warm to-background">
        <div className="container pt-28 pb-16 lg:pt-36 lg:pb-20">
          <div className="mb-10 flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-surface-container-lowest p-4 shadow-hairline">
            <p className="flex items-center gap-3">
              <span className="rounded-xs bg-primary px-2.5 py-1 type-eyebrow uppercase text-primary-foreground">
                Aligned
              </span>
              <span className="text-sm font-semibold">
                Ghana Education Service and NaCCA curriculum standards
              </span>
            </p>
            <p className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Landmark className="h-4 w-4" aria-hidden="true" />
              Ayeduase campus · Kumasi
            </p>
          </div>

          <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="flex flex-col gap-6 lg:col-span-7">
              {/*
                `text-accent-warm-dark`, not `#b94c25`. This kicker is 12px bold,
                which is not large text under WCAG, so it needs 4.5:1 — and
                `#b94c25` measures 4.61:1 on `--color-surface`, i.e. 0.11 of
                margin. The dark terracotta measures 7.11:1 on the canvas and
                6.26:1 on the tint. Terracotta as a *fill* is fine; as 12px text
                it is not, so that use is banned outright.
              */}
              <p className="flex items-center gap-2 type-label uppercase text-accent-warm-dark">
                <span className="h-0.5 w-6 bg-accent-warm" aria-hidden="true" />
                Pedagogical continuum
              </p>

              <h1 className="type-display max-w-[18ch]">
                Authentic Montessori, sequenced{' '}
                <em className="font-normal italic text-primary-dark/85">
                  from the first work cycle to the final exam
                </em>
              </h1>

              <p className="max-w-[58ch] text-lg leading-relaxed text-muted-foreground">
                We hold the Montessori method together with the Ghanaian
                curriculum: mixed-age classrooms and uninterrupted work periods on
                one side, National Council for Curriculum and Assessment
                requirements on the other. A child progresses from Crèche to
                Junior High without changing school.
              </p>

              <div className="flex flex-wrap gap-3 pt-2">
                <ArrowLink href="#environments" size="lg" className="group">
                  Explore the environments
                </ArrowLink>
                <MarketingButton href="/admissions" variant="outline" size="lg">
                  Admissions and entry criteria
                </MarketingButton>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="grid gap-4">
                {[
                  {
                    value: '1:6',
                    label: 'Guide to children, early years',
                    caption: 'Mixed-age environment',
                    tone: 'primary' as const,
                  },
                  {
                    value: '3 hrs',
                    label: 'Uninterrupted work cycle',
                    caption: 'Self-directed, no bells',
                    tone: 'secondary' as const,
                  },
                  {
                    value: '2',
                    label: 'Languages from the start',
                    caption: 'English and Asante Twi',
                    tone: 'tertiary' as const,
                  },
                ].map((metric) => (
                  // `1:6` and `2` are the largest figures in the hero, so they
                  // take the display step. `Stat` defaults to `headline` because a
                  // stat in a grid is not a hero.
                  <Card key={metric.label} className={cn(CARD_PAD, 'p-5')}>
                    <Stat {...metric} scale="display" />
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Progression Path */}
      <section className="container pt-20 pb-10">
        <div className="text-center mb-10">
          <p className="type-label uppercase text-accent-warm-dark mb-2">The Novastar Journey</p>
          <h2 className="font-serif text-3xl md:text-4xl text-primary">A continuous path to BECE</h2>
        </div>
        <ProgressionPath
          steps={[
            { label: 'Crèche', caption: '6mo – 2yrs', active: true },
            { label: 'Nursery', caption: '2 – 4yrs', active: true },
            { label: 'Kindergarten', caption: '4 – 6yrs', active: true },
            { label: 'Primary', caption: '6 – 12yrs', active: true },
            { label: 'Junior High', caption: '12 – 15yrs', active: true },
          ]}
          className="mx-auto"
          containerClassName="px-2 md:px-1"
        />
      </section>

      {/* Prepared environments — Visual Curriculum Accordions */}
      <SectionShell id="environments" tone="band">
        <SectionHeading
          eyebrow="Curriculum environments"
          title="Five prepared environments"
          lede="Each room is built with materials that isolate one kind of work, so a child can begin at any point and still find a task that holds their attention. Click to explore the focus areas within each environment."
        />
        <div className="container mt-8">
          <CurriculumAccordion
            items={ENVIRONMENTS.map((env) => ({
              id: env.id,
              title: env.tab,
              summary: env.heading,
              icon: env.id === 'practical-life' ? 'LayoutDashboard' :
                     env.id === 'sensorial' ? 'Brain' :
                     env.id === 'mathematics' ? 'Calculator' :
                     env.id === 'language' ? 'BookOpen' :
                     env.id === 'cosmic' ? 'Globe' :
                     'LayoutDashboard',
              content: (
                <div className="space-y-4">
                  <p className="type-body-lg text-muted-foreground leading-relaxed">
                    {env.body}
                  </p>
                  <div className="pt-2 border-t border-border/50">
                    <p className="type-label text-primary mb-3">Focus areas</p>
                    <CurriculumFocusList
                      items={env.focus.map((f) => ({
                        title: f.title,
                        body: f.body,
                        icon: f.title.includes('Self-care') ? 'Baby' :
                              f.title.includes('Care of environment') ? 'Globe' :
                              f.title.includes('Grace') ? 'Users' :
                              f.title.includes('Language') ? 'BookOpen' :
                              f.title.includes('Geometric') ? 'Puzzle' :
                              f.title.includes('Colour') ? 'Brain' :
                              f.title.includes('Sorting') ? 'Puzzle' :
                              f.title.includes('Apparatus') ? 'LayoutDashboard' :
                              f.title.includes('Golden') ? 'Calculator' :
                              f.title.includes('Number rods') ? 'Calculator' :
                              f.title.includes('Stamp') ? 'Calculator' :
                              f.title.includes('Algebraic') ? 'Brain' :
                              f.title.includes('Sandpaper') ? 'BookOpen' :
                              f.title.includes('Movable') ? 'BookOpen' :
                              f.title.includes('Language basket') ? 'BookOpen' :
                              f.title.includes('Twi') ? 'Languages' :
                              f.title.includes('Great cosmic') ? 'Sparkles' :
                              f.title.includes('Botany') ? 'FlaskConical' :
                              f.title.includes('Practical science') ? 'FlaskConical' :
                              f.title.includes('Geography') ? 'Globe' :
                              'LayoutDashboard',
                      }))}
                    />
                  </div>
                  <p className="type-eyebrow text-muted-foreground italic mt-2">
                    {env.schedule}
                  </p>
                </div>
              ),
            }))}
            type="multiple"
            tone="flat"
            divided
          />
        </div>
      </SectionShell>

      <section className="w-full">
        <Photo
          id="environment"
          ratio="aspect-[21/9] md:aspect-[3/1]"
          className="w-full rounded-none"
        />
      </section>

      {/*
        The programme list the rest of the site links into. The footer deep-links
        to `/academics#<programSlug>`, so each entry keeps its id and the
        ordering stays as `getAcademicPrograms` returned it. Empty when no
        database is configured — the section is omitted rather than rendered as
        an empty heading.
      */}
      {programs.length > 0 && (
        <SectionShell tone="canvas">
          <SectionHeading
            eyebrow="Programmes"
            title="Programmes and subjects"
            lede="Every programme below lists the subjects taught in that phase."
          />
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {programs.map((program) => (
              <ProgramSection key={program.id} program={program} />
            ))}
          </div>
        </SectionShell>
      )}

      {/* Traditions */}
      <SectionShell tone="band">
        <SectionHeading
          eyebrow="Institutional culture"
          title="Traditions the school keeps"
          lede="Practice built into the week, rather than an occasional event."
        />
        {/*
          The previous lede read "Practice that a child can expect every year,
          rather than an occasional event", and one of these four cards is a
          reading and storytelling circle. The comment above TRADITIONS records
          that the frequencies were deliberately dropped because nothing in this
          repository substantiates them — "every year" put the frequency back in
          frequency-free words. See
          docs/technical/2026-10-04_222000-public-site-ui-refinement.md §7.3.
        */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TRADITIONS.map((tradition) => (
            <Card
              key={tradition.title}
              interactive
              className={cn(CARD_PAD, 'flex flex-col justify-between gap-6')}
            >
              <div>
                <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-sm bg-tint-warm text-accent-warm-dark">
                  <tradition.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <CardTitle>{tradition.title}</CardTitle>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                  {tradition.body}
                </p>
              </div>
              <p className="flex items-center justify-between border-t border-border pt-4 text-sm font-medium text-primary">
                Montessori practice
                <Award className="h-4 w-4" aria-hidden="true" />
              </p>
            </Card>
          ))}
        </div>
      </SectionShell>

      {/* Continuum matrix */}
      <SectionShell tone="canvas">
        <SectionHeading
          align="center"
          eyebrow="Curriculum continua"
          title="How a subject develops across the environments"
          lede="The same strand of knowledge, traced from the first concrete material to work the child reasons about rather than recalls."
        />
        {/*
            `tabIndex={0}` and `role="region"` because the table is wider than the
            viewport on narrow screens. A scroll container that is not focusable
            cannot be scrolled with the keyboard, so the content becomes
            unreachable without a pointer. The label gives the landmark a name.
            The visible `aria-hidden` hint is the non-pointer equivalent: a
            focusable scroll region that gives no clue what scrolls is the WCAG
            2.1.1 keyboard trap in all but name.
          */}
        <div
          tabIndex={0}
          role="region"
          aria-label="Curriculum continuum by domain and environment"
          className="mt-12 overflow-x-auto rounded-md border border-border bg-surface shadow-raised"
        >
          <p className="sr-only">Scroll horizontally to see all three environments.</p>
          <table className="w-full min-w-[52rem] border-collapse text-left">
            {/*
              Without a caption the table is announced only as "table" and the
              reader has to infer what the columns mean. This one names it.
            */}
            <caption className="sr-only">
              How each academic domain progresses from concrete, manipulative work
              to abstract reasoning across the five prepared environments.
            </caption>
            <thead>
              <tr className="border-b border-border bg-surface-container-low">
                <th scope="col" className="w-1/4 px-5 py-4 type-label uppercase text-muted-foreground">
                  Domain and method
                </th>
                <th scope="col" className="px-5 py-4 type-label uppercase text-muted-foreground">
                  Early environments
                </th>
                <th scope="col" className="px-5 py-4 type-label uppercase text-muted-foreground">
                  Middle environments
                </th>
                <th scope="col" className="px-5 py-4 type-label uppercase text-muted-foreground">
                  Advanced environments
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {CONTINUUM.map((row) => (
                <tr key={row.domain}>
                  <th scope="row" className="px-5 py-4 font-semibold">
                    <span className="flex items-center gap-2 text-primary">
                      <BookOpen className="h-4 w-4" aria-hidden="true" />
                      {row.domain}
                    </span>
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {row.method}
                    </span>
                  </th>
                  <td className="px-5 py-4 align-top leading-relaxed text-muted-foreground">
                    {row.early}
                  </td>
                  <td className="px-5 py-4 align-top leading-relaxed text-muted-foreground">
                    {row.middle}
                  </td>
                  <td className="px-5 py-4 align-top leading-relaxed text-muted-foreground">
                    {row.advanced}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionShell>

      {/* Closing call to action */}
      <div className="bg-secondary-dark text-white">
        <div className="container flex flex-col items-center justify-between gap-10 py-16 lg:flex-row lg:gap-14 lg:py-24">
          <div className="max-w-2xl text-center lg:text-left">
            {open ? (
              <span className="mb-4 inline-block px-3 py-1 text-[11px] font-bold tracking-[0.25em] uppercase text-white/70">
                — Admissions open · 2026/2027
              </span>
            ) : (
              <span className="mb-4 inline-block px-3 py-1 text-[11px] font-bold tracking-[0.25em] uppercase text-white/70">
                — Admissions closed
              </span>
            )}
            <h2 className="font-serif text-3xl font-medium sm:text-4xl text-balance text-white">
              See the classroom before you decide
            </h2>
            <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-white/80">
              Enquiry groups are kept small so each child gets adult attention
              during the work cycle. Schedule a visit and observe a work cycle.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-3 sm:flex-row">
            <MarketingButton href="/contact" className="bg-white text-secondary-dark hover:bg-white/90 text-[11px] font-bold tracking-[0.25em] uppercase h-12 px-8">
              Schedule a visit
            </MarketingButton>
            <MarketingButton href="/fees" variant="outline" className="bg-transparent border-white/20 text-white hover:bg-white hover:text-secondary-dark text-[11px] font-bold tracking-[0.25em] uppercase h-12 px-8">
              Tuition and fees
            </MarketingButton>
          </div>
        </div>
      </div>
    </div>
  )
}

/*
 * The anchor offset lives in one place: `scroll-padding-top` on `html` in
 * globals.css. Adding `scroll-mt-*` here as well would stack the two, leaving the
 * target a further ~6rem below the sticky header.
 */
function ProgramSection({ program }: { program: Program }) {
  return (
    <Card id={programSlug(program.name)} className={cn(CARD_PAD, 'scroll-mt-32')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-tint-warm">
            <PhaseIcon phase={program.phase} className="h-5 w-5 text-primary" />
          </span>
          <div>
            <CardTitle>{program.name}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {ageRange(program.ageMin, program.ageMax)}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-block rounded-xs border px-2 py-1 text-xs font-medium',
            phaseBadge(program.phase),
          )}
        >
          {program.phase}
        </span>
      </div>

      <p className="mt-5 leading-relaxed text-muted-foreground">
        {/*
          Phase-specific copy only. This block repeats for every programme, and it
          used to assert the 1:6 ratio "in the early years" on each card — which
          put it on the Crèche entry (seeded at six months old) and restated a
          figure the hero already carries. The ratio now lives in the hero stat
          only.
        */}
        Authentic Montessori education integrated with GES/NaCCA curriculum
        standards, in a mixed-age self-directed classroom.
      </p>

      {program.subjects.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {program.subjects.slice(0, 8).map((subject) => (
            <li
              key={subject.id}
              className="rounded-xs bg-surface-container px-3 py-1 text-sm text-muted-foreground"
            >
              {subject.name}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}