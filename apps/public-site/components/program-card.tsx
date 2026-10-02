import Link from 'next/link'
import { Button } from '@novastar/shared-ui'
import { cn } from '@novastar/shared-ui'
import { ageRange, phaseBadge, PhaseIcon, programSlug } from '@/lib/programs'

interface ProgramCardProps {
  program: {
    name: string
    phase: string
    ageMin: number | null
    ageMax: number | null
  }
}

export function ProgramCard({ program }: ProgramCardProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10">
        <PhaseIcon phase={program.phase} className="h-12 w-12 text-primary/40" />
      </div>
      <div className="p-6">
        <h3 className="mb-1 font-heading text-xl font-semibold text-primary">
          {program.name}
        </h3>
        <p className="mb-2 text-sm text-muted-foreground">
          {ageRange(program.ageMin, program.ageMax)}
        </p>
        <span
          className={cn(
            'mb-4 inline-block rounded-full px-2 py-1 text-xs font-medium',
            phaseBadge(program.phase)
          )}
        >
          {program.phase}
        </span>
        <p className="mb-4 text-foreground/80">
          Authentic Montessori education integrated with GES/NaCCA curriculum standards.
        </p>
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link href={`/academics#${programSlug(program.name)}`}>Learn More</Link>
        </Button>
      </div>
    </div>
  )
}