/**
 * Currency, phone, validation, percentage and string helpers.
 *
 * These are the functions a parent sees their own data rendered through — an
 * amount off the cedi sign, a phone number reformatted one digit short, a name
 * mangled by a slug — so the assertions pin the exact output string rather than
 * a loose "looks formatted" match. A currency helper that is nearly right is a
 * statement on a child's fee.
 *
 * Three of these were wrong and are now pinned to the corrected behaviour:
 * `formatPhone` and `validateGhanaPhone` gated the local arm on nine digits when
 * a Ghanaian number is ten, and `slugify` deleted accented letters instead of
 * transliterating them. `formatPhone` has one caller — the admissions review
 * step in apps/public-site — so a parent was being shown a national number one
 * digit short, for the nine-digit input, and no formatting at all for the ten
 * digit one they are far more likely to type.
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
  test("reformats the 10-digit local form into the international one", () => {
    // Ten digits: `0` + a 2-digit network code + 7. This is the form a parent
    // types, and the local form of `+233 55 441 6937`. It used to be returned
    // unformatted, because the local arm was gated on `length === 9` and ten
    // matched neither arm.
    expect(formatPhone("0554416937")).toBe("+233 55 441 6937");
    expect(formatPhone("0544166937")).toBe("+233 54 416 6937");
    expect(formatPhone("020 123 4567")).toBe("+233 20 123 4567");
  });

  test("reformats the 12-digit +233 international form into spaced groups", () => {
    expect(formatPhone("233554416937")).toBe("+233 55 441 6937");
    expect(formatPhone("+233 55 441 6937")).toBe("+233 55 441 6937");
    expect(formatPhone("+233-55-441-6937")).toBe("+233 55 441 6937");
  });

  test("returns anything it does not recognise unchanged rather than mangling it", () => {
    // A number this function cannot parse is one a human still has to read and
    // correct, so it is never rewritten into something that merely looks
    // formatted.
    expect(formatPhone("")).toBe("");
    expect(formatPhone("not a number")).toBe("not a number");
    // Nine digits is not a Ghanaian number in any form, and reformatting it used
    // to produce `+233 54 416 937` — a national number one digit short, which
    // dials nobody.
    expect(formatPhone("054416937")).toBe("054416937");
    expect(formatPhone("4416937")).toBe("4416937");
  });
});

describe("validateGhanaPhone", () => {
  test("accepts the 10-digit local form and the 12-digit international one", () => {
    // Agrees with `formatPhone` on both arms, which it did not: it used to accept
    // the nine-digit `054416937` and reject the ten-digit `0554416937`, so a form
    // validating against it refused the format Ghanaians actually write.
    expect(validateGhanaPhone("0554416937")).toBe(true);
    expect(validateGhanaPhone("0544166937")).toBe(true);
    expect(validateGhanaPhone("233554416937")).toBe(true);
    expect(validateGhanaPhone("+233 55 441 6937")).toBe(true);
  });

  test("rejects an empty or non-numeric value", () => {
    expect(validateGhanaPhone("")).toBe(false);
    expect(validateGhanaPhone("abc")).toBe(false);
    expect(validateGhanaPhone("12345")).toBe(false);
  });

  test("rejects a nine-digit number, which is not a Ghanaian number in any form", () => {
    expect(validateGhanaPhone("054416937")).toBe(false);
    expect(validateGhanaPhone("4416937")).toBe(false);
  });

  test("is a shape gate, not a proof of allocation", () => {
    // It checks length and leading digit only, and does not consult the NCC's
    // network-code list, so an unallocated-looking number passes. Deliberate: the
    // question being answered is "did the parent type something shaped like a
    // Ghanaian number", and a stricter check would refuse real numbers from
    // ranges this code has no list of.
    expect(validateGhanaPhone("0000000000")).toBe(true);
    expect(validateGhanaPhone("0999999999")).toBe(true);
  });

  test("rejects a ten-digit number that does not start with 0", () => {
    // Ten digits is the right LENGTH and the wrong shape: the trunk 0 is what
    // makes it local rather than an unprefixed national number.
    expect(validateGhanaPhone("5544169377")).toBe(false);
  });

  test("rejects a twelve-digit number that does not start with 233", () => {
    expect(validateGhanaPhone("234554416937")).toBe(false);
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

  test("transliterates accented letters rather than deleting them", () => {
    // `[^\w\s-]` without the `u` flag is ASCII-only, so every non-ASCII letter was
    // removed outright and "Ünïcodé Ñame" became "ncod-ame" — a *different string*
    // rather than a mangled one, so two different names could land on the same
    // slug with nothing to tell them apart. NFD first and `\p{Diacritic}` second
    // is what makes transliteration possible: an accented letter is only a base
    // character plus a combining mark once decomposed.
    expect(slugify("Ünïcodé Ñame")).toBe("unicode-name");
    expect(slugify("Ångström")).toBe("angstrom");
    expect(slugify("Café Münster")).toBe("cafe-munster");
    expect(slugify("Ćwikła")).toBe("cwikła");
  });

  test("keeps letters and digits outside ASCII, transliterating only the accents", () => {
    // `\p{L}`/`\p{N}` rather than `\w`. Under the ASCII class "Καλημέρα" collapsed
    // to the empty string, which is a worse answer than one that keeps the letters
    // and loses only the accent.
    expect(slugify("Καλημέρα")).toBe("καλημερα");
    expect(slugify("你好")).toBe("你好");
    expect(slugify("Größe 42")).toBe("große-42");
  });

  test("preserves a letter Unicode cannot decompose, rather than guessing at it", () => {
    // `ø`, `ł`, `ß`, `æ` and `đ` have no canonical decomposition, so there is
    // nothing to transliterate and inventing `ø` -> `o` would be a guess about
    // someone's name. The output is still a valid URL path segment once
    // percent-encoded, and it is a *different* string per name rather than a
    // collision.
    expect(slugify("Bjørn")).toBe("bjørn");
    expect(slugify("Łódź")).toBe("łodz");
    expect(slugify("Ærø")).toBe("ærø");
  });

  test("the rule is what Unicode can decompose, not what looks like an ASCII letter", () => {
    // `Größe` keeps its eszett because `ß` has no decomposition, while the `ö`
    // beside it does have one. A rule that transliterated "whatever resembles
    // ASCII" would have produced "grosse" here and been guessing.
    expect(slugify("Größe")).toBe("große");
    expect(slugify("Grosse")).toBe("grosse");
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
});