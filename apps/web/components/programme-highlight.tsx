import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@novastar/shared-ui'
import { Card, CardTitle } from '@/components/marketing'

interface ProgrammeHighlightProps {
  title: string
  description: string
  href: string
  imageSrc: string
  imageAlt: string
  className?: string
}

/**
 * A visually engaging card for the Home page to direct users to specific programmes
 * like Preschool and Primary School. Replaces the generic gateway cards for programmes.
 */
export function ProgrammeHighlight({
  title,
  description,
  href,
  imageSrc,
  imageAlt,
  className
}: ProgrammeHighlightProps) {
  return (
    <Link href={href} className={cn("group block h-full", className)}>
      <Card tone="flat" interactive className="relative overflow-hidden p-0 h-[400px] md:h-[500px] flex flex-col justify-end transition-all duration-700 hover:shadow-floating hover:-translate-y-1 bg-surface-container-low border-transparent">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-primary/20 z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100 mix-blend-multiply" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent z-10 opacity-80 group-hover:opacity-100 transition-opacity duration-500" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src={imageSrc} 
            alt={imageAlt} 
            className="h-full w-full object-cover transition-transform duration-[2s] ease-out group-hover:scale-105"
            loading="lazy"
          />
        </div>
        <div className="relative z-20 flex flex-col p-8 md:p-10 transition-transform duration-500 group-hover:-translate-y-2">
          <CardTitle as="h3" className="font-serif text-3xl font-medium text-white mb-3 drop-shadow-sm">{title}</CardTitle>
          <p className="flex-1 text-[1.0625rem] leading-relaxed text-white/90 drop-shadow-sm">
            {description}
          </p>
          <div className="mt-6 flex items-center gap-2 text-[11px] font-bold tracking-[0.2em] uppercase text-white/80 group-hover:text-white transition-colors">
            Explore programme
            <ArrowRight className="h-4 w-4 transition-transform duration-base ease-out group-hover:translate-x-1" aria-hidden="true" />
          </div>
        </div>
      </Card>
    </Link>
  )
}
