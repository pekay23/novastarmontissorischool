import { describe, it, expect } from 'bun:test'
import {
  ATTENDANCE_PRESENCE_WEIGHT,
  summariseAttendance,
  type AttendanceMark,
} from '@novastar/shared-utils'

/**
 * Attendance as days, proved without a database.
 *
 * `AttendanceStudent.period` is `NOT NULL` with `''` as the whole-day sentinel,
 * so a day marked per period holds one row per period. The report used to size
 * its day count from `records.length`, which made four periods on a Monday read
 * as four school days and inflated the denominator of the rate by the size of
 * the register.
 *
 * `summariseAttendance` is the whole of that fix. Every assertion below is
 * about which rows are counted as a day, and about the three statuses whose
 * meaning had to be decided rather than inherited: `LATE`, `HALF_DAY` and
 * `EXCUSED`.
 */

/** UTC midnight, which is what the write path stores for a calendar day. */
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`)

function marks(
  rows: Array<{ date: string; status: string }>,
): AttendanceMark[] {
  return rows.map((row) => ({ date: day(row.date), status: row.status }))
}

describe('summariseAttendance - rows are not days', () => {
  it('counts four periods on one day as one day, not four', () => {
    const summary = summariseAttendance(
      marks([
        { date: '2026-03-02', status: 'PRESENT' },
        { date: '2026-03-02', status: 'PRESENT' },
        { date: '2026-03-02', status: 'PRESENT' },
        { date: '2026-03-02', status: 'PRESENT' },
      ]),
    )
    // The old count was `records.length` = 4.
    expect(summary.totalAttendanceDays).toBe(1)
    expect(summary.presentDays).toBe(1)
    expect(summary.attendanceRate).toBe(100)
    expect(summary.partialDays).toBe(0)
  })

  it('charges a child who sat one period of four a quarter day', () => {
    const summary = summariseAttendance(
      marks([
        { date: '2026-03-02', status: 'PRESENT' },
        { date: '2026-03-02', status: 'ABSENT' },
        { date: '2026-03-02', status: 'ABSENT' },
        { date: '2026-03-02', status: 'ABSENT' },
      ]),
    )
    // A per-row count would have credited 1 of 4 = 25% for the whole term.
    expect(summary.totalAttendanceDays).toBe(1)
    expect(summary.presentDays).toBe(0.25)
    expect(summary.attendanceRate).toBe(25)
    expect(summary.partialDays).toBe(1)
    expect(summary.absentDays).toBe(0)
  })

  it('averages a period register across days, not across rows', () => {
    const summary = summariseAttendance(
      marks([
        // Monday: all four periods present.
        { date: '2026-03-02', status: 'PRESENT' },
        { date: '2026-03-02', status: 'PRESENT' },
        { date: '2026-03-02', status: 'PRESENT' },
        { date: '2026-03-02', status: 'PRESENT' },
        // Tuesday: absent all four periods.
        { date: '2026-03-03', status: 'ABSENT' },
        { date: '2026-03-03', status: 'ABSENT' },
        { date: '2026-03-03', status: 'ABSENT' },
        { date: '2026-03-03', status: 'ABSENT' },
      ]),
    )
    // Two days, one of them whole: the eight rows are not eight days.
    expect(summary.totalAttendanceDays).toBe(2)
    expect(summary.presentDays).toBe(1)
    expect(summary.attendanceRate).toBe(50)
    expect(summary.absentDays).toBe(1)
  })

  it('groups by the UTC calendar day, so a timestamp later the same day is the same day', () => {
    const summary = summariseAttendance([
      { date: new Date('2026-03-02T00:00:00.000Z'), status: 'PRESENT' },
      { date: new Date('2026-03-02T15:30:00.000Z'), status: 'ABSENT' },
    ])
    expect(summary.totalAttendanceDays).toBe(1)
    expect(summary.presentDays).toBe(0.5)
  })

  it('reads a whole-day mark (period "") as a single countable session', () => {
    const summary = summariseAttendance(marks([{ date: '2026-03-02', status: 'PRESENT' }]))
    expect(summary.totalAttendanceDays).toBe(1)
    expect(summary.presentDays).toBe(1)
  })
})

describe('summariseAttendance - the statuses whose meaning was decided', () => {
  it('credits LATE a full day, because lateness is punctuality', () => {
    const summary = summariseAttendance(
      marks([
        { date: '2026-03-02', status: 'LATE' },
        { date: '2026-03-03', status: 'PRESENT' },
      ]),
    )
    expect(ATTENDANCE_PRESENCE_WEIGHT.LATE).toBe(1)
    expect(summary.presentDays).toBe(2)
    expect(summary.attendanceRate).toBe(100)
  })

  it('credits HALF_DAY half a day', () => {
    const summary = summariseAttendance(
      marks([
        { date: '2026-03-02', status: 'HALF_DAY' },
        { date: '2026-03-03', status: 'PRESENT' },
      ]),
    )
    expect(ATTENDANCE_PRESENCE_WEIGHT.HALF_DAY).toBe(0.5)
    expect(summary.totalAttendanceDays).toBe(2)
    // 0.5 + 1 over 2 days.
    expect(summary.presentDays).toBe(1.5)
    expect(summary.attendanceRate).toBe(75)
    expect(summary.partialDays).toBe(1)
  })

  it('excludes an EXCUSED day from both sides of the rate, and reports it separately', () => {
    // Scored as an absence, the school penalises the child for an absence the
    // school approved. Scored as present, a term of recorded illness would
    // report 100%. So it leaves the accounting, and is visible as its own
    // number instead of vanishing.
    const summary = summariseAttendance(
      marks([
        { date: '2026-03-02', status: 'PRESENT' },
        { date: '2026-03-03', status: 'EXCUSED' },
      ]),
    )
    expect(summary.totalAttendanceDays).toBe(1)
    expect(summary.excusedDays).toBe(1)
    expect(summary.presentDays).toBe(1)
    expect(summary.attendanceRate).toBe(100)
  })

  it('gives EXCUSED no presence weight at all', () => {
    expect('EXCUSED' in ATTENDANCE_PRESENCE_WEIGHT).toBe(false)
  })

  it('still counts the day when one period is excused and another was attended', () => {
    // The day is countable — a session was sat — and the excused period leaves
    // the denominator so it cannot charge for time the school excused.
    const summary = summariseAttendance(
      marks([
        { date: '2026-03-02', status: 'PRESENT' },
        { date: '2026-03-02', status: 'EXCUSED' },
      ]),
    )
    expect(summary.totalAttendanceDays).toBe(1)
    expect(summary.excusedDays).toBe(0)
    expect(summary.presentDays).toBe(1)
    expect(summary.attendanceRate).toBe(100)
  })

  it('counts a wholly excused day as excused rather than as an absence', () => {
    const summary = summariseAttendance(
      marks([
        { date: '2026-03-02', status: 'ABSENT' },
        { date: '2026-03-03', status: 'EXCUSED' },
        { date: '2026-03-04', status: 'EXCUSED' },
      ]),
    )
    expect(summary.totalAttendanceDays).toBe(1)
    expect(summary.excusedDays).toBe(2)
    expect(summary.absentDays).toBe(1)
    expect(summary.attendanceRate).toBe(0)
  })

  it('does not crash on a status it has never heard of, and credits it nothing', () => {
    // The day is still countable — it was marked — but an unmapped status
    // cannot be assumed to be attendance.
    const summary = summariseAttendance(
      marks([
        { date: '2026-03-02', status: 'PRESENT' },
        { date: '2026-03-03', status: 'SOMETHING_NEW' },
      ]),
    )
    expect(summary.totalAttendanceDays).toBe(2)
    expect(summary.presentDays).toBe(1)
    expect(summary.attendanceRate).toBe(50)
  })
})

describe('summariseAttendance - no data is null, never 0', () => {
  it('returns a null rate for an empty register', () => {
    const summary = summariseAttendance([])
    expect(summary.hasData).toBe(false)
    // The distinction the report card depends on: "not recorded" is not "0%".
    expect(summary.attendanceRate).toBeNull()
    expect(summary.totalAttendanceDays).toBe(0)
    expect(summary.presentDays).toBe(0)
  })

  it('reports a real 0% as zero, so the null above is not vacuous', () => {
    const summary = summariseAttendance(marks([{ date: '2026-03-02', status: 'ABSENT' }]))
    expect(summary.hasData).toBe(true)
    expect(summary.attendanceRate).toBe(0)
    expect(summary.presentDays).toBe(0)
  })

  it('reports a null rate when every day in range was excused', () => {
    // Nothing to report is not a zero.
    const summary = summariseAttendance(
      marks([
        { date: '2026-03-02', status: 'EXCUSED' },
        { date: '2026-03-03', status: 'EXCUSED' },
      ]),
    )
    expect(summary.hasData).toBe(false)
    expect(summary.attendanceRate).toBeNull()
    expect(summary.totalAttendanceDays).toBe(0)
    expect(summary.excusedDays).toBe(2)
  })
})

describe('summariseAttendance - a mark with no usable date is its own day', () => {
  it('does not collapse an undated set of marks into a single day', () => {
    // `date` is NOT NULL, so this is unreachable for a stored row. It is the
    // documented degradation for a malformed fixture or a legacy import:
    // one row, one day — never every row silently merged into one.
    const summary = summariseAttendance([
      { date: null, status: 'PRESENT' },
      { date: null, status: 'ABSENT' },
      { date: null, status: 'PRESENT' },
    ])
    expect(summary.totalAttendanceDays).toBe(3)
    expect(summary.presentDays).toBe(2)
    expect(summary.attendanceRate).toBe(67)
  })

  it('treats an unparseable date string the same way', () => {
    const summary = summariseAttendance([
      { date: 'not-a-date', status: 'PRESENT' },
      { date: 'not-a-date', status: 'ABSENT' },
    ])
    expect(summary.totalAttendanceDays).toBe(2)
  })

  it('does not merge an undated mark into a dated day', () => {
    const summary = summariseAttendance([
      { date: day('2026-03-02'), status: 'PRESENT' },
      { date: null, status: 'ABSENT' },
    ])
    expect(summary.totalAttendanceDays).toBe(2)
    expect(summary.attendanceRate).toBe(50)
  })
})