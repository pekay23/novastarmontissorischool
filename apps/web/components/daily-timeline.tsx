import { cn } from '@novastar/shared-ui'

export interface TimelineEvent {
  time: string
  title: string
  description?: string
}

interface DailyTimelineProps {
  events: TimelineEvent[]
  className?: string
}

/**
 * A vertical timeline showing a day in the life.
 * Enhanced with staggered reveal animations and hover interactions.
 */
export function DailyTimeline({ events, className }: DailyTimelineProps) {
  return (
    <div className={cn('relative space-y-8 before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-primary/20', className)}>
      {events.map((event, i) => (
        <div 
          key={i} 
          className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group animate-reveal-up opacity-0"
          style={{ animationDelay: `${0.1 + i * 0.1}s`, animationFillMode: 'forwards' }}
        >
          {/* Timeline dot */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-4 border-surface-container-lowest bg-surface-container-highest text-primary shadow-hairline md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 transition-all duration-300 group-hover:scale-110 group-hover:border-primary/30 group-hover:shadow-raised">
             <div className="h-2.5 w-2.5 rounded-xl bg-primary transition-transform duration-300 group-hover:scale-125" />
          </div>
          
          <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] rounded-xl border border-border bg-surface-container-lowest p-6 shadow-hairline transition-all duration-300 hover:border-primary/40 hover:shadow-floating hover:-translate-y-1 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none"></div>
            <div className="flex flex-col gap-1 relative z-10">
              <span className="type-label uppercase text-primary tracking-widest text-[10px]">{event.time}</span>
              <span className="type-title text-foreground mt-1 group-hover:text-primary transition-colors">{event.title}</span>
              {event.description && (
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{event.description}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
