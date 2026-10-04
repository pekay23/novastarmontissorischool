/**
 * Grading-band validation, resolution and the cross-row write rule.
 *
 * This is the most consequential file in the package. A band is the only thing
 * standing between a child's percentage and the label a parent reads, so the
 * properties pinned here are the ones that decide whether a misconfigured scale
 * reaches a report card:
 *
 *  - a band that runs backwards, leaves 0-100, doubles up a percentage, or leaves
 *    a hole between two bands is a defect (`findGradeBandDefects`);
 *  - an unreachable edge is NOT a defect, because "report nothing below 50" is a
 *    school's own decision (`findGradeBandCoverageGaps` is the separate, stricter
 *    check the seed calls);
 *  - resolution refuses rather than guesses, so a percentage in a hole or an
 *    overlap resolves to null instead of inheriting the band beneath;
 *  - the single-row admin write refuses only what no legitimate intermediate
 *    state contains — a hole is deliberately not among them, or a scale could
 *    never be retuned.
 *
 * The `scale()` helper builds a complete 0-100 six-band scale. Anything derived
 * from it must still be asserted against the specific rule under test, not just
 * "no defects".
 */
import { describe, expect, test } from "bun:test";
import {
  GRADING_SCALE_RESOLUTION_ORDER,
  assertBandsCoverZeroToHundred,
  determineGrade,
  findGradeBandCoverageGaps,
  findGradeBandDefects,
  findGradeBandWriteConflicts,
  findGradingScaleApplicabilityProblems,
  gradeBandWriteProblems,
  gradingScaleBandWriteRule,
  gradingScaleParentId,
  gradingScaleScopeWhere,
  resolveApplicableGradingScale,
  resolveGradeBand,
  type GradeBand,
  type NamedGradeBand,
} from "../index";

/** A complete, sound 0-100 scale: the Ghana Primary GES 6-level shape. */
const scale = (): NamedGradeBand[] => [
  { key: "l1", minScore: 0, maxScore: 49 },
  { key: "l2", minScore: 50, maxScore: 54 },
  { key: "l3", minScore: 55, maxScore: 59 },
  { key: "l4", minScore: 60, maxScore: 64 },
  { key: "l5", minScore: 65, maxScore: 69 },
  { key: "l6", minScore: 70, maxScore: 100 },
];

/** The same bands with the display fields a stored `GradingLevel` row carries. */
const displayScale = (): GradeBand[] =>
  scale().map((band) => ({ ...band, label: band.key.toUpperCase(), color: "#000000" }));

describe("findGradeBandDefects", () => {
  test("reports nothing for a complete, sound scale", () => {
    expect(findGradeBandDefects(scale())).toEqual([]);
  });

  test("reports a band that runs backwards", () => {
    const problems = findGradeBandDefects([{ key: "x", minScore: 70, maxScore: 30 }]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("x runs backwards");
    expect(problems[0]).toContain("minScore 70 is above maxScore 30");
  });

  test("reports a band reaching outside 0-100", () => {
    expect(findGradeBandDefects([{ key: "x", minScore: 0, maxScore: 149 }])).toEqual([
      "x covers 0-149, outside 0-100",
    ]);
    expect(findGradeBandDefects([{ key: "y", minScore: -10, maxScore: 50 }])).toEqual([
      "y covers -10-50, outside 0-100",
    ]);
  });

  test("a backwards band is named once, as backwards and not also as out of range", () => {
    // `minScore > maxScore` is checked first and `else if` short-circuits, so one
    // malformed row produces one sentence a head teacher can act on.
    expect(findGradeBandDefects([{ key: "x", minScore: 200, maxScore: 300 }])).toHaveLength(1);
  });

  test("names both bands and the contested range when two claim one percentage", () => {
    const problems = findGradeBandDefects([
      { key: "a", minScore: 0, maxScore: 60 },
      { key: "b", minScore: 55, maxScore: 100 },
    ]);

    expect(problems).toEqual(["a (0-60) and b (55-100) both claim 55-60"]);
  });

  test("names the range no band claims when a boundary is mistyped", () => {
    // THE defect that reached a child: 65 belonged to nobody and used to be
    // reported in the band beneath.
    expect(
      findGradeBandDefects([
        { key: "a", minScore: 0, maxScore: 64 },
        { key: "b", minScore: 66, maxScore: 100 },
      ]),
    ).toEqual(["65-65% falls between a and b and matches no band"]);
  });

  test("reports no hole when two bands are merely adjacent", () => {
    expect(
      findGradeBandDefects([
        { key: "a", minScore: 0, maxScore: 49 },
        { key: "b", minScore: 50, maxScore: 100 },
      ]),
    ).toEqual([]);
  });

  test("reports the overlap and NOT a hole for a band that ends inside its predecessor", () => {
    // With `a 0-49, c 30-45, b 50-100` the percentage 46 is claimed by `a`, so
    // there is no hole. Comparing `b` against `c` alone used to report one and
    // refuse through `assertBandsCoverZeroToHundred` a scale that grades every
    // percentage exactly once.
    const problems = findGradeBandDefects([
      { key: "a", minScore: 0, maxScore: 49 },
      { key: "c", minScore: 30, maxScore: 45 },
      { key: "b", minScore: 50, maxScore: 100 },
    ]);

    expect(problems).toEqual(["a (0-49) and c (30-45) both claim 30-45"]);
    expect(problems.some((problem) => problem.includes("falls between"))).toBe(false);

    // The overlap is still a defect, so the strict assert refuses — but for the
    // overlap it can name, never for a hole that no percentage can fall into.
    let thrown: Error | null = null;
    try {
      assertBandsCoverZeroToHundred("Primary", [
        { key: "a", minScore: 0, maxScore: 49 },
        { key: "c", minScore: 30, maxScore: 45 },
        { key: "b", minScore: 50, maxScore: 100 },
      ]);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain("a (0-49) and c (30-45) both claim 30-45");
    expect(thrown?.message).not.toContain("falls between");
  });

  test("finds a hole however the rows are ordered, and reports it once", () => {
    const forwards = findGradeBandDefects([
      { key: "a", minScore: 0, maxScore: 64 },
      { key: "b", minScore: 66, maxScore: 100 },
    ]);
    const backwards = findGradeBandDefects([
      { key: "b", minScore: 66, maxScore: 100 },
      { key: "a", minScore: 0, maxScore: 64 },
    ]);

    expect(forwards).toHaveLength(1);
    expect(backwards).toEqual(forwards);
  });

  test("an unreachable edge is not a defect", () => {
    // "Report nothing below 50" is a school's own decision, and a scale still
    // being built one band at a time looks the same. Neither is a mis-grade.
    expect(
      findGradeBandDefects([
        { key: "a", minScore: 50, maxScore: 69 },
        { key: "b", minScore: 70, maxScore: 100 },
      ]),
    ).toEqual([]);
  });
});

describe("findGradeBandWriteConflicts", () => {
  test("is findGradeBandDefects without the hole", () => {
    const bands = [
      { key: "a", minScore: 0, maxScore: 64 },
      { key: "b", minScore: 66, maxScore: 100 },
    ];

    expect(findGradeBandWriteConflicts(bands)).toEqual([]);
    expect(findGradeBandDefects(bands)).toHaveLength(1);
  });

  test("still refuses a backwards band, an out-of-range band and an overlap", () => {
    expect(findGradeBandWriteConflicts([{ key: "x", minScore: 70, maxScore: 30 }])).toHaveLength(1);
    expect(findGradeBandWriteConflicts([{ key: "x", minScore: 0, maxScore: 149 }])).toHaveLength(1);
    expect(
      findGradeBandWriteConflicts([
        { key: "a", minScore: 0, maxScore: 60 },
        { key: "b", minScore: 55, maxScore: 100 },
      ]),
    ).toHaveLength(1);
  });
});

describe("findGradeBandCoverageGaps", () => {
  test("reports nothing for a scale that reaches both ends", () => {
    expect(findGradeBandCoverageGaps(scale())).toEqual([]);
  });

  test("names the unreachable percentage at each end", () => {
    expect(findGradeBandCoverageGaps([{ key: "a", minScore: 50, maxScore: 70 }])).toEqual([
      "no band covers 0-49%",
      "no band covers 71-100%",
    ]);
  });

  test("reports one end only when the other is covered", () => {
    expect(findGradeBandCoverageGaps([{ key: "a", minScore: 0, maxScore: 70 }])).toEqual([
      "no band covers 71-100%",
    ]);
    expect(findGradeBandCoverageGaps([{ key: "a", minScore: 50, maxScore: 100 }])).toEqual([
      "no band covers 0-49%",
    ]);
  });

  test("an empty scale has no coverage, and says so", () => {
    expect(findGradeBandCoverageGaps([])).toEqual(["the scale has no bands"]);
  });
});

describe("assertBandsCoverZeroToHundred", () => {
  test("passes for a complete scale rather than returning a verdict to forget", () => {
    expect(() => assertBandsCoverZeroToHundred("Ghana Primary", scale())).not.toThrow();
  });

  test("throws naming the scale and every way it fails", () => {
    let thrown: Error | null = null;
    try {
      assertBandsCoverZeroToHundred("Ghana Primary", [
        { key: "a", minScore: 0, maxScore: 64 },
        { key: "b", minScore: 66, maxScore: 100 },
      ]);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown?.message).toContain('Grading scale "Ghana Primary" does not cover 0-100 exactly once');
    expect(thrown?.message).toContain("65-65% falls between a and b and matches no band");
  });

  test("reports the coverage gap of a scale with no defects", () => {
    expect(() => assertBandsCoverZeroToHundred("Partial", [{ key: "a", minScore: 50, maxScore: 70 }])).toThrow(
      /no band covers 0-49%/,
    );
    expect(() => assertBandsCoverZeroToHundred("Empty", [])).toThrow(/the scale has no bands/);
  });
});

describe("gradeBandWriteProblems", () => {
  test("refuses a create that would overlap a stored band", () => {
    expect(
      gradeBandWriteProblems({
        write: { key: "b", minScore: 55, maxScore: 100 },
        stored: [{ id: "a1", key: "a", minScore: 0, maxScore: 60 }],
        editedId: null,
      }),
    ).toEqual(["a (0-60) and b (55-100) both claim 55-60"]);
  });

  test("does not judge an edited row against the version being replaced", () => {
    expect(
      gradeBandWriteProblems({
        write: { key: "b", minScore: 55, maxScore: 100 },
        stored: [
          { id: "b1", key: "b", minScore: 50, maxScore: 60 },
          { id: "a1", key: "a", minScore: 0, maxScore: 49 },
        ],
        editedId: "b1",
      }),
    ).toEqual([]);
  });

  test("accepts anything while a scale is still being built one band at a time", () => {
    // A band is never exhaustive on its own: `0-49` alone is a valid bottom half
    // of a scale. Fewer than two bands cannot overlap and cannot enclose a hole.
    expect(
      gradeBandWriteProblems({ write: { key: "a", minScore: 0, maxScore: 49 }, stored: [], editedId: null }),
    ).toEqual([]);
    expect(
      gradeBandWriteProblems({
        write: { key: "b", minScore: 90, maxScore: 10 },
        stored: [],
        editedId: null,
      }),
    ).toEqual([]);
  });

  test("a delete is judged against the survivors alone", () => {
    // Deleting a middle band is a legitimate step of a restructure; the range it
    // leaves uncovered is reported at resolution rather than guessed at.
    const stored = [
      { id: "a1", key: "a", minScore: 0, maxScore: 49 },
      { id: "b1", key: "b", minScore: 50, maxScore: 59 },
      { id: "c1", key: "c", minScore: 60, maxScore: 100 },
    ];

    expect(gradeBandWriteProblems({ write: null, stored, editedId: "b1" })).toEqual([]);
  });

  test("a delete that would leave an overlap is refused", () => {
    const stored = [
      { id: "a1", key: "a", minScore: 0, maxScore: 60 },
      { id: "b1", key: "b", minScore: 55, maxScore: 100 },
      { id: "c1", key: "c", minScore: 90, maxScore: 100 },
    ];

    expect(gradeBandWriteProblems({ write: null, stored, editedId: "c1" })).toEqual([
      "a (0-60) and b (55-100) both claim 55-60",
    ]);
  });
});

describe("resolveGradeBand", () => {
  test("claims a percentage at either edge of a band, inclusively", () => {
    const bands = displayScale();

    expect(resolveGradeBand(0, bands)?.key).toBe("l1");
    expect(resolveGradeBand(49, bands)?.key).toBe("l1");
    expect(resolveGradeBand(50, bands)?.key).toBe("l2");
    expect(resolveGradeBand(65, bands)?.key).toBe("l5");
    expect(resolveGradeBand(100, bands)?.key).toBe("l6");
  });

  test("hands back the caller's own row, display fields and all", () => {
    const bands = displayScale();
    const matched = resolveGradeBand(72, bands);

    expect(matched).toEqual({
      key: "l6",
      minScore: 70,
      maxScore: 100,
      label: "L6",
      color: "#000000",
    });
  });

  test("returns null for a percentage two bands claim, not the first of them", () => {
    // Answering here would make the winning band a function of row order rather
    // than of the score.
    expect(
      resolveGradeBand(60, [
        { minScore: 0, maxScore: 60, key: "a", label: "A", color: "#000000" },
        { minScore: 55, maxScore: 100, key: "b", label: "B", color: "#000000" },
      ]),
    ).toBeNull();
  });

  test("returns null for a percentage that falls in a hole, not the band beneath", () => {
    expect(
      resolveGradeBand(65, [
        { minScore: 0, maxScore: 64, key: "l3", label: "L3", color: "#000000" },
        { minScore: 66, maxScore: 100, key: "l6", label: "L6", color: "#000000" },
      ]),
    ).toBeNull();
  });

  test("returns null for a percentage outside 0-100 whatever the scale spans", () => {
    // A child scoring 100.5 has a mark that cannot exist, usually `15` typed as
    // `150`. The code this replaced handed it to "the band with the highest
    // minScore" and recorded the child as Excellent.
    expect(resolveGradeBand(150, displayScale())).toBeNull();
    expect(resolveGradeBand(100.5, displayScale())).toBeNull();
    expect(resolveGradeBand(-1, displayScale())).toBeNull();
  });

  test("returns null for a non-finite percentage and for an empty scale", () => {
    expect(resolveGradeBand(Number.NaN, displayScale())).toBeNull();
    expect(resolveGradeBand(Number.POSITIVE_INFINITY, displayScale())).toBeNull();
    expect(resolveGradeBand(70, [])).toBeNull();
  });

  test("a child below a scale's own floor resolves to null", () => {
    // Same answer as out of range, same reason: no band claims it. This is not
    // the hole case and must not be reported as one.
    expect(
      resolveGradeBand(45, [
        { minScore: 50, maxScore: 69, key: "a", label: "A", color: "#000000" },
        { minScore: 70, maxScore: 100, key: "b", label: "B", color: "#000000" },
      ]),
    ).toBeNull();
  });

  test("resolves against the scale's current bands, never a key frozen on the score", () => {
    // The same 68 falls in a different band once the school retunes, and that is
    // the point: `Score.grade` froze a label the school no longer uses. The two
    // scales are each sound, so the difference is the retune alone.
    const before: GradeBand[] = [
      { key: "credit", minScore: 0, maxScore: 69, label: "Credit", color: "#000000" },
      { key: "distinction", minScore: 70, maxScore: 100, label: "Distinction", color: "#000000" },
    ];
    const after: GradeBand[] = [
      { key: "credit", minScore: 0, maxScore: 64, label: "Credit", color: "#000000" },
      { key: "distinction", minScore: 65, maxScore: 100, label: "Distinction", color: "#000000" },
    ];

    expect(findGradeBandDefects(before)).toEqual([]);
    expect(findGradeBandDefects(after)).toEqual([]);
    expect(resolveGradeBand(68, before)?.key).toBe("credit");
    expect(resolveGradeBand(68, after)?.key).toBe("distinction");
  });
});

describe("determineGrade", () => {
  test("returns the label under both keys, which is what the report prints", () => {
    expect(
      determineGrade(70, [
        { minScore: 0, maxScore: 69, key: "l5", label: "Credit" },
        { minScore: 70, maxScore: 100, key: "l6", label: "Distinction" },
      ]),
    ).toEqual({ grade: "Distinction", key: "l6", label: "Distinction" });
  });

  test("returns null when nothing claims the percentage", () => {
    expect(determineGrade(150, [{ minScore: 0, maxScore: 100, key: "a", label: "A" }])).toBeNull();
    expect(determineGrade(70, [])).toBeNull();
  });
});

describe("GRADING_SCALE_RESOLUTION_ORDER", () => {
  test("is default first, then oldest first, then by id", () => {
    // Each key earns its place. `isDefault` is the school's stated preference;
    // `createdAt` keeps a duplicate from displacing the original; `id` makes the
    // order total, because `createdAt` is a timestamp and not a unique key.
    expect(GRADING_SCALE_RESOLUTION_ORDER).toEqual([
      { isDefault: "desc" },
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });
});

describe("resolveApplicableGradingScale", () => {
  const older = { id: "b", appliesToLevels: ["B1"], isDefault: false, createdAt: new Date("2026-01-01") };
  const newer = { id: "c", appliesToLevels: ["B1"], isDefault: false, createdAt: new Date("2026-06-01") };
  const fallback = { id: "d", appliesToLevels: [], isDefault: true, createdAt: new Date("2027-01-01") };

  test("answers the same way whichever order the rows arrive in", () => {
    // Without an ordering clause the winner was whatever order the database
    // happened to return rows in, so a routine VACUUM was enough to move a
    // cohort of children from one band to another with no error anywhere.
    expect(resolveApplicableGradingScale([older, newer], ["B1"])?.id).toBe("b");
    expect(resolveApplicableGradingScale([newer, older], ["B1"])?.id).toBe("b");
  });

  test("prefers a scale naming the level over a newer copy that does not", () => {
    expect(resolveApplicableGradingScale([older, fallback], ["B1"])?.id).toBe("b");
  });

  test("falls back to the default for a level no scale names", () => {
    expect(resolveApplicableGradingScale([older, fallback], ["B9"])?.id).toBe("d");
  });

  test("a default naming the level outranks an older copy that also names it", () => {
    const preferred = { id: "e", appliesToLevels: ["B1"], isDefault: true, createdAt: new Date("2028-01-01") };

    expect(resolveApplicableGradingScale([older, preferred], ["B1"])?.id).toBe("e");
  });

  test("returns null when nothing applies and nothing is the default", () => {
    expect(resolveApplicableGradingScale([older], ["B9"])).toBeNull();
    expect(resolveApplicableGradingScale([], ["B1"])).toBeNull();
  });

  test("ignores null, undefined and empty level keys rather than matching them", () => {
    expect(resolveApplicableGradingScale([older], [null, undefined, ""])).toBeNull();
  });

  test("matches any of several level keys", () => {
    expect(resolveApplicableGradingScale([older], [null, "B2", "B1"])?.id).toBe("b");
    expect(resolveApplicableGradingScale([older], [undefined, "B1"])?.id).toBe("b");
  });

  test("a real timestamp beats a missing one, whatever the input order", () => {
    const undated = { id: "z", appliesToLevels: ["B1"], isDefault: false };

    expect(resolveApplicableGradingScale([older, undated], ["B1"])?.id).toBe("b");
    expect(resolveApplicableGradingScale([undated, older], ["B1"])?.id).toBe("b");
  });

  test("DEFECT: two scales with no createdAt are ordered by the array, not by id", () => {
    // The `id` tiebreaker is documented as the step that makes the order total,
    // and it is unreachable for the case the comment on `Infinity` names: "this
    // only orders the hand-built fixtures and the degenerate caller".
    //
    // `gradingScaleCreatedAtValue` returns Infinity for a scale with no
    // `createdAt`, and `Infinity - Infinity` is NaN — which the guard
    // `if (createdAt !== 0)` does not catch, because `NaN !== 0` is true. The
    // comparator therefore RETURNS NaN, and a comparator that returns NaN is not
    // a comparator: `Array.prototype.sort` treats it as "no opinion" and leaves
    // the rows where they were.
    //
    // These two assertions ARE the defect, and they are stated as one test
    // because the defect is the disagreement between them: the same two scales
    // resolve differently depending only on the order they were handed in. A
    // documented total order would return "aaa" for both. Unreachable from
    // Prisma, which always returns `createdAt`; reachable from the hand-built
    // fixtures that decide how this behaves.
    const low = { id: "aaa", appliesToLevels: ["B1"], isDefault: false };
    const high = { id: "zzz", appliesToLevels: ["B1"], isDefault: false };

    expect(resolveApplicableGradingScale([high, low], ["B1"])?.id).toBe("zzz");
    expect(resolveApplicableGradingScale([low, high], ["B1"])?.id).toBe("aaa");
  });
});

describe("findGradingScaleApplicabilityProblems", () => {
  test("reports nothing for a set that decides unambiguously", () => {
    expect(
      findGradingScaleApplicabilityProblems([
        { id: "b", name: "Ghana Primary", appliesToLevels: ["B1"], isDefault: true },
        { id: "c", name: "JHS", appliesToLevels: ["B7"], isDefault: false },
      ]),
    ).toEqual([]);
  });

  test("names every scale claiming a contested level", () => {
    // `@@unique([tenantId, schoolId, name])` stops two scales sharing a NAME, so
    // "Ghana Primary (GES 6-level)" and "Ghana Primary 2026" are both legal rows
    // that both name B1-B6.
    expect(
      findGradingScaleApplicabilityProblems([
        { id: "b", name: "B", appliesToLevels: ["B1"], isDefault: false },
        { id: "c", name: "C", appliesToLevels: ["B1"], isDefault: false },
      ]),
    ).toEqual([
      'level B1 is claimed by 2 scales ("B", "C"); a class at that level would be graded against whichever one the database returned first',
    ]);
  });

  test("names every default when there is more than one", () => {
    expect(
      findGradingScaleApplicabilityProblems([
        { id: "b", name: "B", appliesToLevels: ["B1"], isDefault: true },
        { id: "c", name: "C", appliesToLevels: ["B2"], isDefault: true },
      ]),
    ).toEqual([
      '2 scales are marked the default ("B", "C"); every level no scale names would fall back to whichever one the database returned first',
    ]);
  });

  test("falls back to the id when a scale has no name to quote", () => {
    const problems = findGradingScaleApplicabilityProblems([
      { id: "b1", appliesToLevels: ["B1"], isDefault: false },
      { id: "b2", appliesToLevels: ["B1"], isDefault: false },
    ]);

    expect(problems[0]).toContain("scale b1");
    expect(problems[0]).toContain("scale b2");
  });

  test("an empty level string claims nothing", () => {
    expect(
      findGradingScaleApplicabilityProblems([
        { id: "b", name: "B", appliesToLevels: [""], isDefault: false },
        { id: "c", name: "C", appliesToLevels: [""], isDefault: false },
      ]),
    ).toEqual([]);
  });

  test("an unnamed, idless scale is still nameable in the sentence", () => {
    const problems = findGradingScaleApplicabilityProblems([
      { appliesToLevels: ["B1"], isDefault: false },
      { appliesToLevels: ["B1"], isDefault: false },
    ]);

    expect(problems[0]).toContain("scale (unnamed)");
  });
});

describe("gradingScaleParentId", () => {
  test("prefers the scale the write names", () => {
    expect(
      gradingScaleParentId({ operation: "update", write: { gradingScaleId: "g1" }, existing: { gradingScaleId: "g2" } }),
    ).toBe("g1");
  });

  test("falls back to the scale the stored row already belongs to", () => {
    // The ownership check and the sibling check must resolve the destination
    // scale the same way, or a band can pass one and be judged against the other.
    expect(
      gradingScaleParentId({ operation: "update", write: {}, existing: { gradingScaleId: "g2" } }),
    ).toBe("g2");
  });

  test("returns null when neither names a scale", () => {
    expect(gradingScaleParentId({ operation: "create", write: {}, existing: null })).toBeNull();
  });

  test("ignores a non-string or empty gradingScaleId", () => {
    expect(gradingScaleParentId({ operation: "create", write: { gradingScaleId: "" }, existing: null })).toBeNull();
    expect(
      gradingScaleParentId({ operation: "create", write: { gradingScaleId: 42 }, existing: null }),
    ).toBeNull();
  });
});

describe("gradingScaleScopeWhere", () => {
  test("matches the caller's school OR a tenant-wide scale", () => {
    // `schoolId` is an OR, never an equality: a tenant-wide scale is shared by
    // every school in the tenant, and refusing it would be the same bug wearing
    // the opposite hat — the band belongs to nobody's school and everybody's
    // report.
    expect(gradingScaleScopeWhere({ id: "g1", tenantId: "t1", schoolId: "s1" })).toEqual({
      id: "g1",
      tenantId: "t1",
      OR: [{ schoolId: "s1" }, { schoolId: null }],
    });
  });

  test("always includes the tenant, so the row cannot be another school's", () => {
    const where = gradingScaleScopeWhere({ id: "g1", tenantId: "t1", schoolId: "s1" });

    expect(where.tenantId).toBe("t1");
    expect(where.id).toBe("g1");
  });

  test("a caller with no school reaches only tenant-wide scales", () => {
    // `schoolId` is null for a tenant-level admin, which is why it is a value to
    // match rather than a filter to skip. Both OR clauses are the tenant-wide
    // predicate here, which is redundant but not wrong — Prisma ORs them.
    const where = gradingScaleScopeWhere({ id: "g1", tenantId: "t1", schoolId: null });

    expect(where.OR.every((clause) => clause.schoolId === null)).toBe(true);
  });
});

describe("gradingScaleBandWriteRule", () => {
  const stored = [{ id: "a1", key: "a", minScore: 0, maxScore: 60 }];
  const reader = (rows: NamedGradeBand[]) => async () => rows;

  test("refuses a create that would overlap a stored band", async () => {
    const problems = await gradingScaleBandWriteRule({
      operation: "create",
      write: { key: "b", gradingScaleId: "g1", minScore: 55, maxScore: 100 },
      existing: null,
      readScaleBands: reader(stored),
    });

    expect(problems).toEqual(["a (0-60) and b (55-100) both claim 55-60"]);
  });

  test("answers nothing and reads nothing when the write names no scale", async () => {
    const problems = await gradingScaleBandWriteRule({
      operation: "create",
      write: { key: "a", minScore: 0, maxScore: 10 },
      existing: null,
      readScaleBands: async () => {
        throw new Error("must not read the scale bands");
      },
    });

    expect(problems).toEqual([]);
  });

  test("merges the written fields over the stored ones for an update", async () => {
    // The write carries only `maxScore`; `minScore` comes from the stored row.
    // Without that merge the rule finds no second bound, answers nothing, and
    // accepts the write — so this case is what makes the merge load-bearing.
    const problems = await gradingScaleBandWriteRule({
      operation: "update",
      write: { key: "b", gradingScaleId: "g1", maxScore: 100 },
      existing: { id: "b1", key: "b", minScore: 55 },
      readScaleBands: reader([{ id: "a1", key: "a", minScore: 0, maxScore: 60 }]),
    });

    expect(problems).toEqual(["a (0-60) and b (55-100) both claim 55-60"]);
  });

  test("a delete removes the row rather than merging it back in", async () => {
    const problems = await gradingScaleBandWriteRule({
      operation: "delete",
      write: {},
      existing: { id: "b1", gradingScaleId: "g1", key: "b", minScore: 50, maxScore: 59 },
      readScaleBands: reader([
        { id: "a1", key: "a", minScore: 0, maxScore: 49 },
        { id: "b1", key: "b", minScore: 50, maxScore: 59 },
        { id: "c1", key: "c", minScore: 60, maxScore: 100 },
      ]),
    });

    expect(problems).toEqual([]);
  });

  test("answers nothing rather than guessing when a bound is missing entirely", async () => {
    // The row's schema requires both bounds, so a validated payload always has
    // them. Inventing a range to judge would refuse a write for a defect it did
    // not cause.
    const problems = await gradingScaleBandWriteRule({
      operation: "update",
      write: { key: "b", gradingScaleId: "g1", maxScore: 45 },
      existing: { id: "b1" },
      readScaleBands: reader([]),
    });

    expect(problems).toEqual([]);
  });

  test("reads the destination scale, so moving a band between scales is judged there", async () => {
    const asked: string[] = [];
    const problems = await gradingScaleBandWriteRule({
      operation: "update",
      write: { key: "b", gradingScaleId: "g2", minScore: 10, maxScore: 20 },
      existing: { id: "b1", gradingScaleId: "g1", minScore: 50, maxScore: 59 },
      readScaleBands: async (gradingScaleId) => {
        asked.push(gradingScaleId);
        return [{ id: "z1", key: "z", minScore: 15, maxScore: 25 }];
      },
    });

    expect(asked).toEqual(["g2"]);
    expect(problems).toEqual(["b (10-20) and z (15-25) both claim 15-20"]);
  });

  test("accepts a hole, because one row per request cannot express a retune", async () => {
    // Moving `level_4` from 60-69 to 60-64 is the first half of a correct two-row
    // retune and the same single write as moving it to 66-69, which is the
    // mistyped boundary. The rows either side are byte-identical; only the
    // admin's intent differs, and intent is not in the database.
    const problems = await gradingScaleBandWriteRule({
      operation: "create",
      write: { key: "l4", gradingScaleId: "g1", minScore: 60, maxScore: 64 },
      existing: null,
      readScaleBands: reader([{ id: "l5", key: "l5", minScore: 65, maxScore: 69 }]),
    });

    expect(problems).toEqual([]);
  });
});