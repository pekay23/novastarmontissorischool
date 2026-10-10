import { Award, Baby, BookOpen, GraduationCap } from 'lucide-react'

/**
 * Academic phases, mirroring the Prisma `Phase` enum.
 *
 * Kept as a string union rather than importing `@prisma/client` so components
 * stay free of the generated client. Adding a phase to the schema means adding
 * it here too.
 */
export type AcademicPhase = 'KINDERGARTEN' | 'PRIMARY' | 'JHS' | 'SHS'

/**
 * Phase badge styles.
 *
 * These previously gave each phase its own hue (`wine`, `secondary`,
 * `accent-earth`, `primary`) on a maroon-tinted `bg-primary-soft`. Four hues plus
 * the tint is the colour noise the 2026-10-04 refinement removed, and
 * `bg-primary-soft` no longer exists — the council replaced it with
 * `--color-tint-warm`. Three cues carry phase identity instead of four colours:
 * a warm tint (maroon text), a stone neutral (ink text), and a navy wash
 * (navy text). SHS reuses the warm tint with terracotta text, which is the same
 * warm family read one step hotter, so the set stays inside the palette the
 * council signed off: smoke neutrals, one warm tint, one cool note.
 */
const PHASE_BADGES: Record<AcademicPhase, string> = {
  KINDERGARTEN: 'border-primary/15 bg-tint-warm text-primary',
  PRIMARY: 'border-border bg-surface-container text-foreground',
  JHS: 'border-secondary/20 bg-secondary-fixed text-secondary',
  SHS: 'border-accent-warm/30 bg-tint-warm text-accent-warm-dark',
}

const FALLBACK_BADGE = 'border-border bg-surface-container-low text-muted-foreground'

export function phaseBadge(phase: string): string {
  return PHASE_BADGES[phase as AcademicPhase] ?? FALLBACK_BADGE
}

/**
 * Icon for a phase, picked with a static switch rather than a lookup variable.
 * Assigning a component to a local (`const Icon = phaseIcon(p)`) and rendering
 * it violates `react-hooks/static-components`: React treats a component created
 * during render as a new component type each pass, which resets its state.
 */
export function PhaseIcon({ phase, className }: { phase: string; className?: string }) {
  switch (phase) {
    case 'KINDERGARTEN':
      return <Baby className={className} aria-hidden="true" />
    case 'PRIMARY':
      return <BookOpen className={className} aria-hidden="true" />
    case 'JHS':
      return <GraduationCap className={className} aria-hidden="true" />
    case 'SHS':
      return <Award className={className} aria-hidden="true" />
    default:
      return <BookOpen className={className} aria-hidden="true" />
  }
}

/**
 * URL-safe anchor for a program section, derived from its display name so the
 * footer can deep-link into `/academics#<slug>` without a separate route.
 */
export function programSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** "18-36 months", or "All ages" when the range is unset. */
export function ageRange(ageMin: number | null, ageMax: number | null): string {
  if (ageMin == null || ageMax == null) return 'All ages'
  return `${ageMin}-${ageMax} months`
}