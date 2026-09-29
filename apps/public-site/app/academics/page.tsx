import { getAcademicPrograms } from '@/lib/data'
import { cn } from '@novastar/shared-ui'
import { metadata } from '@/lib/metadata'

export { metadata }

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

      {/* Phase Overview */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-12">
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
            <h2 className="text-responsive-h2 font-heading text-primary mb-4">GES & NaCCA Aligned</h2>
            <p className="text-muted-foreground mb-6">
              Our curriculum follows the Ghana Education Service standards and is
              approved by the National Council for Curriculum and Assessment (NaCCA).
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-primary">{programs.length}</div>
                <div className="text-sm text-muted-foreground">Key Phases</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">3</div>
                <div className="text-sm text-muted-foreground">Terms Per Year</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">3</div>
                <div className="text-sm text-muted-foreground">Term Assessments</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">100%</div>
                <div className="text-sm text-muted-foreground">BECE Sci (2021)</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function ProgramSection({ program }: { program: Awaited<ReturnType<typeof getAcademicPrograms>>[0] }) {
  const phaseColor = {
    KINDERGARTEN: 'bg-green-100 text-green-800',
    PRIMARY: 'bg-blue-100 text-blue-800',
    JHS: 'bg-purple-100 text-purple-800',
    SHS: 'bg-orange-100 text-orange-800',
  }[program.phase] || 'bg-gray-100 text-gray-800'

  return (
    <div className="border border-border rounded-lg p-4 md:p-6">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
          <span className="text-xl">★</span>
        </div>
        <div>
          <h2 className="text-2xl font-heading font-semibold text-primary">{program.name}</h2>
          <p className="text-sm text-muted-foreground">
            {program.ageMin && program.ageMax ? `${program.ageMin}-${program.ageMax} months` : 'All ages'}
          </p>
          <span className={cn('inline-block mt-1 px-2 py-1 text-xs font-medium rounded-full', phaseColor)}>
            {program.phase}
          </span>
        </div>
      </div>
      <p className="text-foreground/80 mb-4">Authentic Montessori education integrated with GES/NaCCA curriculum standards.</p>

      {/* Subjects for this program */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        {program.subjects.slice(0, 8).map((subject: { name: string; id: string }) => (
          <SubjectBadge key={subject.id} subject={subject.name} />
        ))}
      </div>
    </div>
  )
}

function SubjectBadge({ subject }: { subject: string }) {
  return (
    <div className="bg-muted/50 px-3 py-1 rounded-md text-center">
      {subject}
    </div>
  )
}