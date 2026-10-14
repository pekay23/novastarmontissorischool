import type { ReactNode } from 'react'
import { Badge, cn, type BadgeProps } from '@novastar/shared-ui'

/**
 * Status colours for the portal's domain statuses.
 *
 * Portal tokens (portal.css) define surfaces and brand hues, not
 * per-status semantic colours, so the status hues come from the Tailwind
 * palette as translucent tints with a dark-mode companion on each
 * foreground. The old hardcoded maps were amber-100/green-100 style fills
 * with no `dark:` half, which read as light blocks on the dark canvas.
 */
const STATUS_COLOR_CLASSES: Record<string, string> = {
  // Invoice / payment statuses (fees page)
  PENDING: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PAID: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  PARTIAL: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  OVERDUE: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  CANCELLED: 'bg-gray-500/10 text-gray-700 dark:text-gray-300',
  DRAFT: 'bg-gray-500/10 text-gray-700 dark:text-gray-300',
  WAIVED: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',

  // Attendance statuses (attendance marking)
  PRESENT: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  ABSENT: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  LATE: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  EXCUSED: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  HALF_DAY: 'bg-purple-500/10 text-purple-700 dark:text-purple-300',

  // Library loan statuses
  ACTIVE: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  RETURNED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  LOST: 'bg-gray-500/10 text-gray-700 dark:text-gray-300',

  // Content statuses (announcements, calendar events)
  PUBLISHED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  ARCHIVED: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
}

/** The colour classes for a status, empty for an unmapped status. */
export function statusBadgeClasses(status: string): string {
  return STATUS_COLOR_CLASSES[status] ?? ''
}

export interface StatusBadgeProps extends BadgeProps {
  status: string
  children?: ReactNode
}

/**
 * A badge tinted by status. Defaults its label to the status string so
 * call sites that render the raw status keep one source of truth.
 */
export function StatusBadge({
  status,
  children,
  className,
  ...props
}: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(STATUS_COLOR_CLASSES[status] ?? '', className)}
      {...props}
    >
      {children ?? status}
    </Badge>
  )
}
