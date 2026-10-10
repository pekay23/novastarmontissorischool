/**
 * Promotion planning — pure, with no Prisma and no database.
 *
 * A class promotion is the highest-blast-radius academic operation in the
 * product: it moves a whole cohort's current class and rewrites a term's
 * enrolment history in one shot. So every question that can be answered
 * without touching the database is answered here, from data the route has
 * already read, and a rejected plan means *nothing was written*.
 *
 * The route feeds in three facts — which classes exist in the caller's
 * tenant, whether the term exists, and who is actually in the source class —
 * and gets back either a complete plan or a specific reason. The page
 * imports `resolveDestination` too, so the destination a row displays is
 * produced by the same function the route will act on rather than by a
 * second, near-identical expression in the component.
 */

export interface PromotionOverrideInput {
  studentId: string
  toClassId: string
}

export interface PromotionRequestInput {
  fromClassId: string
  toClassId: string
  termId: string
  overrides?: readonly PromotionOverrideInput[]
}

/**
 * What the route read before it planned anything.
 *
 * `knownClassIds` carries only classes that exist in the caller's tenant AND
 * school, so a class id belonging to another tenant is simply absent from it
 * and is rejected by the same rule as an id that exists nowhere. That is why
 * there is no separate "cross-tenant" case: the route cannot tell the
 * difference and does not need to, because the outcome is the same refusal.
 */
export interface PromotionFacts {
  knownClassIds: readonly string[]
  termKnown: boolean
  /** Ids of the students whose current class (`Student.classId`) is the source class. */
  cohortStudentIds: readonly string[]
}

export interface PromotionPlanRow {
  studentId: string
  fromClassId: string
  toClassId: string
  /** Whether this row's destination came from a per-student override. */
  overridden: boolean
}

export type PromotionRejectionCode =
  | 'UNKNOWN_TERM'
  | 'UNKNOWN_CLASS'
  | 'SAME_CLASS'
  | 'OVERRIDE_CLASS_UNKNOWN'
  | 'OVERRIDE_STUDENT_NOT_IN_SOURCE'
  | 'DUPLICATE_OVERRIDE'
  | 'EMPTY_COHORT'

export type PromotionPlan =
  | { ok: true; rows: readonly PromotionPlanRow[] }
  | {
      ok: false
      code: PromotionRejectionCode
      /** Safe to show the user: never names a row outside their own tenant. */
      error: string
      status: 400 | 404
      /** Present when one specific student caused the rejection. */
      studentId?: string
    }

/**
 * The destination a single student is promoted to.
 *
 * An override wins over the cohort target; with no override the student
 * follows the cohort. Exported because the page needs it to decide what each
 * row's `<Select>` starts on: the roster is rendered before anything is
 * saved, so a row that defaults to the cohort target and a row the user has
 * since overridden must agree with what the route would do.
 */
export function resolveDestination(
  studentId: string,
  cohortTargetClassId: string,
  overrides: readonly PromotionOverrideInput[] | undefined,
): string {
  return (
    overrides?.find((override) => override.studentId === studentId)?.toClassId ??
    cohortTargetClassId
  )
}

/**
 * Turn a request plus the facts the route read into a complete plan, or a
 * reason to refuse it.
 *
 * Checks run in a fixed order and all of them run before the caller writes
 * anything:
 *
 * 1. `UNKNOWN_TERM` — the term must exist in the caller's tenant and school.
 * 2. `UNKNOWN_CLASS` — both the source and the target must exist. Checked
 *    before `SAME_CLASS` so an id that is unknown *and* equal still reports
 *    the more specific "not found" rather than a nonsense "cannot promote a
 *    class to itself".
 * 3. `SAME_CLASS` — promoting a class into itself would rewrite nothing while
 *    reporting a cohort as promoted.
 * 4. `OVERRIDE_CLASS_UNKNOWN` — every override's destination must exist too.
 * 5. `OVERRIDE_STUDENT_NOT_IN_SOURCE` — the important one. The source
 *    system's controller trusted a client-posted array keyed by student id
 *    and moved whoever it named, so a crafted request could rewrite an
 *    arbitrary student's class. An override naming a student outside the
 *    source class is refused, not ignored: silently dropping it would promote
 *    a student the caller did not ask about if the id had been the only
 *    entry, and silently applying it would be the original vulnerability.
 * 6. `DUPLICATE_OVERRIDE` — two overrides for one student have no defined
 *    winner, and which one silently applied would depend on iteration order.
 * 7. `EMPTY_COHORT` — the source class holds nobody. This is almost always a
 *    wrong class selection rather than an intentional no-op, so it is a 400
 *    with a message instead of a cheerful "promoted 0 students".
 *
 * Every rejection is a refusal to act, not a warning. There is no path
 * through this function that returns a plan omitting rows.
 */
export function planPromotion(
  input: PromotionRequestInput,
  facts: PromotionFacts,
): PromotionPlan {
  // `termId` is not read here: whether the term exists is the `termKnown`
  // fact, and the id itself is only needed by the write, which takes it from
  // the validated request rather than from the plan.
  const { fromClassId, toClassId } = input
  const overrides = input.overrides ?? []

  if (!facts.termKnown) {
    return {
      ok: false,
      code: 'UNKNOWN_TERM',
      error: 'Term not found',
      status: 404,
    }
  }

  const known = new Set(facts.knownClassIds)
  if (!known.has(fromClassId)) {
    return {
      ok: false,
      code: 'UNKNOWN_CLASS',
      error: 'Source class not found',
      status: 404,
    }
  }
  if (!known.has(toClassId)) {
    return {
      ok: false,
      code: 'UNKNOWN_CLASS',
      error: 'Target class not found',
      status: 404,
    }
  }

  if (fromClassId === toClassId) {
    return {
      ok: false,
      code: 'SAME_CLASS',
      error: 'The target class must differ from the source class',
      status: 400,
    }
  }

  for (const override of overrides) {
    if (!known.has(override.toClassId)) {
      return {
        ok: false,
        code: 'OVERRIDE_CLASS_UNKNOWN',
        error: 'An override names a class that does not exist',
        status: 404,
      }
    }
  }

  const cohort = new Set(facts.cohortStudentIds)
  const seen = new Set<string>()
  for (const override of overrides) {
    if (!cohort.has(override.studentId)) {
      return {
        ok: false,
        code: 'OVERRIDE_STUDENT_NOT_IN_SOURCE',
        error: 'An override names a student who is not in the source class',
        status: 400,
        studentId: override.studentId,
      }
    }
    if (seen.has(override.studentId)) {
      return {
        ok: false,
        code: 'DUPLICATE_OVERRIDE',
        error: 'An override is repeated for the same student',
        status: 400,
        studentId: override.studentId,
      }
    }
    seen.add(override.studentId)
  }

  if (facts.cohortStudentIds.length === 0) {
    return {
      ok: false,
      code: 'EMPTY_COHORT',
      error: 'No students are currently in the source class',
      status: 400,
    }
  }

  const rows = facts.cohortStudentIds.map((studentId) => ({
    studentId,
    fromClassId,
    toClassId: resolveDestination(studentId, toClassId, overrides),
    overridden: seen.has(studentId),
  }))

  return { ok: true, rows }
}

/**
 * Per-student rows for the audit entry.
 *
 * The whole batch is one audit event, not one per student: a promotion is a
 * single decision, and a 45-student cohort would otherwise bury every other
 * audited action under 45 rows. The per-student destinations still belong in
 * the payload — that is what makes the entry worth having when someone asks
 * six months later why one child was not moved with the rest.
 */
export function auditChanges(rows: readonly PromotionPlanRow[], termId: string) {
  return {
    termId,
    promoted: rows.length,
    overrides: rows.filter((row) => row.overridden).map((row) => ({
      studentId: row.studentId,
      toClassId: row.toClassId,
    })),
    students: rows.map((row) => ({
      studentId: row.studentId,
      fromClassId: row.fromClassId,
      toClassId: row.toClassId,
    })),
  }
}