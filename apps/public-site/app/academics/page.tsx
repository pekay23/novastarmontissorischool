import Link from 'next/link'
import { Button, cn } from '@novastar/shared-ui'
import {
  ArrowRight,
  Award,
  BookOpen,
  Calculator,
  Landmark,
  Mic,
  Sparkles,
} from 'lucide-react'

import { SectionHeading, Stat } from '@/components/marketing'
import { PreparedEnvironments, type EnvironmentPanel } from '@/components/prepared-environments'
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
      <section className="border-b border-border bg-gradient-to-b from-primary-soft to-background">
        <div className="container pt-32 pb-16 lg:pt-40 lg:pb-20">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-container-low p-3.5">
            <p className="flex items-center gap-3">
              <span className="rounded bg-primary px-2.5 py-1 text-label-sm uppercase tracking-[0.08em] text-primary-foreground">
                Aligned
              </span>
              <span className="text-sm font-semibold">
                Ghana Education Service and NaCCA curriculum standards
              </span>
            </p>
            <p className="flex items-center gap-2 text-label-sm font-bold text-primary">
              <Landmark className="h-4 w-4" aria-hidden="true" />
              Ayeduase campus · Kumasi
            </p>
          </div>

          <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
            <div className="flex flex-col gap-6 lg:col-span-7">
              {/*
                `--color-accent-warm-dark` rather than `--color-tertiary-container`
                here. This kicker is 12px bold, which is not large text under
                WCAG, so it needs 4.5:1; the terracotta measures 4.48:1 against the
                hero tint. The display-size `<em>` below does clear the bar on the
                lighter threshold and keeps the accent.
              */}
              <p className="flex items-center gap-2 text-label-md uppercase tracking-[0.06em] text-accent-warm-dark">
                <span className="h-0.5 w-6 bg-tertiary-container" aria-hidden="true" />
                Pedagogical continuum
              </p>

              <h1 className="text-display-hero">
                Authentic Montessori, sequenced{' '}
                <em className="font-normal text-tertiary-container">
                  from the first work cycle to the final exam
                </em>
              </h1>

              <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
                We hold the Montessori method together with the Ghanaian
                curriculum: mixed-age classrooms and uninterrupted work periods on
                one side, National Council for Curriculum and Assessment
                requirements on the other. A child progresses from Crèche to
                Junior High without changing school.
              </p>

              <div className="flex flex-wrap gap-4 pt-2">
                <Button size="lg" asChild>
                  <Link href="#environments">
                    Explore the environments
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/admissions">Admissions and entry criteria</Link>
                </Button>
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
                  <div
                    key={metric.label}
                    className="rounded-xl border border-border bg-surface-container-low p-4"
                  >
                    <Stat {...metric} className="items-start border-0 bg-transparent p-0 text-left" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Prepared environments */}
      <section id="environments" className="bg-surface-container-low">
        <div className="container section-y">
          <SectionHeading
            eyebrow="Curriculum environments"
            title="Five prepared environments"
            lede="Each room is built with materials that isolate one kind of work, so a child can begin at any point and still find a task that holds their attention."
          />
          <div className="mt-10">
            <PreparedEnvironments panels={ENVIRONMENTS} />
          </div>
        </div>
      </section>

      {/*
        The programme list the rest of the site links into. The footer deep-links
        to `/academics#<programSlug>`, so each entry keeps its id and the
        ordering stays as `getAcademicPrograms` returned it. Empty when no
        database is configured — the section is omitted rather than rendered as
        an empty heading.
      */}
      {programs.length > 0 && (
        <section className="container section-y">
          <SectionHeading
            eyebrow="Programmes"
            title="Programmes and subjects"
            lede="Every programme below lists the subjects taught in that phase."
          />
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {programs.map((program) => (
              <ProgramSection key={program.id} program={program} />
            ))}
          </div>
        </section>
      )}

      {/* Traditions */}
      <section className="border-y border-border bg-surface-container-low">
        <div className="container section-y">
          <SectionHeading
            eyebrow="Institutional culture"
            title="Traditions the school keeps"
            lede="Practice that a child can expect every year, rather than an occasional event."
          />
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRADITIONS.map((tradition) => (
              <article
                key={tradition.title}
                className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:-translate-y-1 hover:shadow-md"
              >
                <div>
                  <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <tradition.icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <h3 className="text-title-lg text-foreground">{tradition.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                    {tradition.body}
                  </p>
                </div>
                <p className="mt-6 flex items-center justify-between border-t border-border pt-4 text-xs font-semibold text-primary">
                  Montessori practice
                  <Award className="h-4 w-4" aria-hidden="true" />
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Continuum matrix */}
      <section className="container section-y">
        <SectionHeading
          align="center"
          eyebrow="Curriculum continuums"
          title="How a subject develops across the environments"
          lede="The same strand of knowledge, traced from the first concrete material to work the child reasons about rather than recalls."
        />
        {/*
            `tabIndex={0}` and `role="region"` because the table is wider than the
            viewport on narrow screens. A scroll container that is not focusable
            cannot be scrolled with the keyboard, so the content becomes
            unreachable without a pointer. The label gives the landmark a name.
          */}
          <div
            tabIndex={0}
            role="region"
            aria-label="Curriculum continuum by domain and environment"
            className="mt-10 overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm"
          >
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
              <tr className="border-b border-border bg-surface-container text-foreground">
                <th scope="col" className="w-1/4 p-5 text-title-md">
                  Domain and method
                </th>
                <th scope="col" className="p-5 text-title-md">
                  Early environments
                </th>
                <th scope="col" className="p-5 text-title-md">
                  Middle environments
                </th>
                <th scope="col" className="p-5 text-title-md">
                  Advanced environments
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {CONTINUUM.map((row, i) => (
                <tr key={row.domain} className={cn(i % 2 === 1 && 'bg-surface-container-low')}>
                  <th scope="row" className="p-5 font-semibold">
                    <span className="flex items-center gap-2 text-title-md text-primary">
                      <BookOpen className="h-4 w-4" aria-hidden="true" />
                      {row.domain}
                    </span>
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {row.method}
                    </span>
                  </th>
                  <td className="p-5 align-top text-muted-foreground">{row.early}</td>
                  <td className="p-5 align-top text-muted-foreground">{row.middle}</td>
                  <td className="p-5 align-top text-muted-foreground">{row.advanced}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* GES alignment */}
      <section className="border-t border-border bg-surface-container-low">
        <div className="container section-y">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
            <h2 className="text-headline-lg">GES and NaCCA aligned</h2>
            <p className="text-muted-foreground">
              The Montessori sequence runs alongside the national curriculum, so
              children work through its requirements inside a self-directed
              classroom rather than alongside a separate taught syllabus.
            </p>
            <dl className="grid w-full grid-cols-2 gap-4 md:grid-cols-4">
              {[
                /*
                  Every other programme-dependent block on this page is guarded on
                  `programs.length > 0`. This one was not, so a build with no
                  database published "Programmes 0" directly under "GES and NaCCA
                  aligned" — a factual claim that the school runs no programmes at
                  all. The count is omitted instead.
                */
                ...(programs.length > 0
                  ? [{ term: 'Programmes', value: String(programs.length) }]
                  : []),
                { term: 'Terms per year', value: '3' },
                { term: 'Languages', value: 'English and Twi' },
                { term: 'Approach', value: 'Mixed-age' },
              ].map((stat) => (
                /*
                  dt must precede dd, or assistive tech announces the value
                  before the label ("3 Terms per year" -> "3, Terms").
                */
                <div key={stat.term}>
                  <dt className="text-sm text-muted-foreground">{stat.term}</dt>
                  <dd className="text-2xl font-bold text-primary">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="bg-primary">
        <div className="container flex flex-col items-center justify-between gap-8 py-14 lg:flex-row">
          <div className="max-w-2xl text-center lg:text-left">
            {open ? (
              <span className="mb-3 inline-block rounded-full border border-primary-foreground/20 bg-primary-container px-3 py-1 text-label-sm uppercase tracking-[0.06em] text-primary-foreground">
                Admissions open · 2026/2027
              </span>
            ) : (
              <span className="mb-3 inline-block rounded-full border border-primary-foreground/20 bg-primary-container px-3 py-1 text-label-sm uppercase tracking-[0.06em] text-primary-foreground">
                Admissions closed — enquire for future intake
              </span>
            )}
            <h2 className="text-headline-lg text-primary-foreground">
              See the classroom before you decide
            </h2>
            <p className="mt-2 text-sm text-primary-foreground/85">
              Enquiry groups are kept small so each child gets adult attention
              during the work cycle. Schedule a visit and observe a work cycle.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-4 sm:flex-row">
            <Button
              size="lg"
              asChild
              className="bg-surface text-primary hover:bg-surface-container-high"
            >
              <Link href="/contact">Schedule a classroom visit</Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
              className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/fees">Tuition and fees</Link>
            </Button>
          </div>
        </div>
      </section>
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
    <article
      id={programSlug(program.name)}
      className="rounded-xl border border-border bg-card p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
            <PhaseIcon phase={program.phase} className="h-6 w-6 text-primary" />
          </span>
          <div>
            <h3 className="text-headline-sm text-foreground">{program.name}</h3>
            <p className="text-sm text-muted-foreground">
              {ageRange(program.ageMin, program.ageMax)}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-block rounded-full px-2 py-1 text-xs font-medium',
            phaseBadge(program.phase),
          )}
        >
          {program.phase}
        </span>
      </div>

      <p className="mt-4 text-muted-foreground">
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
        <ul className="mt-4 flex flex-wrap gap-2">
          {program.subjects.slice(0, 8).map((subject) => (
            <li
              key={subject.id}
              className="rounded-md bg-muted px-3 py-1 text-sm text-muted-foreground"
            >
              {subject.name}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}