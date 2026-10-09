'use client'

import * as React from 'react'
import * as Icons from 'lucide-react'

import { cn } from '@novastar/shared-ui'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@novastar/shared-ui'

// Icon name to component mapping for server-to-client prop passing
const ICON_MAP: Record<string, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  LayoutDashboard: Icons.LayoutDashboard,
  Brain: Icons.Brain,
  Music: Icons.Music,
  Puzzle: Icons.Puzzle,
  BookOpen: Icons.BookOpen,
  MessageCircle: Icons.MessageCircle,
  Baby: Icons.Baby,
  Globe: Icons.Globe,
  Users: Icons.Users,
  SquareFunction: Icons.SquareFunction,
  Library: Icons.Library,
  FlaskConical: Icons.FlaskConical,
  Languages: Icons.Languages,
  Globe2: Icons.Globe2,
  Calculator: Icons.Calculator,
  Atom: Icons.Atom,
  Landmark: Icons.Landmark,
  Heart: Icons.Heart,
  Sparkles: Icons.Sparkles,
  Palette: Icons.Palette,
  Mic: Icons.Mic,
}

function ResolvedIcon({ name, className, ...props }: { name: string; className?: string; 'aria-hidden'?: boolean }) {
  const IconComponent = ICON_MAP[name]
  if (!IconComponent) return null
  return <IconComponent className={className} {...props} />
}

/**
 * CurriculumAccordion — marketing-page wrapper around the shared-ui Accordion.
 *
 * Designed for "Visual Curriculum Accordions" per the marketing plan Phase 3:
 * "Convert long lists of subjects or focus areas into interactive accordions
 * or tabbed interfaces to keep the page clean while offering deep information."
 *
 * This component:
 * - Is a client component (required by Radix Accordion)
 * - Accepts structured curriculum data (title, description, focus areas, icon name)
 * - Uses the design system tokens (type scale, colours, radii, shadows)
 * - Supports glassmorphism/floating card aesthetic via `tone` prop
 * - Maintains accessibility: proper ARIA, keyboard navigation, focus management
 * - Allows multiple open (type="multiple") or single (type="single")
 */

export interface CurriculumAccordionItem {
  /** Unique identifier for the accordion item */
  id: string
  /** Display title for the trigger */
  title: string
  /** Brief summary shown in trigger (optional) */
  summary?: string
  /** Detailed content shown when expanded */
  content: React.ReactNode
  /** Optional icon name (from lucide-react) displayed in trigger */
  icon?: string
  /** Optional badge/count shown in trigger */
  badge?: string
}

interface CurriculumAccordionPropsBase {
  /** Array of curriculum items to render as accordion sections */
  items: CurriculumAccordionItem[]
  /** Visual tone matching SectionShell tokens */
  tone?: 'canvas' | 'band' | 'deep' | 'flat'
  /** Optional className for the root Accordion */
  className?: string
  /** Optional className for each AccordionItem */
  itemClassName?: string
  /** Optional className for each AccordionTrigger */
  triggerClassName?: string
  /** Optional className for each AccordionContent */
  contentClassName?: string
  /** Whether to render a divider between items */
  divided?: boolean
  /** Collapse icon (defaults to ChevronDown from shared-ui Accordion) */
  collapsible?: boolean
}

type CurriculumAccordionProps =
  | (CurriculumAccordionPropsBase & {
      type: 'single'
      defaultValue?: string
      value?: string
      onValueChange?: (value: string) => void
    })
  | (CurriculumAccordionPropsBase & {
      type: 'multiple'
      defaultValue?: string[]
      value?: string[]
      onValueChange?: (value: string[]) => void
    })

/**
 * Internal mapping of tone to background classes
 */
const TONE_CLASSES = {
  canvas: 'bg-background',
  band: 'bg-surface-container-low',
  deep: 'bg-surface-container',
  flat: 'bg-surface-container-lowest border border-border',
} as const

/**
 * CurriculumAccordion — reusable accordion for curriculum/subject/focus areas
 * on marketing pages.
 */
export function CurriculumAccordion({
  items,
  tone = 'band',
  type = 'multiple',
  defaultValue,
  value,
  onValueChange,
  className,
  itemClassName,
  triggerClassName,
  contentClassName,
  divided = true,
  collapsible = true,
}: CurriculumAccordionProps) {
  // Type assertion needed because Radix Accordion uses discriminated union
  // that TypeScript can't narrow when `type` is a union variable
  const AccordionComponent = Accordion as any
  return (
    <AccordionComponent
      type={type}
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      className={cn(
        'w-full',
        TONE_CLASSES[tone],
        divided && 'divide-y divide-border/50',
        'rounded-md',
        className,
      )}
    >
      {items.map((item) => (
        <AccordionItem
          key={item.id}
          value={item.id}
          className={cn(
            'overflow-hidden',
            divided && 'first:rounded-t-md last:rounded-b-md',
            itemClassName,
          )}
        >
          <AccordionTrigger
            className={cn(
              'flex w-full items-center justify-between gap-4 px-6 py-5 font-medium text-left transition-colors duration-fast',
              'hover:bg-surface-container hover:text-foreground',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              triggerClassName,
            )}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {item.icon && (
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center justify-center h-9 w-9 rounded-sm',
                    'bg-primary-fixed/50 text-primary',
                  )}
                  aria-hidden="true"
                >
                  <ResolvedIcon name={item.icon} className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0">
                <span className="type-title-lg font-medium text-foreground break-words block">
                  {item.title}
                </span>
                {item.summary && (
                  <span className="type-body-lg text-muted-foreground line-clamp-1 block mt-0.5">
                    {item.summary}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {item.badge && (
                <span
                  className={cn(
                    'inline-flex items-center rounded-xs px-2 py-0.5',
                    'type-eyebrow font-medium',
                    'bg-surface-container-high text-muted-foreground',
                  )}
                >
                  {item.badge}
                </span>
              )}
              {collapsible && (
                <span className="text-muted-foreground" aria-hidden="true">
                  {/* ChevronDown is rendered by shared-ui AccordionTrigger */}
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent
            className={cn(
              'overflow-hidden transition-all duration-base ease-out-soft',
              'data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up',
              'px-6 pb-6 text-muted-foreground leading-relaxed',
              contentClassName,
            )}
          >
            <div className="pt-2">{item.content}</div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </AccordionComponent>
  )
}

/**
 * CurriculumFocusItem — helper for rendering focus area details inside
 * AccordionContent. Matches the "focus" array structure used in
 * Academics page ENVIRONMENTS data.
 */
export interface CurriculumFocusItem {
  title: string
  body: string
  icon?: string
}

interface CurriculumFocusListProps {
  items: CurriculumFocusItem[]
  className?: string
}

/**
 * Renders a list of focus areas with consistent styling.
 * Used inside AccordionContent for detailed curriculum breakdowns.
 */
export function CurriculumFocusList({ items, className }: CurriculumFocusListProps) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2', className)}>
      {items.map((focus, index) => (
        <article
          key={focus.title}
          className={cn(
            'relative p-4 rounded-md border border-border/50',
            'bg-surface-container-lowest/80 backdrop-blur-sm',
            'transition-all duration-fast hover:border-border hover:shadow-soft',
          )}
        >
          <div className="flex items-start gap-3">
            {focus.icon && (
              <span
                className={cn(
                  'inline-flex shrink-0 items-center justify-center h-8 w-8 rounded-sm',
                  'bg-primary-fixed/50 text-primary',
                )}
                aria-hidden="true"
              >
                <ResolvedIcon name={focus.icon} className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h4 className="type-label font-semibold text-foreground">
                {focus.title}
              </h4>
              <p className="mt-1.5 type-body-lg text-muted-foreground leading-relaxed">
                {focus.body}
              </p>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

/**
 * CurriculumSubjectCard — for rendering subject chips/lists inside accordion
 * content (e.g., Primary School subjects with descriptions).
 */
export interface CurriculumSubjectItem {
  name: string
  description: string
  icon?: string
  tone?: 'primary' | 'secondary' | 'tertiary'
}

interface CurriculumSubjectListProps {
  items: CurriculumSubjectItem[]
  className?: string
}

export function CurriculumSubjectList({ items, className }: CurriculumSubjectListProps) {
  return (
    <div className={cn('flex flex-wrap gap-3', className)}>
      {items.map((subject) => (
        <div
          key={subject.name}
          className={cn(
            'flex flex-col sm:flex-row sm:items-center gap-2 min-w-[200px]',
            'p-3 rounded-md border border-border/50',
            'bg-surface-container-lowest/80 backdrop-blur-sm',
            'transition-all duration-fast hover:border-border hover:shadow-soft',
          )}
        >
          {subject.icon && (
            <span
              className={cn(
                'inline-flex shrink-0 items-center justify-center h-7 w-7 rounded-sm',
                subject.tone === 'primary' && 'bg-primary-fixed/50 text-primary',
                subject.tone === 'secondary' && 'bg-secondary-fixed/50 text-secondary',
                subject.tone === 'tertiary' && 'bg-tertiary-fixed/50 text-accent-warm-dark',
              )}
              aria-hidden="true"
            >
              <ResolvedIcon name={subject.icon} className="h-3.5 w-3.5" />
            </span>
          )}
          <div className="flex-1 min-w-0">
            <span className="type-label font-medium text-foreground truncate block">
              {subject.name}
            </span>
            <p className="type-eyebrow text-muted-foreground line-clamp-2 block mt-0.5">
              {subject.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}