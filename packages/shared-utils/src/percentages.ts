// Percentage Calculations

/**
 * A mark as a percentage of what it was scored against, or null when the two
 * cannot produce one.
 *
 * Refusing rather than rounding or clamping is the point. `rawScore` and
 * `Assessment.maxScore` are bounded independently, so a teacher who typed 150
 * into a 100-mark assessment used to get 150% — and `Score.grade`, the audit
 * record of what the gradebook decided, recorded the top band for it. A
 * percentage is by definition inside 0-100; anything else is not a percentage
 * that needs rounding, it is a mark that does not belong on this assessment.
 *
 * `null` is also what keeps `Score.percentage` (`Decimal(5,2)`) reachable: a
 * ratio such as 9999/1 would otherwise become a 500 from the database rather
 * than a 400 to the teacher who typed the mark.
 */
export function calculatePercentage(marks: number, total: number): number | null {
  if (!Number.isFinite(marks) || !Number.isFinite(total) || total === 0) return null
  const percentage = Math.round((marks / total) * 100 * 100) / 100
  if (percentage < 0 || percentage > 100) return null
  return percentage
}

export function calculateAverage(scores: number[]): number {
  if (scores.length === 0) return 0
  return scores.reduce((sum, s) => sum + s, 0) / scores.length
}