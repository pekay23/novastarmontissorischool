/**
 * Assessment weights, the report-card summary, and band contrast.
 *
 * `computeAcademicSummary` produces the two percentage figures a parent reads,
 * and the whole point of the module is that they are NOT the same number:
 * `weightedPercentage` is the mean mark, so a subject with more assessments
 * contributes more of it, and `overallPercentage` is the mean of the per-subject
 * percentages, so ten HOMEWORK rows cannot outvote one FINAL. Every case below
 * builds a fixture whose two answers differ, because a fixture where they agree
 * cannot tell the two rules apart.
 *
 * There is no grade point anywhere in this file, by design: percentage is the
 * unit of grading in this product and the 0-4 average this replaced was measured
 * on a column that has since been removed.
 */
import { describe, expect, test } from "bun:test";
import {
  calculateWeightedAverage,
  computeAcademicSummary,
  contrastTextColor,
  resolveAssessmentWeight,
  type GradeBand,
  type ReportableAssessment,
} from "../index";

const scale = (): GradeBand[] => [
  { key: "l1", minScore: 0, maxScore: 49, label: "L1", color: "#000000" },
  { key: "l2", minScore: 50, maxScore: 54, label: "L2", color: "#000000" },
  { key: "l3", minScore: 55, maxScore: 59, label: "L3", color: "#000000" },
  { key: "l4", minScore: 60, maxScore: 64, label: "L4", color: "#000000" },
  { key: "l5", minScore: 65, maxScore: 69, label: "L5", color: "#000000" },
  { key: "l6", minScore: 70, maxScore: 100, label: "L6", color: "#000000" },
];

const row = (overrides: Partial<ReportableAssessment> = {}): ReportableAssessment => ({
  subjectId: "s1",
  percentage: 70,
  weight: null,
  ...overrides,
});

describe("resolveAssessmentWeight", () => {
  test("the assessment's own weight wins", () => {
    expect(resolveAssessmentWeight({ weight: 3, typeDefaultWeight: 2 })).toEqual({
      weight: 3,
      source: "assessment",
    });
  });

  test("the school's configured type weight is next", () => {
    expect(resolveAssessmentWeight({ weight: null, typeDefaultWeight: 2 })).toEqual({
      weight: 2,
      source: "assessment_type",
    });
  });

  test("1 and 'default' is the last resort", () => {
    expect(resolveAssessmentWeight({ weight: null, typeDefaultWeight: null })).toEqual({
      weight: 1,
      source: "default",
    });
    expect(resolveAssessmentWeight({ weight: null })).toEqual({ weight: 1, source: "default" });
  });

  test("an explicit weight of exactly 1 is a weight, not a sentinel", () => {
    // `Assessment.weight` is nullable precisely so that "no weight of its own"
    // and "a teacher set this to 1.00" are two different facts. It used to be
    // `NOT NULL DEFAULT 1` with a 1-sentinel overload, so a teacher who chose
    // 1.00 deliberately had it discarded in favour of the type's default.
    expect(resolveAssessmentWeight({ weight: 1, typeDefaultWeight: 5 })).toEqual({
      weight: 1,
      source: "assessment",
    });
  });

  test("an explicit 0 falls through to the type default, it does not exclude", () => {
    // A normalised weighted mean with every weight at 0 has nothing to divide by.
    // And the read path hands this `Number(assessment.weight)`, which turns NULL
    // into 0 — treating 0 as "excluded" would silently drop every assessment
    // that carries no weight of its own, which is the majority of them.
    expect(resolveAssessmentWeight({ weight: 0, typeDefaultWeight: 2 })).toEqual({
      weight: 2,
      source: "assessment_type",
    });
    expect(resolveAssessmentWeight({ weight: 0, typeDefaultWeight: null })).toEqual({
      weight: 1,
      source: "default",
    });
  });

  test("a negative or non-finite weight is unusable, like zero", () => {
    for (const weight of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveAssessmentWeight({ weight, typeDefaultWeight: 2 })).toEqual({
        weight: 2,
        source: "assessment_type",
      });
    }
  });
});

describe("computeAcademicSummary — the two percentages", () => {
  test("weightedPercentage is the mean mark and overallPercentage is the mean of subjects", () => {
    // English: one FINAL at 100 weighted 3. Maths: five HOMEWORK at 50 weighted
    // 1 each, so Maths carries 5 points of weight to English's 3.
    //
    // The two rules must not agree here, or the test cannot tell them apart:
    // mean mark = (100*3 + 50*5) / 8 = 68.75, but mean of subjects is
    // (100 + 50) / 2 = 75 because Maths counts once however many rows it has.
    // The earlier fixture had three homework rows, which put Maths on exactly
    // English's weight of 3 and made both rules answer 75 — a fixture in which
    // redefining `overallPercentage` as the weighted mean changes nothing.
    const summary = computeAcademicSummary(
      [
        row({ subjectId: "english", percentage: 100, weight: 3 }),
        row({ subjectId: "maths", percentage: 50, weight: 1 }),
        row({ subjectId: "maths", percentage: 50, weight: 1 }),
        row({ subjectId: "maths", percentage: 50, weight: 1 }),
        row({ subjectId: "maths", percentage: 50, weight: 1 }),
        row({ subjectId: "maths", percentage: 50, weight: 1 }),
      ],
      scale(),
    );

    expect(summary.weightedPercentage).toBe(68.75);
    expect(summary.overallPercentage).toBe(75);
    expect(summary.gradedAssessments).toBe(6);
    expect(summary.subjectCount).toBe(2);
  });

  test("the two percentages diverge when the subject weights differ", () => {
    // English 80 at weight 1; Maths 60 at weight 3. Mean mark = (80 + 180)/4 =
    // 65; mean of subjects = (80 + 60)/2 = 70. A report card that printed the
    // wrong one of these would move a child by five points.
    const summary = computeAcademicSummary(
      [
        row({ subjectId: "english", percentage: 80, weight: 1 }),
        row({ subjectId: "maths", percentage: 60, weight: 3 }),
      ],
      scale(),
    );

    expect(summary.weightedPercentage).toBe(65);
    expect(summary.overallPercentage).toBe(70);
  });

  test("a subject's own percentage is already weighted internally", () => {
    // English's two rows are weighted 3:1, so the subject contributes 65, not the
    // unweighted 70, and overallPercentage is (65 + 60)/2.
    const summary = computeAcademicSummary(
      [
        row({ subjectId: "english", percentage: 80, weight: 3 }),
        row({ subjectId: "english", percentage: 40, weight: 1 }),
        row({ subjectId: "maths", percentage: 60, weight: 1 }),
      ],
      scale(),
    );

    expect(summary.subjects[0]?.percentage).toBe(70);
    expect(summary.overallPercentage).toBe(65);
  });

  test("groups by subject id, never by subject name", () => {
    // Two subjects may share a display name and a name may be renamed mid-term,
    // so grouping by name would merge two subjects or split one.
    const summary = computeAcademicSummary(
      [
        row({ subjectId: "sub-1", percentage: 80, weight: 1 }),
        row({ subjectId: "sub-2", percentage: 60, weight: 1 }),
      ],
      scale(),
    );

    expect(summary.subjectCount).toBe(2);
    expect(summary.subjects.map((subject) => subject.subjectId)).toEqual(["sub-1", "sub-2"]);
  });

  test("preserves the order the caller supplied subjects in", () => {
    const summary = computeAcademicSummary(
      [
        row({ subjectId: "zeta", percentage: 80 }),
        row({ subjectId: "alpha", percentage: 60 }),
        row({ subjectId: "mu", percentage: 70 }),
      ],
      scale(),
    );

    expect(summary.subjects.map((subject) => subject.subjectId)).toEqual(["zeta", "alpha", "mu"]);
  });
});

describe("computeAcademicSummary — what is excluded", () => {
  test("an ungraded assessment contributes nothing at all", () => {
    const summary = computeAcademicSummary(
      [
        row({ subjectId: "english", percentage: 80 }),
        row({ subjectId: "english", percentage: null }),
      ],
      scale(),
    );

    expect(summary.gradedAssessments).toBe(1);
    expect(summary.weightedPercentage).toBe(80);
    expect(summary.overallPercentage).toBe(80);
  });

  test("a percentage outside 0-100 is not a mark and is dropped", () => {
    // The write path refuses to store such a percentage, so what this catches is
    // a row that predates that guard. Averaging it would report a terminal mark
    // no child earned.
    const summary = computeAcademicSummary(
      [row({ percentage: 80 }), row({ subjectId: "s2", percentage: 150 })],
      scale(),
    );

    expect(summary.gradedAssessments).toBe(1);
    expect(summary.weightedPercentage).toBe(80);
    expect(summary.overallPercentage).toBe(80);
    expect(summary.subjects.map((subject) => subject.subjectId)).toEqual(["s1"]);
  });

  test("an empty list yields nulls, not zeros", () => {
    // No graded assessment is "scored zero percent". A report card must not
    // print a fabricated zero.
    const summary = computeAcademicSummary([], scale());

    expect(summary).toEqual({
      gradedAssessments: 0,
      weightedPercentage: null,
      overallPercentage: null,
      weighting: { rule: "normalised-weighted-mean", totalWeight: 0, components: [] },
      subjectCount: 0,
      subjects: [],
    });
  });

  test("a weight of 0 is unusable, so a row that carries only 0 still scores", () => {
    // The alternative — dropping it — would silently remove the majority of
    // assessments, because the read path turns the nullable column into 0.
    const summary = computeAcademicSummary([row({ percentage: 80, weight: 0 })]);

    expect(summary.gradedAssessments).toBe(1);
    expect(summary.subjects[0]?.percentage).toBe(80);
    expect(summary.weighting.totalWeight).toBe(1);
    expect(summary.overallPercentage).toBe(80);
  });
});

describe("computeAcademicSummary — weighting breakdown", () => {
  test("states the composition rule and the pre-normalisation weight total", () => {
    const summary = computeAcademicSummary(
      [
        row({ percentage: 80, weight: 1, assessmentType: "Quiz", assessmentTypeCode: "QUIZ" }),
        row({ percentage: 60, weight: 3, assessmentType: "Exam", assessmentTypeCode: "EXAM" }),
      ],
      scale(),
    );

    expect(summary.weighting.rule).toBe("normalised-weighted-mean");
    expect(summary.weighting.totalWeight).toBe(4);
  });

  test("orders components by weight share, heaviest first", () => {
    const summary = computeAcademicSummary(
      [
        row({ percentage: 80, weight: 1, assessmentType: "Quiz", assessmentTypeCode: "QUIZ" }),
        row({ percentage: 60, weight: 3, assessmentType: "Exam", assessmentTypeCode: "EXAM" }),
      ],
      scale(),
    );

    expect(summary.weighting.components.map((component) => component.code)).toEqual(["EXAM", "QUIZ"]);
    expect(summary.weighting.components.map((component) => component.weightShare)).toEqual([75, 25]);
  });

  test("share is weight x count over the total, not the configured weight", () => {
    // SBA is recorded three times in a term. Three QUIZ rows at weight 1 carry
    // the same 3 points as one EXAM row at weight 3, and this is the block that
    // answers "why is this child on 72%".
    const summary = computeAcademicSummary(
      [
        row({ percentage: 80, weight: 1, assessmentType: "SBA", assessmentTypeCode: "SBA" }),
        row({ percentage: 80, weight: 1, assessmentType: "SBA", assessmentTypeCode: "SBA" }),
        row({ percentage: 80, weight: 1, assessmentType: "SBA", assessmentTypeCode: "SBA" }),
        row({ percentage: 50, weight: 3, assessmentType: "Exam", assessmentTypeCode: "EXAM" }),
      ],
      scale(),
    );

    const sba = summary.weighting.components.find((component) => component.code === "SBA");
    const exam = summary.weighting.components.find((component) => component.code === "EXAM");

    expect(sba?.count).toBe(3);
    expect(sba?.weight).toBe(3);
    expect(sba?.weightShare).toBe(50);
    expect(exam?.weightShare).toBe(50);
  });

  test("an assessment with no type is named Untyped under a null code", () => {
    const summary = computeAcademicSummary([row({ percentage: 50 })], scale());

    expect(summary.weighting.components[0]).toEqual({
      code: null,
      name: "Untyped",
      count: 1,
      weight: 1,
      weightShare: 100,
      percentage: 50,
    });
  });

  test("a component's own percentage is the weighted mean of its assessments", () => {
    const summary = computeAcademicSummary(
      [
        row({ percentage: 80, weight: 3, assessmentType: "Exam", assessmentTypeCode: "EXAM" }),
        row({ percentage: 40, weight: 1, assessmentType: "Exam", assessmentTypeCode: "EXAM" }),
      ],
      scale(),
    );

    expect(summary.weighting.components[0]?.count).toBe(2);
    expect(summary.weighting.components[0]?.percentage).toBe(70);
  });

  test("the type's configured defaultWeight reaches the report for an assessment with none of its own", () => {
    const summary = computeAcademicSummary(
      [
        row({ percentage: 80, weight: null, typeDefaultWeight: 2, assessmentType: "SBA", assessmentTypeCode: "SBA" }),
        row({ percentage: 40, weight: null, typeDefaultWeight: 2, assessmentType: "SBA", assessmentTypeCode: "SBA" }),
      ],
      scale(),
    );

    expect(summary.weighting.components[0]?.weight).toBe(4);
    expect(summary.weighting.components[0]?.percentage).toBe(60);
  });

  test("each subject carries its own breakdown, scoped to its rows", () => {
    const summary = computeAcademicSummary(
      [
        row({ subjectId: "english", percentage: 80, weight: 1, assessmentTypeCode: "QUIZ", assessmentType: "Quiz" }),
        row({ subjectId: "maths", percentage: 60, weight: 3, assessmentTypeCode: "EXAM", assessmentType: "Exam" }),
      ],
      scale(),
    );

    expect(summary.subjects[0]?.weighting.totalWeight).toBe(1);
    expect(summary.subjects[0]?.weighting.components.map((component) => component.code)).toEqual(["QUIZ"]);
    expect(summary.subjects[1]?.weighting.totalWeight).toBe(3);
    expect(summary.subjects[1]?.weighting.components.map((component) => component.code)).toEqual(["EXAM"]);
  });
});

describe("computeAcademicSummary — bandStatus", () => {
  const one = (percentage: number | null) =>
    computeAcademicSummary([row({ percentage })], scale()).subjects[0];

  test("'ok' is the only status that carries a band", () => {
    const subject = one(72);

    expect(subject?.bandStatus).toBe("ok");
    expect(subject?.band?.key).toBe("l6");
    expect(subject?.bandProblem).toBeNull();
  });

  test("'no-scale' when no bands were supplied, and carries no complaint about one", () => {
    // `findGradeBandCoverageGaps([])` answers "the scale has no bands", which
    // would put a statement about a scale that need not exist onto a school that
    // has none. The caller, which knows which scale applied, resolves which it is.
    const subject = computeAcademicSummary([row({ percentage: 72 })]).subjects[0];

    expect(subject?.bandStatus).toBe("no-scale");
    expect(subject?.band).toBeNull();
    expect(subject?.bandProblem).toBeNull();
  });

  test("'hole' names the range no band claims", () => {
    const subject = computeAcademicSummary([row({ percentage: 65 })], [
      { key: "l3", minScore: 0, maxScore: 64, label: "L3", color: "#000000" },
      { key: "l6", minScore: 66, maxScore: 100, label: "L6", color: "#000000" },
    ]).subjects[0];

    expect(subject?.bandStatus).toBe("hole");
    expect(subject?.band).toBeNull();
    expect(subject?.bandProblem).toBe("65-65% falls between l3 and l6 and matches no band");
  });

  test("'ambiguous' when two bands claim the percentage", () => {
    const subject = computeAcademicSummary([row({ percentage: 60 })], [
      { key: "a", minScore: 0, maxScore: 60, label: "A", color: "#000000" },
      { key: "b", minScore: 55, maxScore: 100, label: "B", color: "#000000" },
    ]).subjects[0];

    expect(subject?.bandStatus).toBe("ambiguous");
    expect(subject?.band).toBeNull();
  });

  test("'below-scale' and 'above-scale' are the school's own edges, named as such", () => {
    // A scale that reports only 50-60 leaves 45 below and 90 above it, and both
    // are below-scale/above-scale rather than a hole: a hole is strictly between
    // two bands.
    const narrow = [
      { key: "a", minScore: 50, maxScore: 55, label: "A", color: "#000000" },
      { key: "b", minScore: 56, maxScore: 60, label: "B", color: "#000000" },
    ];

    expect(computeAcademicSummary([row({ percentage: 45 })], narrow).subjects[0]?.bandStatus).toBe("below-scale");
    expect(computeAcademicSummary([row({ percentage: 90 })], narrow).subjects[0]?.bandStatus).toBe("above-scale");
    expect(computeAcademicSummary([row({ percentage: 52 })], narrow).subjects[0]?.bandStatus).toBe("ok");
  });

  test("'no-bands' when bands exist but not one of them can ever claim a percentage", () => {
    // A scale whose only band is 150-200 must report that it cannot grade, not
    // report a child at 68% as "below the scale". The coverage gap is stated too:
    // on a scale this broken it is true and useless, so it joins the defect
    // rather than standing in for it.
    const subject = computeAcademicSummary([row({ percentage: 68 })], [
      { key: "x", minScore: 150, maxScore: 200, label: "X", color: "#000000" },
    ]).subjects[0];

    expect(subject?.bandStatus).toBe("no-bands");
    expect(subject?.bandProblem).toBe("no band covers 0-149%; x covers 150-200, outside 0-100");
  });

  test("a backwards band cannot claim anything and is excluded before the edges are read", () => {
    const subject = computeAcademicSummary([row({ percentage: 30 })], [
      { key: "x", minScore: 60, maxScore: 20, label: "X", color: "#000000" },
    ]).subjects[0];

    expect(subject?.bandStatus).toBe("no-bands");
    // `findGradeBandCoverageGaps` filters backwards rows out, so a scale of only
    // backwards bands reads as having no bands at all.
    expect(subject?.bandProblem).toBe("the scale has no bands; x runs backwards: minScore 60 is above maxScore 20");
  });

  test("an ungraded assessment produces no subject at all", () => {
    // Not a subject with `bandStatus: 'no-percentage'` — no subject. An
    // ungraded assessment is absent from `gradedAssessments`, from `subjects[]`
    // and from both means, which is the honest description of a mark that cannot
    // be read.
    const summary = computeAcademicSummary([row({ percentage: null })]);

    expect(summary.gradedAssessments).toBe(0);
    expect(summary.subjects).toEqual([]);
  });

  test("'no-percentage' is unreachable from a summary, because the graded filter runs first", () => {
    // `classifyBand` can return it, but every percentage that reaches it has
    // already passed the 0-100 range filter above, and anything that failed that
    // filter never became a subject. Pinned so that widening the filter is a
    // visible change to the status set a report card can render.
    const statuses = [-1, 101, Number.NaN, null].map((percentage) => {
      const subject = computeAcademicSummary([row({ percentage })], scale()).subjects[0];
      return subject?.bandStatus ?? "(no subject)";
    });

    expect(statuses).toEqual(["(no subject)", "(no subject)", "(no subject)", "(no subject)"]);
  });

  test("an unbanded subject's percentage is still reported", () => {
    // No scale is not a reason to withhold the mark itself.
    expect(one(65)?.percentage).toBe(65);
  });
});

describe("computeAcademicSummary — bandProblem", () => {
  test("states the coverage gap on EVERY subject, whether or not that one graded", () => {
    // A class where two subjects grade and one does not is exactly how a partly
    // broken scale stays invisible.
    const partial = [{ key: "a", minScore: 50, maxScore: 70, label: "A", color: "#000000" }];
    const summary = computeAcademicSummary(
      [
        row({ subjectId: "grading", percentage: 60 }),
        row({ subjectId: "ungraded", percentage: 20 }),
      ],
      partial,
    );

    expect(summary.subjects.every((subject) => subject.bandProblem === "no band covers 0-49%; no band covers 71-100%")).toBe(true);
  });

  test("states the scale's coverage gaps on a subject that did grade", () => {
    // The edges are the school's decision, so they are stated rather than treated
    // as a fault — but they are stated on every subject, which is how a partly
    // broken scale stays visible.
    const subject = computeAcademicSummary([row({ percentage: 60 })], [
      { key: "a", minScore: 50, maxScore: 70, label: "A", color: "#000000" },
    ]).subjects[0];

    expect(subject?.bandStatus).toBe("ok");
    expect(subject?.band?.key).toBe("a");
    expect(subject?.bandProblem).toBe("no band covers 0-49%; no band covers 71-100%");
  });

  test("adds the defect sentences to the coverage sentences rather than replacing them", () => {
    // On a scale whose bands are all corrupt the coverage sentence is true and
    // useless ("no band covers 0-149%") while the defect names the row to fix.
    const subject = computeAcademicSummary([row({ percentage: 68 })], [
      { key: "x", minScore: 150, maxScore: 200, label: "X", color: "#000000" },
    ]).subjects[0];

    expect(subject?.bandProblem).toBe("no band covers 0-149%; x covers 150-200, outside 0-100");
  });
});

describe("contrastTextColor", () => {
  test("puts dark text on a light band and light text on a dark one", () => {
    expect(contrastTextColor("#ffffff")).toBe("#0f172a");
    expect(contrastTextColor("#000000")).toBe("#ffffff");
  });

  test("accepts a three-digit hex and an unprefixed six-digit one", () => {
    expect(contrastTextColor("#fff")).toBe("#0f172a");
    expect(contrastTextColor("000000")).toBe("#ffffff");
    expect(contrastTextColor("  #FFFFFF  ")).toBe("#0f172a");
  });

  test("splits on luminance, not on magnitude of the grade", () => {
    // The JHS default runs the other way — grade 9 is the worst result and is
    // coloured like every other worst result — so green-above-70 is not available
    // and the school's own colour decides.
    expect(contrastTextColor("#ff0000")).toBe("#0f172a");
    expect(contrastTextColor("#808080")).toBe("#0f172a");
    // The WCAG threshold sits between these two greys, so they straddle it.
    expect(contrastTextColor("#767676")).toBe("#0f172a");
    expect(contrastTextColor("#757575")).toBe("#ffffff");
  });

  test("falls back to dark text for input it cannot parse", () => {
    // The call that crashed on a null colour was inside a render — the one place
    // that cannot afford a TypeError — so the fallback must exist even though
    // `GradingLevel.color` is NOT NULL today.
    expect(contrastTextColor(null)).toBe("#0f172a");
    expect(contrastTextColor(undefined)).toBe("#0f172a");
    expect(contrastTextColor("red")).toBe("#0f172a");
    expect(contrastTextColor("transparent")).toBe("#0f172a");
    expect(contrastTextColor("#12345")).toBe("#0f172a");
    expect(contrastTextColor("#gggggg")).toBe("#0f172a");
    expect(contrastTextColor("")).toBe("#0f172a");
  });

  test("every one of the JHS 1-9 grade colours gets legible text", () => {
    // Whatever a head teacher picks, the badge must not render a label on a
    // background it cannot be read against.
    const jhs = ["#dc2626", "#ea580c", "#ca8a04", "#65a30d", "#16a34a", "#0d9488", "#2563eb", "#4f46e5", "#7c3aed"];

    for (const colour of jhs) {
      expect(["#0f172a", "#ffffff"]).toContain(contrastTextColor(colour));
    }
  });
});

describe("calculateWeightedAverage and the summary agree on one rule", () => {
  test("a summary of one row equals the weighted average of that row", () => {
    const summary = computeAcademicSummary([row({ percentage: 80, weight: 3 })], scale());

    expect(summary.weightedPercentage).toBe(
      calculateWeightedAverage([{ score: 80, weight: 3 }]),
    );
  });

  test("normalisation means weights need not sum to 1, or to the template", () => {
    // Doubling every weight leaves the answer unchanged.
    const once = computeAcademicSummary(
      [
        row({ subjectId: "a", percentage: 80, weight: 1 }),
        row({ subjectId: "b", percentage: 40, weight: 3 }),
      ],
      scale(),
    );
    const doubled = computeAcademicSummary(
      [
        row({ subjectId: "a", percentage: 80, weight: 2 }),
        row({ subjectId: "b", percentage: 40, weight: 6 }),
      ],
      scale(),
    );

    expect(once.weightedPercentage).toBe(50);
    expect(doubled.weightedPercentage).toBe(50);
    expect(doubled.weighting.totalWeight).toBe(8);
  });
});