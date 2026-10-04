/**
 * Attendance accounting.
 *
 * `AttendanceStudent.period` is NOT NULL with `''` as the whole-day sentinel, so
 * a day marked per period holds one row per period and a day marked as a whole
 * holds a single row. Counting rows therefore counts periods, not days, and
 * every figure here is keyed on the UTC calendar day first. The dates in these
 * tests are explicit UTC midnights so the day key is the day the test means.
 *
 * The rule that carries the most weight: `EXCUSED` is in neither the numerator
 * nor the denominator. An authorised absence is not attendance the child earned
 * and not a failure the school may attribute to them — counting it as an absence
 * penalises the family for the school's own approval, and counting it as present
 * lets a term of recorded illness report 100%. Both are wrong, so it is removed
 * from the accounting and reported on its own.
 */
import { describe, expect, test } from "bun:test";
import {
  ATTENDANCE_PRESENCE_WEIGHT,
  calculateAttendancePercentage,
  summariseAttendance,
  type AttendanceMark,
} from "../index";

/** UTC midnight on the given day, so `toISOString().slice(0, 10)` is that day. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const mark = (date: Date | string | null, status: string): AttendanceMark => ({ date, status });

describe("ATTENDANCE_PRESENCE_WEIGHT", () => {
  test("credits a full session for present and for late", () => {
    // Lateness is punctuality, not attendance.
    expect(ATTENDANCE_PRESENCE_WEIGHT.PRESENT).toBe(1);
    expect(ATTENDANCE_PRESENCE_WEIGHT.LATE).toBe(1);
  });

  test("credits half for a half day and nothing for an absence", () => {
    expect(ATTENDANCE_PRESENCE_WEIGHT.HALF_DAY).toBe(0.5);
    expect(ATTENDANCE_PRESENCE_WEIGHT.ABSENT).toBe(0);
  });

  test("has no entry for EXCUSED, which is removed from the accounting entirely", () => {
    expect(Object.keys(ATTENDANCE_PRESENCE_WEIGHT)).not.toContain("EXCUSED");
  });
});

describe("summariseAttendance", () => {
  test("counts a four-period register as one day, not four", () => {
    // The whole reason this function groups by day. A per-row count reported this
    // child four days present and inflated the rate by the number of periods in
    // the register.
    const summary = summariseAttendance([
      mark(day("2026-01-05"), "PRESENT"),
      mark(day("2026-01-05"), "PRESENT"),
      mark(day("2026-01-05"), "PRESENT"),
      mark(day("2026-01-05"), "PRESENT"),
      mark(day("2026-01-06"), "ABSENT"),
    ]);

    expect(summary.totalAttendanceDays).toBe(2);
    expect(summary.presentDays).toBe(1);
    expect(summary.attendanceRate).toBe(50);
  });

  test("charges a quarter for a student who sat one period of four", () => {
    const summary = summariseAttendance([
      mark(day("2026-01-05"), "PRESENT"),
      mark(day("2026-01-05"), "ABSENT"),
      mark(day("2026-01-05"), "ABSENT"),
      mark(day("2026-01-05"), "ABSENT"),
    ]);

    expect(summary.totalAttendanceDays).toBe(1);
    expect(summary.presentDays).toBe(0.25);
    expect(summary.partialDays).toBe(1);
    expect(summary.absentDays).toBe(0);
    expect(summary.attendanceRate).toBe(25);
  });

  test("credits a HALF_DAY as half and counts it as a partial day", () => {
    const summary = summariseAttendance([
      mark(day("2026-01-05"), "HALF_DAY"),
      mark(day("2026-01-06"), "LATE"),
    ]);

    expect(summary.presentDays).toBe(1.5);
    expect(summary.partialDays).toBe(1);
    expect(summary.absentDays).toBe(0);
    expect(summary.attendanceRate).toBe(75);
  });

  test("removes an EXCUSED mark from both the numerator and the denominator", () => {
    const summary = summariseAttendance([
      mark(day("2026-01-05"), "EXCUSED"),
      mark(day("2026-01-06"), "PRESENT"),
      mark(day("2026-01-07"), "EXCUSED"),
    ]);

    expect(summary.totalAttendanceDays).toBe(1);
    expect(summary.excusedDays).toBe(2);
    expect(summary.presentDays).toBe(1);
    expect(summary.attendanceRate).toBe(100);
  });

  test("an entirely excused register has no data, not a rate of 100", () => {
    // hasData is false rather than the rate being fabricated, so the report card
    // shows "—" instead of crediting a term of recorded illness.
    const summary = summariseAttendance([mark(day("2026-01-05"), "EXCUSED")]);

    expect(summary.hasData).toBe(false);
    expect(summary.attendanceRate).toBeNull();
    expect(summary.excusedDays).toBe(1);
    expect(summary.totalAttendanceDays).toBe(0);
  });

  test("an empty register has no data and every counter at zero", () => {
    expect(summariseAttendance([])).toEqual({
      hasData: false,
      attendanceRate: null,
      totalAttendanceDays: 0,
      presentDays: 0,
      excusedDays: 0,
      absentDays: 0,
      partialDays: 0,
    });
  });

  test("a day whose every mark is excused is one excused day, however many periods", () => {
    const summary = summariseAttendance([
      mark(day("2026-01-05"), "EXCUSED"),
      mark(day("2026-01-05"), "EXCUSED"),
      mark(day("2026-01-05"), "EXCUSED"),
    ]);

    expect(summary.excusedDays).toBe(1);
    expect(summary.totalAttendanceDays).toBe(0);
  });

  test("a day is excused only when EVERY mark on it is excused", () => {
    const summary = summariseAttendance([
      mark(day("2026-01-05"), "EXCUSED"),
      mark(day("2026-01-05"), "PRESENT"),
    ]);

    expect(summary.excusedDays).toBe(0);
    expect(summary.totalAttendanceDays).toBe(1);
    expect(summary.attendanceRate).toBe(100);
  });

  test("groups a Date and its ISO string onto the same day", () => {
    const summary = summariseAttendance([
      mark(day("2026-01-05"), "PRESENT"),
      mark("2026-01-05T20:00:00.000Z", "PRESENT"),
    ]);

    expect(summary.totalAttendanceDays).toBe(1);
    expect(summary.attendanceRate).toBe(100);
  });

  test("each undated mark is its own day rather than collapsing a term into one", () => {
    // `AttendanceStudent.date` is NOT NULL, so this is unreachable from a stored
    // row. It exists so a malformed fixture degrades to "one row, one day" rather
    // than folding a whole register into an arbitrary bucket.
    const summary = summariseAttendance([mark(null, "PRESENT"), mark(null, "PRESENT")]);

    expect(summary.totalAttendanceDays).toBe(2);
    expect(summary.attendanceRate).toBe(100);
  });

  test("an unrecognised status is countable and credits nothing", () => {
    // Fail-closed: a status added to the table later cannot silently make a
    // register read as 100% before its weight is decided.
    const summary = summariseAttendance([mark(day("2026-01-05"), "MYSTERY")]);

    expect(summary.hasData).toBe(true);
    expect(summary.presentDays).toBe(0);
    expect(summary.absentDays).toBe(1);
    expect(summary.attendanceRate).toBe(0);
  });

  test("a day can never be credited more than one day", () => {
    // The clamp guards against a status added to ATTENDANCE_PRESENCE_WEIGHT with a
    // value above 1, which would let one day report more than one day.
    const summary = summariseAttendance([
      mark(day("2026-01-05"), "PRESENT"),
      mark(day("2026-01-05"), "PRESENT"),
      mark(day("2026-01-05"), "PRESENT"),
    ]);

    expect(summary.presentDays).toBe(1);
    expect(summary.attendanceRate).toBe(100);
  });

  test("rounds presentDays to two places and the rate to a whole number", () => {
    const summary = summariseAttendance([
      mark(day("2026-01-05"), "HALF_DAY"),
      mark(day("2026-01-06"), "PRESENT"),
      mark(day("2026-01-07"), "ABSENT"),
    ]);

    expect(summary.presentDays).toBe(1.5);
    expect(summary.attendanceRate).toBe(Math.round((1.5 / 3) * 100));
  });

  test("classifies a whole absent day, a partial day and a full day as three different things", () => {
    const summary = summariseAttendance([
      mark(day("2026-01-05"), "PRESENT"),
      mark(day("2026-01-06"), "ABSENT"),
      mark(day("2026-01-07"), "HALF_DAY"),
      mark(day("2026-01-08"), "PRESENT"),
    ]);

    expect(summary).toMatchObject({
      totalAttendanceDays: 4,
      presentDays: 2.5,
      absentDays: 1,
      partialDays: 1,
      excusedDays: 0,
      hasData: true,
    });
    expect(summary.attendanceRate).toBe(63);
  });
});

describe("calculateAttendancePercentage", () => {
  test("rounds to a whole percentage and colours by threshold", () => {
    expect(calculateAttendancePercentage(90, 100)).toEqual({ percentage: 90, colour: "green" });
    expect(calculateAttendancePercentage(85, 100)).toEqual({ percentage: 85, colour: "green" });
    expect(calculateAttendancePercentage(84, 100)).toEqual({ percentage: 84, colour: "amber" });
    expect(calculateAttendancePercentage(75, 100)).toEqual({ percentage: 75, colour: "amber" });
    expect(calculateAttendancePercentage(74, 100)).toEqual({ percentage: 74, colour: "red" });
  });

  test("rounds rather than truncating, so 17 of 20 is 85 and not 84", () => {
    expect(calculateAttendancePercentage(17, 20)).toEqual({ percentage: 85, colour: "green" });
    expect(calculateAttendancePercentage(16, 20)).toEqual({ percentage: 80, colour: "amber" });
  });

  test("an empty register is grey and 0 rather than a division by zero", () => {
    expect(calculateAttendancePercentage(0, 0)).toEqual({ percentage: 0, colour: "gray" });
  });

  test("a student who never attended is red, not green", () => {
    expect(calculateAttendancePercentage(0, 20)).toEqual({ percentage: 0, colour: "red" });
  });
});