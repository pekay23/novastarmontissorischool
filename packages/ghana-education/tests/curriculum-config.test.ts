/**
 * Promotion rules. The property pinned here is that the JHS and Primary
 * promotion thresholds are exactly as NaCCA specifies: 40% overall average,
 * 80% attendance, 40% SBA minimum, and a pass in English and Mathematics.
 * A child who meets the average but fails English must not be promoted —
 * this is the rule that keeps BECE candidates from advancing unprepared.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_JHS_PROMOTION,
  DEFAULT_PRIMARY_PROMOTION,
  DEFAULT_ASSESSMENT_WINDOWS,
  BECE_SUBJECT_MAPPING,
  GES_CURRICULUM,
  WASSCE_SUBJECT_MAPPING,
  DEFAULT_REPORT_TEMPLATES,
  NACCA_5_LEVEL,
  NACCA_6_LEVEL,
  MONTESSORI_GRADING,
  EYLF_GRADING,
} from "../index";

describe("DEFAULT_JHS_PROMOTION", () => {
  const rule = DEFAULT_JHS_PROMOTION;

  test("condition identifies the correct promotion gate", () => {
    expect(rule.condition).toBe("JHS_END_OF_YEAR");
  });

  test("minimum overall average is 40% per NaCCA", () => {
    expect(rule.minAverage).toBe(40);
  });

  test("minimum attendance is 80%", () => {
    expect(rule.minAttendance).toBe(80);
  });

  test("minimum SBA score is 40%", () => {
    expect(rule.minSBA).toBe(40);
  });

  test("requires English pass", () => {
    expect(rule.requiresEnglishPass).toBe(true);
  });

  test("requires Mathematics pass", () => {
    expect(rule.requiresMathPass).toBe(true);
  });

  test("has all required fields with correct types", () => {
    expect(typeof rule.condition).toBe("string");
    expect(typeof rule.minAverage).toBe("number");
    expect(typeof rule.minAttendance).toBe("number");
    expect(typeof rule.minSBA).toBe("number");
    expect(typeof rule.requiresEnglishPass).toBe("boolean");
    expect(typeof rule.requiresMathPass).toBe("boolean");
  });
});

describe("DEFAULT_PRIMARY_PROMOTION", () => {
  const rule = DEFAULT_PRIMARY_PROMOTION;

  test("condition identifies the correct promotion gate", () => {
    expect(rule.condition).toBe("PRIMARY_END_OF_YEAR");
  });

  test("minimum overall average is 40%", () => {
    expect(rule.minAverage).toBe(40);
  });

  test("minimum attendance is 80%", () => {
    expect(rule.minAttendance).toBe(80);
  });

  test("minimum SBA score is 40%", () => {
    expect(rule.minSBA).toBe(40);
  });

  test("requires English pass", () => {
    expect(rule.requiresEnglishPass).toBe(true);
  });

  test("requires Mathematics pass", () => {
    expect(rule.requiresMathPass).toBe(true);
  });

  test("has all required fields with correct types", () => {
    expect(typeof rule.condition).toBe("string");
    expect(typeof rule.minAverage).toBe("number");
    expect(typeof rule.minAttendance).toBe("number");
    expect(typeof rule.minSBA).toBe("number");
    expect(typeof rule.requiresEnglishPass).toBe("boolean");
    expect(typeof rule.requiresMathPass).toBe("boolean");
  });
});

describe("Promotion rule cross-check", () => {
  test("JHS and Primary have identical numeric thresholds", () => {
    expect(DEFAULT_JHS_PROMOTION.minAverage).toBe(DEFAULT_PRIMARY_PROMOTION.minAverage);
    expect(DEFAULT_JHS_PROMOTION.minAttendance).toBe(DEFAULT_PRIMARY_PROMOTION.minAttendance);
    expect(DEFAULT_JHS_PROMOTION.minSBA).toBe(DEFAULT_PRIMARY_PROMOTION.minSBA);
    expect(DEFAULT_JHS_PROMOTION.requiresEnglishPass).toBe(DEFAULT_PRIMARY_PROMOTION.requiresEnglishPass);
    expect(DEFAULT_JHS_PROMOTION.requiresMathPass).toBe(DEFAULT_PRIMARY_PROMOTION.requiresMathPass);
  });

  test("only the condition string differs", () => {
    const { condition: _jhsCond, ...jhs } = DEFAULT_JHS_PROMOTION;
    const { condition: _priCond, ...pri } = DEFAULT_PRIMARY_PROMOTION;
    expect(jhs).toEqual(pri);
  });
});

describe("DEFAULT_ASSESSMENT_WINDOWS", () => {
  test("has primary, jhs, and shs phases", () => {
    expect(Object.keys(DEFAULT_ASSESSMENT_WINDOWS)).toEqual(["primary", "jhs", "shs"]);
  });

  describe("primary windows", () => {
    const windows = DEFAULT_ASSESSMENT_WINDOWS.primary;

    test("has exactly 5 windows", () => {
      expect(windows).toHaveLength(5);
    });

    test("window names match NaCCA primary assessment types", () => {
      expect(windows.map((w) => w.name)).toEqual([
        "SBA 1",
        "Mid-Term",
        "SBA 2",
        "SBA 3",
        "Terminal",
      ]);
    });

    test("weeksFromTermStart are strictly increasing", () => {
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i].weeksFromTermStart).toBeGreaterThan(windows[i - 1].weeksFromTermStart);
      }
    });

    test("all windows are mandatory", () => {
      for (const w of windows) {
        expect(w.isMandatory).toBe(true);
      }
    });

    test("durations are positive", () => {
      for (const w of windows) {
        expect(w.duration).toBeGreaterThan(0);
      }
    });
  });

  describe("jhs windows", () => {
    const windows = DEFAULT_ASSESSMENT_WINDOWS.jhs;

    test("has exactly 5 windows", () => {
      expect(windows).toHaveLength(5);
    });

    test("window names match NaCCA JHS assessment types", () => {
      expect(windows.map((w) => w.name)).toEqual([
        "SBA 1",
        "BLC/Mid-Term",
        "SBA 2",
        "SBA 3",
        "Terminal",
      ]);
    });

    test("weeksFromTermStart are strictly increasing", () => {
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i].weeksFromTermStart).toBeGreaterThan(windows[i - 1].weeksFromTermStart);
      }
    });

    test("all windows are mandatory", () => {
      for (const w of windows) {
        expect(w.isMandatory).toBe(true);
      }
    });

    test("SBA windows have 7-day duration, others have 3 or 5", () => {
      expect(windows.find((w) => w.name === "SBA 1")?.duration).toBe(7);
      expect(windows.find((w) => w.name === "SBA 2")?.duration).toBe(7);
      expect(windows.find((w) => w.name === "SBA 3")?.duration).toBe(5);
      expect(windows.find((w) => w.name === "BLC/Mid-Term")?.duration).toBe(3);
      expect(windows.find((w) => w.name === "Terminal")?.duration).toBe(3);
    });
  });

  describe("shs windows", () => {
    const windows = DEFAULT_ASSESSMENT_WINDOWS.shs;

    test("has exactly 5 windows", () => {
      expect(windows).toHaveLength(5);
    });

    test("window names match NaCCA SHS assessment types", () => {
      expect(windows.map((w) => w.name)).toEqual([
        "Coursework",
        "Mid-Term",
        "Coursework 2",
        "Mock",
        "Terminal",
      ]);
    });

    test("weeksFromTermStart are strictly increasing", () => {
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i].weeksFromTermStart).toBeGreaterThan(windows[i - 1].weeksFromTermStart);
      }
    });

    test("all windows are mandatory", () => {
      for (const w of windows) {
        expect(w.isMandatory).toBe(true);
      }
    });
  });
});

describe("BECE_SUBJECT_MAPPING", () => {
  const jhsSubjects = GES_CURRICULUM.JHS.subjects;
  const jhsCore = jhsSubjects.filter((subject) => subject.isCore).map((subject) => subject.code).sort();
  const jhsElective = jhsSubjects
    .filter((subject) => !subject.isCore)
    .map((subject) => subject.code)
    .sort();

  test("contains exactly the JHS core subjects", () => {
    // Derived, not a literal 9: a hardcoded count says nothing about which
    // subjects it counts.
    expect(Object.keys(BECE_SUBJECT_MAPPING)).toHaveLength(jhsCore.length);
  });

  test("maps each subject code to its full BECE name", () => {
    expect(BECE_SUBJECT_MAPPING.ENG).toBe("English Language");
    expect(BECE_SUBJECT_MAPPING.GLO).toBe("Ghanaian Language");
    expect(BECE_SUBJECT_MAPPING.MAT).toBe("Mathematics");
    expect(BECE_SUBJECT_MAPPING.SCI).toBe("Integrated Science");
    expect(BECE_SUBJECT_MAPPING.SST).toBe("Social Studies");
    expect(BECE_SUBJECT_MAPPING.RME).toBe("Religious & Moral Education");
    expect(BECE_SUBJECT_MAPPING.ICT).toBe("Information Communication Technology");
    expect(BECE_SUBJECT_MAPPING.PHE).toBe("Physical Education");
    expect(BECE_SUBJECT_MAPPING.CULT).toBe("Creative Arts");
  });

  test("keys are the JHS curriculum subject codes, not a hand-written list", () => {
    // The expectation is derived from `GES_CURRICULUM.JHS.subjects`, because the
    // previous version looped a hardcoded twelve-string array that never touched
    // the curriculum: adding a JHS subject with no mapping entry left this file
    // green, which is precisely the defect a curriculum-to-exam mapping has.
    //
    // Every core subject a BECE candidate is examined in is mapped...
    for (const code of jhsCore) {
      expect(BECE_SUBJECT_MAPPING[code]).toBeDefined();
    }
    // ...and nothing else is, so a mapping is never a claim BECE does not make.
    expect(Object.keys(BECE_SUBJECT_MAPPING).sort()).toEqual(jhsCore);
  });

  test("the exemptions are the JHS electives, named rather than implied", () => {
    // The one documented exemption set: French, Agricultural Science and
    // Business Studies are taught at JHS but are not BECE subjects. Stating the
    // set means adding a fourth unmapped subject is a visible failure.
    expect(jhsElective).toEqual(["AGRIC", "BST", "FRENCH"]);
    for (const code of jhsElective) {
      expect(BECE_SUBJECT_MAPPING[code]).toBeUndefined();
    }
  });

  test("no duplicate values", () => {
    const values = Object.values(BECE_SUBJECT_MAPPING);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe("WASSCE_SUBJECT_MAPPING", () => {
  test("contains 7 SHS subjects", () => {
    expect(Object.keys(WASSCE_SUBJECT_MAPPING)).toHaveLength(7);
  });

  test("maps each subject code to its full WASSCE name", () => {
    expect(WASSCE_SUBJECT_MAPPING.ENG).toBe("English Language");
    expect(WASSCE_SUBJECT_MAPPING.MAT).toBe("Elective Mathematics");
    expect(WASSCE_SUBJECT_MAPPING.SST).toBe("Social Studies");
    expect(WASSCE_SUBJECT_MAPPING.SCI).toBe("Science (Biology, Chemistry, Physics)");
    expect(WASSCE_SUBJECT_MAPPING.FRENCH).toBe("French");
    expect(WASSCE_SUBJECT_MAPPING.ICT).toBe("Information Communication Technology");
    expect(WASSCE_SUBJECT_MAPPING.RME).toBe("Religious & Moral Education");
  });

  test("no duplicate values", () => {
    const values = Object.values(WASSCE_SUBJECT_MAPPING);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe("GES_CURRICULUM gradingScale references", () => {
  // Derived from the scales' own `id` fields, not written out as literals. The
  // four phases used to name 'naCCA_EYLF', 'naCCA_6_1' and 'naCCA_5_1', none of
  // which matched any `id` this module exports, so nothing anywhere could have
  // resolved a phase's grading scale — and a literal list here would have pinned
  // the dangling strings instead of catching them.
  const exportedIds = [
    NACCA_6_LEVEL.id,
    NACCA_5_LEVEL.id,
    MONTESSORI_GRADING.id,
    EYLF_GRADING.id,
  ];

  test("every phase names a grading scale this module exports", () => {
    const dangling = Object.entries(GES_CURRICULUM)
      .filter(([, curriculum]) => !exportedIds.includes(curriculum.gradingScale))
      .map(([phase, curriculum]) => `${phase} -> ${curriculum.gradingScale}`);

    expect(dangling).toEqual([]);
  });

  test("each phase names the scale NaCCA uses for it", () => {
    // Not just a member of the set: KG is early years, Primary and JHS are the
    // 6-level scale, SHS is the 5-level A-G scale. A phase pointing at the wrong
    // exported scale resolves, so only the set membership above would miss it.
    expect(GES_CURRICULUM.KINDERGARTEN.gradingScale).toBe(EYLF_GRADING.id);
    expect(GES_CURRICULUM.PRIMARY.gradingScale).toBe(NACCA_6_LEVEL.id);
    expect(GES_CURRICULUM.JHS.gradingScale).toBe(NACCA_6_LEVEL.id);
    expect(GES_CURRICULUM.SHS.gradingScale).toBe(NACCA_5_LEVEL.id);
  });
});

describe("DEFAULT_REPORT_TEMPLATES", () => {
  test("has exactly 3 templates: primary, jhs, shs", () => {
    expect(DEFAULT_REPORT_TEMPLATES).toHaveLength(3);
  });

  test("each template has a unique id and correct phase", () => {
    const ids = DEFAULT_REPORT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(3);

    const primary = DEFAULT_REPORT_TEMPLATES.find((t) => t.phase === "PRIMARY");
    const jhs = DEFAULT_REPORT_TEMPLATES.find((t) => t.phase === "JHS");
    const shs = DEFAULT_REPORT_TEMPLATES.find((t) => t.phase === "SHS");

    expect(primary).toBeDefined();
    expect(jhs).toBeDefined();
    expect(shs).toBeDefined();
    expect(primary!.id).toBe("primary_terminal_report");
    expect(jhs!.id).toBe("jhs_terminal_report");
    expect(shs!.id).toBe("shs_semester_report");
  });

  test("primary and jhs templates include promotionStatus, shs does not", () => {
    const primary = DEFAULT_REPORT_TEMPLATES.find((t) => t.phase === "PRIMARY")!;
    const jhs = DEFAULT_REPORT_TEMPLATES.find((t) => t.phase === "JHS")!;
    const shs = DEFAULT_REPORT_TEMPLATES.find((t) => t.phase === "SHS")!;

    expect(primary.includes.promotionStatus).toBe(true);
    expect(jhs.includes.promotionStatus).toBe(true);
    expect(shs.includes.promotionStatus).toBe(false);
  });

  test("all templates include attendance, behavior, coCurricular, teacherComments, principalComments", () => {
    for (const template of DEFAULT_REPORT_TEMPLATES) {
      expect(template.includes.attendance).toBe(true);
      expect(template.includes.behavior).toBe(true);
      expect(template.includes.coCurricular).toBe(true);
      expect(template.includes.teacherComments).toBe(true);
      expect(template.includes.principalComments).toBe(true);
    }
  });

  test("sections arrays are non-empty", () => {
    for (const template of DEFAULT_REPORT_TEMPLATES) {
      expect(template.sections.length).toBeGreaterThan(0);
    }
  });

  test("SHS template includes Grade Point Average section but promotionStatus is false", () => {
    const shs = DEFAULT_REPORT_TEMPLATES.find((t) => t.phase === "SHS")!;
    expect(shs.sections.some((s) => s.includes("Grade Point Average"))).toBe(true);
    expect(shs.includes.promotionStatus).toBe(false);
  });
});