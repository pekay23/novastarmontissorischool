import { describe, it, expect } from 'bun:test'
import {
  auditChanges,
  planPromotion,
  resolveDestination,
  type PromotionFacts,
  type PromotionRequestInput,
} from '../app/portal/(portal)/promotions/promotion-plan'

/**
 * The promotion planner, proved without a database.
 *
 * `planPromotion` takes a request plus three facts the route has already read
 * and returns either a complete plan or a refusal. Everything below is
 * therefore about one question: does the plan match what a caller could
 * legitimately have asked for?
 *
 * The cases that matter most are the refusals. A promotion rewrites the
 * current class of every student in a cohort, so the plan has to be
 * unbuildable — not merely warned about — when the request names a class or a
 * student outside the caller's own tenant. The source system's controller
 * trusted a client-posted array keyed by student id and moved whoever it
 * named, which is the vulnerability these checks exist to close.
 */

const SOURCE = 'class-toddler-a'
const TARGET = 'class-toddler-b'
const TERM = 'term-1'

function request(overrides: Partial<PromotionRequestInput> = {}): PromotionRequestInput {
  return { fromClassId: SOURCE, toClassId: TARGET, termId: TERM, ...overrides }
}

function facts(overrides: Partial<PromotionFacts> = {}): PromotionFacts {
  return {
    knownClassIds: [SOURCE, TARGET, 'class-kindergarten-a'],
    termKnown: true,
    cohortStudentIds: ['stu-ada', 'stu-brah', 'stu-cleo'],
    ...overrides,
  }
}

describe('planPromotion - effective destination per row', () => {
  it('sends every student to the cohort target when there are no overrides', () => {
    const plan = planPromotion(request(), facts())

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.rows).toEqual([
      { studentId: 'stu-ada', fromClassId: SOURCE, toClassId: TARGET, overridden: false },
      { studentId: 'stu-brah', fromClassId: SOURCE, toClassId: TARGET, overridden: false },
      { studentId: 'stu-cleo', fromClassId: SOURCE, toClassId: TARGET, overridden: false },
    ])
  })

  it('honours an override for one student and leaves the rest on the cohort target', () => {
    const plan = planPromotion(
      request({ overrides: [{ studentId: 'stu-brah', toClassId: 'class-kindergarten-a' }] }),
      facts(),
    )

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const byStudent = Object.fromEntries(plan.rows.map((row) => [row.studentId, row]))
    expect(byStudent['stu-brah'].toClassId).toBe('class-kindergarten-a')
    expect(byStudent['stu-brah'].overridden).toBe(true)
    expect(byStudent['stu-ada'].toClassId).toBe(TARGET)
    expect(byStudent['stu-ada'].overridden).toBe(false)
    expect(byStudent['stu-cleo'].toClassId).toBe(TARGET)
    expect(byStudent['stu-cleo'].overridden).toBe(false)
  })

  it('plans one row per cohort member even when several are overridden', () => {
    const plan = planPromotion(
      request({
        overrides: [
          { studentId: 'stu-ada', toClassId: 'class-kindergarten-a' },
          { studentId: 'stu-cleo', toClassId: 'class-kindergarten-a' },
        ],
      }),
      facts(),
    )

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.rows).toHaveLength(3)
    expect(plan.rows.filter((row) => row.overridden)).toHaveLength(2)
  })

  it('resolveDestination agrees with the plan: override wins, else cohort target', () => {
    const overrides = [{ studentId: 'stu-brah', toClassId: 'class-kindergarten-a' }]
    expect(resolveDestination('stu-brah', TARGET, overrides)).toBe('class-kindergarten-a')
    expect(resolveDestination('stu-ada', TARGET, overrides)).toBe(TARGET)
    // No overrides at all is the same as an override naming nobody.
    expect(resolveDestination('stu-ada', TARGET, undefined)).toBe(TARGET)
    expect(resolveDestination('stu-ada', TARGET, [])).toBe(TARGET)
  })
})

describe('planPromotion - refusals', () => {
  it('refuses an override naming a student who is not in the source class', () => {
    // The source system took a client-posted array keyed by student id and
    // moved whoever it named, with no check that they were in the class being
    // promoted. This is the case that would have rewritten an arbitrary
    // student: the id belongs to somebody real, just not to this cohort.
    const plan = planPromotion(
      request({ overrides: [{ studentId: 'stu-someone-else', toClassId: TARGET }] }),
      facts(),
    )

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.code).toBe('OVERRIDE_STUDENT_NOT_IN_SOURCE')
    expect(plan.studentId).toBe('stu-someone-else')
    expect(plan.status).toBe(400)
  })

  it('refuses a class id that is not in the caller tenant, for source or target', () => {
    const foreignTarget = planPromotion(
      request({ toClassId: 'class-other-tenant' }),
      facts(),
    )
    expect(foreignTarget.ok).toBe(false)
    if (!foreignTarget.ok) expect(foreignTarget.code).toBe('UNKNOWN_CLASS')

    const foreignSource = planPromotion(
      request({ fromClassId: 'class-other-tenant' }),
      facts(),
    )
    expect(foreignSource.ok).toBe(false)
    if (!foreignSource.ok) {
      expect(foreignSource.code).toBe('UNKNOWN_CLASS')
      // The message must not echo the id back: a caller that guessed another
      // tenant's class id should learn it is not theirs, not confirm it
      // exists elsewhere.
      expect(foreignSource.error).not.toContain('class-other-tenant')
    }
  })

  it('refuses an override whose destination class is not in the tenant', () => {
    const plan = planPromotion(
      request({ overrides: [{ studentId: 'stu-ada', toClassId: 'class-elsewhere' }] }),
      facts(),
    )

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.code).toBe('OVERRIDE_CLASS_UNKNOWN')
  })

  it('refuses a promotion into the class it came from', () => {
    const plan = planPromotion(request({ toClassId: SOURCE }), facts())

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.code).toBe('SAME_CLASS')
    expect(plan.status).toBe(400)
  })

  it('refuses an unknown term', () => {
    const plan = planPromotion(request({ termId: 'term-nope' }), facts({ termKnown: false }))

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.code).toBe('UNKNOWN_TERM')
    expect(plan.status).toBe(404)
  })

  it('reports the unknown term before anything else, even with a bad class too', () => {
    // Ordering matters for the message a user sees: a typo in the term plus a
    // stale class in the same form should report the term, not chase the
    // class first and then report the term anyway.
    const plan = planPromotion(
      request({ toClassId: SOURCE }),
      facts({ termKnown: false }),
    )

    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('UNKNOWN_TERM')
  })

  it('refuses two overrides for the same student instead of picking one', () => {
    const plan = planPromotion(
      request({
        overrides: [
          { studentId: 'stu-ada', toClassId: 'class-kindergarten-a' },
          { studentId: 'stu-ada', toClassId: TARGET },
        ],
      }),
      facts(),
    )

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.code).toBe('DUPLICATE_OVERRIDE')
  })

  it('refuses an empty source class rather than reporting a successful no-op', () => {
    const plan = planPromotion(request(), facts({ cohortStudentIds: [] }))

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.code).toBe('EMPTY_COHORT')
  })

  it('never returns a plan that omits a cohort member', () => {
    // The single most important structural property: there is no input for
    // which a student in the cohort is silently left behind.
    const cohort = ['stu-1', 'stu-2', 'stu-3', 'stu-4', 'stu-5']
    const plan = planPromotion(
      request({
        overrides: [
          { studentId: 'stu-2', toClassId: 'class-kindergarten-a' },
          { studentId: 'stu-4', toClassId: 'class-kindergarten-a' },
        ],
      }),
      facts({ cohortStudentIds: cohort }),
    )

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.rows.map((row) => row.studentId).sort()).toEqual([...cohort].sort())
  })
})

describe('auditChanges', () => {
  it('records the term, the count and every per-student destination', () => {
    const plan = planPromotion(
      request({ overrides: [{ studentId: 'stu-brah', toClassId: 'class-kindergarten-a' }] }),
      facts(),
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const changes = auditChanges(plan.rows, TERM)
    expect(changes.termId).toBe(TERM)
    expect(changes.promoted).toBe(3)
    // One entry for the batch, but the per-student destinations still belong
    // in it — that is what makes the entry answer "why was this one child not
    // moved with the rest" six months later.
    expect(changes.overrides).toEqual([
      { studentId: 'stu-brah', toClassId: 'class-kindergarten-a' },
    ])
    expect(changes.students).toHaveLength(3)
    expect(changes.students).toContainEqual({
      studentId: 'stu-ada',
      fromClassId: SOURCE,
      toClassId: TARGET,
    })
  })
})