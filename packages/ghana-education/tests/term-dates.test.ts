/**
 * Ghana term date calculation. The property pinned here is that the three
 * terms and the long vacation carry the dates NaCCA sets, on two different
 * academic years. The NaCCA calendar is the reference: Term 1 Sep–Dec, Term 2
 * Jan–Apr, Term 3 May–Aug, long vacation Aug–Sep.
 *
 * WHAT THE CALENDAR IS NOT, contrary to what this file used to claim at two
 * places: the four intervals are not consecutive. The Christmas and Easter
 * breaks sit between them as real gaps (Dec 20 → Jan 6, Apr 16 → May 2). It is
 * also *not* true that no two of them shared a day: `term3.end` and
 * `holidays.start` were both Aug 15, and since both ends of both ranges are
 * inclusive that double-counted the boundary day and cost a real teaching day
 * in every year whose Aug 15 is a weekday. The boundary is now adjacent rather
 * than shared — term 3 owns Aug 15, the vacation opens Aug 16 — and both halves
 * of that are pinned by name below.
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
  test("pins the four NaCCA interval dates for 2025-2026", () => {
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

    // Holiday: Aug 16 – Sept 1, 2026
    expect(dates.holidays.start).toEqual(new Date("2026-08-16"));
    expect(dates.holidays.end).toEqual(new Date("2026-09-01"));
  });

  test("pins the four NaCCA interval dates for 2024-2025", () => {
    const dates = calculateGhanaTermDates(new Date("2024-09-01"));

    expect(dates.term1.start).toEqual(new Date("2024-09-01"));
    expect(dates.term1.end).toEqual(new Date("2024-12-20"));

    expect(dates.term2.start).toEqual(new Date("2025-01-06"));
    expect(dates.term2.end).toEqual(new Date("2025-04-16"));

    expect(dates.term3.start).toEqual(new Date("2025-05-02"));
    expect(dates.term3.end).toEqual(new Date("2025-08-15"));

    expect(dates.holidays.start).toEqual(new Date("2025-08-16"));
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

  test("the intervals are separated by gaps, not consecutive", () => {
    // The direct statement of what the two "consecutive" test names denied. If a
    // future change closes either break, this is what notices.
    const dates = calculateGhanaTermDates(new Date("2025-09-01"));

    // 17 days of Christmas break and 16 of Easter break, in whole days.
    expect(
      Math.round((dates.term2.start.getTime() - dates.term1.end.getTime()) / 86_400_000),
    ).toBe(17);
    expect(
      Math.round((dates.term3.start.getTime() - dates.term2.end.getTime()) / 86_400_000),
    ).toBe(16);
  });

  test("term 3 and the long vacation are adjacent, so the shared day is gone", () => {
    // Adjacency is the property, not adjacency's absence. `term3.end` and
    // `holidays.start` were the same day, which meant a caller walking
    // term3.end -> holidays.start as a closed interval visited Aug 15 twice —
    // once as the last day of term 3 and once as the first day of the vacation.
    // Term 3 owns Aug 15 and the vacation opens the day after it, so each
    // calendar day belongs to exactly one interval.
    const dates = calculateGhanaTermDates(new Date("2025-09-01"));

    expect(dates.term3.end.getTime()).toBe(new Date("2026-08-15").getTime());
    expect(dates.holidays.start.getTime()).toBe(new Date("2026-08-16").getTime());
    expect(
      Math.round((dates.holidays.start.getTime() - dates.term3.end.getTime()) / 86_400_000),
    ).toBe(1);
  });

  test("attaching the calendar's own vacation to term 3 costs no teaching day", () => {
    // The consequence of the old overlap, which was a defect rather than a
    // curiosity. `calculateTeachingDays` drops a day for being a weekend and
    // then drops it again for falling inside a holiday range, so a vacation whose
    // `start` is also the term's `end` deletes a real teaching day whenever that
    // boundary day is a weekday. A caller computing term 3's teaching days with
    // this calendar's own vacation attached got one day fewer than the same
    // call with no holidays, in the years where Aug 15 is a weekday.
    //
    // Aug 15 walks one day forward each year, so it is a weekday in 2024-25 and
    // a weekend in 2025-26. Both branches are pinned by name below, because the
    // old overlap showed up in one of them and not the other: a walk over only
    // the weekend years was green against the defect.
    const weekdayBoundary = calculateGhanaTermDates(new Date("2024-09-01"));
    const weekendBoundary = calculateGhanaTermDates(new Date("2025-09-01"));

    expect(weekdayBoundary.term3.end.getTime()).toBe(new Date("2025-08-15").getTime());
    expect(weekdayBoundary.term3.end.getDay()).toBe(5); // Friday
    expect(weekendBoundary.term3.end.getTime()).toBe(new Date("2026-08-15").getTime());
    expect(weekendBoundary.term3.end.getDay()).toBe(6); // Saturday

    for (const dates of [weekdayBoundary, weekendBoundary]) {
      expect(
        calculateTeachingDays(dates.term3.start, dates.term3.end, [dates.holidays]),
      ).toBe(calculateTeachingDays(dates.term3.start, dates.term3.end, []));
    }
  });

  test("every term of every academic year is unaffected by its own calendar's vacation", () => {
    // The general rule the two named boundary years above are instances of: the
    // vacation lies outside every term in the calendar, so passing it to
    // `calculateTeachingDays` for any term removes nothing. Six consecutive
    // academic-year starts — four weekday Aug 15s and the Saturday and Sunday
    // ones — so the years the old boundary got wrong are all in this list, and a
    // calendar whose vacation drifted back onto term 3's last day fails here in
    // every weekday year even if the two named cases above were deleted.
    for (const year of [2023, 2024, 2025, 2026, 2027, 2028]) {
      const dates = calculateGhanaTermDates(new Date(`${year}-09-01`));

      for (const term of [dates.term1, dates.term2, dates.term3]) {
        expect(
          calculateTeachingDays(term.start, term.end, [dates.holidays]),
        ).toBe(calculateTeachingDays(term.start, term.end, []));
      }
    }
  });

  test("the long vacation ends on the day the next academic year opens", () => {
    // The one boundary that IS continuous: holidays.end and next year's
    // term1.start are the same date, which is what stops an untaught gap
    // appearing between one academic year's calendar and the next.
    const thisYear = calculateGhanaTermDates(new Date("2025-09-01"));
    const nextYear = calculateGhanaTermDates(new Date("2026-09-01"));

    expect(thisYear.holidays.end.getTime()).toBe(nextYear.term1.start.getTime());
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

  test("Term 3 2024-2025 has 76 teaching days with the vacation attached", () => {
    // The weekday-boundary year, pinned as an absolute number rather than only
    // as a comparison. Aug 15 2025 is a Friday, so it is a teaching day, and
    // 2024-25 was one of the years the shared boundary took it away: the same
    // call with the vacation attached used to return 75 and no test noticed.
    const dates = calculateGhanaTermDates(new Date("2024-09-01"));

    // May 2 – Aug 15, 2025 inclusive: 76 weekdays
    expect(dates.term3.end.getDay()).toBe(5); // Friday
    expect(calculateTeachingDays(dates.term3.start, dates.term3.end, [])).toBe(76);
    expect(calculateTeachingDays(dates.term3.start, dates.term3.end, [dates.holidays])).toBe(76);
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