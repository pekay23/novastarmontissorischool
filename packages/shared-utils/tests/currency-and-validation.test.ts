/**
 * Currency, phone, validation, percentage and string helpers.
 *
 * These are the functions a parent sees their own data rendered through — an
 * amount off the cedi sign, a phone number reformatted one digit short, a name
 * mangled by a slug — so the assertions pin the exact output string rather than
 * a loose "looks formatted" match. A currency helper that is nearly right is a
 * statement on a child's fee.
 *
 * Two tests here are pinned RED and say so. See `formatPhone` and
 * `validateGhanaPhone` below: a Ghanaian mobile is 10 digits (`0` + a 2-digit
 * network code + 7 digits), and these two functions agree only on the 9-digit
 * and 12-digit forms, which is the wrong pair. The one caller in the repo is
 * `apps/public-site/components/admissions-form.tsx`, which shows a parent their
 * own typed number back for review before submitting it.
 */
import { describe, expect, test } from "bun:test";
import {
  calculateAverage,
  calculatePercentage,
  calculateWeightedAverage,
  deepClone,
  formatGHS,
  formatPhone,
  generateId,
  generateId as generateIdAgain,
  generateInvoiceNumber,
  generateStudentId,
  parseAmount,
  slugify,
  truncate,
  validateEmail,
  validateGhanaID,
  validateGhanaPhone,
} from "../index";

describe("formatGHS", () => {
  test("prefixes the cedi sign and forces exactly two decimal places", () => {
    expect(formatGHS(0)).toBe("₵0.00");
    expect(formatGHS(1)).toBe("₵1.00");
    expect(formatGHS(12.5)).toBe("₵12.50");
  });

  test("groups thousands and rounds to the nearest centavo", () => {
    expect(formatGHS(1234.5)).toBe("₵1,234.50");
    expect(formatGHS(1234.567)).toBe("₵1,234.57");
    expect(formatGHS(1234.564)).toBe("₵1,234.56");
    expect(formatGHS(1234567.891)).toBe("₵1,234,567.89");
  });

  test("accepts the numeric string a form field or a Decimal column hands it", () => {
    expect(formatGHS("99")).toBe("₵99.00");
    expect(formatGHS("1234.5")).toBe("₵1,234.50");
  });

  test("renders every absent or unparseable amount as ₵0.00 rather than NaN", () => {
    // `amount || 0` collapses null, undefined and '' to 0; parseFloat collapses
    // 'abc' to NaN. A bill that cannot be read must print a zero, never "₵NaN",
    // because this string is what a parent is shown.
    expect(formatGHS(null)).toBe("₵0.00");
    expect(formatGHS(undefined)).toBe("₵0.00");
    expect(formatGHS("")).toBe("₵0.00");
    expect(formatGHS("abc")).toBe("₵0.00");
  });
});

describe("parseAmount", () => {
  test("reads back what formatGHS writes, so the two are inverses", () => {
    expect(parseAmount("₵1,234.50")).toBe(1234.5);
    expect(parseAmount(formatGHS(1234.5))).toBe(1234.5);
    expect(parseAmount(formatGHS(0))).toBe(0);
  });

  test("strips the cedi sign, thousands separators and surrounding space", () => {
    expect(parseAmount(" 100 ")).toBe(100);
    expect(parseAmount("₵ 1,000.25 ")).toBe(1000.25);
  });

  test("returns null for input that is not a number, so a caller can refuse", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("₵")).toBeNull();
  });
});

describe("formatPhone", () => {
  test("reformats the 12-digit +233 international form into spaced groups", () => {
    expect(formatPhone("233554416937")).toBe("+233 55 441 6937");
    expect(formatPhone("+233 55 441 6937")).toBe("+233 55 441 6937");
    expect(formatPhone("+233-55-441-6937")).toBe("+233 55 441 6937");
  });

  test("returns anything it does not recognise unchanged rather than mangling it", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone("not a number")).toBe("not a number");
  });

  test("DEFECT: a 10-digit Ghanaian mobile is returned unformatted rather than reflowed", () => {
    // A Ghanaian mobile number is TEN digits: `0` + a 2-digit network code + 7
    // digits. `0554416937` is the form a parent types, and the local form of the
    // target this function's own comment on line 32 gives (`+233 55 441 6937`).
    //
    // Neither branch of `formatPhone` accepts it. The 9-digit arm tests
    // `cleaned.length === 9`, so 10 digits matches neither the 9- nor the 12-digit
    // arm and falls through to `return phone`. THE EXPECTED VALUE HERE IS THE
    // DEFECT: it should be "+233 55 441 6937". This test goes red when that is
    // fixed.
    //
    // Reachable from apps/public-site/components/admissions-form.tsx:315, which
    // shows a parent their own typed number back on the review step. Harmless on
    // its own, and the reason the sibling defect below is easy to miss.
    expect(formatPhone("0554416937")).toBe("0554416937");
  });

  test("DEFECT: the 9-digit arm produces a national number one digit short", () => {
    // `054416937` matches `cleaned.length === 9 && startsWith('0')` and is sliced
    // into `+233 <2> <3> <3>`, which is a NINE-digit national number. That is not
    // a shorter way of writing a Ghanaian number, it is a different number that
    // will not connect — a parent who reads the review screen and dials
    // `+233 54 416 937` reaches nobody.
    //
    // The correct local form is `0544166937` (10 digits); stripping the leading
    // `0` leaves `544166937`, still 9 and still short. So no input at all produces
    // `+233 54 416 6937`. THE EXPECTED VALUE HERE IS THE DEFECT.
    expect(formatPhone("054416937")).toBe("+233 54 416 937");
  });
});

describe("validateGhanaPhone", () => {
  test("accepts the 9-digit and 12-digit forms", () => {
    expect(validateGhanaPhone("054416937")).toBe(true);
    expect(validateGhanaPhone("233554416937")).toBe(true);
    expect(validateGhanaPhone("+233 55 441 6937")).toBe(true);
  });

  test("rejects an empty or non-numeric value", () => {
    expect(validateGhanaPhone("")).toBe(false);
    expect(validateGhanaPhone("abc")).toBe(false);
    expect(validateGhanaPhone("12345")).toBe(false);
  });

  test("DEFECT: the canonical 10-digit form is rejected", () => {
    // `0554416937` is a complete, dialable Ghanaian mobile number, and this
    // predicate returns false for it — so any form validating against it rejects
    // the format Ghanaians actually write. It has no caller in the repo yet, so
    // nothing is broken today, which is exactly why it is recorded here rather
    // than left unstated. THE EXPECTED VALUE IS THE DEFECT: it should be `true`.
    expect(validateGhanaPhone("0554416937")).toBe(false);
  });
});

describe("validateEmail", () => {
  test("accepts ordinary addresses", () => {
    expect(validateEmail("parent@novastar.test")).toBe(true);
    expect(validateEmail("a.b+tag@sub.domain.co.gh")).toBe(true);
  });

  test("rejects anything without exactly one @ and a dotted domain", () => {
    expect(validateEmail("")).toBe(false);
    expect(validateEmail("no-at-sign.test")).toBe(false);
    expect(validateEmail("two@at@sign.test")).toBe(false);
    expect(validateEmail("no-domain@localhost")).toBe(false);
    expect(validateEmail("trailing@dot.")).toBe(false);
    expect(validateEmail("has space@test.test")).toBe(false);
  });
});

describe("validateGhanaID", () => {
  test("accepts 10 or 12 digits, ignoring formatting characters", () => {
    expect(validateGhanaID("GHA-123456789-0")).toBe(true);
    expect(validateGhanaID("1234567890")).toBe(true);
    expect(validateGhanaID("GHA-123456789-012")).toBe(true);
  });

  test("rejects a length other than 10 or 12", () => {
    expect(validateGhanaID("123456789")).toBe(false);
    expect(validateGhanaID("12345678901")).toBe(false);
    expect(validateGhanaID("")).toBe(false);
  });
});

describe("calculatePercentage", () => {
  test("computes a percentage rounded to two decimal places", () => {
    expect(calculatePercentage(50, 100)).toBe(50);
    expect(calculatePercentage(15, 20)).toBe(75);
    expect(calculatePercentage(1, 3)).toBe(33.33);
    expect(calculatePercentage(2, 3)).toBe(66.67);
    expect(calculatePercentage(0, 100)).toBe(0);
  });

  test("returns null for a mark that cannot be a percentage of anything", () => {
    // A mark of 150 on a 100-mark assessment is a typo, not 150%. Returning a
    // number here would put the top band on a child who scored 15.
    expect(calculatePercentage(150, 100)).toBeNull();
    expect(calculatePercentage(-5, 100)).toBeNull();
  });

  test("returns null rather than dividing by zero or by Infinity", () => {
    expect(calculatePercentage(50, 0)).toBeNull();
    expect(calculatePercentage(0, 0)).toBeNull();
    expect(calculatePercentage(9999, 1)).toBeNull();
  });

  test("returns null for a non-finite mark or total", () => {
    expect(calculatePercentage(Number.NaN, 100)).toBeNull();
    expect(calculatePercentage(50, Number.NaN)).toBeNull();
    expect(calculatePercentage(50, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("calculateAverage", () => {
  test("averages a non-empty list", () => {
    expect(calculateAverage([80, 60, 70])).toBe(70);
    expect(calculateAverage([50])).toBe(50);
  });

  test("returns 0 for an empty list rather than NaN", () => {
    expect(calculateAverage([])).toBe(0);
  });
});

describe("calculateWeightedAverage", () => {
  test("weights by the ratio between weights, so they need not sum to 1", () => {
    // SBA is recorded three times in a term, so the weights present in one
    // rollup routinely exceed the template's sum. Absolute shares would overflow.
    expect(calculateWeightedAverage([{ score: 80, weight: 1 }, { score: 60, weight: 1 }])).toBe(70);
    expect(calculateWeightedAverage([{ score: 80, weight: 3 }, { score: 60, weight: 1 }])).toBe(75);
    expect(
      calculateWeightedAverage([
        { score: 90, weight: 30 },
        { score: 50, weight: 10 },
      ]),
    ).toBe(80);
  });

  test("returns 0 for an empty list — this function's long-standing contract", () => {
    expect(calculateWeightedAverage([])).toBe(0);
  });

  test("treats a weight of 0 as unusable and substitutes defaultWeight", () => {
    // Both rows at 0 fall back to 1, so the answer is the plain mean.
    expect(
      calculateWeightedAverage([
        { score: 80, weight: 0 },
        { score: 60, weight: 0 },
      ]),
    ).toBe(70);
    // Only the first row falls back, so it now carries 1 against the other's 3.
    expect(
      calculateWeightedAverage([
        { score: 80, weight: 0 },
        { score: 60, weight: 3 },
      ]),
    ).toBe(65);
  });

  test("substitutes defaultWeight for a missing or unusable weight, and 1 for a bad default", () => {
    // The zero-weight row falls back to 2, so it outranks the weight-3 row:
    // (80x2 + 60x3) / 5 = 68.
    expect(
      calculateWeightedAverage([{ score: 80, weight: 0 }, { score: 60, weight: 3 }], 2),
    ).toBe(68);
    // A defaultWeight of 0 is itself unusable, so the last resort is 1 and the
    // answer matches the no-default case above exactly. Pinned because "0 and no
    // default behave alike" is the property, not a coincidence of arithmetic.
    expect(
      calculateWeightedAverage([{ score: 80, weight: 0 }, { score: 60, weight: 3 }], 0),
    ).toBe(65);
    expect(
      calculateWeightedAverage([{ score: 80, weight: Number.NaN }], Number.NaN),
    ).toBe(80);
  });

  test("never returns NaN or Infinity, whatever the weights", () => {
    for (const weight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = calculateWeightedAverage([{ score: 80, weight }, { score: 60, weight: 2 }]);
      expect(Number.isFinite(result)).toBe(true);
    }
  });
});

describe("truncate", () => {
  test("appends an ellipsis only when the text is actually cut", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
    expect(truncate("hello", 5)).toBe("hello");
    expect(truncate("hi", 5)).toBe("hi");
  });

  test("keeps exactly maxLength characters before the ellipsis", () => {
    expect(truncate("abcdefgh", 3)).toBe("abc...");
    expect(truncate("abc", 0)).toBe("...");
  });
});

describe("slugify", () => {
  test("lowercases and hyphenates words", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("  Spaces   Here  ")).toBe("spaces-here");
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  test("collapses runs of separators and trims them from both ends", () => {
    expect(slugify("--a__b--")).toBe("a-b");
    expect(slugify("a - b")).toBe("a-b");
    expect(slugify("!!!")).toBe("");
  });

  test("keeps the hyphens in an already-slugified name", () => {
    expect(slugify("Kwabena Osei-Mensah")).toBe("kwabena-osei-mensah");
  });

  test("DEFECT: accented letters are deleted rather than transliterated", () => {
    // `[^\w\s-]` is not Unicode-aware without the `u` flag plus `\p{L}`, so
    // every accented letter is DELETED. "Ünïcodé Ñame" becomes "ncod-ame" — two of
    // eight characters gone, and the result is a different string rather than a
    // mangled one, so a collision between two different names is silent.
    //
    // Ghanaian names are overwhelmingly ASCII so this is rare in practice, but the
    // function is exported and any accented display name reaches it.
    // THE EXPECTED VALUE IS THE DEFECT: it should be "unicode-name".
    expect(slugify("Ünïcodé Ñame")).toBe("ncod-ame");
  });
});

describe("deepClone", () => {
  test("produces a structurally equal copy that is not the same reference", () => {
    const original = { a: 1, nested: { b: [1, 2, 3] } };
    const clone = deepClone(original);

    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.nested).not.toBe(original.nested);

    clone.nested.b.push(4);
    expect(original.nested.b).toEqual([1, 2, 3]);
  });

  test("is a JSON round trip: Dates become strings and undefined keys vanish", () => {
    // Worth pinning because it is a limitation a caller must know about, not a
    // deep clone in the structuredClone sense. `deepClone<T>(obj: T): T` promises
    // the same type back, so the Date→string change is invisible to the compiler
    // and only a test like this one states it. The declared type is widened to
    // `unknown` here for the same reason: asserting a string against a value the
    // compiler still believes is a Date is a type error, which is precisely the
    // gap this test exists to describe.
    const cloned: { when: unknown; gone?: unknown } = deepClone({
      when: new Date("2026-01-01T00:00:00.000Z"),
      gone: undefined,
    });

    expect(cloned.when).toEqual("2026-01-01T00:00:00.000Z");
    expect(typeof cloned.when).toBe("string");
    expect("gone" in cloned).toBe(false);
  });
});

describe("id generation", () => {
  test("generateStudentId pads the sequence to three digits under a NOVA prefix", () => {
    expect(generateStudentId(2026, 7)).toBe("NOVA26007");
    expect(generateStudentId(2026, 123)).toBe("NOVA26123");
    expect(generateStudentId(2026, 1234)).toBe("NOVA261234");
  });

  test("generateInvoiceNumber pads the sequence to four digits under an INV prefix", () => {
    expect(generateInvoiceNumber(2026, 7)).toBe("INV260007");
    expect(generateInvoiceNumber(2026, 12)).toBe("INV260012");
    // A sequence wider than the pad is left whole rather than truncated.
    expect(generateInvoiceNumber(2026, 1234)).toBe("INV261234");
  });

  test("both use the last two digits of the year", () => {
    expect(generateStudentId(1999, 1)).toBe("NOVA99001");
    expect(generateInvoiceNumber(2026, 1)).toBe("INV260001");
  });

  test("generateId carries its prefix and is unique across rapid calls", () => {
    expect(generateId()).toMatch(/^id_[a-z0-9]+$/);
    expect(generateId("pay")).toMatch(/^pay_[a-z0-9]+$/);

    const ids = new Set<string>();
    for (let index = 0; index < 1000; index += 1) ids.add(generateId());
    expect(ids.size).toBe(1000);
  });

  test("generateId is the same function under either import name", () => {
    // Present so a rename of one binding cannot silently diverge from the other.
    expect(generateIdAgain).toBe(generateId);
  });
});