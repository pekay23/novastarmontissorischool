// --- Attendance Calculation ---

/** The five states a `AttendanceStudent.status` row can carry. */
export type AttendanceStatusValue =
  | 'PRESENT'
  | 'ABSENT'
  | 'LATE'
  | 'EXCUSED'
  | 'HALF_DAY'

/**
 * How much of one marked session a status credits, as a fraction in 0..1.
 *
 * `LATE` credits a full session: lateness is punctuality, not attendance.
 * `HALF_DAY` credits the half the child was there for.
 *
 * `EXCUSED` is absent from this table on purpose. An authorised absence —
 * illness, a death in the family, an official engagement the school itself
 * approved — is not attendance the child earned and not a failure the school
 * may attribute to them. Scoring it either way is wrong: counting it as an
 * absence penalises the family for the school's own approval, and counting it
 * as a full day lets a term of recorded illness report 100%. It is therefore
 * removed from the accounting entirely, in both the numerator and the
 * denominator, and reported on its own as `excusedDays`.
 */
export const ATTENDANCE_PRESENCE_WEIGHT: Record<string, number> = {
  PRESENT: 1,
  LATE: 1,
  HALF_DAY: 0.5,
  ABSENT: 0,
}

const EXCUSED_STATUS = 'EXCUSED'

/** One attendance row, as the report reads it. */
export interface AttendanceMark {
  date: Date | string | null | undefined
  status: string
}

export interface AttendanceSummaryMetrics {
  /** False when the student has no countable mark in range. */
  hasData: boolean
  /** Credited days as a percentage of countable days, 0-100. Null when there is no countable day. */
  attendanceRate: number | null
  /** Distinct calendar days carrying at least one countable mark. */
  totalAttendanceDays: number
  /** Credited days. Fractional: one `HALF_DAY` credits 0.5. */
  presentDays: number
  /** Distinct days whose every mark was `EXCUSED`. */
  excusedDays: number
  /** Countable days credited nothing. */
  absentDays: number
  /** Countable days credited something less than a full day. */
  partialDays: number
}

/**
 * The UTC calendar day a mark belongs to.
 *
 * `AttendanceStudent.date` is stored as UTC midnight by `normaliseAttendanceDate`
 * in the write path, so the UTC day is the calendar day and the key is
 * machine-independent. A mark with no usable date gets its own unique key: it
 * cannot be shown to belong to any other mark's day, so it is its own day
 * rather than being folded into an arbitrary bucket. `date` is `NOT NULL`, so
 * that branch is unreachable for a stored row — it exists so a malformed fixture
 * degrades to "one row, one day" instead of collapsing a term into one day.
 */
function attendanceDayKey(date: Date | string | null | undefined): string | symbol {
  const parsed = date instanceof Date ? date : typeof date === 'string' ? new Date(date) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }
  return Symbol('undated-attendance-mark')
}

/**
 * Distinct calendar days and the attendance rate, from a flat list of marks.
 *
 * `AttendanceStudent.period` is `NOT NULL` with `''` as the whole-day
 * sentinel, so a day marked per period holds one row per period and a day
 * marked as a whole holds a single row. Counting rows therefore counts
 * periods, not days, and both the day total and the rate were wrong by the
 * number of periods in the register.
 *
 * The fix is to group by UTC day first. Within a day, a day is worth the
 * fraction of its marked sessions the student was credited for:
 * `sum(weight(status)) / countable marks`. That collapses a four-period
 * `PRESENT` register to exactly one full day, credits a `HALF_DAY` 0.5, and
 * charges 0.25 for a student who sat one period of four — none of which a
 * per-row count could express.
 */
export function summariseAttendance(
  marks: readonly AttendanceMark[],
): AttendanceSummaryMetrics {
  const days = new Map<string | symbol, { credited: number; countable: number }>()

  for (const mark of marks) {
    const key = attendanceDayKey(mark.date)
    let day = days.get(key)
    if (!day) {
      day = { credited: 0, countable: 0 }
      days.set(key, day)
    }
    if (mark.status === EXCUSED_STATUS) continue
    day.credited += ATTENDANCE_PRESENCE_WEIGHT[mark.status] ?? 0
    day.countable += 1
  }

  let presentDays = 0
  let excusedDays = 0
  let absentDays = 0
  let partialDays = 0
  for (const day of days.values()) {
    if (day.countable === 0) {
      excusedDays += 1
      continue
    }
    // Weight per mark is at most 1, so the ratio cannot exceed 1; the clamp is
    // a guard against a status added to ATTENDANCE_PRESENCE_WEIGHT with a
    // value above 1, which would let one day report more than one day.
    const credit = Math.min(day.credited / day.countable, 1)
    presentDays += credit
    if (credit === 0) absentDays += 1
    else if (credit < 1) partialDays += 1
  }

  const totalAttendanceDays = days.size - excusedDays
  const hasData = totalAttendanceDays > 0

  return {
    hasData,
    attendanceRate: hasData
      ? Math.round((presentDays / totalAttendanceDays) * 100)
      : null,
    totalAttendanceDays,
    presentDays: Math.round(presentDays * 100) / 100,
    excusedDays,
    absentDays,
    partialDays,
  }
}

export function calculateAttendancePercentage(
  present: number,
  total: number
): { percentage: number; colour: string } {
  if (total === 0) return { percentage: 0, colour: 'gray' }
  const pct = Math.round((present / total) * 100)
  
  let colour = 'green'
  if (pct < 75) colour = 'red'
  else if (pct < 85) colour = 'amber'
  
  return { percentage: pct, colour }
}

