/**
 * Class position / ranking.
 *
 * The ranking rule is stated once in `rankStudents` and tested here against
 * the Ghanaian school-report convention:
 * - rank by overallPercentage descending
 * - ties share position; next skips by tie count ("1 2 2 4")
 * - students with null/undefined overallPercentage are NOT ranked (position = null)
 * - deterministic tie-break by displayName then studentId keeps output idempotent
 */
import { describe, expect, test } from "bun:test"
import { rankStudents, type StudentForRanking } from "../index"

describe("rankStudents", () => {
  const make = (
    studentId: string,
    overallPercentage: number | null,
    displayName?: string,
  ): StudentForRanking => ({ studentId, overallPercentage, displayName })

  test("empty input", () => {
    expect(rankStudents([])).toEqual([])
  })

  test("single student with null percentage is not ranked", () => {
    const res = rankStudents([make("s1", null)])
    expect(res).toEqual([{ studentId: "s1", position: null }])
  })

  test("single student with percentage gets position 1", () => {
    const res = rankStudents([make("s1", 85)])
    expect(res).toEqual([{ studentId: "s1", position: 1 }])
  })

  test("two students with distinct percentages", () => {
    const res = rankStudents([
      make("s1", 70),
      make("s2", 85),
    ])
    // s2 (85) = 1st, s1 (70) = 2nd
    expect(res).toEqual([
      { studentId: "s1", position: 2 },
      { studentId: "s2", position: 1 },
    ])
  })

  test("tie shares position and next skips (standard competition: 1 2 2 4)", () => {
    const res = rankStudents([
      make("s1", 80), // tied
      make("s2", 85), // 1st
      make("s3", 80), // tied
      make("s4", 70), // next distinct
    ])
    // s2 (85) = 1
    // s1, s3 (80) = 2 (shared)
    // s4 (70) = 4 (skips 3)
    expect(res).toEqual([
      { studentId: "s1", position: 2 },
      { studentId: "s2", position: 1 },
      { studentId: "s3", position: 2 },
      { studentId: "s4", position: 4 },
    ])
  })

  test("three-way tie shares position; next skips by 3", () => {
    const res = rankStudents([
      make("s1", 75),
      make("s2", 75),
      make("s3", 75),
      make("s4", 70),
    ])
    expect(res).toEqual([
      { studentId: "s1", position: 1 },
      { studentId: "s2", position: 1 },
      { studentId: "s3", position: 1 },
      { studentId: "s4", position: 4 },
    ])
  })

  test("null/NaN/out-of-range percentages are excluded from ranking", () => {
    const res = rankStudents([
      make("s1", null),
      make("s2", NaN),
      make("s3", -1),
      make("s4", 101),
      make("s5", 80),
    ])
    expect(res).toEqual([
      { studentId: "s1", position: null },
      { studentId: "s2", position: null },
      { studentId: "s3", position: null },
      { studentId: "s4", position: null },
      { studentId: "s5", position: 1 },
    ])
  })

  test("deterministic tie-break by displayName then studentId does not change shared position", () => {
    const res = rankStudents([
      make("s1", 80, "Baz"),
      make("s2", 80, "Abe"),
      make("s3", 80, "Abe"),
    ])
    // All three share position 1; deterministic order in sorted array is Abe(s2), Abe(s3), Baz(s1)
    // but shared position is 1 for all.
    expect(res.map((r) => r.position)).toEqual([1, 1, 1])
  })

  test("students with null percentage are excluded and do not occupy a slot", () => {
    const res = rankStudents([
      make("s1", 90),
      make("s2", null),
      make("s3", 80),
    ])
    // s1 = 1, s3 = 2; s2 is null and does not push s3 to 3
    expect(res).toEqual([
      { studentId: "s1", position: 1 },
      { studentId: "s2", position: null },
      { studentId: "s3", position: 2 },
    ])
  })

  test("returns results in original input order", () => {
    const res = rankStudents([
      make("s3", 70), // 3rd
      make("s1", 90), // 1st
      make("s2", 80), // 2nd
    ])
    expect(res).toEqual([
      { studentId: "s3", position: 3 },
      { studentId: "s1", position: 1 },
      { studentId: "s2", position: 2 },
    ])
  })
})