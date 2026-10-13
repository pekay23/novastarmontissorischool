export interface StudentForRanking {
  studentId: string
  /**
   * The student's overall aggregate percentage for the term (0-100).
   * `null` means the student has no graded, approved work this term and is
   * excluded from the class ranking (position = null), not ranked last.
   */
  overallPercentage: number | null
  displayName?: string
}

/**
 * The result of ranking a student within a class.
 */
export interface RankedStudent {
  studentId: string
  /**
   * The student's position in the class ranking, 1-indexed.
   * `null` when the student has no ranked figure (overallPercentage === null).
   */
  position: number | null
}

/**
 * Class position by term aggregate, descending.
 *
 * Rules (Ghanaian school-report convention, stated explicitly so the portal
 * has one answer to both ask and to test against):
 * 1. Ranked over students with a readable 0-100 overall percentage. A student
 *    whose marks are all ungraded/unapproved has no aggregate and is NOT ranked
 *    — reporting them as "last" would reward absence, and reporting them at all
 *    would mis-represent a card that shows "No marks recorded".
 * 2. Higher percentage ranks first. `rank === 1` is the top of the class.
 * 3. Ties share a position and the next position skips by the tie count
 *    (standard competition ranking, "1 2 2 4"). Two aggregates that are equal
 *    occupy the same slot; the next lower aggregate takes the number of slots
 *    already filled.
 * 4. Among ties, a stable deterministic tie-break (displayName, then studentId)
 *    keeps the output idempotent across runs so the API is idempotent. Ties
 *    still share the position regardless of that order.
 */
export function rankStudents(
  students: readonly StudentForRanking[],
): RankedStudent[] {
  // Filter to students with a valid, readable percentage.
  const ranked = students
    .filter(
      (s) =>
        s.overallPercentage !== null &&
        Number.isFinite(s.overallPercentage) &&
        s.overallPercentage >= 0 &&
        s.overallPercentage <= 100,
    )
    .sort((a, b) => {
      // Higher percentage first.
      if (b.overallPercentage! !== a.overallPercentage!) {
        return b.overallPercentage! - a.overallPercentage!
      }
      // Stable tie-break: displayName asc, then studentId asc.
      const nameA = a.displayName ?? ""
      const nameB = b.displayName ?? ""
      if (nameA !== nameB) return nameA.localeCompare(nameB)
      return a.studentId.localeCompare(b.studentId)
    })

  // Assign standard competition ranks ("1 2 2 4").
  const positions = new Map<string, number>()
  let position = 0
  let previousPercentage: number | null = null
  let i = 0
  for (const student of ranked) {
    i++
    // Filter guarantees non-null percentage, but TS strict indexing needs help.
    const percentage = student.overallPercentage!
    if (previousPercentage === null || percentage !== previousPercentage) {
      // New percentage: rank = 1 + number of students strictly better.
      position = i
      previousPercentage = percentage
    }
    positions.set(student.studentId, position)
  }

  // Return in the original input order with position attached.
  return students.map((s) => ({
    studentId: s.studentId,
    position: positions.get(s.studentId) ?? null,
  }))
}