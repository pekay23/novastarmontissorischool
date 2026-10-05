import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { NextRequest } from 'next/server'

/**
 * Row-level visibility for the two assessment read routes.
 *
 * `CLASSROOM_TEACHER` holds `assessment:read` at `class` scope, so both routes
 * have to answer "which rows", not only "may they read at all":
 *
 * - `GET /api/assessments` filtered on `schoolId`/`tenantId` alone, so a
 *   teacher read every assessment in the school and could widen further with
 *   `?classId=<any other class>`.
 * - `GET /api/assessments/[id]/scores` verified the assessment but then read
 *   scores by `assessmentId` alone, leaking names and marks for students in
 *   classes the caller does not teach.
 *
 * The Prisma doubles below HONOUR the where clauses rather than recording them,
 * so a missing or misplaced clause shows up as the wrong rows coming back, not
 * only as a different argument object.
 */

interface Row {
  [key: string]: unknown
}

interface QueryArgs {
  where?: Row
  select?: Row
  include?: Row
  data?: Row
}

const TENANT_ID = 'tenant-multi-school'
const SCHOOL_ID = 'school-main'
const OTHER_SCHOOL_ID = 'school-other'
const USER_ID = 'user-teacher'
const STAFF_ID = 'staff-1'
const PARENT_ID = 'parent-1'

// --- Doubles ---------------------------------------------------------------

class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

interface Session {
  tenantId: string
  schoolId: string | null
  userId: string
  role: string | null
}

let session: Session = {
  tenantId: TENANT_ID,
  schoolId: SCHOOL_ID,
  userId: USER_ID,
  role: 'CLASSROOM_TEACHER',
}

const getTenantContext = mock(async (): Promise<Session> => session)

let grants: string[] = ['assessment:read', 'assessment:grade']

const hasPermission = mock(
  async (_userId: string, key: string): Promise<boolean> =>
    grants.includes('*') || grants.includes(key),
)

class ServerConfigError extends Error {
  constructor() {
    super('Server configuration error')
    this.name = 'ServerConfigError'
  }
}

// Captured before the first `mock.module` below, so it is the namespace this file
// replaces rather than its own factory. Registered with the rest further down.
const actualAuth = await import('@novastar/auth')

/**
 * Classes. The teacher reaches `class-1` (as class teacher) and `class-3`
 * (another school, as class teacher). `class-2` is in THIS school and belongs
 * to a different teacher, which is what makes it the widening target.
 */
const CLASSES: Row[] = [
  { id: 'class-1', tenantId: TENANT_ID, schoolId: SCHOOL_ID, classTeacherId: STAFF_ID },
  { id: 'class-2', tenantId: TENANT_ID, schoolId: SCHOOL_ID, classTeacherId: 'staff-2' },
  { id: 'class-3', tenantId: TENANT_ID, schoolId: OTHER_SCHOOL_ID, classTeacherId: STAFF_ID },
]

const CLASS_SUBJECTS: Row[] = [
  { id: 'cs-1', tenantId: TENANT_ID, classId: 'class-1', teacherId: STAFF_ID },
  { id: 'cs-2', tenantId: TENANT_ID, classId: 'class-2', teacherId: 'staff-2' },
  { id: 'cs-3', tenantId: TENANT_ID, classId: 'class-3', teacherId: STAFF_ID },
]

const ASSESSMENTS: Row[] = [
  { id: 'assess-mine', tenantId: TENANT_ID, schoolId: SCHOOL_ID, termId: 'term-1', classSubjectId: 'cs-1', name: 'Mine' },
  { id: 'assess-other-class', tenantId: TENANT_ID, schoolId: SCHOOL_ID, termId: 'term-1', classSubjectId: 'cs-2', name: 'Someone else\'s class' },
  { id: 'assess-other-school', tenantId: TENANT_ID, schoolId: OTHER_SCHOOL_ID, termId: 'term-1', classSubjectId: 'cs-3', name: 'Other school' },
]

interface Student {
  id: string
  schoolId: string
  parentId: string | null
  enrollmentClassIds: string[]
}

const STUDENTS: Student[] = [
  { id: 'stu-1', schoolId: SCHOOL_ID, parentId: PARENT_ID, enrollmentClassIds: ['class-1'] },
  { id: 'stu-2', schoolId: SCHOOL_ID, parentId: null, enrollmentClassIds: ['class-1'] },
  { id: 'stu-3', schoolId: SCHOOL_ID, parentId: null, enrollmentClassIds: ['class-2'] },
  { id: 'stu-4', schoolId: OTHER_SCHOOL_ID, parentId: null, enrollmentClassIds: ['class-3'] },
]

const SCORES: Row[] = [
  { id: 'score-1', tenantId: TENANT_ID, assessmentId: 'assess-mine', studentId: 'stu-1', rawScore: 80 },
  { id: 'score-2', tenantId: TENANT_ID, assessmentId: 'assess-mine', studentId: 'stu-3', rawScore: 90 },
  { id: 'score-3', tenantId: TENANT_ID, assessmentId: 'assess-other-class', studentId: 'stu-3', rawScore: 70 },
]

/** Staff rows for `resolveVisibility`, keyed by userId. */
let staffRow: Row | null = { id: STAFF_ID }
let parentRow: Row | null = null

/** `findFirst` filters the doubles return: null means "matches nothing". */
function matchesClassSubject(row: Row, clause: Row): boolean {
  const cs = CLASS_SUBJECTS.find((c) => c.id === row.classSubjectId)
  if (!cs) return false
  const classId = cs.classId
  if (typeof classId !== 'string') return false
  const filter = clause.classId
  if (filter === undefined) return true
  if (typeof filter === 'string') return classId === filter
  if (filter && typeof filter === 'object' && Array.isArray((filter as Row).in)) {
    return ((filter as Row).in as string[]).includes(classId)
  }
  return true
}

function matchesAssessmentClause(row: Row, clause: Row): boolean {
  if (clause.classSubject !== undefined) {
    return matchesClassSubject(row, clause.classSubject as Row)
  }
  if (clause.termId !== undefined && clause.termId !== row.termId) return false
  return true
}

function matchesAssessment(row: Row, where: Row): boolean {
  if (where.tenantId !== undefined && where.tenantId !== row.tenantId) return false
  if (where.schoolId !== undefined && where.schoolId !== row.schoolId) return false
  if (where.id !== undefined && where.id !== row.id) return false
  if (where.termId !== undefined && where.termId !== row.termId) return false
  if (where.classSubject !== undefined && !matchesClassSubject(row, where.classSubject as Row)) {
    return false
  }
  if (Array.isArray(where.AND)) {
    return (where.AND as Row[]).every((clause) => matchesAssessmentClause(row, clause))
  }
  return true
}

function matchesStudent(student: Student, clause: Row): boolean {
  if (clause.schoolId !== undefined && clause.schoolId !== student.schoolId) return false
  if (clause.parentId !== undefined && clause.parentId !== student.parentId) return false
  if (clause.enrollments !== undefined) {
    const relation = (clause.enrollments as Row).some as Row | undefined
    const allowed = relation?.classId as Row | undefined
    const allowedIds = allowed?.in
    if (!Array.isArray(allowedIds)) return true
    return student.enrollmentClassIds.some((c) => (allowedIds as string[]).includes(c))
  }
  return true
}

function matchesScore(row: Row, where: Row): boolean {
  if (where.tenantId !== undefined && where.tenantId !== row.tenantId) return false
  if (where.assessmentId !== undefined && where.assessmentId !== row.assessmentId) return false
  const student = STUDENTS.find((s) => s.id === row.studentId)
  if (!student) return false

  // Unwrap every `student` relation clause, whether it is a sibling of
  // `tenantId`/`assessmentId` or composed under `AND`. With no such clause the
  // row matches, which is exactly what the unscoped read did.
  const clauses: Row[] = []
  if (where.student !== undefined) clauses.push(where.student as Row)
  for (const clause of (where.AND ?? []) as Row[]) {
    if (clause.student !== undefined) clauses.push(clause.student as Row)
  }
  return clauses.every((clause) => matchesStudent(student, clause))
}

const assessmentFindMany = mock(async (args: QueryArgs): Promise<Row[]> =>
  ASSESSMENTS.filter((row) => matchesAssessment(row, args.where ?? {})),
)

const assessmentFindFirst = mock(async (args: QueryArgs): Promise<Row | null> =>
  ASSESSMENTS.find((row) => matchesAssessment(row, args.where ?? {})) ?? null,
)

const scoreFindMany = mock(async (args: QueryArgs): Promise<Row[]> =>
  SCORES.filter((row) => matchesScore(row, args.where ?? {})),
)

const staffFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  return where.userId === session.userId && where.tenantId === session.tenantId ? staffRow : null
})

const parentFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  return where.userId === session.userId && where.tenantId === session.tenantId ? parentRow : null
})

const classFindMany = mock(async (args: QueryArgs): Promise<Row[]> => {
  const where = args.where ?? {}
  return CLASSES.filter((row) => row.tenantId === where.tenantId && row.classTeacherId === where.classTeacherId)
})

const classSubjectFindMany = mock(async (args: QueryArgs): Promise<Row[]> => {
  const where = args.where ?? {}
  return CLASS_SUBJECTS.filter((row) => row.tenantId === where.tenantId && row.teacherId === where.teacherId)
})

const prismaDouble = {
  assessment: { findMany: assessmentFindMany, findFirst: assessmentFindFirst },
  score: { findMany: scoreFindMany },
  staff: { findFirst: staffFindFirst },
  parent: { findFirst: parentFindFirst },
  class: { findMany: classFindMany },
  classSubject: { findMany: classSubjectFindMany },
}

// ---------------------------------------------------------------------------
// Module-mock lifetime: snapshot before registering, restore after
// ---------------------------------------------------------------------------
//
// `mock.module` patches the LIVE namespace for the whole process and never reverts, so a
// registration made at module scope is not this file's alone — it is what every file that
// loads afterwards binds to, and it is still live once this file has finished. All four
// boundaries registered here are put back.
//
// `server-only` goes first and alone: the real `@/lib/tenant` imports it and the package
// is not installed in this workspace, so nothing else is capturable until that specifier
// resolves. Its snapshot entry is therefore the empty module registered here — an
// identity, not a restoration, and inert either way.
//
// The other three snapshots are read HERE, before the first of those registrations, and
// that is load-bearing: a `beforeEach` capture would run after they had already
// overwritten the namespace, so it would record this file's own factory and hand the
// double straight back to the next file.
//
// Every factory SPREADS the namespace it replaces and then overrides, which makes each
// fake both a superset — no caller can fail on a name this file happened not to list —
// and a subset, since `mock.module` merges and an added key could never be removed by
// the restore. `lib/prisma` has both a named and a default export and both are set, for
// the same reason: dropping the default here removed it from every file loaded alongside
// this one.
const previousNamespaces = new Map<string, Record<string, unknown>>([
  ['@novastar/auth', { ...actualAuth }],
])

mock.module('server-only', () => ({}))

previousNamespaces.set('server-only', { ...(await import('server-only')) })
previousNamespaces.set('@/lib/tenant', { ...(await import('@/lib/tenant')) })
previousNamespaces.set('@/lib/prisma', { ...(await import('@/lib/prisma')) })

const base = (specifier: string): Record<string, unknown> =>
  previousNamespaces.get(specifier) ?? {}

const FAKES = [
  { specifier: '@novastar/auth', factory: () => ({ ...base('@novastar/auth'), hasPermission }) },
  {
    specifier: '@/lib/tenant',
    factory: () => ({
      ...base('@/lib/tenant'),
      UnauthorizedError,
      ForbiddenError,
      ServerConfigError,
      getTenantContext,
      getTenantContextOrNull: async () => session,
    }),
  },
  {
    specifier: '@/lib/prisma',
    factory: () => ({ ...base('@/lib/prisma'), prisma: prismaDouble, default: prismaDouble }),
  },
] as const

// Also registered at load time, so the route imports below resolve these specifiers
// through the doubles and the file is correct in a run that never reaches `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

const assessmentsRoute = await import('@/app/api/assessments/route')
const scoresRoute = await import('@/app/api/assessments/[id]/scores/route')

// --- Helpers ---------------------------------------------------------------

function listRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/assessments${query}`)
}

function scoresParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function listIds(query = ''): Promise<{ status: number; ids: string[] }> {
  const res = await assessmentsRoute.GET(listRequest(query))
  const body = (await res.json()) as { data?: Array<Row>; error?: string }
  return {
    status: res.status,
    ids: (body.data ?? []).map((r) => String(r.id)),
  }
}

async function scoreIds(id: string): Promise<{ status: number; ids: string[] }> {
  const res = await scoresRoute.GET(listRequest(), scoresParams(id))
  const body = (await res.json()) as { scores?: Array<Row>; error?: string }
  return {
    status: res.status,
    ids: (body.scores ?? []).map((r) => String(r.id)),
  }
}

beforeEach(() => {
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
  session = {
    tenantId: TENANT_ID,
    schoolId: SCHOOL_ID,
    userId: USER_ID,
    role: 'CLASSROOM_TEACHER',
  }
  grants = ['assessment:read', 'assessment:grade']
  staffRow = { id: STAFF_ID }
  parentRow = null

  assessmentFindMany.mockClear()
  assessmentFindFirst.mockClear()
  scoreFindMany.mockClear()
  hasPermission.mockClear()
  hasPermission.mockImplementation(
    async (_userId: string, key: string) => grants.includes('*') || grants.includes(key),
  )
})

// --- GET /api/assessments --------------------------------------------------

describe('GET /api/assessments - row-level visibility', () => {
  it('returns only assessments for the caller\'s own classes', async () => {
    const { status, ids } = await listIds()
    expect(status).toBe(200)
    expect(ids).toEqual(['assess-mine'])
  })

  it('returns nothing for a class outside the caller\'s visible set', async () => {
    // `class-2` is in this school but belongs to another teacher. Naming it
    // must narrow to nothing, not widen the read to that class.
    const { status, ids } = await listIds('?classId=class-2')
    expect(status).toBe(200)
    expect(ids).toEqual([])
  })

  it('keeps the school filter on an unrestricted caller', async () => {
    // A Head of School resolves to `all` scope, so no clause is added — but the
    // other school's assessments must still be excluded.
    session.role = 'HEADMASTER'
    const { status, ids } = await listIds()
    expect(status).toBe(200)
    expect(ids).toEqual(['assess-mine', 'assess-other-class'])
  })

  it('fails closed with 403 when the caller resolves to no classes', async () => {
    // A teacher whose Staff row exists but who teaches nothing holds the
    // permission and sees nothing. A misconfigured assignment must not read as
    // "the school has no assessments".
    staffRow = null
    classFindMany.mockClear()
    classFindMany.mockImplementation(async () => [])

    const { status, ids } = await listIds()
    expect(status).toBe(403)
    expect(ids).toEqual([])
  })

  it('narrows a named class within the visible set rather than replacing it', async () => {
    const { status, ids } = await listIds('?classId=class-1')
    expect(status).toBe(200)
    expect(ids).toEqual(['assess-mine'])
  })
})

// --- GET /api/assessments/[id]/scores --------------------------------------

describe('GET /api/assessments/[id]/scores - row-level visibility', () => {
  it('returns scores only for students the caller may see', async () => {
    // score-2 belongs to stu-3, who is enrolled in class-2 — a class this
    // teacher does not teach. Reading it leaked that student's name and mark.
    const { status, ids } = await scoreIds('assess-mine')
    expect(status).toBe(200)
    expect(ids).toEqual(['score-1'])
  })

  it('404s an assessment in a class the caller may not read', async () => {
    const { status, ids } = await scoreIds('assess-other-class')
    expect(status).toBe(404)
    expect(ids).toEqual([])
  })

  it('still returns every score to an unrestricted caller', async () => {
    session.role = 'HEADMASTER'
    const { status, ids } = await scoreIds('assess-mine')
    expect(status).toBe(200)
    expect(ids).toEqual(['score-1', 'score-2'])
  })

  it('fails closed with 403 before touching the assessment when nothing is visible', async () => {
    staffRow = null
    classFindMany.mockClear()
    classFindMany.mockImplementation(async () => [])

    const { status, ids } = await scoreIds('assess-mine')
    expect(status).toBe(403)
    expect(ids).toEqual([])
    expect(assessmentFindFirst).not.toHaveBeenCalled()
  })
})