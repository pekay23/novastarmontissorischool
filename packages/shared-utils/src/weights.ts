// Weights

/**
 * One rule, shared by every weighted mean in this package.
 * `calculateWeightedAverage` below, `resolveAssessmentWeight` further down, and
 * `computeAcademicSummary` all compose with `weightedMean`; none of them divides
 * by a weight sum it has not first made computable.
 */

/** Last resort when neither the assessment nor its type carries a usable weight. */
export const FALLBACK_ASSESSMENT_WEIGHT = 1

/**
 * A weight that can actually be divided by: finite and above zero.
 *
 * Zero is rejected here, and that is a decision rather than an oversight — see
 * `resolveAssessmentWeight` for why an explicit 0 cannot mean "excluded" yet.
 */
export function positiveWeight(weight: number | null | undefined): number | null {
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0
    ? weight
    : null
}

/**
 * `sum(value * weight) / sum(weight)`, or null when nothing was weighted.
 *
 * Null rather than 0 because 0 is a real answer for a percentage and a
 * fabricated one here: no graded assessment is "scored zero percent". Callers
 * that owe the caller a number (the legacy `calculateWeightedAverage` contract)
 * map null to 0 themselves.
 *
 * A weight of 0 is arithmetically inert rather than dangerous: it adds nothing to
 * either sum, so such a row cannot move the answer, and the `totalWeight > 0`
 * guard means a set that is entirely zeros still returns null instead of
 * dividing by it. Nothing here can produce NaN or Infinity from any weight.
 */
export function weightedMean(
  items: ReadonlyArray<{ value: number; weight: number }>,
): number | null {
  let weightedSum = 0
  let totalWeight = 0
  for (const item of items) {
    weightedSum += item.value * item.weight
    totalWeight += item.weight
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null
}

/**
 * The weighted mean of `items`, `defaultWeight` standing in for a missing or
 * unusable weight.
 *
 * Composition is a **normalised** weighted mean, `sum(x x w) / sum(w)`, so only
 * the ratio between weights matters. A school's configured weights need not sum
 * to 1 and cannot be required to: SBA is recorded three times in a term, so the
 * weights actually present in one rollup routinely exceed the template's sum.
 * Absolute shares would overflow past 100%; normalisation cannot.
 *
 * Returns 0 for an empty list or an all-zero weight sum, which is this
 * function's long-standing contract. `computeAcademicSummary` reports null
 * instead, because a report card must not print a fabricated zero.
 */
export function calculateWeightedAverage(
  items: Array<{ score: number; weight: number }>,
  defaultWeight: number = FALLBACK_ASSESSMENT_WEIGHT
): number {
  const fallback = positiveWeight(defaultWeight) ?? FALLBACK_ASSESSMENT_WEIGHT
  return (
    weightedMean(
      items.map((item) => ({
        value: item.score,
        weight: positiveWeight(item.weight) ?? fallback,
      })),
    ) ?? 0
  )
}