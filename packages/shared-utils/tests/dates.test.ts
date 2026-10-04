/**
 * Date formatting helpers.
 *
 * Every assertion uses a date string with no timezone offset, because
 * `parseISO("2026-01-15")` is local midnight and `format` renders in local time.
 * A `Z`-suffixed fixture would make every expected string depend on the machine's
 * offset, which is the usual reason a date suite only passes in CI.
 *
 * The Twi locale is deliberately pinned as English. `shared-utils` builds it by
 * spreading `enUS` and overwriting `code`, so `'tw'` currently formats
 * identically to `'en'` — a documented fallback, not a translation, and the test
 * says so before a real Twi locale lands and turns it red on purpose.
 */
import { describe, expect, test } from "bun:test";
import { formatDate, formatDateRange, formatDateTime, timeAgo } from "../index";

describe("formatDate", () => {
  test("formats an ISO date string in long English form", () => {
    expect(formatDate("2026-01-15")).toBe("Jan 15, 2026");
    expect(formatDate("2026-12-31")).toBe("Dec 31, 2026");
    expect(formatDate("2026-09-01")).toBe("Sep 1, 2026");
  });

  test("accepts a Date as readily as a string", () => {
    expect(formatDate(new Date(2026, 0, 15))).toBe("Jan 15, 2026");
  });

  test("renders an absent or unusable date as an em dash, never 'Invalid Date'", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("not a date")).toBe("—");
    expect(formatDate(new Date("nonsense"))).toBe("—");
  });

  test("the 'tw' locale is an English fallback, not a translation", () => {
    // `const tw: Locale = { ...enUS, code: 'tw' }` — every month name, day name
    // and format pattern is the English one. Pinned so that shipping a real Twi
    // locale is a visible, deliberate change to this line rather than a silent
    // one that leaves a parent reading an English report card.
    expect(formatDate("2026-01-15", "tw")).toBe("Jan 15, 2026");
    expect(formatDate("2026-01-15", "tw")).toBe(formatDate("2026-01-15", "en"));
  });

  test("defaults to English when no locale is passed", () => {
    expect(formatDate("2026-01-15")).toBe(formatDate("2026-01-15", "en"));
  });
});

describe("formatDateTime", () => {
  test("adds the time of day to the long date", () => {
    expect(formatDateTime("2026-01-15T13:45:00")).toBe("Jan 15, 2026, 1:45:00 PM");
    expect(formatDateTime("2026-01-15T09:05:00")).toBe("Jan 15, 2026, 9:05:00 AM");
    expect(formatDateTime("2026-01-15T00:00:00")).toBe("Jan 15, 2026, 12:00:00 AM");
  });

  test("renders an absent or unusable date-time as an em dash", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });
});

describe("formatDateRange", () => {
  test("joins two formatted dates with an em dash", () => {
    expect(formatDateRange("2026-01-01", "2026-03-31")).toBe("Jan 1, 2026 — Mar 31, 2026");
  });

  test("an open-ended range keeps the em dash beside the missing end", () => {
    // An open range is a real state for a term that has not started or an
    // invoice that has not been paid, and "Jan 1, 2026 — " reads as a range
    // rather than as a missing value.
    expect(formatDateRange("2026-01-01", null)).toBe("Jan 1, 2026 — —");
    expect(formatDateRange(null, "2026-03-31")).toBe("— — Mar 31, 2026");
    expect(formatDateRange(null, null)).toBe("— — —");
  });

  test("passes the locale through to both ends", () => {
    expect(formatDateRange("2026-01-01", "2026-03-31", "tw")).toBe(
      formatDateRange("2026-01-01", "2026-03-31", "en"),
    );
  });
});

describe("timeAgo", () => {
  test("describes a recent instant relative to now", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(timeAgo(twoHoursAgo)).toBe("about 2 hours ago");
  });

  test("says 'ago' for the past and 'in ...' for the future", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const threeDaysAhead = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    expect(timeAgo(threeDaysAgo)).toContain("ago");
    expect(timeAgo(threeDaysAhead)).toContain("in ");
  });

  test("accepts an ISO string as readily as a Date", () => {
    const expected = timeAgo(new Date(Date.now() - 60 * 60 * 1000));
    const asString = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(timeAgo(asString)).toBe(expected);
  });

  test("renders an absent or unusable date as an em dash", () => {
    expect(timeAgo(null)).toBe("—");
    expect(timeAgo(undefined)).toBe("—");
    expect(timeAgo("")).toBe("—");
    expect(timeAgo("not a date")).toBe("—");
  });
});