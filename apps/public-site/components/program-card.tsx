import { cn } from '@novastar/shared-ui'

import { Card, CardTitle } from '@/components/marketing'
import { MarketingButton } from '@/components/marketing-button'
import { ageRange, phaseBadge, PhaseIcon, programSlug } from '@/lib/programs'

interface ProgramCardProps {
  program: {
    name: string
    phase: string
    ageMin: number | null
    ageMax: number | null
  }
}

/**
 * Programme teaser.
 *
 * The 16:9 placeholder frame was a `from-primary/10 to-secondary/10` gradient
 * with a 48px ghosted icon — a maroon-to-navy wash that carried no information
 * and put two brand hues behind every card. `ProgramCard` is used by the
 * admissions flow, where a student is choosing a phase, so the frame now states
 * the phase in text at a size that is actually readable, and the icon fills the
 * panel instead of floating in the middle of it.
 */
export function ProgramCard({ program }: ProgramCardProps) {
  return (
    <Card interactive className="flex h-full flex-col overflow-hidden">
      <div className="relative flex aspect-video items-center justify-center bg-tint-warm">
        <PhaseIcon phase={program.phase} className="h-14 w-14 text-primary/25" />
        <span className="absolute inset-x-0 bottom-0 p-4">
          <span
            className={cn(
              'inline-block rounded-xs border px-2 py-1 text-xs font-medium',
              phaseBadge(program.phase),
            )}
          >
            {program.phase}
          </span>
        </span>
      </div>

      <div className="flex flex-1 flex-col p-6">
        <CardTitle>{program.name}</CardTitle>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {ageRange(program.ageMin, program.ageMax)}
        </p>

        <p className="mt-4 flex-1 text-sm leading-relaxed text-muted-foreground">
          Authentic Montessori education integrated with GES/NaCCA curriculum
          standards, in a mixed-age self-directed classroom.
        </p>

        <MarketingButton
          href={`/academics#${programSlug(program.name)}`}
          variant="outline"
          size="sm"
          className="mt-6 w-full"
        >
          See the curriculum
        </MarketingButton>
      </div>
    </Card>
  )
}