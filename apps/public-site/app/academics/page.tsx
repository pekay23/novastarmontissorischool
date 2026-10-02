import { cn } from '@novastar/shared-ui'
import { getAcademicPrograms } from '@/lib/data'
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

export default async function AcademicsPage() {
  const programs = await getAcademicPrograms()

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Academic Programs</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            From Creche to Junior High School, we offer authentic Montessori
            education integrated with Ghana Education Service standards.
          </p>
        </div>
      </section>

      {/* Phase overview. Each section is anchored so the footer can deep-link. */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-6">
            {programs.map((program) => (
              <ProgramSection key={program.id} program={program} />
            ))}
          </div>
        </div>
      </section>

      {/* GES Alignment */}
      <section className="py-12 md:py-16 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-responsive-h2 font-heading text-primary mb-4">GES &amp; NaCCA Aligned</h2>
            <p className="text-muted-foreground mb-6">
              Our curriculum follows the Ghana Education Service standards and is
              approved by the National Council for Curriculum and Assessment (NaCCA).
            </p>
            <dl className="grid grid-cols-2 gap-4 text-center md:grid-cols-4">
              {[
                { term: 'Academic Programs', value: programs.length },
                { term: 'Terms Per Year', value: 3 },
                { term: 'Term Assessments', value: 3 },
                { term: 'BECE Sci (2021)', value: '100%' },
              ].map((stat) => (
                /* dt must precede dd, or assistive tech announces the value
                   before the label ("3 Terms Per Year" -> "3, Terms"). */
                <div key={stat.term}>
                  <dt className="text-sm text-muted-foreground">{stat.term}</dt>
                  <dd className="text-2xl font-bold text-primary">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </div>
  )
}

function ProgramSection({ program }: { program: Program }) {
  return (
    <article
      id={programSlug(program.name)}
      className="scroll-mt-24 rounded-xl border border-border bg-card p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
            <PhaseIcon phase={program.phase} className="h-6 w-6 text-primary" />
          </span>
          <div>
            <h2 className="font-heading text-2xl font-semibold text-primary">
              {program.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {ageRange(program.ageMin, program.ageMax)}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-block rounded-full px-2 py-1 text-xs font-medium',
            phaseBadge(program.phase)
          )}
        >
          {program.phase}
        </span>
      </div>

      <p className="mt-4 text-foreground/80">
        Authentic Montessori education integrated with GES/NaCCA curriculum standards.
      </p>

      {program.subjects.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {program.subjects.slice(0, 8).map((subject) => (
            <li
              key={subject.id}
              className="rounded-md bg-muted px-3 py-1 text-sm text-foreground/80"
            >
              {subject.name}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}