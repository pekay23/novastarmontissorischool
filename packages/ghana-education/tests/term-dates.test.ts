/**
 * Ghana term date calculation. The property pinned here is that the three
 * terms and the long vacation partition the academic year with no gaps and
 * no overlaps. A child whose birthday falls on a term boundary must not be
 * assigned to two terms or to none. The NaCCA calendar is the reference:
 * Term 1 Sep–Dec, Term 2 Jan–Apr, Term 3 May–Aug, holiday Aug–Sep.
 *
 * The long vacation's end date is pinned exactly because it was once wrong in a
 * way nothing could see: `new Date(year + 1, 8, 31)` reads as "September 31st",
 * which rolls forward to October 1 and made the vacation 17 days longer than the
 * one the doc above describes. `calculateTeachingDays` treats both ends as
 * inclusive, so that quietly added 30 days to every academic year's teaching
 * total. The test that would have caught it is the teaching-day count, not the
 * field access — see "the long vacation does not inflate the teaching-day count".
 */
import { describe, expect, test } from "bun:test";
import { calculateGhanaTermDates, calculateTeachingDays } from "../index";

describe("calculateGhanaTermDates", () => {
  test("returns four consecutive, non-overlapping intervals for 2025-2026", () => {
    const dates = calculateGhanaTermDates(new Date("2025-09-01"));

    // Term 1: Sep 1 – Dec 20, 2025
    expect(dates.term1.start).toEqual(new Date("2025-09-01"));
    expect(dates.term1.end).toEqual(new Date("2025-12-20"));

    // Term 2: Jan 6 – Apr 16, 2026
    expect(dates.term2.start).toEqual(new Date("2026-01-06"));
    expect(dates.term2.end).toEqual(new Date("2026-04-16"));

    // Term 3: May 2 – Aug 15, 2026
    expect(dates.term3.start).toEqual(new Date("2026-05-02"));
    expect(dates.term3.end).toEqual(new Date("2026-08-15"));

    // Holiday: Aug 15 – Sept 1, 2026
    expect(dates.holidays.start).toEqual(new Date("2026-08-15"));
    expect(dates.holidays.end).toEqual(new Date("2026-09-01"));
  });

  test("returns four consecutive, non-overlapping intervals for 2024-2025", () => {
    const dates = calculateGhanaTermDates(new Date("2024-09-01"));

    expect(dates.term1.start).toEqual(new Date("2024-09-01"));
    expect(dates.term1.end).toEqual(new Date("2024-12-20"));

    expect(dates.term2.start).toEqual(new Date("2025-01-06"));
    expect(dates.term2.end).toEqual(new Date("2025-04-16"));

    expect(dates.term3.start).toEqual(new Date("2025-05-02"));
    expect(dates.term3.end).toEqual(new Date("2025-08-15"));

    expect(dates.holidays.start).toEqual(new Date("2025-08-15"));
    expect(dates.holidays.end).toEqual(new Date("2025-09-01"));
  });

  test("term end dates are before the next term starts (Christmas/Easter breaks exist)", () => {
    const dates = calculateGhanaTermDates(new Date("2025-09-01"));

    // Term 1 ends Dec 20, Term 2 starts Jan 6 — there is a Christmas break
    expect(dates.term1.end < dates.term2.start).toBe(true);
    expect(dates.term2.end < dates.term3.start).toBe(true);
    expect(dates.term3.end < dates.holidays.end).toBe(true);
    // September 1, not October 1: month index 8 with day 31 rolls forward, and the
// rollover is invisible unless this exact date is pinned.
    expect(dates.holidays.end.getTime()).toEqual(new Date("2026-09-01").getTime());
    expect(dates.holidays.end.getMonth()).toBe(8);
    expect(dates.holidays.end.getDate()).toBe(1);
  });

  test("academic year start in October still anchors to September 1 of that year", () => {
    // If a school passes Oct 15, the function uses the year of that date
    // for Term 1 start (Sep 1 of same year). This is the current behavior.
    const dates = calculateGhanaTermDates(new Date("2025-10-15"));
    expect(dates.term1.start).toEqual(new Date("2025-09-01"));
  });

  test("handles leap year boundaries correctly", () => {
    // 2024 is a leap year; Feb has 29 days. Term 2 spans Jan 6 – Apr 16.
    const dates = calculateGhanaTermDates(new Date("2024-09-01"));
    expect(dates.term2.start.getFullYear()).toBe(2025);
    expect(dates.term2.end.getMonth()).toBe(3); // April
    expect(dates.term2.end.getDate()).toBe(16);
  });
});

describe("calculateTeachingDays", () => {
  test("counts weekdays between two dates excluding weekends (inclusive range)", () => {
    // Mon Sep 1 – Fri Sep 5, 2025: 5 weekdays (inclusive)
    const days = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-05"),
      []
    );
    expect(days).toBe(5);
  });

  test("excludes weekends within the range", () => {
    // Mon Sep 1 – Mon Sep 8, 2025: 6 weekdays (Sat/Sun excluded)
    const days = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-08"),
      []
    );
    expect(days).toBe(6);
  });

  test("excludes holidays that fall on weekdays", () => {
    // Mon Sep 1 – Fri Sep 5, but Wed Sep 3 is a holiday
    const days = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-05"),
      [{ start: new Date("2025-09-03"), end: new Date("2025-09-03") }]
    );
    expect(days).toBe(4);
  });

  test("excludes multi-day holidays", () => {
    // Mon Sep 1 – Fri Sep 5, Wed-Thu are holidays
    const days = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-05"),
      [{ start: new Date("2025-09-03"), end: new Date("2025-09-04") }]
    );
    expect(days).toBe(3);
  });

  test("holidays on weekends do not double-count exclusion", () => {
    // Sat Sep 6 – Sun Sep 7 are weekend; marking them as holiday changes nothing
    const without = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-08"),
      []
    );
    const withWeekendHoliday = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-08"),
      [{ start: new Date("2025-09-06"), end: new Date("2025-09-07") }]
    );
    expect(withWeekendHoliday).toBe(without);
  });

  test("holiday entirely before range does not affect count", () => {
    const days = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-05"),
      [{ start: new Date("2025-08-20"), end: new Date("2025-08-31") }]
    );
    expect(days).toBe(5);
  });

  test("holiday entirely after range does not affect count", () => {
    const days = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-05"),
      [{ start: new Date("2025-09-10"), end: new Date("2025-09-15") }]
    );
    expect(days).toBe(5);
  });

  test("holiday spanning range start excludes only the overlapping days", () => {
    const days = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-05"),
      [{ start: new Date("2025-08-30"), end: new Date("2025-09-02") }]
    );
    // Mon Aug 30 is before range, Tue Sep 1 and Wed Sep 2 are in range
    // Mon Sep 1, Tue Sep 2 excluded; Wed Sep 3, Thu Sep 4, Fri Sep 5 remain
    expect(days).toBe(3);
  });

  test("holiday spanning range end excludes only the overlapping days", () => {
    const days = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-05"),
      [{ start: new Date("2025-09-04"), end: new Date("2025-09-08") }]
    );
    // Thu Sep 4, Fri Sep 5 excluded; Mon Sep 1 – Wed Sep 3 remain
    expect(days).toBe(3);
  });

  test("empty holiday array equals no holidays", () => {
    const days = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-05"),
      []
    );
    expect(days).toBe(5);
  });

  test("start and end on same weekday returns 1", () => {
    const days = calculateTeachingDays(
      new Date("2025-09-01"),
      new Date("2025-09-01"),
      []
    );
    expect(days).toBe(1);
  });

  test("start and end on same weekend day returns 0", () => {
    const days = calculateTeachingDays(
      new Date("2025-09-06"), // Saturday
      new Date("2025-09-06"),
      []
    );
    expect(days).toBe(0);
  });

  test("handles year boundary correctly (Jan 6 2026 is Tuesday)", () => {
    // Tue Jan 6 – Fri Jan 10, 2026: 4 weekdays
    const days = calculateTeachingDays(
      new Date("2026-01-06"),
      new Date("2026-01-10"),
      []
    );
    expect(days).toBe(4);
  });
});

describe("Term dates + teaching days integration", () => {
  test("Term 1 2025-2026 has expected teaching day count (no holidays)", () => {
    const dates = calculateGhanaTermDates(new Date("2025-09-01"));
    const days = calculateTeachingDays(dates.term1.start, dates.term1.end, []);
    // Sep 1 – Dec 20, 2025 inclusive: 80 weekdays
    expect(days).toBe(80);
  });

  test("Term 2 2025-2026 has expected teaching day count (no holidays)", () => {
    const dates = calculateGhanaTermDates(new Date("2025-09-01"));
    const days = calculateTeachingDays(dates.term2.start, dates.term2.end, []);
    // Jan 6 – Apr 16, 2026 inclusive: 73 weekdays
    expect(days).toBe(73);
  });

  test("Term 3 2025-2026 has expected teaching day count (no holidays)", () => {
    const dates = calculateGhanaTermDates(new Date("2025-09-01"));
    const days = calculateTeachingDays(dates.term3.start, dates.term3.end, []);
    // May 2 – Aug 15, 2026 inclusive: 75 weekdays
    expect(days).toBe(75);
  });

  /**
   * The regression test for the vacation-end rollover, and the reason it exists
   * in this form rather than as a field comparison.
   *
   * September is the month the new academic year opens, so it must contribute
   * most of its weekdays as teaching days. While the vacation ran to October 1
   * instead of September 1, the whole month was excluded and this count came
   * back zero — which is why nothing downstream complained: a teaching-day
   * total of zero for the first month of term is absurd enough to be obvious
   * only if somebody looks.
   *
   * Stated as "the same as September 2 onward, because September 1 is the single
   * excluded day" rather than as a hardcoded number, so the assertion survives a
   * calendar change and still fails if the end date rolls forward again.
   */
  test("the long vacation does not inflate the teaching-day count", () => {
    const dates = calculateGhanaTermDates(new Date("2025-09-01"));
    const holidays = [dates.holidays];

    const wholeSeptember = calculateTeachingDays(
      new Date("2026-09-01"),
      new Date("2026-09-30"),
      holidays,
    );
    const afterTheVacation = calculateTeachingDays(
      new Date("2026-09-02"),
      new Date("2026-09-30"),
      holidays,
    );

    expect(afterTheVacation).toBeGreaterThan(15);
    expect(wholeSeptember).toBe(afterTheVacation);
  });
});