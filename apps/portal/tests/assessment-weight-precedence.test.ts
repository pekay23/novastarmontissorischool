import { describe, it, expect, afterAll, beforeEach, mock, spyOn } from 'bun:test'
import { NextRequest } from 'next/server'
import {
  computeAcademicSummary,
  resolveAssessmentWeight,
  type ReportableAssessment,
} from '@novastar/shared-utils'
import { AssessmentTypeConfigSchema } from '@novastar/shared-types'

/**
 * An assessment's weight: whose it is, and where it comes from.
 *
 * `POST /api/assessments` used to copy its type's `defaultWeight` onto the row it
 * created. An explicit own-weight outranks the type default, so every assessment
 * created through the API permanently reported `weightSource: 'assessment'`, the
 * report tooltip read "Weight set on this assessment" for a weight nobody set, and a
 * head teacher retuning a type from 0.30 to 0.40 changed nothing at all for any
 * existing row. That left `weightSource: 'assessment_type'` unreachable in practice,
 * which defeats the exact precedence the nullable column was introduced to express.
 *
 * The row is now created with `weight` NULL, which is the one value that means "this
 * assessment has no weight of its own", so the school's configured weight applies and
 * keeps applying. These tests assert on the arguments the mocked Prisma call received
 * and on the arithmetic that follows, not on the response body, because the defect was
 * entirely inside the write.
 */

// ---------------------------------------------------------------------------
// Session / auth / Prisma, mocked at the boundary
// ---------------------------------------------------------------------------

class MockUnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

class MockForbiddenError extends Error {
  constructor() {
    super('Forbidden')
    this.name = 'ForbiddenError'
  }
}

class MockServerConfigError extends Error {
  constructor() {
    super('Server config unavailable')
    this.name = 'ServerConfigError'
  }
}

/**
 * HEADMASTER, so `resolveVisibility` answers `all` from the role table alone and the
 * test is about the write rather than about row scope.
 */
const tenantContext = {
  tenantId: 'tenant-1',
  schoolId: 'school-1',
  userId: 'user-1',
  role: 'HEADMASTER',
}

mock.module('@/lib/tenant', () => ({
  getTenantContext: async () => tenantContext,
  getTenantContextOrNull: async () => tenantContext,
  UnauthorizedError: MockUnauthorizedError,
  ForbiddenError: MockForbiddenError,
  ServerConfigError: MockServerConfigError,
}))

const actualAuth = await import('@novastar/auth')
mock.module('@novastar/auth', () => ({ ...actualAuth, hasPermission: async () => true }))

type Args = { where?: Record<string, unknown>; data?: Record<string, unknown> }

let typeConfig: Record<string, unknown> | null = null
const createCalls: Args[] = []

const classSubjectFindFirst = mock(async () => ({
  id: 'cs-1',
  subject: { name: 'Mathematics', code: 'MAT' },
}))
const assessmentTypeConfigFindFirst = mock(async (args: Args) => {
  if (args.where?.id !== typeConfig?.id) return null
  return typeConfig
})
const termFindFirst = mock(async () => ({ id: 'term-1' }))
const assessmentCreate = mock(async (args: Args) => {
  createCalls.push(args)
  return { id: 'assessment-1', ...(args.data ?? {}) }
})

mock.module('server-only', () => ({}))
mock.module('@/lib/prisma', () => ({
  prisma: {
    classSubject: { findFirst: classSubjectFindFirst },
    assessmentTypeConfig: { findFirst: assessmentTypeConfigFindFirst },
    term: { findFirst: termFindFirst },
    assessment: { create: assessmentCreate },
  },
}))

const silencedError = spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => {
  silencedError.mockRestore()
})

const { POST } = await import('@/app/api/assessments/route')

function create(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/assessments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const VALID_BODY = {
  classSubjectId: 'cs-1',
  termId: 'term-1',
  typeId: 'type-quiz',
  name: 'End of term quiz',
  assessmentDate: '2026-05-01T00:00:00.000Z',
}

beforeEach(() => {
  typeConfig = {
    id: 'type-quiz',
    tenantId: 'tenant-1',
    schoolId: 'school-1',
    code: 'QUIZ',
    name: 'Quiz',
    defaultWeight: 0.3,
  }
  createCalls.length = 0
})

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

describe('POST /api/assessments leaves the weight to the school\'s configuration', () => {
  it('writes no weight at all, rather than copying the type\'s', async () => {
    const res = await create(VALID_BODY)

    expect(res.status).toBe(201)
    expect(createCalls).toHaveLength(1)
    // The absence is the whole fix, so it is asserted as an absent key rather than
    // as a value: `weight: undefined` would be indistinguishable from the copy in a
    // future diff.
    expect(createCalls[0]!.data).not.toHaveProperty('weight')
    expect(Object.keys(createCalls[0]!.data!).sort()).toEqual([
      'assessmentDate',
      'classSubjectId',
      'createdById',
      'description',
      'dueDate',
      'maxScore',
      'name',
      'schoolId',
      'tenantId',
      'termId',
      'typeId',
    ])
  })

  it('still reads the type, so the school-scope check on it is not lost', async () => {
    // The copy is gone but the lookup stays: a type from another school must still
    // be refused rather than silently accepted.
    await create(VALID_BODY)
    expect(assessmentTypeConfigFindFirst.mock.calls[0]![0]).toEqual({
      where: { id: 'type-quiz', tenantId: 'tenant-1', schoolId: 'school-1' },
    })
  })

  it('refuses a type that is not the school\'s, and writes nothing', async () => {
    const res = await create({ ...VALID_BODY, typeId: 'type-foreign' })

    expect(res.status).toBe(404)
    expect(createCalls).toHaveLength(0)
  })

  it('does not change its behaviour when the type carries no weight at all', async () => {
    typeConfig = { ...typeConfig!, defaultWeight: null }
    const res = await create(VALID_BODY)

    expect(res.status).toBe(201)
    expect(createCalls[0]!.data).not.toHaveProperty('weight')
  })
})

// ---------------------------------------------------------------------------
// Precedence, and a retune reaching an assessment nobody pinned
// ---------------------------------------------------------------------------

describe('resolveAssessmentWeight - the precedence a created row now reaches', () => {
  it('takes the type\'s configured weight when the row carries none', () => {
    // This is the state every API-created assessment is in, so it is the state the
    // `assessment_type` source exists for.
    expect(resolveAssessmentWeight({ weight: null, typeDefaultWeight: 0.3 })).toEqual({
      weight: 0.3,
      source: 'assessment_type',
    })
  })

  it('still lets an assessment\'s own weight outrank its type', () => {
    expect(resolveAssessmentWeight({ weight: 2, typeDefaultWeight: 0.3 })).toEqual({
      weight: 2,
      source: 'assessment',
    })
  })

  it('honours an own weight of exactly 1 rather than discarding it as "unset"', () => {
    expect(resolveAssessmentWeight({ weight: 1, typeDefaultWeight: 0.3 })).toEqual({
      weight: 1,
      source: 'assessment',
    })
  })

  it('falls back to equal weighting only when neither carries a usable weight', () => {
    expect(resolveAssessmentWeight({ weight: null, typeDefaultWeight: null })).toEqual({
      weight: 1,
      source: 'default',
    })
  })
})

describe('a retune of the type reaches every assessment that has no weight of its own', () => {
  const quiz: ReportableAssessment = {
    subjectId: 'sub-1',
    percentage: 90,
    weight: null,
    assessmentType: 'Quiz',
    assessmentTypeCode: 'QUIZ',
  }
  const finalExam = (
    typeDefaultWeight: number,
  ): ReportableAssessment => ({
    subjectId: 'sub-1',
    percentage: 40,
    weight: null,
    assessmentType: 'Final Exam',
    assessmentTypeCode: 'FINAL',
    typeDefaultWeight,
  })
  const quizRow: ReportableAssessment = { ...quiz, typeDefaultWeight: 0.1 }

  it('composes the terminal figure from the weights configured at the time', () => {
    const summary = computeAcademicSummary([quizRow, finalExam(0.15)])

    // (90 x 0.10 + 40 x 0.15) / 0.25 = 60
    expect(summary.weightedPercentage).toBe(60)
    expect(summary.weighting.components.find((c) => c.code === 'QUIZ')?.weight).toBe(0.1)
  })

  it('moves the same two rows when the school retunes the type, with no rewrite of either', () => {
    const summary = computeAcademicSummary([quizRow, finalExam(0.45)])

    // (90 x 0.10 + 40 x 0.45) / 0.55 = 49.09
    expect(summary.weightedPercentage).toBe(49.09)
    // The rows are byte-identical between the two calls; only the type's configured
    // weight changed, which is the whole claim.
    expect(summary.weighting.totalWeight).toBe(0.55)
  })

  it('does not move a row that WAS given a weight of its own', () => {
    // The precedence has to stay real in both directions, or fixing the copy would
    // have removed the only way to pin one assessment.
    const pinned: ReportableAssessment = { ...finalExam(0.15), weight: 0.15 }

    expect(resolveAssessmentWeight(pinned).source).toBe('assessment')
    expect(computeAcademicSummary([quizRow, pinned]).weightedPercentage).toBe(60)
    expect(computeAcademicSummary([quizRow, { ...pinned }]).weightedPercentage).toBe(60)
  })
})

// ---------------------------------------------------------------------------
// The bound that made a 0 exclusion look like it worked
// ---------------------------------------------------------------------------

describe('AssessmentTypeConfigSchema - what a school may configure', () => {
  // The base carries the row identity the config endpoint omits before it writes;
  // a valid full row is what the school-admin write path validates against.
  const valid = {
    id: 'cm1assessmenttype0001',
    tenantId: 'cm1tenant00000000000000000001',
    schoolId: 'cm1school0000000000000000001',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    code: 'QUIZ',
    name: 'Quiz',
    defaultWeight: 0.1,
    maxScore: 100,
    appliesToLevels: ['B1'],
  }

  /**
   * The message the teacher is shown, and only when the schema actually refuses —
   * narrowing rather than asserting through `expect`, because a test that reads
   * `.error` on a successful parse would throw a different error than it asserts.
   */
  const refusalFor = (defaultWeight: number): string => {
    const parsed = AssessmentTypeConfigSchema.safeParse({ ...valid, defaultWeight })
    if (parsed.success) {
      throw new Error(`expected the schema to refuse defaultWeight ${defaultWeight}`)
    }
    return parsed.error.issues[0]?.message ?? ''
  }

  it('refuses a weight of 0, because the report could not honour it as an exclusion', () => {
    // The teacher is told what a 0 would actually do, not just that it is invalid.
    expect(refusalFor(0)).toContain('greater than 0')
    expect(refusalFor(0)).toContain('cannot exclude')
    expect(refusalFor(0)).toContain('divides by the sum')
    expect(refusalFor(-1)).toContain('greater than 0')
  })

  it('accepts a relative weight above 1, which the normalised mean handles', () => {
    expect(AssessmentTypeConfigSchema.safeParse({ ...valid, defaultWeight: 3 }).success).toBe(true)
  })

  it('accepts the ceiling of the column and refuses one above it', () => {
    expect(AssessmentTypeConfigSchema.safeParse({ ...valid, defaultWeight: 9.99 }).success).toBe(true)
    expect(refusalFor(10)).toContain('9.99')
  })

  it('accepts the weights the seed ships', () => {
    for (const weight of [0.15, 0.05, 0.1, 0.3]) {
      expect(AssessmentTypeConfigSchema.safeParse({ ...valid, defaultWeight: weight }).success).toBe(true)
    }
  })
})