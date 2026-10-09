import { cn } from '@novastar/shared-ui'
import { ArrowRight } from 'lucide-react'
import { HorizontalScroll } from '@/components/horizontal-scroll'

export interface ProgressionStep {
  label: string
  caption: string
  active?: boolean
}

interface ProgressionPathProps {
  steps: ProgressionStep[]
  className?: string
  containerClassName?: string
}

/**
 * A horizontal progression timeline to show the academic pathway.
 * Now enhanced with staggered animations, dynamic hover states,
 * and accessible horizontal scrolling with visual indicators.
 */
export function ProgressionPath({ steps, className, containerClassName }: ProgressionPathProps) {
  return (
    <HorizontalScroll
      className={cn('relative', className)}
      containerClassName={cn('flex items-center min-w-max gap-3', containerClassName)}
      showButtons={true}
      showShadows={true}
      id="progression-path"
    >
      {steps.map((step, index) => (
        <div 
          key={index} 
          className="flex items-center gap-3 animate-reveal-up opacity-0 shrink-0"
          style={{ animationDelay: `${0.1 + index * 0.15}s`, animationFillMode: 'forwards' }}
          role="listitem"
        >
          <div className={cn(
            "group relative flex flex-col justify-center rounded-xl border p-5 shadow-hairline w-44 text-center transition-all duration-300 ease-out",
            step.active 
              ? "border-primary/20 bg-primary/5 hover:bg-primary hover:-translate-y-1 hover:shadow-floating hover:border-primary cursor-default" 
              : "border-border bg-surface-container-lowest hover:border-border-strong"
          )}>
            {/* Optional glowing background behind the active ones on hover */}
            <div className="absolute inset-0 bg-primary opacity-0 transition-opacity duration-300 group-hover:opacity-10 rounded-xl pointer-events-none"></div>
            
            <span className={cn(
              "type-title text-[1.125rem] transition-colors duration-300 relative z-10",
              step.active ? "text-primary group-hover:text-white" : "text-foreground"
            )}>{step.label}</span>
            <span className={cn(
              "text-sm mt-1 transition-colors duration-300 relative z-10",
              step.active ? "text-primary/70 group-hover:text-white/80" : "text-muted-foreground"
            )}>{step.caption}</span>
          </div>
          
          {index < steps.length - 1 && (
            <div className="relative flex items-center justify-center w-6 shrink-0">
              <ArrowRight className="h-5 w-5 text-primary/30 shrink-0" aria-hidden="true" />
            </div>
          )}
        </div>
      ))}
    </HorizontalScroll>
  )
}
