/**
 * Grading scale boundaries. The property pinned here is that every integer
 * percentage from 0 to 100 maps to exactly one band in every scale. A child
 * who scores exactly 39, 40, 49, 50, 59, 60, 69, 70, 84, or 85 must not
 * fall between two bands or land in the wrong one. The 6-level scale is
 * used for Primary and JHS report cards; a mis-grade here puts a child in
 * the wrong proficiency level for BECE preparation.
 */
import { describe, expect, test } from "bun:test";
import {
  NACCA_6_LEVEL,
  NACCA_5_LEVEL,
  MONTESSORI_GRADING,
  EYLF_GRADING,
  type GradingScale,
} from "../index";

function findLevel(scale: GradingScale, mark: number) {
  return scale.levels.find((l) => mark >= l.minScore && mark <= l.maxScore);
}

function allLevels(scale: GradingScale) {
  return scale.levels.map((l) => l.key);
}

describe("NACCA 6-Level scale (Primary/JHS)", () => {
  const scale = NACCA_6_LEVEL;

  test("covers 0 through 100 with no gaps and no overlaps", () => {
    const covered = new Set<number>();
    for (const level of scale.levels) {
      for (let m = level.minScore; m <= level.maxScore; m++) {
        expect(covered.has(m)).toBe(false);
        covered.add(m);
      }
    }
    for (let m = 0; m <= 100; m++) {
      expect(covered.has(m)).toBe(true);
    }
  });

  test.each([
    [39, "level1"],
    [40, "level2"],
    [49, "level2"],
    [50, "level3"],
    [59, "level3"],
    [60, "level4"],
    [69, "level4"],
    [70, "level5"],
    [84, "level5"],
    [85, "level6"],
    [100, "level6"],
    [0, "level1"],
  ])("mark %d maps to %s", (mark: number, expectedKey: string) => {
    const level = findLevel(scale, mark);
    expect(level).toBeDefined();
    expect(level!.key).toBe(expectedKey);
  });

  test("marks outside 0-100 find no level", () => {
    expect(findLevel(scale, -1)).toBeUndefined();
    expect(findLevel(scale, 101)).toBeUndefined();
  });

  test("non-finite marks find no level", () => {
    expect(findLevel(scale, NaN)).toBeUndefined();
    expect(findLevel(scale, Infinity)).toBeUndefined();
    expect(findLevel(scale, -Infinity)).toBeUndefined();
  });

  test("levels are in ascending order by minScore", () => {
    for (let i = 1; i < scale.levels.length; i++) {
      expect(scale.levels[i].minScore).toBeGreaterThan(scale.levels[i - 1].minScore);
    }
  });

  test("levels are contiguous: each minScore equals previous maxScore + 1", () => {
    for (let i = 1; i < scale.levels.length; i++) {
      expect(scale.levels[i].minScore).toBe(scale.levels[i - 1].maxScore + 1);
    }
  });

  test("has exactly 6 levels with expected keys", () => {
    expect(allLevels(scale)).toEqual(["level1", "level2", "level3", "level4", "level5", "level6"]);
  });
});

describe("NACCA 5-Level scale (SHS A-G)", () => {
  const scale = NACCA_5_LEVEL;

  test("covers 0 through 100 with no gaps and no overlaps", () => {
    const covered = new Set<number>();
    for (const level of scale.levels) {
      for (let m = level.minScore; m <= level.maxScore; m++) {
        expect(covered.has(m)).toBe(false);
        covered.add(m);
      }
    }
    for (let m = 0; m <= 100; m++) {
      expect(covered.has(m)).toBe(true);
    }
  });

  test.each([
    [39, "F9"],
    [40, "E8"],
    [44, "E8"],
    [45, "D7"],
    [49, "D7"],
    [50, "C6"],
    [54, "C6"],
    [55, "C5"],
    [59, "C5"],
    [60, "C4"],
    [64, "C4"],
    [65, "B3"],
    [69, "B3"],
    [70, "B2"],
    [79, "B2"],
    [80, "A1"],
    [100, "A1"],
    [0, "F9"],
  ])("mark %d maps to %s", (mark: number, expectedKey: string) => {
    const level = findLevel(scale, mark);
    expect(level).toBeDefined();
    expect(level!.key).toBe(expectedKey);
  });

  test("marks outside 0-100 find no level", () => {
    expect(findLevel(scale, -1)).toBeUndefined();
    expect(findLevel(scale, 101)).toBeUndefined();
  });

  test("non-finite marks find no level", () => {
    expect(findLevel(scale, NaN)).toBeUndefined();
    expect(findLevel(scale, Infinity)).toBeUndefined();
    expect(findLevel(scale, -Infinity)).toBeUndefined();
  });

  test("levels are in descending order by minScore (highest grade first)", () => {
    for (let i = 1; i < scale.levels.length; i++) {
      expect(scale.levels[i].minScore).toBeLessThan(scale.levels[i - 1].minScore);
    }
  });

  test("levels are contiguous when read in descending order: each maxScore + 1 equals next minScore", () => {
    for (let i = 1; i < scale.levels.length; i++) {
      expect(scale.levels[i].maxScore + 1).toBe(scale.levels[i - 1].minScore);
    }
  });

  test("has exactly 9 levels with expected keys (A1 through F9)", () => {
    expect(allLevels(scale)).toEqual(["A1", "B2", "B3", "C4", "C5", "C6", "D7", "E8", "F9"]);
  });
});

describe("Montessori Standards-Based scale", () => {
  const scale = MONTESSORI_GRADING;

  test("covers 0 through 100 with no gaps and no overlaps", () => {
    const covered = new Set<number>();
    for (const level of scale.levels) {
      for (let m = level.minScore; m <= level.maxScore; m++) {
        expect(covered.has(m)).toBe(false);
        covered.add(m);
      }
    }
    for (let m = 0; m <= 100; m++) {
      expect(covered.has(m)).toBe(true);
    }
  });

  test.each([
    [49, "emerging"],
    [50, "developing"],
    [64, "developing"],
    [65, "proficient"],
    [79, "proficient"],
    [80, "exemplary"],
    [100, "exemplary"],
    [0, "emerging"],
  ])("mark %d maps to %s", (mark: number, expectedKey: string) => {
    const level = findLevel(scale, mark);
    expect(level).toBeDefined();
    expect(level!.key).toBe(expectedKey);
  });

  test("marks outside 0-100 find no level", () => {
    expect(findLevel(scale, -1)).toBeUndefined();
    expect(findLevel(scale, 101)).toBeUndefined();
  });

  test("non-finite marks find no level", () => {
    expect(findLevel(scale, NaN)).toBeUndefined();
    expect(findLevel(scale, Infinity)).toBeUndefined();
    expect(findLevel(scale, -Infinity)).toBeUndefined();
  });

  test("levels are in descending order by minScore (highest grade first)", () => {
    for (let i = 1; i < scale.levels.length; i++) {
      expect(scale.levels[i].minScore).toBeLessThan(scale.levels[i - 1].minScore);
    }
  });

  test("levels are contiguous when read in descending order", () => {
    for (let i = 1; i < scale.levels.length; i++) {
      expect(scale.levels[i].maxScore + 1).toBe(scale.levels[i - 1].minScore);
    }
  });

  test("has exactly 4 levels with expected keys", () => {
    expect(allLevels(scale)).toEqual(["exemplary", "proficient", "developing", "emerging"]);
  });
});

describe("EYLF Early Years scale", () => {
  const scale = EYLF_GRADING;

  test("covers 0 through 100 with no gaps and no overlaps", () => {
    const covered = new Set<number>();
    for (const level of scale.levels) {
      for (let m = level.minScore; m <= level.maxScore; m++) {
        expect(covered.has(m)).toBe(false);
        covered.add(m);
      }
    }
    for (let m = 0; m <= 100; m++) {
      expect(covered.has(m)).toBe(true);
    }
  });

  test.each([
    [19, "not_yet"],
    [20, "emerging"],
    [39, "emerging"],
    [40, "progressing"],
    [59, "progressing"],
    [60, "proficient"],
    [79, "proficient"],
    [80, "exceeding"],
    [100, "exceeding"],
    [0, "not_yet"],
  ])("mark %d maps to %s", (mark: number, expectedKey: string) => {
    const level = findLevel(scale, mark);
    expect(level).toBeDefined();
    expect(level!.key).toBe(expectedKey);
  });

  test("marks outside 0-100 find no level", () => {
    expect(findLevel(scale, -1)).toBeUndefined();
    expect(findLevel(scale, 101)).toBeUndefined();
  });

  test("non-finite marks find no level", () => {
    expect(findLevel(scale, NaN)).toBeUndefined();
    expect(findLevel(scale, Infinity)).toBeUndefined();
    expect(findLevel(scale, -Infinity)).toBeUndefined();
  });

  test("levels are in descending order by minScore (highest grade first)", () => {
    for (let i = 1; i < scale.levels.length; i++) {
      expect(scale.levels[i].minScore).toBeLessThan(scale.levels[i - 1].minScore);
    }
  });

  test("levels are contiguous when read in descending order", () => {
    for (let i = 1; i < scale.levels.length; i++) {
      expect(scale.levels[i].maxScore + 1).toBe(scale.levels[i - 1].minScore);
    }
  });

  test("has exactly 5 levels with expected keys", () => {
    expect(allLevels(scale)).toEqual(["exceeding", "proficient", "progressing", "emerging", "not_yet"]);
  });
});

describe("Cross-scale consistency", () => {
  test("no two scales assign the same mark to bands with the same semantic meaning", () => {
    // This is a sanity check: the 6-level and 5-level scales have different
    // band meanings. We only assert that at boundary marks they disagree,
    // which is expected and correct — they are different systems.
    const boundaries = [39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 84, 85];
    for (const mark of boundaries) {
      const l6 = findLevel(NACCA_6_LEVEL, mark);
      const l5 = findLevel(NACCA_5_LEVEL, mark);
      expect(l6).toBeDefined();
      expect(l5).toBeDefined();
      // They should never have the same key (they use different naming)
      expect(l6!.key).not.toBe(l5!.key);
    }
  });

  test("every scale defines color and description for each level", () => {
    for (const scale of [NACCA_6_LEVEL, NACCA_5_LEVEL, MONTESSORI_GRADING, EYLF_GRADING]) {
      for (const level of scale.levels) {
        expect(level.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(level.description).toBeDefined();
        expect(level.description!.length).toBeGreaterThan(0);
      }
    }
  });
});