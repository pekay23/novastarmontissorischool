import { CalendarClock, Clock } from 'lucide-react'
import { cn } from '../lib/utils'

/**
 * One period in a weekly timetable.
 *
 * Deliberately flat and presentational: the API returns Prisma rows
 * with nested relations, and the consuming pages project them into
 * this shape so the grid never knows anything about Prisma, tenants
 * or permissions. `dayOfWeek` follows the `TimetableEntry` convention
 * (1 = Monday … 7 = Sunday) and the times are `HH:mm` text, which
 * sorts correctly as text because both fields are zero-padded.
 */
export interface TimetablePeriod {
  id: string
  /** 1 = Monday … 7 = Sunday, matching `TimetableEntry.dayOfWeek`. */
  dayOfWeek: number
  /** `HH:mm`, 24-hour, zero-padded. */
  startTime: string
  /** `HH:mm`, 24-hour, zero-padded. */
  endTime: string
  subjectName: string
  subjectCode?: string | null
  teacherName?: string | null
  room?: string | null
}

/** One weekday row of the grid, with its periods sorted by start time. */
export interface TimetableDay {
  dayOfWeek: number
  label: string
  short: string
  periods: TimetablePeriod[]
}

/**
 * The seven weekday rows, in `TimetableEntry.dayOfWeek` order.
 *
 * Exported (rather than kept module-private) because it is the
 * definition of the grid's row structure, and tests assert against it
 * directly.
 */
export const WEEKDAYS: ReadonlyArray<{
  value: number
  label: string
  short: string
}> = [
  { value: 1, label: 'Monday', short: 'MON' },
  { value: 2, label: 'Tuesday', short: 'TUE' },
  { value: 3, label: 'Wednesday', short: 'WED' },
  { value: 4, label: 'Thursday', short: 'THU' },
  { value: 5, label: 'Friday', short: 'FRI' },
  { value: 6, label: 'Saturday', short: 'SAT' },
  { value: 7, label: 'Sunday', short: 'SUN' },
]

/**
 * Sort periods by day, then by start time within the day.
 *
 * String comparison is chronological here because `HH:mm` is
 * zero-padded fixed-width text — the same property the API relies on
 * when it orders entries by `startTime`. A copy is returned so the
 * caller's array is never mutated.
 */
export function sortTimetablePeriods(
  periods: ReadonlyArray<TimetablePeriod>,
): TimetablePeriod[] {
  return [...periods].sort(
    (a, b) =>
      a.dayOfWeek - b.dayOfWeek ||
      (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0),
  )
}

/**
 * Project a flat period list into the grid's seven rows.
 *
 * Every weekday is present, even one with no periods — a missing row
 * would read as "this day does not exist" rather than "nothing
 * scheduled", so empty days keep their row and render the per-day
 * empty state. Unknown `dayOfWeek` values (0, 8, …) cannot attach to
 * a row and are dropped, which is why the API validates 1–7 first.
 */
export function groupTimetablePeriods(
  periods: ReadonlyArray<TimetablePeriod>,
): TimetableDay[] {
  const sorted = sortTimetablePeriods(periods)
  return WEEKDAYS.map((day) => ({
    dayOfWeek: day.value,
    label: day.label,
    short: day.short,
    periods: sorted.filter((period) => period.dayOfWeek === day.value),
  }))
}

export interface TimetableGridProps {
  /** Flat period list; grouped and sorted internally. */
  periods?: ReadonlyArray<TimetablePeriod>
  /** Class name shown in the caption and the empty state. */
  classLabel?: string | null
  /** Term name shown in the caption. */
  termLabel?: string | null
  /** Timetable name, when the caller knows it. */
  name?: string | null
  className?: string
}

/**
 * A weekly timetable as seven weekday rows — one row per day, each
 * period cell showing subject (and code), teacher, `start–end` and
 * room, sorted by start time within the day.
 *
 * Presentation-only and props-driven: no fetching, no Prisma, no
 * client state, so the same component serves the class timetable page
 * and the teacher workspace. It carries no `'use client'` directive
 * because, unlike `data-table` and `calendar`, it uses no hooks —
 * both consuming pages are client components and pull it into the
 * client graph themselves.
 *
 * A real `<table>`, not a CSS grid pretending to be one: the day is a
 * `scope="row"` header and every period cell sits in that row's
 * `<td>`, so a screen reader associates each period with its day
 * through the table model itself. The table carries a `<caption>`
 * naming the class and term, and each period opens with a
 * visually-hidden day prefix so the day is spoken alongside the
 * period even when the reader is walking the list of periods rather
 * than the table cells. (An `aria-labelledby` on the period would
 * have replaced its accessible name with the day and hidden the
 * subject and time, which is the opposite of what it is for.)
 *
 * Empty states are part of the component rather than an afterthought:
 * a day with no periods says so in its row, and a timetable with no
 * periods at all gets a page-level empty state with an icon and the
 * reason, instead of a silently empty `<tbody>`.
 */
export function TimetableGrid({
  periods = [],
  classLabel,
  termLabel,
  name,
  className,
}: TimetableGridProps) {
  const days = groupTimetablePeriods(periods)

  if (periods.length === 0) {
    return (
      <div
        role="status"
        className={cn(
          'flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-16 text-center',
          className,
        )}
      >
        <CalendarClock
          className="h-12 w-12 text-muted-foreground opacity-50"
          aria-hidden="true"
        />
        <h3 className="mt-4 text-lg font-semibold text-card-foreground">
          No timetable
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          No weekly timetable is scheduled
          {classLabel ? ` for ${classLabel}` : ''}
          {termLabel ? ` in ${termLabel}` : ''}
          {name ? ` (${name})` : ''}.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('w-full overflow-auto', className)}>
      <table className="w-full caption-bottom text-sm">
        <caption className="mt-2 text-left text-sm text-muted-foreground">
          Weekly timetable
          {name ? ` — ${name}` : ''}
          {classLabel ? ` for ${classLabel}` : ''}
          {termLabel ? `, ${termLabel}` : ''}
        </caption>
        <thead className="[&_tr]:border-b">
          <tr className="border-b">
            <th scope="col" className="h-10 px-2 text-left font-bold">
              Day
            </th>
            <th scope="col" className="h-10 px-2 text-left font-bold">
              Periods
            </th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.dayOfWeek} className="border-b">
              <th
                scope="row"
                className="h-10 px-2 py-3 text-left align-top"
              >
                <span className="block font-bold">{day.label}</span>
                <span className="block text-xs font-medium text-muted-foreground">
                  {day.short}
                </span>
              </th>
              <td className="p-2 align-top">
                {day.periods.length === 0 ? (
                  <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4 opacity-50" aria-hidden="true" />
                    No periods scheduled
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {day.periods.map((period) => (
                      <li
                        key={period.id}
                        className="rounded-md border bg-background p-3"
                      >
                        <span className="sr-only">{day.label}: </span>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="font-medium text-card-foreground">
                            {period.subjectName}
                            {period.subjectCode ? (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {period.subjectCode}
                              </span>
                            ) : null}
                          </span>
                          <span className="text-sm tabular-nums text-muted-foreground">
                            <time dateTime={period.startTime}>
                              {period.startTime}
                            </time>
                            {' – '}
                            <time dateTime={period.endTime}>
                              {period.endTime}
                            </time>
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {period.teacherName ? (
                            <span>{period.teacherName}</span>
                          ) : null}
                          {period.room ? <span>Room {period.room}</span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
