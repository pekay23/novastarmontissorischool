import { Button } from '@novastar/shared-ui'

interface ProgramCardProps {
  program: {
    id: string
    name: string
    phase: string
    ageMin: number | null
    ageMax: number | null
  }
}

export function ProgramCard({ program }: ProgramCardProps) {
  const ageText = program.ageMin && program.ageMax 
    ? `${program.ageMin}-${program.ageMax} months`
    : 'All ages'

  const phaseColors = {
    KINDERGARTEN: 'bg-green-100 text-green-800',
    PRIMARY: 'bg-blue-100 text-blue-800',
    JHS: 'bg-purple-100 text-purple-800',
    SHS: 'bg-orange-100 text-orange-800',
  }

  const phaseColor = phaseColors[program.phase as keyof typeof phaseColors] || 'bg-gray-100 text-gray-800'

  return (
    <div className="bg-white dark:bg-card rounded-lg shadow-sm border border-border overflow-hidden transition-transform hover:shadow-md">
      <div className="aspect-video bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center">
        <div className="text-4xl text-primary/40">★</div>
      </div>
      <div className="p-6">
        <h3 className="text-xl font-heading font-semibold text-primary mb-1">
          {program.name}
        </h3>
        <p className="text-sm text-muted-foreground mb-2">{ageText}</p>
        <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full mb-4 ${phaseColor}`}>
          {program.phase}
        </span>
        <p className="text-foreground/80 mb-4">Authentic Montessori education integrated with GES/NaCCA curriculum standards.</p>
        <Button variant="outline" size="sm" className="w-full">
          Learn More
        </Button>
      </div>
    </div>
  )
}