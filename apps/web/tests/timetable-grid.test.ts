import { describe, it, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  TimetableGrid,
  WEEKDAYS,
  groupTimetablePeriods,
  sortTimetablePeriods,
  type TimetableGridProps,
  type TimetablePeriod,
} from '@novastar/shared-ui'

/**
 * Cover for the timetable grid's pure structure.
 *
 * `TimetableGrid` is a presentational component, so the load-bearing
 * logic — which days exist, and in what order periods appear within a
 * day — lives in `groupTimetablePeriods`/`sortTimetablePeriods`, which
 * the render path calls directly. These tests assert those functions so
 * the grid's row structure and ordering are provable without a DOM or a
 * database.
 *
 * Imported through the package root, not by deep path. A test in
 * `apps/portal` reaching into `packages/shared-ui/src/` is a package
 * boundary violation: it resolves a file the package does not publish,
 * silently bypasses the barrel, and breaks the moment the package
 * republishes its entry point. `@novastar/shared-ui` is the contract.
 */

const period = (overrides: Partial<TimetablePeriod>): TimetablePeriod => ({
  id: 'period',
  dayOfWeek: 1,
  startTime: '08:00',
  endTime: '09:00',
  subjectName: 'Mathematics',
  ...overrides,
})

/**
 * Render the component to static markup.
 *
 * The grid is a plain function component with no hooks and no client
 * state, so calling it and stringifying the result exercises the real
 * render path — no DOM, no testing library, and nothing to install.
 * That matters here because the accessibility claims are about the
 * markup: `scope="row"`, the `<caption>`, and the visually-hidden day
 * prefix are only visible once the element tree is serialised, and a
 * test of `groupTimetablePeriods` alone cannot see them.
 */
const render = (props: TimetableGridProps = {}) =>
  renderToStaticMarkup(TimetableGrid(props))

/** How many times `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('TimetableGrid - weekday rows', () => {
  it('labels seven weekday rows, Monday (1) through Sunday (7)', () => {
    expect(WEEKDAYS).toHaveLength(7)
    expect(WEEKDAYS.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(WEEKDAYS.map((d) => d.label)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
    expect(WEEKDAYS.map((d) => d.short)).toEqual([
      'MON',
      'TUE',
      'WED',
      'THU',
      'FRI',
      'SAT',
      'SUN',
    ])
  })

  it('renders a row for every weekday, including days with no periods', () => {
    const days = groupTimetablePeriods([period({ id: 'mon-only' })])
    // All seven rows exist — a day with nothing scheduled keeps its row
    // and renders the per-day empty state rather than disappearing.
    expect(days).toHaveLength(7)
    expect(days[0].periods.map((p) => p.id)).toEqual(['mon-only'])
    expect(days[1].periods).toEqual([])
    expect(days[6].periods).toEqual([])
  })

  it('returns seven empty rows for an empty timetable', () => {
    const days = groupTimetablePeriods([])
    expect(days).toHaveLength(7)
    expect(days.every((d) => d.periods.length === 0)).toBe(true)
  })

  it('drops a period whose dayOfWeek is outside 1-7', () => {
    const days = groupTimetablePeriods([
      period({ id: 'valid', dayOfWeek: 1 }),
      period({ id: 'zero', dayOfWeek: 0 }),
      period({ id: 'eight', dayOfWeek: 8 }),
    ])
    const ids = days.flatMap((d) => d.periods.map((p) => p.id))
    expect(ids).toEqual(['valid'])
  })
})

describe('TimetableGrid - ordering', () => {
  it('sorts periods by startTime within a day', () => {
    const days = groupTimetablePeriods([
      period({ id: 'late', startTime: '13:00', endTime: '14:00' }),
      period({ id: 'early', startTime: '08:30', endTime: '09:30' }),
      period({ id: 'mid', startTime: '10:00', endTime: '11:00' }),
    ])
    expect(days[0].periods.map((p) => p.id)).toEqual(['early', 'mid', 'late'])
  })

  it('sorts zero-padded times correctly across the hour boundary', () => {
    // '09:30' < '10:00' lexicographically because both fields are
    // fixed-width — the same property the API relies on when it orders
    // entries by startTime in SQL.
    const sorted = sortTimetablePeriods([
      period({ id: 'ten', startTime: '10:00' }),
      period({ id: 'nine-thirty', startTime: '09:30' }),
      period({ id: 'nine', startTime: '09:00' }),
    ])
    expect(sorted.map((p) => p.id)).toEqual(['nine', 'nine-thirty', 'ten'])
  })

  it('groups by day before time, so each period lands on its own row', () => {
    const days = groupTimetablePeriods([
      period({ id: 'wed', dayOfWeek: 3, startTime: '08:00' }),
      period({ id: 'mon-late', dayOfWeek: 1, startTime: '10:00' }),
      period({ id: 'mon-early', dayOfWeek: 1, startTime: '08:00' }),
    ])
    expect(days[0].periods.map((p) => p.id)).toEqual(['mon-early', 'mon-late'])
    expect(days[1].periods).toEqual([])
    expect(days[2].periods.map((p) => p.id)).toEqual(['wed'])
  })

  it('does not mutate the caller’s array', () => {
    const input = [
      period({ id: 'b', startTime: '10:00' }),
      period({ id: 'a', startTime: '08:00' }),
    ]
    sortTimetablePeriods(input)
    expect(input.map((p) => p.id)).toEqual(['b', 'a'])
  })
})

// ---------------------------------------------------------------------------
// Rendered markup
// ---------------------------------------------------------------------------

describe('TimetableGrid - rendered markup', () => {
  const week = [
    period({ id: 'mon-late', dayOfWeek: 1, startTime: '13:00', endTime: '14:00' }),
    period({
      id: 'mon-early',
      dayOfWeek: 1,
      startTime: '08:00',
      endTime: '09:00',
      subjectCode: 'MTH',
      teacherName: 'Ada Lovelace',
      room: 'Sunflower',
    }),
    period({ id: 'fri', dayOfWeek: 5, startTime: '09:00', endTime: '10:00' }),
  ]

  it('renders a real table with a caption naming class and term', () => {
    const html = render({
      periods: week,
      classLabel: 'Sunflower A',
      termLabel: 'Autumn 2026',
      name: 'Weekly A',
    })
    expect(html).toContain('<table')
    expect(html).toContain('<caption')
    expect(html).toContain('Weekly timetable')
    expect(html).toContain('Weekly A')
    expect(html).toContain('for Sunflower A')
    expect(html).toContain('Autumn 2026')
  })

  it('renders seven row headers, each labelled with its day and short form', () => {
    const html = render({ periods: week })
    // A row header per weekday, so a screen reader can name the row a
    // period belongs to. Not seven of something else.
    expect(occurrences(html, '<th scope="row"')).toBe(7)
    for (const day of WEEKDAYS) {
      expect(html).toContain(`<span class="block font-bold">${day.label}</span>`)
      expect(html).toContain(`<span class="block text-xs font-medium text-muted-foreground">${day.short}</span>`)
    }
    // Column headers too, so the grid is not header-less.
    expect(occurrences(html, '<th scope="col"')).toBe(2)
  })

  it('spells out the day alongside each period, for a reader walking the list', () => {
    const html = render({ periods: week })
    // The table model already ties the cell to its row header; the
    // hidden prefix means the day is also spoken with the period when
    // the reader is stepping through periods one at a time.
    expect(html).toContain('<span class="sr-only">Monday: </span>')
    expect(html).toContain('<span class="sr-only">Friday: </span>')
    expect(html).not.toContain('<span class="sr-only">Tuesday: </span>')
  })

  it('shows subject, code, teacher, time range and room in a cell', () => {
    const html = render({ periods: week })
    expect(html).toContain('Mathematics')
    expect(html).toContain('MTH')
    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('Sunflower')
    // React 19 serialises the `dateTime` prop with its original casing.
    expect(html).toContain('<time dateTime="08:00">08:00</time>')
    expect(html).toContain('<time dateTime="09:00">09:00</time>')
    // Room is prefixed so "Sunflower" is not mistaken for a class name.
    expect(html).toContain('Room Sunflower')
  })

  it('orders the periods inside the Monday row by start time', () => {
    const html = render({ periods: week })
    const mondayRow = html.slice(html.indexOf('>Monday<'))
    expect(mondayRow.indexOf('08:00')).toBeLessThan(mondayRow.indexOf('13:00'))
  })

  it('gives every day with no periods its own empty state, keeping all seven rows', () => {
    const html = render({ periods: week })
    // Seven rows survive; the five quiet days each say so.
    expect(occurrences(html, '<th scope="row"')).toBe(7)
    expect(occurrences(html, 'No periods scheduled')).toBe(5)
    // Two days have periods, so two rows show a list instead.
    expect(occurrences(html, '<ul class="space-y-2">')).toBe(2)
  })

  it('replaces the table with a page-level empty state when nothing is scheduled', () => {
    const html = render({ periods: [], classLabel: 'Sunflower A', termLabel: 'Autumn 2026' })
    // Not a silently empty tbody: no table at all, an announced reason.
    expect(html).not.toContain('<table')
    expect(html).not.toContain('<tbody')
    expect(html).toContain('role="status"')
    expect(html).toContain('No timetable')
    expect(html).toContain('Sunflower A')
    expect(html).toContain('Autumn 2026')
  })
})
