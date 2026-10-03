import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { NextRequest } from 'next/server'

/**
 * `POST /api/promotions`.
 *
 * The house `mock.module` idiom: session, permission and Prisma boundaries are
 * replaced, then the route is dynamically imported so it binds to these
 * doubles. Every finder honours the `where` it is given, so a class id from
 * another tenant simply does not resolve and the route has to refuse it — a
 * cooperative double would let an unscoped handler pass every assertion here.
 *
 * `@/lib/api-response` is NOT mocked. Bun's module mock registry is global
 * and outlives this file, and `system-config-route.test.ts` loads routes that
 * use the real one. It runs for real against the mocked client instead.
 *
 * This file registers every boundary before its single dynamic import, so it
 * depends on no other file's mocks and no other file can break it.
 */

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? 'promotions-test-secret'

interface Row {
  [key: string]: unknown
}

interface QueryArgs {
  where?: Row
  select?: Row
  include?: Row
  data?: Row
}

const USER_ID = 'user-head'
const TENANT_ID = 'tenant-school'
const OTHER_TENANT_ID = 'tenant-other'
const SCHOOL_ID = 'school-main'

const SOURCE = 'class-toddler-a'
const TARGET = 'class-toddler-b'
const ALT = 'class-toddler-c'
const TERM_ID = 'term-1'

/** Classes in the caller's tenant and school, plus one belonging elsewhere. */
const CLASSES: Row[] = [
  { id: SOURCE, tenantId: TENANT_ID, schoolId: SCHOOL_ID },
  { id: TARGET, tenantId: TENANT_ID, schoolId: SCHOOL_ID },
  { id: ALT, tenantId: TENANT_ID, schoolId: SCHOOL_ID },
  // A real class in the caller's school that nobody is currently in.
  { id: 'class-empty', tenantId: TENANT_ID, schoolId: SCHOOL_ID },
  { id: 'class-foreign', tenantId: OTHER_TENANT_ID, schoolId: 'school-other' },
]

/** Students whose `classId` is their current class. */
const STUDENTS: Row[] = [
  { id: 'stu-ada', tenantId: TENANT_ID, schoolId: SCHOOL_ID, classId: SOURCE },
  { id: 'stu-brah', tenantId: TENANT_ID, schoolId: SCHOOL_ID, classId: SOURCE },
  { id: 'stu-cleo', tenantId: TENANT_ID, schoolId: SCHOOL_ID, classId: SOURCE },
  { id: 'stu-someone-else', tenantId: TENANT_ID, schoolId: SCHOOL_ID, classId: ALT },
  { id: 'stu-foreign', tenantId: OTHER_TENANT_ID, schoolId: 'school-other', classId: SOURCE },
]

interface Session {
  tenantId: string
  schoolId: string | null
  userId: string
  role: string | null
  user: Row
}

let session: Session = {
  tenantId: TENANT_ID,
  schoolId: SCHOOL_ID,
  userId: USER_ID,
  role: 'HEADMASTER',
  user: { id: USER_ID },
}

let sessionError: Error | null = null
let grants: string[] = ['promotion:execute']

class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

const getTenantContext = mock(async (): Promise<Session> => {
  if (sessionError) throw sessionError
  return session
})

const hasPermission = mock(
  async (_userId: string, key: string): Promise<boolean> => grants.includes(key),
)

mock.module('server-only', () => ({}))
mock.module('@novastar/auth', () => ({ hasPermission }))
mock.module('@/lib/tenant', () => ({
  UnauthorizedError,
  ForbiddenError: class extends Error {},
  getTenantContext,
  getTenantContextOrNull: async () => (sessionError ? null : session),
}))

// --- Prisma doubles ----------------------------------------------------------

const classFindMany = mock(async (args: QueryArgs): Promise<Row[]> => {
  const where = args.where ?? {}
  return CLASSES.filter(
    (row) => row.tenantId === where.tenantId && row.schoolId === where.schoolId,
  )
})

/** `ClassTerm` rows explicitly marked inactive for the term. */
let inactiveClassTerms: Row[] = []

const classTermFindMany = mock(async (_args: QueryArgs): Promise<Row[]> => inactiveClassTerms)

const termFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  return where.id === TERM_ID && where.tenantId === TENANT_ID && where.schoolId === SCHOOL_ID
    ? { id: TERM_ID }
    : null
})

const studentFindMany = mock(async (args: QueryArgs): Promise<Row[]> => {
  const where = args.where ?? {}
  const classFilter = where.class as Row | undefined
  return STUDENTS.filter((row) => {
    if (row.tenantId !== where.tenantId) return false
    if (row.classId !== where.classId) return false
    if (classFilter?.schoolId !== undefined && row.schoolId !== classFilter.schoolId) {
      return false
    }
    return true
  })
})

/**
 * The compound-unique upsert, recorded rather than performed.
 *
 * `upsertCalls` is the evidence for idempotence: a repeated promotion must
 * issue the SAME upsert keyed on `[tenantId, studentId, termId]`, never a
 * second `create`, and never raise.
 */
interface UpsertCall {
  where: { tenantId_studentId_termId: { tenantId: string; studentId: string; termId: string } }
  create: Row
  update: Row
}

let upsertCalls: UpsertCall[] = []

/** Set by a test to make one student's upsert fail. */
let upsertErrorFor: string | null = null

const enrollmentUpsert = mock(async (args: QueryArgs): Promise<Row> => {
  const where = args.where as UpsertCall['where']
  const studentId = where.tenantId_studentId_termId.studentId
  if (upsertErrorFor === studentId) throw new Error('write failed')
  // Prisma's `upsert` takes `create` and `update` as siblings, not a `data`.
  upsertCalls.push({
    where,
    create: (args as unknown as { create: Row }).create,
    update: (args as unknown as { update: Row }).update,
  })
  return { id: `enr-${studentId}` }
})

/** Tenant-scoped by construction, so a foreign id updates nothing. */
let studentUpdates: { where: Row; data: Row }[] = []

/** Set by a test to make the class pointer update match zero rows. */
let studentUpdateCount = 1

const studentUpdateMany = mock(async (args: QueryArgs): Promise<Row> => {
  studentUpdates.push({ where: args.where ?? {}, data: args.data ?? {} })
  return { count: studentUpdateCount }
})

/** Audit entries written, and whether they went through the transaction. */
let auditWrites: { params: Row; viaTransaction: boolean }[] = []

const logAuditEvent = mock(async (params: Row, tx?: unknown): Promise<Row | null> => {
  auditWrites.push({ params, viaTransaction: tx !== undefined })
  return { id: 'audit-1' }
})

/** Set by a test to make the whole transaction throw. */
let transactionError: unknown = null

const TX_CLIENT = {
  enrollment: { upsert: enrollmentUpsert },
  student: { updateMany: studentUpdateMany },
  auditLog: { create: mock(async () => ({ id: 'audit-row' })) },
}

const $transaction = mock(
  async (fn: (tx: typeof TX_CLIENT) => Promise<unknown>): Promise<unknown> => {
    if (transactionError) throw transactionError
    return fn(TX_CLIENT)
  },
)

mock.module('@/lib/audit/logger', () => ({
  AuditLogAction: { UPDATE: 'UPDATE' },
  logAuditEvent,
  createAuditLog: logAuditEvent,
}))

mock.module('@/lib/prisma', () => ({
  prisma: {
    class: { findMany: classFindMany },
    classTerm: { findMany: classTermFindMany },
    term: { findFirst: termFindFirst },
    student: { findMany: studentFindMany, updateMany: studentUpdateMany },
    enrollment: { upsert: enrollmentUpsert },
    systemError: { create: mock(async () => ({ id: 'err-1' })) },
    auditLog: { findFirst: mock(async () => null) },
    $transaction,
  },
}))

const { GET, POST } = await import('@/app/api/promotions/route')

// --- Helpers -----------------------------------------------------------------

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/promotions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as unknown as NextRequest
}

const validBody = { fromClassId: SOURCE, toClassId: TARGET, termId: TERM_ID }

beforeEach(() => {
  session = {
    tenantId: TENANT_ID,
    schoolId: SCHOOL_ID,
    userId: USER_ID,
    role: 'HEADMASTER',
    user: { id: USER_ID },
  }
  sessionError = null
  grants = ['promotion:execute']
  upsertCalls = []
  upsertErrorFor = null
  studentUpdates = []
  studentUpdateCount = 1
  auditWrites = []
  transactionError = null
  inactiveClassTerms = []
})

// --- Tests -------------------------------------------------------------------

describe('GET /api/promotions', () => {
  it('reports the capability so the page can disable the action', async () => {
    const res = await GET()

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ canPromote: true })
  })

  it('reports canPromote false rather than hiding the screen', async () => {
    grants = []
    const res = await GET()

    expect((await res.json()).data).toEqual({ canPromote: false })
  })
})

describe('POST /api/promotions - authorization', () => {
  it('refuses a caller without promotion:execute and writes nothing', async () => {
    grants = []
    const res = await POST(postRequest(validBody))

    expect(res.status).toBe(403)
    expect(upsertCalls).toHaveLength(0)
    expect(studentUpdates).toHaveLength(0)
  })

  it('answers an unauthenticated caller with 401, not 500', async () => {
    sessionError = new UnauthorizedError()
    const res = await POST(postRequest(validBody))

    expect(res.status).toBe(401)
    expect(upsertCalls).toHaveLength(0)
  })
})

describe('POST /api/promotions - the cohort transaction', () => {
  it('upserts one enrolment per cohort member and moves each class pointer', async () => {
    const res = await POST(postRequest(validBody))
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.data.promoted).toBe(3)
    expect(payload.data.failures).toEqual([])

    // The cohort is the tenant's students in the source class: `stu-somewhere-else`
    // is in another class and `stu-foreign` is another tenant's.
    expect(upsertCalls.map((call) => call.where.tenantId_studentId_termId.studentId).sort()).toEqual([
      'stu-ada',
      'stu-brah',
      'stu-cleo',
    ])
    for (const call of upsertCalls) {
      expect(call.where.tenantId_studentId_termId).toEqual({
        tenantId: TENANT_ID,
        studentId: call.where.tenantId_studentId_termId.studentId,
        termId: TERM_ID,
      })
      expect(call.create).toMatchObject({ tenantId: TENANT_ID, classId: TARGET, termId: TERM_ID })
    }

    expect(studentUpdates).toHaveLength(3)
    for (const update of studentUpdates) {
      expect(update.data).toMatchObject({ classId: TARGET })
      expect(update.where).toMatchObject({ tenantId: TENANT_ID })
    }
  })

  it('upserts rather than throwing when the same cohort is promoted again', async () => {
    // The idempotence requirement. Re-running must converge on the same end
    // state: the same compound-unique upsert, no second insert, no P2002.
    const first = await POST(postRequest(validBody))
    expect(first.status).toBe(200)
    const callsAfterFirst = upsertCalls.length

    const second = await POST(postRequest(validBody))

    expect(second.status).toBe(200)
    expect((await second.json()).data.promoted).toBe(3)
    expect(upsertCalls.length).toBe(callsAfterFirst * 2)
    // Still an upsert on the unique key, never a create path.
    expect(upsertCalls.every((call) => call.create && call.update)).toBe(true)
    expect(upsertCalls.some((call) => call.update.classId !== TARGET)).toBe(false)
  })

  it('applies a per-row override to that student only', async () => {
    const res = await POST(
      postRequest({ ...validBody, overrides: [{ studentId: 'stu-brah', toClassId: ALT }] }),
    )
    const payload = await res.json()

    expect(payload.data.promoted).toBe(3)
    const destinations = Object.fromEntries(
      payload.data.results.map((row: Row) => [row.studentId, row.toClassId]),
    )
    expect(destinations).toEqual({
      'stu-ada': TARGET,
      'stu-brah': ALT,
      'stu-cleo': TARGET,
    })
  })

  it('writes the audit entry through the transaction, once for the batch', async () => {
    await POST(postRequest({ ...validBody, overrides: [{ studentId: 'stu-brah', toClassId: ALT }] }))

    expect(auditWrites).toHaveLength(1)
    expect(auditWrites[0].viaTransaction).toBe(true)
    expect(auditWrites[0].params.entity).toBe('ClassPromotion')
    expect(auditWrites[0].params.tenantId).toBe(TENANT_ID)
    const changes = auditWrites[0].params.changes as Row
    expect(changes.promoted).toBe(3)
    expect(changes.overrides).toEqual([{ studentId: 'stu-brah', toClassId: ALT }])
  })

  it('rolls the whole cohort back and names the failure when one write fails', async () => {
    // A partial promotion is the outcome that must be impossible. The route
    // collects the failure and throws at the end of the transaction, so the
    // reported count is literal zero rather than "two of three".
    upsertErrorFor = 'stu-brah'
    const res = await POST(postRequest(validBody))
    const payload = await res.json()

    expect(res.status).toBe(409)
    expect(payload.data.promoted).toBe(0)
    expect(payload.data.failures).toEqual([
      { studentId: 'stu-brah', error: 'write failed' },
    ])
    // No audit entry: nothing happened.
    expect(auditWrites).toHaveLength(0)
  })

  it('refuses when a student vanished mid-flight and reports it rather than claiming success', async () => {
    studentUpdateCount = 0
    const res = await POST(postRequest(validBody))
    const payload = await res.json()

    expect(res.status).toBe(409)
    expect(payload.data.promoted).toBe(0)
    expect(payload.data.failures).toHaveLength(3)
  })
})

describe('POST /api/promotions - validation writes nothing', () => {
  it('refuses an override naming a student outside the source class', async () => {
    // The source system's controller trusted this array and moved whoever it
    // named, so a crafted request could rewrite an arbitrary student.
    const res = await POST(
      postRequest({ ...validBody, overrides: [{ studentId: 'stu-someone-else', toClassId: ALT }] }),
    )
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.code).toBe('OVERRIDE_STUDENT_NOT_IN_SOURCE')
    expect(upsertCalls).toHaveLength(0)
    expect(studentUpdates).toHaveLength(0)
  })

  it('refuses an override naming another tenant student', async () => {
    const res = await POST(
      postRequest({ ...validBody, overrides: [{ studentId: 'stu-foreign', toClassId: ALT }] }),
    )

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('OVERRIDE_STUDENT_NOT_IN_SOURCE')
    expect(upsertCalls).toHaveLength(0)
  })

  it('refuses a target class from another tenant', async () => {
    const res = await POST(postRequest({ ...validBody, toClassId: 'class-foreign' }))
    const payload = await res.json()

    expect(res.status).toBe(404)
    expect(payload.code).toBe('UNKNOWN_CLASS')
    expect(upsertCalls).toHaveLength(0)
    expect(studentUpdates).toHaveLength(0)
  })

  it('refuses a source class from another tenant', async () => {
    const res = await POST(postRequest({ ...validBody, fromClassId: 'class-foreign' }))

    expect(res.status).toBe(404)
    expect(upsertCalls).toHaveLength(0)
  })

  it('refuses an override whose destination is another tenant class', async () => {
    const res = await POST(
      postRequest({ ...validBody, overrides: [{ studentId: 'stu-ada', toClassId: 'class-foreign' }] }),
    )

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('OVERRIDE_CLASS_UNKNOWN')
    expect(upsertCalls).toHaveLength(0)
  })

  it('refuses a promotion into the class it came from', async () => {
    const res = await POST(postRequest({ ...validBody, toClassId: SOURCE }))

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('SAME_CLASS')
    expect(upsertCalls).toHaveLength(0)
  })

  it('refuses an unknown term', async () => {
    const res = await POST(postRequest({ ...validBody, termId: 'term-nope' }))

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('UNKNOWN_TERM')
    expect(upsertCalls).toHaveLength(0)
    expect(studentUpdates).toHaveLength(0)
  })

  it('refuses a target class explicitly inactive for the term', async () => {
    // `Class` has no active flag; `ClassTerm.isActive` is the only signal.
    inactiveClassTerms = [{ classId: TARGET }]
    const res = await POST(postRequest(validBody))

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INACTIVE_CLASS')
    expect(upsertCalls).toHaveLength(0)
  })

  it('refuses an empty source class rather than reporting a no-op success', async () => {
    const res = await POST(postRequest({ ...validBody, fromClassId: 'class-empty' }))

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('EMPTY_COHORT')
    expect(upsertCalls).toHaveLength(0)
  })

  it('rejects a malformed body before touching the database', async () => {
    const res = await POST(postRequest({ fromClassId: SOURCE, toClassId: '' }))

    expect(res.status).toBe(400)
    expect(upsertCalls).toHaveLength(0)
  })
})

describe('POST /api/promotions - nothing else is rewritten', () => {
  it('never writes the student id number', async () => {
    // The source controller rewrote `studentId` from the request body, which
    // is an unauthenticated write to a student identifier. `Student.studentId`
    // is stable here and must not appear in any write.
    await POST(postRequest(validBody))

    for (const update of studentUpdates) {
      expect(Object.keys(update.data)).toEqual(['classId'])
      expect(update.data).not.toHaveProperty('studentId')
    }
    for (const call of upsertCalls) {
      expect(Object.keys(call.create).sort()).toEqual([
        'classId',
        'isActive',
        'studentId',
        'tenantId',
        'termId',
      ])
    }
  })

  it('keeps `enrolledAt` out of the update so a re-run does not rewrite it', async () => {
    await POST(postRequest(validBody))
    await POST(postRequest(validBody))

    for (const call of upsertCalls) {
      expect(Object.keys(call.update).sort()).toEqual(['classId', 'isActive'])
    }
  })
})