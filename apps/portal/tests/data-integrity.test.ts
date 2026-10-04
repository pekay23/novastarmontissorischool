import { describe, it, expect, afterAll, beforeEach, mock, spyOn } from 'bun:test'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { PLATFORM_ROLES, type PlatformRole } from '@/lib/constants/platform-roles'

/**
 * Data-integrity regression cover for the attendance, score and
 * academic-report write/read paths.
 *
 * Every case here exists because a defect shipped through
 * `143 pass / 0 fail`: the attendance upsert looked up `period: ''`
 * while writing `period: null` (so it always inserted), attendance
 * reads had no permission check and no row scope, score saves
 * hardcoded `grade: null` (blanking stored grades), and the academic
 * report filtered by the student's *current* class pointer so
 * promoted students lost their history. These tests assert the
 * Prisma call sequence and the exact `where`/`data` shapes — a
 * response-only test would pass through all four regressions.
 *
 * The attendance write contract these tests pin is a `findFirst`
 * then `update`/`create` inside `prisma.$transaction`, keyed on the
 * same normalised `period` as both write branches — not a single
 * `upsert`. The compound-unique `upsert` cannot express "the row for
 * this exact key" while any caller can send a period that differs from
 * the stored one by whitespace alone, and the original defect was
 * exactly that: a lookup key and a write value that disagreed. The
 * mocked client deliberately exposes no `attendanceStudent.upsert`,
 * so a route that regressed to one fails loudly instead of passing
 * against a delegate that is no longer called.
 *
 * `@/lib/visibility` runs for real (it is the module under test for
 * the row-scope merge); only its boundary — `@/lib/prisma` — is
 * replaced, along with the session and auth boundaries.
 */

// ---------------------------------------------------------------------------
// Session / auth state
// ---------------------------------------------------------------------------

interface SessionContext {
  tenantId: string
  schoolId: string
  userId: string
  role: PlatformRole | null
}

const BASE_SESSION: SessionContext = {
  tenantId: 'tenant-1',
  schoolId: 'school-1',
  userId: 'user-1',
  role: PLATFORM_ROLES.HEADMASTER,
}

let session: SessionContext | 'unauthorized' = BASE_SESSION
let permissionResult = true

const getTenantContext = mock(async (): Promise<SessionContext> => {
  if (session === 'unauthorized') throw new MockUnauthorizedError()
  return session
})

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

const hasPermission = mock(async (): Promise<boolean> => permissionResult)

// The factory must export every name `@/lib/tenant` exports that
// anything imports: Bun's module-mock registry is global and
// outlives this file, so a missing export (e.g. `ForbiddenError`,
// which `lib/api-response.ts` imports) breaks unrelated test files
// that load the mocked module afterwards.
mock.module('@/lib/tenant', () => ({
  getTenantContext,
  getTenantContextOrNull: async () => {
    try {
      return await getTenantContext()
    } catch {
      return null
    }
  },
  UnauthorizedError: MockUnauthorizedError,
  ForbiddenError: MockForbiddenError,
  ServerConfigError: MockServerConfigError,
}))
/**
 * The real auth module, captured before the mock is installed so the
 * factory can hand back every export it does not replace.
 *
 * Bun's module-mock registry is process-global and outlives this file,
 * so a factory that exports only `hasPermission` leaves `can`,
 * `logAudit`, `getUserSession` and the delegation helpers undefined for
 * every file that resolves `@novastar/auth` afterwards — and
 * `tests/auth.test.ts` and `tests/rbac.test.ts` import exactly those.
 * Same reasoning as the `@/lib/tenant` factory above.
 */
const actualAuth = await import('@novastar/auth')
mock.module('@novastar/auth', () => ({ ...actualAuth, hasPermission }))

/**
 * The deliberately-provoked 500s below each log a JSON line; mute them for
 * this file only.
 *
 * This used to be `mock.module('@/lib/logger', () => ({ logError, logWarn }))`,
 * which is not equivalent. Bun's module-mock registry is process-global and
 * outlives the file that registered it, so a silent stand-in for the logger
 * also removes the `console.error` that `tests/system-config-route.test.ts`
 * spies on to prove a 5xx was recorded. That test then passed or failed on
 * nothing but file order: it fails in a full-suite run, where this file
 * loads first and installs the stand-in, and passes when run beside a file
 * that does not touch the logger. Muting the console is local, so the real
 * logger keeps working for every file loaded afterwards.
 */
const silencedError = spyOn(console, 'error').mockImplementation(() => {})
const silencedWarn = spyOn(console, 'warn').mockImplementation(() => {})

afterAll(() => {
  silencedError.mockRestore()
  silencedWarn.mockRestore()
})

// ---------------------------------------------------------------------------
// Prisma state
// ---------------------------------------------------------------------------

/** Ordered labels of every database call, for sequence assertions. */
let steps: string[] = []

// --- Class / visibility lookups (the real resolveVisibility reads these) ---
let targetClass: { id: string; students: Array<{ id: string }> } | null = null
let callerStaff: { id: string } | null = null
let callerParent: { id: string } | null = null
let taughtClasses: Array<{ id: string }> = []
let taughtSubjectClasses: Array<{ classId: string }> = []

const classFindFirst = mock(async () => targetClass)
const staffFindFirst = mock(async () => callerStaff)
const parentFindFirst = mock(async () => callerParent)
const classFindMany = mock(async () => taughtClasses)
const classSubjectFindMany = mock(async () => taughtSubjectClasses)

// --- AttendanceTaker (DEFECT 3) ---
let takerAssignment: { id: string } | null = null
const attendanceTakerFindFirst = mock(async () => takerAssignment)

/**
 * The argument bags of the mocked Prisma write delegates.
 *
 * These were typed as a bare `Record<string, unknown>`, which makes every
 * payload read an `unknown`: `...args.data` cannot be spread (TS2698) and
 * `args.data.period` cannot be read (TS18046). Spelling out the fields each
 * delegate actually receives fixes that at the source and additionally makes
 * a payload the route stopped sending a type error rather than a silently
 * `undefined` read at runtime.
 */
interface UpdateArgs {
  where: Record<string, unknown>
  data: Record<string, unknown>
}

interface CreateArgs {
  data: Record<string, unknown>
}

interface UpsertArgs {
  where: Record<string, unknown>
  create: Record<string, unknown>
  update: Record<string, unknown>
}

/** What a `findFirst` reads its one argument from. */
interface WhereArgs {
  where: Record<string, unknown>
}

// --- AttendanceStudent ---
let attendanceList: Array<Record<string, unknown>> = []
let existingAttendanceRecord: Record<string, unknown> | null = null

/**
 * What the write transaction's `findFirst` finds for the exact
 * `(tenantId, studentId, date, period)` key, or `null` to force the
 * create branch.
 *
 * Deliberately a different knob from `existingAttendanceRecord`, which
 * answers the `[id]` route's lookup. One variable driving both would
 * make a write-path test depend on which handler the mock was written
 * for, and would let a route that stopped looking up its own key still
 * pass.
 */
let attendanceWriteLookup: Record<string, unknown> | null = null

/** Set by a test to make the write transaction reject, e.g. with a P2002. */
let transactionError: unknown = null

const attendanceFindMany = mock(async () => attendanceList)
const attendanceFindFirst = mock(async () => existingAttendanceRecord)
const attendanceWriteFindFirst = mock(async (_args: WhereArgs) => {
  steps.push('attendanceStudent.findFirst')
  return attendanceWriteLookup
})
const attendanceUpdate = mock(async (args: UpdateArgs) => {
  steps.push('attendanceStudent.update')
  return { id: 'att-existing', ...args.data }
})
const attendanceCreate = mock(async (args: CreateArgs) => {
  steps.push('attendanceStudent.create')
  return { id: 'att-new', ...args.data }
})
const attendanceDelete = mock(async (args: WhereArgs) => args.where)

/**
 * The client the write transaction's callback is handed.
 *
 * `update` and `create` are the same mocks the route's PATCH reaches
 * through `prisma.attendanceStudent` — the transaction client is a
 * separate object precisely so the lookup it performs is distinguishable
 * from a read the handler makes outside the transaction.
 */
const TX_CLIENT = {
  attendanceStudent: {
    findFirst: attendanceWriteFindFirst,
    update: attendanceUpdate,
    create: attendanceCreate,
  },
}

/**
 * Runs the callback with `TX_CLIENT`, or throws `transactionError`.
 *
 * Reads the injected error at call time rather than closing over a
 * snapshot: `tests/timetable-route.test.ts` replaces this
 * implementation in its own `beforeEach` with one that ignores the
 * error, so its P2002 case can never see a 409 and fails with 201.
 * Here the implementation is installed once and only ever
 * `mockClear`ed, so `transactionError` stays live for every test.
 */
const prismaTransaction = mock(
  async (fn: (tx: typeof TX_CLIENT) => Promise<unknown>) => {
    if (transactionError) throw transactionError
    return fn(TX_CLIENT)
  },
)

// --- Scores (DEFECT 4) ---
let assessmentRow: Record<string, unknown> | null = null
let gradingScales: Array<Record<string, unknown>> = []

const assessmentFindFirst = mock(async () => assessmentRow)
/**
 * The `orderBy` this read is handed is recorded, because it is load-bearing.
 *
 * `resolveApplicableGradingScale` takes the FIRST scale that claims the level, and
 * both callers used to pass no ordering at all — so with two scales claiming `B9`
 * the winning scale, and therefore every child's band, was whatever order the
 * database returned rows in. A routine VACUUM was enough to change it. The rows the
 * mock returns are unchanged so every existing assertion here holds; what is new is
 * that the clause is now observable.
 */
const gradingScaleQueryArgs: Array<Record<string, unknown>> = []
const gradingScaleFindMany = mock(async (args: Record<string, unknown>) => {
  gradingScaleQueryArgs.push(args)
  return gradingScales
})
const scoreUpsert = mock(async (args: UpsertArgs) => {
  steps.push('score.upsert')
  return { id: 'score-1', ...args.create }
})

// --- Academic report (DEFECT 5) ---
let studentRow: Record<string, unknown> | null = null
let currentTerm: { id: string; startDate: Date; endDate: Date } | null = null
let requestedTerm: { id: string; startDate: Date; endDate: Date } | null = null
let termEnrollment: {
  classId: string
  // `code` is carried because the route matches the grading scale on the level
  // code first and its name second, exactly as the gradebook write does.
  class: { name: string; level: { name: string; code?: string } }
} | null = null
let reportAssessments: Array<Record<string, unknown>> = []

const studentFindFirst = mock(async () => studentRow)
const termFindFirst = mock(async (args: WhereArgs) => {
  steps.push('term.findFirst')
  if (args.where?.isCurrent) return currentTerm
  return requestedTerm
})
const enrollmentFindFirst = mock(async () => termEnrollment)
const assessmentFindMany = mock(async () => {
  steps.push('assessment.findMany')
  return reportAssessments
})

mock.module('@/lib/prisma', () => {
  // `default` is part of `@/lib/prisma`'s surface as well as the named
  // export; a factory that omits it breaks any later file using a
  // default import of the same module.
  const prismaMock = {
    class: { findFirst: classFindFirst, findMany: classFindMany },
    classSubject: { findMany: classSubjectFindMany },
    staff: { findFirst: staffFindFirst },
    parent: { findFirst: parentFindFirst },
    attendanceTaker: { findFirst: attendanceTakerFindFirst },
    attendanceStudent: {
      findMany: attendanceFindMany,
      findFirst: attendanceFindFirst,
      update: attendanceUpdate,
      create: attendanceCreate,
      delete: attendanceDelete,
    },
    assessment: { findFirst: assessmentFindFirst, findMany: assessmentFindMany },
    score: { upsert: scoreUpsert },
    gradingScale: { findMany: gradingScaleFindMany },
    term: { findFirst: termFindFirst },
    enrollment: { findFirst: enrollmentFindFirst },
    student: { findFirst: studentFindFirst },
    $transaction: prismaTransaction,
  }
  return { prisma: prismaMock, default: prismaMock }
})

const { GET: GET_ATTENDANCE, POST: POST_ATTENDANCE } = await import(
  '@/app/api/attendance/route'
)
const { GET: GET_ATTENDANCE_BY_ID, PATCH: PATCH_ATTENDANCE } = await import(
  '@/app/api/attendance/[id]/route'
)
const { POST: POST_SCORES } = await import(
  '@/app/api/assessments/[id]/scores/route'
)
const { GET: GET_ACADEMIC_REPORT } = await import(
  '@/app/api/reports/academic/[studentId]/route'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A bodyless read request.
 *
 * The verb is a parameter rather than hard-coded so this stays symmetric with
 * `jsonRequest(method, path, body)` — every read below already says `GET`, and
 * hard-coding it would have meant either dropping that argument from every
 * call site or leaving a call that silently discards its own first argument.
 */
function request(method: string, path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method })
}

function jsonRequest(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return `a ${typeof value}`
}

/**
 * One nested object out of a recorded call or a response body — `arg.update`,
 * `arg.create`, `body.student`, `body.summary`.
 *
 * `singleCall` and `readJson` both hand back `Record<string, unknown>`, which
 * is honest: neither knows which delegate or which handler it wrapped. Reading
 * a field straight off that bag yields `unknown` and, one level deeper, a
 * property read off `unknown`. This narrows the same value the assertions
 * always meant to look at, and it throws rather than handing back a cast when
 * the shape is wrong — so a route that stopped sending the payload fails the
 * test instead of quietly satisfying it.
 */
function objectAt(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key]
  if (!isRecord(value)) {
    throw new Error(`expected an object at "${key}", got ${typeName(value)}`)
  }
  return value
}

/**
 * The per-record `results` of a bulk write, each row checked. A write path
 * that answered `{ error }` instead of `results` used to read as `undefined`
 * under a cast and fail two lines later on a different message.
 */
function bodyRows(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const rows = body.results
  if (!Array.isArray(rows)) {
    throw new Error(`expected "results" to be an array, got ${typeName(rows)}`)
  }
  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`expected "results[${index}]" to be an object, got ${typeName(row)}`)
    }
    return row
  })
}

/** The single call args of `m`, failing loudly if the handler called more or less. */
function singleCall(m: { mock: { calls: Array<Array<unknown>> } }): Record<string, unknown> {
  expect(m.mock.calls).toHaveLength(1)
  return m.mock.calls[0][0] as Record<string, unknown>
}

/**
 * The args of call `index` of `m`, for a test that makes several requests
 * against the same delegate.
 *
 * `singleCall` cannot serve there: it demands exactly one call ever made, so
 * the second request of a three-request test fails on the call COUNT instead
 * of on the `where` shape the test exists to read. Pair it with
 * `toHaveBeenCalledTimes` and nothing is hidden — one query per request is
 * now stated outright rather than implied.
 */
function callAt(
  m: { mock: { calls: Array<Array<unknown>> } },
  index: number,
): Record<string, unknown> {
  return m.mock.calls[index][0] as Record<string, unknown>
}

const MARK_BODY = {
  studentId: 'student-1',
  classId: 'class-1',
  date: '2026-03-04',
  status: 'PRESENT',
}

const TERM_DATE = { startDate: new Date('2026-01-05'), endDate: new Date('2026-03-31') }

beforeEach(() => {
  steps = []
  session = BASE_SESSION
  permissionResult = true

  targetClass = null
  callerStaff = null
  callerParent = null
  taughtClasses = []
  taughtSubjectClasses = []
  takerAssignment = null
  attendanceList = []
  existingAttendanceRecord = null
  attendanceWriteLookup = null
  transactionError = null
  assessmentRow = null
  gradingScales = []
  studentRow = null
  currentTerm = null
  requestedTerm = null
  termEnrollment = null
  reportAssessments = []
  gradingScaleQueryArgs.length = 0

  for (const m of [
    getTenantContext,
    hasPermission,
    classFindFirst,
    staffFindFirst,
    parentFindFirst,
    classFindMany,
    classSubjectFindMany,
    attendanceTakerFindFirst,
    attendanceFindMany,
    attendanceFindFirst,
    attendanceWriteFindFirst,
    attendanceUpdate,
    attendanceCreate,
    attendanceDelete,
    prismaTransaction,
    assessmentFindFirst,
    gradingScaleFindMany,
    scoreUpsert,
    studentFindFirst,
    termFindFirst,
    enrollmentFindFirst,
    assessmentFindMany,
  ]) {
    m.mockClear()
  }
})

// ---------------------------------------------------------------------------
// DEFECT 1 — the attendance write path
// ---------------------------------------------------------------------------

describe('POST /api/attendance — one normalised period, one row', () => {
  it('updates the existing row instead of inserting a second one when period is omitted', async () => {
    targetClass = { id: 'class-1', students: [{ id: 'student-1' }] }
    attendanceWriteLookup = { id: 'att-1', studentId: 'student-1', period: '' }

    const res = await POST_ATTENDANCE(jsonRequest('POST', '/api/attendance', MARK_BODY))

    expect(res.status).toBe(201)
    // THE regression. The old write searched `period: ''` but stored
    // `period: null`, so it never matched the row it had just written
    // and every save inserted a duplicate. One normalisation, applied
    // once, now feeds the lookup key AND the write.
    expect(steps).toEqual(['attendanceStudent.findFirst', 'attendanceStudent.update'])
    // The lookup is the compound unique key itself, so it can only
    // match the row the unique constraint would.
    expect(singleCall(attendanceWriteFindFirst).where).toEqual({
      tenantId: 'tenant-1',
      studentId: 'student-1',
      date: new Date('2026-03-04'),
      period: '',
    })
    // Exactly one transaction, one lookup, one write — and the write is
    // an update keyed on the row that was found, not a second insert.
    expect(prismaTransaction).toHaveBeenCalledTimes(1)
    expect(attendanceWriteFindFirst).toHaveBeenCalledTimes(1)
    expect(attendanceUpdate).toHaveBeenCalledTimes(1)
    expect(attendanceCreate).toHaveBeenCalledTimes(0)
    const write = singleCall(attendanceUpdate)
    expect(write.where).toEqual({ id: 'att-1' })
    expect(write.data).toMatchObject({
      classId: 'class-1',
      status: 'PRESENT',
      period: '',
      notes: null,
      markedById: 'user-1',
    })

    const body = await readJson(res)
    expect(bodyRows(body)[0]).toMatchObject({ studentId: 'student-1', success: true })
  })

  it('normalises "", whitespace and untrimmed periods to one canonical value on the write path', async () => {
    targetClass = { id: 'class-1', students: [{ id: 'student-1' }] }

    const cases: Array<{ sent: string; expected: string }> = [
      { sent: '', expected: '' },
      { sent: '   ', expected: '' },
      { sent: '  AM  ', expected: 'AM' },
    ]
    for (const c of cases) {
      // Both branches, from the same normalised value: the update
      // branch proves a re-save finds its own row, the create branch
      // proves the stored value is the canonical one. A route that
      // normalised for the lookup but not for the write would agree
      // with the first and contradict the second.
      attendanceWriteLookup = { id: 'att-1' }
      steps = []
      attendanceWriteFindFirst.mockClear()
      attendanceUpdate.mockClear()
      attendanceCreate.mockClear()
      const updated = await POST_ATTENDANCE(
        jsonRequest('POST', '/api/attendance', { ...MARK_BODY, period: c.sent }),
      )

      expect(updated.status).toBe(201)
      expect(steps).toEqual(['attendanceStudent.findFirst', 'attendanceStudent.update'])
      expect(singleCall(attendanceWriteFindFirst).where).toMatchObject({ period: c.expected })
      expect((singleCall(attendanceUpdate).data as Record<string, unknown>).period).toBe(
        c.expected,
      )

      attendanceWriteLookup = null
      steps = []
      attendanceWriteFindFirst.mockClear()
      attendanceUpdate.mockClear()
      attendanceCreate.mockClear()
      const created = await POST_ATTENDANCE(
        jsonRequest('POST', '/api/attendance', { ...MARK_BODY, period: c.sent }),
      )

      expect(created.status).toBe(201)
      expect(steps).toEqual(['attendanceStudent.findFirst', 'attendanceStudent.create'])
      expect(singleCall(attendanceWriteFindFirst).where).toMatchObject({ period: c.expected })
      expect((singleCall(attendanceCreate).data as Record<string, unknown>).period).toBe(
        c.expected,
      )
    }
  })

  it('normalises the create branch the same way, including blank notes', async () => {
    targetClass = { id: 'class-1', students: [{ id: 'student-1' }] }
    attendanceWriteLookup = null

    const res = await POST_ATTENDANCE(
      jsonRequest('POST', '/api/attendance', { ...MARK_BODY, period: '   ', notes: '   ' }),
    )

    expect(res.status).toBe(201)
    expect(steps).toEqual(['attendanceStudent.findFirst', 'attendanceStudent.create'])
    expect(attendanceUpdate).toHaveBeenCalledTimes(0)
    const create = singleCall(attendanceCreate).data as Record<string, unknown>
    expect(create).toMatchObject({
      tenantId: 'tenant-1',
      studentId: 'student-1',
      classId: 'class-1',
      date: new Date('2026-03-04'),
      status: 'PRESENT',
      period: '',
      notes: null,
      markedById: 'user-1',
    })
  })

  it('maps a unique-constraint violation in the write transaction to 409, not a 500', async () => {
    // Two markers racing on the same student/day both miss the lookup
    // and both reach `create`; the loser's P2002 means "the row you
    // want already exists". `@@unique([tenantId, studentId, date,
    // period])` makes that an ordinary client outcome, so it is a 409.
    targetClass = { id: 'class-1', students: [{ id: 'student-1' }] }
    attendanceWriteLookup = null
    transactionError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`tenantId`,`studentId`,`date`,`period`)',
      { code: 'P2002', clientVersion: '7.10.0' },
    )

    const res = await POST_ATTENDANCE(jsonRequest('POST', '/api/attendance', MARK_BODY))

    expect(res.status).toBe(409)
    const body = await readJson(res)
    expect(body.error).toBe('A record with these values already exists')
  })

  it('marks a bulk array with one write transaction per record', async () => {
    targetClass = { id: 'class-1', students: [{ id: 'student-1' }, { id: 'student-2' }] }
    attendanceWriteLookup = null

    const res = await POST_ATTENDANCE(
      jsonRequest('POST', '/api/attendance', [
        MARK_BODY,
        { ...MARK_BODY, studentId: 'student-2', status: 'ABSENT' },
      ]),
    )

    expect(res.status).toBe(201)
    // One transaction and one write per record, not one transaction for
    // the batch: a per-record transaction is what keeps a single bad
    // row from rolling back the whole register.
    expect(prismaTransaction).toHaveBeenCalledTimes(2)
    expect(attendanceWriteFindFirst).toHaveBeenCalledTimes(2)
    expect(attendanceCreate).toHaveBeenCalledTimes(2)
    // Each record carries its own key, so the two cannot collide.
    expect(callAt(attendanceWriteFindFirst, 0).where).toMatchObject({ studentId: 'student-1' })
    expect(callAt(attendanceWriteFindFirst, 1).where).toMatchObject({ studentId: 'student-2' })
    const second = attendanceCreate.mock.calls[1][0].data
    expect(second).toMatchObject({ studentId: 'student-2', status: 'ABSENT' })
    const body = await readJson(res)
    expect(bodyRows(body)).toHaveLength(2)
  })

  it('rejects a student who is not in the class without writing', async () => {
    targetClass = { id: 'class-1', students: [{ id: 'student-1' }] }

    const res = await POST_ATTENDANCE(
      jsonRequest('POST', '/api/attendance', { ...MARK_BODY, studentId: 'student-other' }),
    )

    expect(res.status).toBe(201)
    // Not one write of any kind — not even the lookup.
    expect(prismaTransaction).toHaveBeenCalledTimes(0)
    expect(attendanceWriteFindFirst).toHaveBeenCalledTimes(0)
    expect(attendanceUpdate).toHaveBeenCalledTimes(0)
    expect(attendanceCreate).toHaveBeenCalledTimes(0)
    const body = await readJson(res)
    expect(bodyRows(body)[0]).toEqual({ studentId: 'student-other', error: 'Student not in this class' })
  })
})

describe('PATCH /api/attendance/[id] — the normaliser guards the edit path', () => {
  it('cannot write "" or whitespace into the period column', async () => {
    existingAttendanceRecord = { id: 'att-1', tenantId: 'tenant-1', studentId: 'student-1' }

    const res = await PATCH_ATTENDANCE(
      jsonRequest('PATCH', '/api/attendance/att-1', { period: '', notes: '   ' }),
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(res.status).toBe(200)
    // A caller-supplied '' must land as the same `''` whole-day
    // sentinel the write path stores — not as null (the old PATCH
    // passed it straight through), which is a different value and
    // would fork a second row for the same student/day.
    const data = singleCall(attendanceUpdate).data as Record<string, unknown>
    expect(data.period).toBe('')
    expect(data.notes).toBeNull()
    expect(data.markedById).toBe('user-1')
  })

  it('trims a real period value on PATCH', async () => {
    existingAttendanceRecord = { id: 'att-1' }

    const res = await PATCH_ATTENDANCE(
      jsonRequest('PATCH', '/api/attendance/att-1', { period: '  AM  ' }),
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(res.status).toBe(200)
    expect((singleCall(attendanceUpdate).data as Record<string, unknown>).period).toBe('AM')
  })
})

// ---------------------------------------------------------------------------
// DEFECT 2 — attendance reads are scoped
// ---------------------------------------------------------------------------

describe('GET /api/attendance — permission and row scope', () => {
  it('returns 403 without attendance:read and 401 without a session', async () => {
    permissionResult = false
    const denied = await GET_ATTENDANCE(request('GET', '/api/attendance'))
    expect(denied.status).toBe(403)
    expect(attendanceFindMany).toHaveBeenCalledTimes(0)

    session = 'unauthorized'
    const unauthenticated = await GET_ATTENDANCE(request('GET', '/api/attendance'))
    expect(unauthenticated.status).toBe(401)
    expect(attendanceFindMany).toHaveBeenCalledTimes(0)
  })

  it('merges school scope and class visibility for a classroom teacher', async () => {
    session = { ...BASE_SESSION, role: PLATFORM_ROLES.CLASSROOM_TEACHER }
    callerStaff = { id: 'staff-teacher' }
    taughtClasses = [{ id: 'class-a' }]
    taughtSubjectClasses = [{ classId: 'class-b' }]
    attendanceList = []

    const res = await GET_ATTENDANCE(request('GET', '/api/attendance?classId=class-a'))

    expect(res.status).toBe(200)
    const where = singleCall(attendanceFindMany).where as Record<string, unknown>
    expect(where.tenantId).toBe('tenant-1')
    // AttendanceStudent has no schoolId column; school scope arrives
    // through the class relation.
    expect(where.class).toEqual({ schoolId: 'school-1' })
    // The teacher's own classes, from the visibility builder.
    expect(where.AND).toEqual([{ classId: { in: ['class-a', 'class-b'] } }])
    // A classId parameter narrows the visible set; it must not
    // replace the visibility filter (which would let the teacher
    // read any class by id).
    expect(where.classId).toBe('class-a')
  })

  it('returns 403 for a teacher whose visibility resolves to no classes', async () => {
    session = { ...BASE_SESSION, role: PLATFORM_ROLES.CLASSROOM_TEACHER }
    callerStaff = null
    permissionResult = true

    const res = await GET_ATTENDANCE(request('GET', '/api/attendance'))

    expect(res.status).toBe(403)
    expect(attendanceFindMany).toHaveBeenCalledTimes(0)
  })

  it('honours the period parameter', async () => {
    attendanceList = []

    await GET_ATTENDANCE(request('GET', '/api/attendance'))
    // One query per request, and the parameter is what that query carries.
    expect(attendanceFindMany).toHaveBeenCalledTimes(1)
    expect((callAt(attendanceFindMany, 0).where as Record<string, unknown>).period).toBeUndefined()

    await GET_ATTENDANCE(request('GET', '/api/attendance?period='))
    // `?period=` means the whole-day sentinel, stored as ''.
    expect(attendanceFindMany).toHaveBeenCalledTimes(2)
    expect((callAt(attendanceFindMany, 1).where as Record<string, unknown>).period).toBe('')

    await GET_ATTENDANCE(request('GET', '/api/attendance?period=AM'))
    expect(attendanceFindMany).toHaveBeenCalledTimes(3)
    expect((callAt(attendanceFindMany, 2).where as Record<string, unknown>).period).toBe('AM')
  })
})

describe('GET /api/attendance/[id] — permission and row scope', () => {
  it('returns 403 without attendance:read and 401 without a session, before any database read', async () => {
    permissionResult = false

    const denied = await GET_ATTENDANCE_BY_ID(request('GET', '/api/attendance/att-1'), {
      params: Promise.resolve({ id: 'att-1' }),
    })

    expect(denied.status).toBe(403)
    expect(attendanceFindFirst).toHaveBeenCalledTimes(0)

    session = 'unauthorized'
    const unauthenticated = await GET_ATTENDANCE_BY_ID(request('GET', '/api/attendance/att-1'), {
      params: Promise.resolve({ id: 'att-1' }),
    })

    expect(unauthenticated.status).toBe(401)
    expect(attendanceFindFirst).toHaveBeenCalledTimes(0)
  })

  it('scopes the single-record read to the caller\'s classes', async () => {
    session = { ...BASE_SESSION, role: PLATFORM_ROLES.CLASSROOM_TEACHER }
    callerStaff = { id: 'staff-teacher' }
    taughtClasses = [{ id: 'class-a' }]
    taughtSubjectClasses = []
    existingAttendanceRecord = { id: 'att-1' }

    const res = await GET_ATTENDANCE_BY_ID(request('GET', '/api/attendance/att-1'), {
      params: Promise.resolve({ id: 'att-1' }),
    })

    expect(res.status).toBe(200)
    const where = singleCall(attendanceFindFirst).where as Record<string, unknown>
    expect(where.id).toBe('att-1')
    expect(where.tenantId).toBe('tenant-1')
    // AttendanceStudent has no schoolId column; school scope arrives
    // through the class relation, as on the list route.
    expect(where.class).toEqual({ schoolId: 'school-1' })
    // The teacher's own classes, composed under `AND` rather than
    // spread — a spread lets any later property on this `where`
    // overwrite the scope silently, which is the same overwrite the
    // list route's `?classId=` parameter used to cause.
    expect(where.AND).toEqual([{ classId: { in: ['class-a'] } }])
    // Nothing unscoped leaks alongside it: an out-of-scope class is
    // reachable only through the `AND`, never as a bare `classId`.
    expect(where.classId).toBeUndefined()
  })

  it('refuses a parent who holds no attendance:read grant', async () => {
    // `ROLE_READ_SCOPE` in @novastar/shared-types maps no attendance key
    // for PARENT, so a parent's `attendance:read` would resolve to the
    // catalog's default `all` scope and `attendanceVisibilityWhere`
    // would return `{}` — an unrestricted read. The permission gate is
    // what stops that today, and this test is the record of it: if the
    // key is ever granted to PARENT (a seed change, a delegation), this
    // fails and the row-scope layer has to be narrowed with
    // `'attendance:read': 'own'` in ROLE_READ_SCOPE before it is granted.
    session = { ...BASE_SESSION, role: PLATFORM_ROLES.PARENT }
    callerParent = { id: 'parent-1' }
    permissionResult = false

    const res = await GET_ATTENDANCE_BY_ID(request('GET', '/api/attendance/att-1'), {
      params: Promise.resolve({ id: 'att-1' }),
    })

    expect(res.status).toBe(403)
    expect(attendanceFindFirst).toHaveBeenCalledTimes(0)
  })
})

// ---------------------------------------------------------------------------
// DEFECT 3 — AttendanceTaker assignments
// ---------------------------------------------------------------------------

describe('POST /api/attendance — AttendanceTaker enforcement', () => {
  it('returns 403 when the caller has no AttendanceTaker row and no role allowance', async () => {
    session = { ...BASE_SESSION, role: PLATFORM_ROLES.CLASSROOM_TEACHER }
    callerStaff = { id: 'staff-teacher' }
    takerAssignment = null
    targetClass = { id: 'class-1', students: [{ id: 'student-1' }] }

    const res = await POST_ATTENDANCE(jsonRequest('POST', '/api/attendance', MARK_BODY))

    expect(res.status).toBe(403)
    const body = await readJson(res)
    expect(body.error).toMatch(/not assigned to mark attendance/)
    // A denial must not write, and must not even look for a row to
    // write over — the grant decision precedes the transaction.
    expect(prismaTransaction).toHaveBeenCalledTimes(0)
    expect(attendanceWriteFindFirst).toHaveBeenCalledTimes(0)
    expect(attendanceCreate).toHaveBeenCalledTimes(0)
  })

  it('allows a caller with a class-scoped AttendanceTaker assignment', async () => {
    session = { ...BASE_SESSION, role: PLATFORM_ROLES.CLASSROOM_TEACHER }
    callerStaff = { id: 'staff-teacher' }
    takerAssignment = { id: 'taker-1' }
    targetClass = { id: 'class-1', students: [{ id: 'student-1' }] }

    const res = await POST_ATTENDANCE(jsonRequest('POST', '/api/attendance', MARK_BODY))

    expect(res.status).toBe(201)
    // The allowance is not just a non-403: the row was written, once,
    // keyed on the caller's own class.
    expect(prismaTransaction).toHaveBeenCalledTimes(1)
    expect(attendanceCreate).toHaveBeenCalledTimes(1)
    const where = singleCall(attendanceTakerFindFirst).where as Record<string, unknown>
    expect(where).toMatchObject({
      tenantId: 'tenant-1',
      schoolId: 'school-1',
      staffId: 'staff-teacher',
      isActive: true,
    })
    // The assignment lookup asks for the target class OR school-wide.
    expect(where.OR).toEqual([{ classId: 'class-1' }, { classId: null }])
  })

  it('resolves the caller\'s staff row through staff.userId', async () => {
    session = { ...BASE_SESSION, role: PLATFORM_ROLES.CLASSROOM_TEACHER }
    callerStaff = { id: 'staff-teacher' }
    takerAssignment = { id: 'taker-1' }
    targetClass = { id: 'class-1', students: [{ id: 'student-1' }] }

    await POST_ATTENDANCE(jsonRequest('POST', '/api/attendance', MARK_BODY))

    expect(singleCall(staffFindFirst).where).toEqual({ tenantId: 'tenant-1', userId: 'user-1' })
  })

  it('falls back to the leadership role allowance until takers are seeded', async () => {
    // Deliberate temporary policy: HEAD_TEACHER may mark any class
    // while AttendanceTaker rows are not seeded.
    session = { ...BASE_SESSION, role: PLATFORM_ROLES.HEAD_TEACHER }
    callerStaff = { id: 'staff-head' }
    takerAssignment = null
    targetClass = { id: 'class-1', students: [{ id: 'student-1' }] }

    const res = await POST_ATTENDANCE(jsonRequest('POST', '/api/attendance', MARK_BODY))

    expect(res.status).toBe(201)
    expect(prismaTransaction).toHaveBeenCalledTimes(1)
    expect(attendanceWriteFindFirst).toHaveBeenCalledTimes(1)
    expect(attendanceCreate).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// DEFECT 4 — grade bands
// ---------------------------------------------------------------------------

const ASSESSMENT_WITH_LEVEL = {
  id: 'assess-1',
  maxScore: 100,
  classSubject: {
    class: {
      students: [{ id: 'student-1' }],
      level: { name: 'Basic 1', code: 'B1' },
    },
  },
  type: { name: 'Test' },
}

describe('POST /api/assessments/[id]/scores — grade bands are applied', () => {
  it('stores the grade band key and the grading scale id on both write branches', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL
    gradingScales = [
      {
        id: 'scale-ges',
        isDefault: true,
        appliesToLevels: ['B1', 'B2'],
        levels: [
          { key: 'A', label: 'A (Excellent)', minScore: 80, maxScore: 100 },
          { key: 'B', label: 'B (Very Good)', minScore: 70, maxScore: 79 },
        ],
      },
    ]

    const res = await POST_SCORES(
      jsonRequest('POST', '/api/assessments/assess-1/scores', {
        studentId: 'student-1',
        rawScore: 90,
      }),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )

    expect(res.status).toBe(200)
    // 90/100 = 90%, which lands in the A band (80..100).
    const update = objectAt(singleCall(scoreUpsert), 'update')
    const create = objectAt(singleCall(scoreUpsert), 'create')
    expect(update).toMatchObject({
      rawScore: 90,
      percentage: 90,
      grade: 'A',
      gradingScaleId: 'scale-ges',
    })
    expect(create).toMatchObject({
      grade: 'A',
      gradingScaleId: 'scale-ges',
    })
    // THE regression: the update branch used to hardcode `grade: null`,
    // blanking every stored grade on each save.
    expect(update.grade).not.toBeNull()
    // The key is stored, deliberately not the label — the UI colour
    // maps are keyed on the bare letter.
    expect(update.grade).not.toBe('A (Excellent)')
  })

  it('fetches the class level in the same assessment join, not a second query', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL
    gradingScales = []

    await POST_SCORES(
      jsonRequest('POST', '/api/assessments/assess-1/scores', {
        studentId: 'student-1',
        rawScore: 10,
      }),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )

    const include = singleCall(assessmentFindFirst).include as Record<string, unknown>
    const classInclude = (include.classSubject as Record<string, unknown>)
      .include as Record<string, unknown>
    const classLevel = ((classInclude.class as Record<string, unknown>)
      .include as Record<string, unknown>).level
    expect(classLevel).toEqual({ select: { name: true, code: true } })
  })

  it('rounds the percentage with the shared helper', async () => {
    assessmentRow = { ...ASSESSMENT_WITH_LEVEL, maxScore: 3 }
    gradingScales = []

    await POST_SCORES(
      jsonRequest('POST', '/api/assessments/assess-1/scores', {
        studentId: 'student-1',
        rawScore: 2,
      }),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )

    // (2/3)*100 = 66.666... → 66.67 via calculatePercentage, not the
    // unrounded 66.66666666666667 the inline arithmetic produced.
    expect((singleCall(scoreUpsert).update as Record<string, unknown>).percentage).toBe(66.67)
  })

  it('succeeds with grade null when no grading scale applies', async () => {
    assessmentRow = {
      ...ASSESSMENT_WITH_LEVEL,
      classSubject: {
        class: {
          students: [{ id: 'student-1' }],
          // A level no scale names, and no default scale exists.
          level: { name: 'Unlevelled', code: 'X9' },
        },
      },
    }
    gradingScales = []

    const res = await POST_SCORES(
      jsonRequest('POST', '/api/assessments/assess-1/scores', {
        studentId: 'student-1',
        rawScore: 50,
      }),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )

    expect(res.status).toBe(200)
    const update = objectAt(singleCall(scoreUpsert), 'update')
    const create = objectAt(singleCall(scoreUpsert), 'create')
    expect(update.grade).toBeNull()
    expect(update.gradingScaleId).toBeNull()
    expect(create.grade).toBeNull()
    expect(create.gradingScaleId).toBeNull()
  })

  it('falls back to the default scale when the level is not named', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL
    gradingScales = [
      {
        id: 'scale-default',
        isDefault: true,
        appliesToLevels: ['SOMETHING_ELSE'],
        levels: [{ key: 'C', label: 'C', minScore: 50, maxScore: 100 }],
      },
    ]

    await POST_SCORES(
      jsonRequest('POST', '/api/assessments/assess-1/scores', {
        studentId: 'student-1',
        rawScore: 75,
      }),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )

    expect((singleCall(scoreUpsert).update as Record<string, unknown>).gradingScaleId).toBe('scale-default')
    expect((singleCall(scoreUpsert).update as Record<string, unknown>).grade).toBe('C')
  })

  it('rejects a student who is not in the assessed class', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL
    gradingScales = []

    const res = await POST_SCORES(
      jsonRequest('POST', '/api/assessments/assess-1/scores', {
        studentId: 'student-other',
        rawScore: 50,
      }),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )

    expect(res.status).toBe(403)
    expect(scoreUpsert).toHaveBeenCalledTimes(0)
  })
})

/**
 * Which scale a class is graded against was decided by the row order the database
 * returned, so a routine VACUUM was enough to move a cohort of children from one band
 * to another — silently, and with no error on any card.
 *
 * `resolveApplicableGradingScale` takes the first scale that claims the level, and
 * neither caller passed an `orderBy`, so the two claims below were decided by
 * whichever row the engine happened to emit first. The fix is two-sided: the query
 * now asks for a total order (default first, then oldest first, then id), and the
 * gradebook calls the one shared resolver instead of its own copy of the rule, so the
 * band it stores and the band the report prints cannot come from two different
 * implementations.
 */
describe('the grading-scale read is ordered, so the same rows always grade the same way', () => {
  /** Both claim B1 and both are marked default: the ambiguous configuration. */
  const AMBIGUOUS = [
    {
      id: 'scale-copy',
      name: 'Ghana Primary 2026',
      isDefault: true,
      appliesToLevels: ['B1'],
      createdAt: '2026-06-01T00:00:00Z',
      levels: [{ key: 'NEW', label: 'New', minScore: 0, maxScore: 100 }],
    },
    {
      id: 'scale-original',
      name: 'Ghana Primary (GES 6-level)',
      isDefault: true,
      appliesToLevels: ['B1'],
      createdAt: '2026-01-01T00:00:00Z',
      levels: [{ key: 'A', label: 'A', minScore: 80, maxScore: 100 }],
    },
  ]

  it('asks Prisma for a total order, rather than accepting whatever rows arrive', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL
    gradingScales = []

    await POST_SCORES(
      jsonRequest('POST', '/api/assessments/assess-1/scores', {
        studentId: 'student-1',
        rawScore: 90,
      }),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )

    // Asserted on the arguments the mocked call received, not on the response: the
    // defect was entirely inside the query.
    expect(gradingScaleQueryArgs).toHaveLength(1)
    expect(gradingScaleQueryArgs[0]!.orderBy).toEqual([
      { isDefault: 'desc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ])
  })

  it('stores the older scale\'s band whatever order the two scales come back in', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL

    gradingScales = AMBIGUOUS
    await POST_SCORES(
      jsonRequest('POST', '/api/assessments/assess-1/scores', {
        studentId: 'student-1',
        rawScore: 90,
      }),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )
    const forwards = objectAt(callAt(scoreUpsert, 0), 'update')

    gradingScales = [...AMBIGUOUS].reverse()
    await POST_SCORES(
      jsonRequest('POST', '/api/assessments/assess-1/scores', {
        studentId: 'student-1',
        rawScore: 90,
      }),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )
    const backwards = objectAt(callAt(scoreUpsert, 1), 'update')

    // The original, not the later copy of it: the school has been reporting against
    // it all along. A duplicate scale must not silently re-label a cohort.
    expect(forwards.gradingScaleId).toBe('scale-original')
    expect(backwards.gradingScaleId).toBe('scale-original')
    expect(forwards.grade).toBe('A')
    expect(backwards.grade).toBe('A')
  })
})

// ---------------------------------------------------------------------------
// DEFECT 4b — a mark outside its assessment's range
// ---------------------------------------------------------------------------

/**
 * `rawScore` bounded by the assessment's own maximum.
 *
 * The defect: `SaveScoreSchema.rawScore` was `z.number().min(0).max(9999)` and
 * nothing related it to `Assessment.maxScore`, so a teacher who typed `150` for
 * a child who scored `15` on a 100-mark assessment produced 150%, which
 * `determineGrade` labelled `level_6` — and `score.upsert` persisted it as the
 * gradebook's audit record. The same gap made `9999` against a `maxScore` of 1 a
 * 500 from the `Decimal(5,2)` column rather than a message to the teacher.
 *
 * These drive the real handler, so what is asserted is the HTTP answer a
 * teacher gets and whether the row was written at all — never the helper alone.
 */
describe('POST /api/assessments/[id]/scores — a mark is bounded by the assessment', () => {
  /** Ghana Primary, so "level_6" here means the Excellent band under test. */
  const ghanaPrimary = [
    {
      id: 'scale-primary',
      isDefault: true,
      appliesToLevels: ['B1'],
      levels: [
        { key: 'level_6', label: 'Level 6', minScore: 85, maxScore: 100 },
        { key: 'level_5', label: 'Level 5', minScore: 70, maxScore: 84 },
        { key: 'level_1', label: 'Level 1', minScore: 0, maxScore: 39 },
      ],
    },
  ]

  const postMark = (body: Record<string, unknown>) =>
    POST_SCORES(
      jsonRequest('POST', '/api/assessments/assess-1/scores', body),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )

  /** A raw JSON body, so a payload JSON can express but a number literal cannot. */
  const postRawMark = (body: string) =>
    POST_SCORES(
      new NextRequest('http://localhost/api/assessments/assess-1/scores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      { params: Promise.resolve({ id: 'assess-1' }) },
    )

  /** The refusal body, read once — a `Response` body is a one-shot stream. */
  const refusal = async (res: Response): Promise<{ error: string; details: string }> => {
    const body = (await res.json()) as { error?: string; details?: unknown }
    return {
      error: body.error ?? '',
      details: JSON.stringify(body.details ?? []),
    }
  }

  it('stores 15 out of 100 as level_1, the mark the teacher actually entered', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL
    gradingScales = ghanaPrimary

    const res = await postMark({ studentId: 'student-1', rawScore: 15 })

    expect(res.status).toBe(200)
    // 15% is 15/100, and 15% is Level 1. Nothing is clamped up to Excellent.
    expect(singleCall(scoreUpsert).update).toMatchObject({
      rawScore: 15,
      percentage: 15,
      grade: 'level_1',
    })
  })

  it('refuses 150 out of 100 as a validation error, and writes nothing', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL
    gradingScales = ghanaPrimary

    const res = await postMark({ studentId: 'student-1', rawScore: 150 })

    // THE DEFECT: this used to be a 200 storing percentage 150 and grade
    // 'level_6' — a child recorded as Excellent on a paper they scored 15 on.
    expect(res.status).toBe(400)
    expect(scoreUpsert).toHaveBeenCalledTimes(0)
    const body = await refusal(res)
    expect(body.error).toBe('Invalid input')
    // The refusal names the assessment's own bound and the offending field, so
    // the teacher is told what the assessment is out of rather than that some
    // number was too big.
    expect(body.details).toContain('100')
    expect(body.details).toContain('rawScore')
  })

  it('refuses every out-of-range value, above the ceiling and below the floor', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL
    gradingScales = ghanaPrimary

    for (const rawScore of [100.5, 120, 150, 300, 850, 999.99, 9999, -1, -0.01]) {
      const res = await postMark({ studentId: 'student-1', rawScore })
      expect(res.status).toBe(400)
      expect(scoreUpsert).toHaveBeenCalledTimes(0)
    }
    // The boundaries themselves are marks, not attempts at one.
    for (const rawScore of [0, 100]) {
      const res = await postMark({ studentId: 'student-1', rawScore })
      expect(res.status).toBe(200)
    }
  })

  it('refuses a mark that overflows Decimal(5,2) rather than failing as a 500', async () => {
    // 9999/1 = 999900, which cannot be stored in `Score.percentage`. Before the
    // bound this reached the database and came back as a 500 from Prisma.
    assessmentRow = { ...ASSESSMENT_WITH_LEVEL, maxScore: 1 }
    gradingScales = ghanaPrimary

    const res = await postMark({ studentId: 'student-1', rawScore: 9999 })

    expect(res.status).toBe(400)
    expect(scoreUpsert).toHaveBeenCalledTimes(0)
  })

  it('refuses a non-finite mark carried by the payload', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL
    gradingScales = ghanaPrimary

    // `1e999` is valid JSON and parses to Infinity, so this reaches the schema
    // as a real Infinity rather than as a string.
    const infinite = await postRawMark('{"studentId":"student-1","rawScore":1e999}')
    expect(infinite.status).toBe(400)
    expect(scoreUpsert).toHaveBeenCalledTimes(0)

    // NaN is what a client actually sends for a mark it could not parse: JSON
    // has no NaN, so `JSON.stringify({ rawScore: NaN })` emits `null`.
    const notANumber = await postRawMark('{"studentId":"student-1","rawScore":null}')
    expect(notANumber.status).toBe(400)
    expect(scoreUpsert).toHaveBeenCalledTimes(0)
  })

  it('never reads a maxScore from the request body', async () => {
    assessmentRow = ASSESSMENT_WITH_LEVEL
    gradingScales = ghanaPrimary

    // A client that sent its own maximum could otherwise choose the denominator
    // that makes its mark correct. `Zod` strips the unknown key and the bound
    // comes from the assessment row.
    const widened = await postMark({
      studentId: 'student-1',
      rawScore: 150,
      maxScore: 1000,
    })
    expect(widened.status).toBe(400)
    expect(scoreUpsert).toHaveBeenCalledTimes(0)

    // And a client cannot narrow it either: 30 is out of range on a 20-mark
    // assessment even if the body claims a maximum of 100.
    assessmentRow = { ...ASSESSMENT_WITH_LEVEL, maxScore: 20 }
    const narrowed = await postMark({
      studentId: 'student-1',
      rawScore: 30,
      maxScore: 100,
    })
    expect(narrowed.status).toBe(400)
    expect(scoreUpsert).toHaveBeenCalledTimes(0)
  })

  it('refuses a mark on an assessment whose own maximum cannot carry one', async () => {
    // A zero maximum admits no mark at all, rather than every mark or a 0% that
    // the child never earned.
    assessmentRow = { ...ASSESSMENT_WITH_LEVEL, maxScore: 0 }
    gradingScales = ghanaPrimary

    const res = await postMark({ studentId: 'student-1', rawScore: 10 })

    expect(res.status).toBe(400)
    expect(scoreUpsert).toHaveBeenCalledTimes(0)
  })
})

// ---------------------------------------------------------------------------
// DEFECT 5 — academic reports after promotion
// ---------------------------------------------------------------------------

const STUDENT_ROW = {
  id: 'student-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  studentId: 'NOVA26001',
  classId: 'class-current',
  class: { name: 'Current Class', level: { name: 'Basic 9' } },
}

describe('GET /api/reports/academic/[studentId] — term-scoped joins', () => {
  it('queries assessments for the enrollment\'s class, not student.classId', async () => {
    studentRow = STUDENT_ROW
    requestedTerm = { id: 'term-2', ...TERM_DATE }
    termEnrollment = {
      classId: 'class-term',
      class: { name: 'Term Class', level: { name: 'Basic 5' } },
    }
    reportAssessments = []
    attendanceList = []

    const res = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1?termId=term-2'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )

    expect(res.status).toBe(200)
    // The enrollment for the requested term decides the class.
    expect(singleCall(enrollmentFindFirst).where).toEqual({
      tenantId: 'tenant-1',
      studentId: 'student-1',
      termId: 'term-2',
      isActive: true,
    })
    const where = singleCall(assessmentFindMany).where as Record<string, unknown>
    expect(where.classSubject).toEqual({ classId: 'class-term' })
    expect(where.termId).toBe('term-2')
    // The header names the enrollment's class, not the current pointer.
    const body = await readJson(res)
    expect(objectAt(body, 'student').class).toBe('Term Class')
    expect(objectAt(body, 'student').classLevel).toBe('Basic 5')
  })

  it('uses the current term enrollment for the default view', async () => {
    studentRow = STUDENT_ROW
    currentTerm = { id: 'term-1', ...TERM_DATE }
    termEnrollment = {
      classId: 'class-term-1',
      class: { name: 'Term 1 Class', level: { name: 'Basic 5' } },
    }
    reportAssessments = []
    attendanceList = []

    const res = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )

    expect(res.status).toBe(200)
    const where = singleCall(assessmentFindMany).where as Record<string, unknown>
    expect(where.classSubject).toEqual({ classId: 'class-term-1' })
    expect(where.termId).toBe('term-1')
  })

  it('falls back to the student class pointer when no current term is configured', async () => {
    studentRow = STUDENT_ROW
    currentTerm = null
    termEnrollment = null
    reportAssessments = []
    attendanceList = []

    const res = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )

    expect(res.status).toBe(200)
    const where = singleCall(assessmentFindMany).where as Record<string, unknown>
    expect(where.classSubject).toEqual({ classId: 'class-current' })
    expect(where.termId).toBeUndefined()
  })

  it('rejects an explicit term the student has no active enrollment for', async () => {
    studentRow = STUDENT_ROW
    requestedTerm = { id: 'term-2', ...TERM_DATE }
    termEnrollment = null

    const res = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1?termId=term-2'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )

    expect(res.status).toBe(400)
    // No silent fall-back to the current class.
    expect(assessmentFindMany).toHaveBeenCalledTimes(0)
  })

  it('rejects an unassigned student instead of a silent empty report', async () => {
    studentRow = { ...STUDENT_ROW, classId: null, class: null }
    currentTerm = null
    termEnrollment = null

    const res = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )

    // The old `classId: student.classId || ''` matched nothing and
    // rendered as an empty report.
    expect(res.status).toBe(400)
    expect(assessmentFindMany).toHaveBeenCalledTimes(0)
  })

  it('bounds attendance by the term date range and drops the class filter', async () => {
    studentRow = STUDENT_ROW
    currentTerm = { id: 'term-1', ...TERM_DATE }
    termEnrollment = {
      classId: 'class-term-1',
      class: { name: 'Term 1 Class', level: { name: 'Basic 5' } },
    }
    reportAssessments = []
    attendanceList = [
      { status: 'PRESENT' },
      { status: 'ABSENT' },
      { status: 'PRESENT' },
    ]

    const res = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )

    expect(res.status).toBe(200)
    const where = singleCall(attendanceFindMany).where as {
      tenantId: string
      studentId: string
      date: { gte: Date; lte: Date }
    }
    expect(where.tenantId).toBe('tenant-1')
    expect(where.studentId).toBe('student-1')
    // No classId filter at all.
    expect((where as Record<string, unknown>).classId).toBeUndefined()
    expect(where.date.gte).toEqual(TERM_DATE.startDate)
    expect(where.date.lte).toBeInstanceOf(Date)
  })

  it('distinguishes "no attendance data" from 0%', async () => {
    studentRow = STUDENT_ROW
    currentTerm = { id: 'term-1', ...TERM_DATE }
    termEnrollment = {
      classId: 'class-term-1',
      class: { name: 'Term 1 Class', level: { name: 'Basic 5' } },
    }
    reportAssessments = []
    attendanceList = []

    const empty = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )
    expect(empty.status).toBe(200)
    const emptyBody = await readJson(empty)
    const emptySummary = objectAt(emptyBody, 'summary')
    // An unmarked period is not a 0%.
    expect(emptySummary.hasAttendanceData).toBe(false)
    expect(emptySummary.attendanceRate).toBeNull()
    expect(emptySummary.totalAttendanceDays).toBe(0)

    attendanceList = [
      { status: 'PRESENT' },
      { status: 'ABSENT' },
      { status: 'PRESENT' },
    ]
    const marked = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )
    const markedBody = await readJson(marked)
    const markedSummary = objectAt(markedBody, 'summary')
    expect(markedSummary.hasAttendanceData).toBe(true)
    // 2 of 3 present, via calculateAttendancePercentage.
    expect(markedSummary.attendanceRate).toBe(67)
    expect(markedSummary.presentDays).toBe(2)
  })

  /**
   * A stored percentage outside 0-100 is re-checked on read.
   *
   * The write path refuses to store one, so these rows predate that guard. The
   * report still has to be honest about them: printing 150% beside a withheld
   * band would show a mark no child earned, and the same value would be averaged
   * into `weightedPercentage` and `subjects[].percentage`.
   */
  it('reports an out-of-range stored percentage as no percentage at all', async () => {
    studentRow = STUDENT_ROW
    currentTerm = { id: 'term-1', ...TERM_DATE }
    termEnrollment = {
      classId: 'class-term-1',
      class: { name: 'Term 1 Class', level: { name: 'Basic 5', code: 'B5' } },
    }
    gradingScales = [
      {
        id: 'scale-primary',
        isDefault: true,
        appliesToLevels: ['B5'],
        levels: [
          { key: 'level_6', label: 'Level 6', minScore: 85, maxScore: 100 },
          { key: 'level_5', label: 'Level 5', minScore: 70, maxScore: 84 },
          { key: 'level_1', label: 'Level 1', minScore: 0, maxScore: 39 },
        ],
      },
    ]
    attendanceList = []
    reportAssessments = [
      {
        id: 'assess-typo',
        name: 'End of Term',
        maxScore: 100,
        weight: 1,
        assessmentDate: new Date('2026-02-01'),
        classSubject: { subjectId: 'subj-1', subject: { name: 'Maths', code: 'MAT' } },
        type: { name: 'Test', code: 'TEST', defaultWeight: 1 },
        term: { name: 'Term 1', academicYear: { name: '2026' } },
        // 15 out of 100 stored as 150, and graded 'level_6' at the time.
        scores: [{ rawScore: 15, percentage: 150, grade: 'level_6' }],
      },
    ]

    const res = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    const assessment = (body.assessments as Array<Record<string, unknown>>)[0]!
    // The out-of-range percentage is not reported, and no band is claimed for it.
    expect(assessment.percentage).toBeNull()
    expect(assessment.band).toBeNull()
    // The raw score still travels, so the discrepancy is visible rather than
    // hidden — and the stale `level_6` key is not what the report displays.
    expect(assessment.score).toBe(15)
    expect(assessment.grade).toBe('level_6')
    // And it contributes nothing to the summary.
    const summary = objectAt(body, 'summary')
    expect(summary.totalAssessments).toBe(1)
    expect(summary.gradedAssessments).toBe(0)
    expect(summary.subjectCount).toBe(0)
    expect(summary.weightedPercentage).toBeNull()
    expect(summary.overallPercentage).toBeNull()
    expect(body.subjects).toEqual([])
  })

  it('still reports a real percentage, band and all', async () => {
    studentRow = STUDENT_ROW
    currentTerm = { id: 'term-1', ...TERM_DATE }
    termEnrollment = {
      classId: 'class-term-1',
      class: { name: 'Term 1 Class', level: { name: 'Basic 5', code: 'B5' } },
    }
    gradingScales = [
      {
        id: 'scale-primary',
        isDefault: true,
        appliesToLevels: ['B5'],
        levels: [
          { key: 'level_6', label: 'Level 6', minScore: 85, maxScore: 100 },
          { key: 'level_5', label: 'Level 5', minScore: 70, maxScore: 84 },
          { key: 'level_1', label: 'Level 1', minScore: 0, maxScore: 39 },
        ],
      },
    ]
    attendanceList = []
    reportAssessments = [
      {
        id: 'assess-ok',
        name: 'End of Term',
        maxScore: 100,
        weight: 1,
        assessmentDate: new Date('2026-02-01'),
        classSubject: { subjectId: 'subj-1', subject: { name: 'Maths', code: 'MAT' } },
        type: { name: 'Test', code: 'TEST', defaultWeight: 1 },
        term: { name: 'Term 1', academicYear: { name: '2026' } },
        scores: [{ rawScore: 88, percentage: 88, grade: 'level_6' }],
      },
    ]

    const res = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    const assessment = (body.assessments as Array<Record<string, unknown>>)[0]!
    expect(assessment.percentage).toBe(88)
    expect(objectAt(assessment, 'band').key).toBe('level_6')
    const summary = objectAt(body, 'summary')
    expect(summary.gradedAssessments).toBe(1)
    expect(summary.weightedPercentage).toBe(88)
  })

  /**
   * The report reader had no `orderBy` on its scale query, and it is the reader that
   * decides the band printed on a report card. With two scales claiming one level —
   * which nothing prevented — the card was a function of the row order the engine
   * emitted, so a routine VACUUM could move a whole cohort from one band to another
   * with no error anywhere.
   */
  it('orders the grading-scale read, so a card cannot depend on the row order', async () => {
    studentRow = STUDENT_ROW
    currentTerm = { id: 'term-1', ...TERM_DATE }
    termEnrollment = {
      classId: 'class-term-1',
      class: { name: 'Term 1 Class', level: { name: 'Basic 5', code: 'B5' } },
    }
    reportAssessments = []
    attendanceList = []

    const res = await GET_ACADEMIC_REPORT(
      request('GET', '/api/reports/academic/student-1'),
      { params: Promise.resolve({ studentId: 'student-1' }) },
    )

    expect(res.status).toBe(200)
    // Asserted on the arguments the mocked call received: the defect was inside the
    // query, and the response body is identical either way.
    expect(gradingScaleQueryArgs).toHaveLength(1)
    expect(gradingScaleQueryArgs[0]!.orderBy).toEqual([
      { isDefault: 'desc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ])
  })

  it('labels the same percentage the same way whichever order two claiming scales arrive in', async () => {
    const twoScales = [
      {
        id: 'scale-copy',
        isDefault: true,
        appliesToLevels: ['B5'],
        createdAt: '2026-06-01T00:00:00Z',
        levels: [{ key: 'COPY', label: 'Copy', minScore: 0, maxScore: 100 }],
      },
      {
        id: 'scale-original',
        isDefault: true,
        appliesToLevels: ['B5'],
        createdAt: '2026-01-01T00:00:00Z',
        levels: [{ key: 'level_6', label: 'Level 6', minScore: 85, maxScore: 100 }],
      },
    ]
    const gradedReport = async () => {
      studentRow = STUDENT_ROW
      currentTerm = { id: 'term-1', ...TERM_DATE }
      termEnrollment = {
        classId: 'class-term-1',
        class: { name: 'Term 1 Class', level: { name: 'Basic 5', code: 'B5' } },
      }
      attendanceList = []
      reportAssessments = [
        {
          id: 'assess-ok',
          name: 'End of Term',
          maxScore: 100,
          weight: 1,
          assessmentDate: new Date('2026-02-01'),
          classSubject: { subjectId: 'subj-1', subject: { name: 'Maths', code: 'MAT' } },
          type: { name: 'Test', code: 'TEST', defaultWeight: 1 },
          term: { name: 'Term 1', academicYear: { name: '2026' } },
          scores: [{ rawScore: 88, percentage: 88, grade: 'level_6' }],
        },
      ]
      const res = await GET_ACADEMIC_REPORT(
        request('GET', '/api/reports/academic/student-1'),
        { params: Promise.resolve({ studentId: 'student-1' }) },
      )
      const body = await readJson(res)
      const assessment = (body.assessments as Array<Record<string, unknown>>)[0]!
      return objectAt(assessment, 'band').key
    }

    gradingScales = twoScales
    const forwards = await gradedReport()
    gradingScales = [...twoScales].reverse()
    const backwards = await gradedReport()

    // The original scale's band, from an 88%, both times. The copy's 0-100 band
    // would have labelled the same 88% as something else entirely.
    expect(forwards).toBe('level_6')
    expect(backwards).toBe('level_6')
  })
})
