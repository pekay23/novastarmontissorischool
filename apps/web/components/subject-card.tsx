import { cn } from '@novastar/shared-ui'
import { Card, CardTitle } from '@/components/marketing'
import type { LucideIcon } from 'lucide-react'

interface SubjectCardProps {
  title: string
  description: string
  icon: LucideIcon
  tone?: 'primary' | 'secondary' | 'tertiary'
  className?: string
}

const ICON_TONES = {
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary',
  tertiary: 'bg-accent-warm-dark/10 text-accent-warm-dark',
}

/**
 * A subject grid card for the Primary School page.
 * Keeps an academic, structured feel.
 */
export function SubjectCard({ title, description, icon: Icon, tone = 'secondary', className }: SubjectCardProps) {
  return (
    <Card tone="flat" interactive className={cn('flex flex-col gap-6 p-8 bg-surface-container-lowest border-transparent transition-all duration-700 hover:shadow-floating hover:-translate-y-1', className)}>
      <span className={cn('inline-flex h-14 w-14 items-center justify-center rounded-sm', ICON_TONES[tone])}>
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <CardTitle as="h3" className="font-serif text-2xl transition-colors group-hover:text-primary">{title}</CardTitle>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </Card>
  )
}
