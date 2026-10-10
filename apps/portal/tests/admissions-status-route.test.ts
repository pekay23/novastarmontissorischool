import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test'
import { NextRequest } from 'next/server'
import { ADMISSIONS_OPEN_FLAG_KEY } from '@novastar/shared-types'
import { PLATFORM_ROLES, type PlatformRole } from '@/lib/constants/platform-roles'

/**
 * Regression cover for `GET` and `PATCH /api/admissions/status`.
 *
 * This route is the ONE writer for the `admissions_open` feature flag, and that
 * is the design fact the whole file is protecting. Two writers for one flag
 * would produce two audit lines that disagree about who changed what, with
 * nothing in the data to arbitrate — so the flag's registry entry declares
 * `manageRoles: []`, the generic `PATCH /api/system/config/:key` refuses it with
 * a pointer here, and `tests/system-config-route.test.ts` pins that refusal and
 * the omission from the platform catalogue.
 *
 * That leaves this route with a job no other flag route has, and each block
 * below pins one obligation of it:
 *
 *   * Authorization is WIDER than the platform-admin set — HEADMASTER,
 *     ADMIN_STAFF and ADMISSIONS_OFFICER — because whether a school is taking
 *     applications is a per-tenant operational decision, and it is still per
 *     tenant: the widening is who may act within a school, never which school.
 *   * The audit entry is the product. An auditor reads "who opened admissions,
 *     when, and from what to what" out of this flag, and the from/to pair lives
 *     in `changes` because `logger.ts` folds `changes` — not `description` —
 *     into the entry's chain hash. An entry with no payload hashes as `{}`, so
 *     its values could be rewritten in the database without breaking the chain.
 *   * Nothing is reported from a read-back. `open` comes from the submitted
 *     value and `version`/`updatedAt` from the write's own result, because a
 *     read-back can observe a concurrent change and answer with a state nobody
 *     asked for.
 *   * The read path never writes and never trusts the stored column. A
 *     non-boolean in a JSON column resolves CLOSED, not truthy — a data
 *     integrity accident must not publish a school as open.
 *
 * The assertions are about the SEQUENCE and RECEIVER of the mocked calls, not
 * only the response body, for the reason `tests/system-config-route.test.ts`
 * sets out at length: all three of that file's original defects were ordering or
 * concurrency bugs that a response-only assertion kept passing straight through.
 *
 * `@/lib/constants/platform-roles` and `@/lib/system-config` are deliberately
 * NOT mocked. They are the registry and the role predicate this feature is
 * built on; stubbing either would let the test agree with itself.
 */

interface ConfigArgs {
  where?: {
    tenantId?: string
    key?: string
    tenantId_key?: { tenantId: string; key: string }
  }
  select?: Record<string, boolean>
  create?: Record<string, unknown>
  update?: Record<string, unknown>
  data?: Record<string, unknown>
}

/**
 * The columns this route ever reads or needs back. The `value` column is
 * deliberately typed `unknown`: it is a Prisma JSON column, so "a boolean" is a
 * property of what was written, not of what the column will hand back.
 */
interface StoredRow {
  value: unknown
  isEditable: boolean
  version: number
  updatedAt: Date
}

/** The timestamp the mocked `upsert` hands back, deliberately not "now". */
const SAVED_AT = new Date('2026-04-14T09:15:00.000Z')

/**
 * A session in a role that may manage admissions; overridden per test as needed.
 * `role` is annotated because the literal would otherwise be pinned to
 * `'HEADMASTER'`, and every authorization test needs to assign a different one.
 */
const SESSION: { tenantId: string; userId: string; schoolId: string; role: PlatformRole | null } = {
  tenantId: 'tenant-session',
  userId: 'user-session',
  schoolId: 'school-session',
  role: PLATFORM_ROLES.HEADMASTER,
}

let session: typeof SESSION | Error = SESSION

/**
 * Every mocked call appends a label here, so a test can assert the order the
 * handler made them in. `toHaveBeenCalledBefore`-style helpers and separate
 * per-mock call counts cannot distinguish "read then write" from "write then
 * read" — both satisfy any assertion about which mocks ran. One shared log can.
 */
type Step = 'transaction' | 'findUnique' | 'upsert' | 'deleteMany' | 'logAuditEvent'
let steps: Step[] = []

/** Which client handle a database call arrived on. */
type Receiver = 'root' | 'transaction'

/**
 * The receiver of each recorded database call. A gate read on the pooled client
 * and a write on the transaction are two statements about two moments, so the
 * verdict the gate reached can describe a row the write never saw. Argument
 * assertions cannot see that; only the receiver can.
 */
let receivers: Receiver[] = []

/** The override row this tenant has, or null when it has none. */
let row: StoredRow | null = null
/** Rows a delete reports removing. `0` means nothing was stored. */
let removedRows = 0
/**
 * The version a write reports back, or `null` to emulate the column's own
 * increment. A test that wants to prove the handler reports the database's
 * answer rather than its own sets this to a number an increment could not
 * produce.
 */
let writtenVersion: number | null = null
let writtenAt: Date = SAVED_AT

const findUnique = mock(async (_args: ConfigArgs): Promise<StoredRow | null> => null)
const upsert = mock(
  async (_args: ConfigArgs): Promise<{ updatedAt: Date; version: number }> => ({
    updatedAt: SAVED_AT,
    version: 1,
  })
)
const deleteMany = mock(async (_args: ConfigArgs): Promise<{ count: number }> => ({ count: 0 }))
const systemErrorCreate = mock(async (_args: ConfigArgs): Promise<Record<string, unknown>> => ({}))
const logAuditEvent = mock(async (_params: Record<string, unknown>): Promise<null> => null)

/**
 * Two handles onto the same mock functions, so which one a call arrived on is
 * observable without the two paths behaving differently. `mock.module` exposes
 * `ROOT_MODEL`; `$transaction` hands its callback `TX_MODEL`. Sharing a single
 * model object would make them indistinguishable and every receiver assertion in
 * this file vacuous.
 */
const ROOT_MODEL = { findUnique, upsert, deleteMany }
const TX_MODEL = { findUnique, upsert, deleteMany }
const TX_CLIENT = { systemConfig: TX_MODEL }

/**
 * Runs the callback immediately against `TX_CLIENT`, exactly as Prisma does
 * against a real connection. Deliberately does NOT roll back or undo: this file
 * asserts which queries ran and what the handler answered, and a fake that
 * silently restored state would let a partial write pass as a clean one.
 */
const $transaction = mock(
  async (
    fn: (tx: typeof TX_CLIENT) => Promise<unknown>,
    _bounds?: { maxWait?: number; timeout?: number }
  ): Promise<unknown> => fn(TX_CLIENT)
)

/**
 * The session resolver, mocked wholesale. `getTokenTenantId` is exported from
 * the same module and is only reached on a 500, but the module has to satisfy
 * every importer or `app/api/.../route.ts` fails to load.
 */
const getCachedSessionAndTenant = mock(async () => {
  if (session instanceof Error) throw session
  return session
})

/** Record a database call's name and the handle it arrived on. */
function record(self: unknown, name: Step): void {
  steps.push(name)
  receivers.push(self === TX_MODEL ? 'transaction' : 'root')
}

/**
 * `lib/system-config.ts` and `lib/audit/logger.ts` import the server-only Prisma
 * client at module scope, so both have to be replaced before they load. There is
 * no test preload in this repo, so `mock.module` is the mechanism — hence the
 * dynamic imports below. Only the methods the route's call graph actually uses
 * are exposed: this route reads and writes `SystemConfig` and nothing else, so
 * an accidental new call — a `findMany` here, a `create` or `update` on the
 * write path — fails loudly instead of silently returning undefined.
 * `systemConfig` deliberately has no `create` or `update`: the write path only
 * ever upserts and deletes.
 */
mock.module('server-only', () => ({}))

// ---------------------------------------------------------------------------
// Module-mock lifetime: snapshot before registering, restore after
// ---------------------------------------------------------------------------
// `mock.module` patches the LIVE namespace for the whole process and never reverts, so a
// registration made at module scope is what every file loaded afterwards binds to. All four
// boundaries registered here are put back. `server-only` goes first because `@/lib/prisma`
// resolves through it and the package is not installed in this workspace.
//
// The remaining snapshots are read HERE, before the first real registration. That is the
// load-bearing part: a `beforeEach` capture would run after these registrations had already
// overwritten the namespace, so it would record this file's own factory and hand the double
// straight back to the next file.
//
// Every factory SPREADS the namespace it replaces and then overrides, making each fake both
// a superset and a subset — which is what makes the restore complete, since `mock.module`
// merges and an added key could never be removed again.
const previousNamespaces = new Map<string, Record<string, unknown>>()
previousNamespaces.set('server-only', { ...(await import('server-only')) })
previousNamespaces.set('@/lib/prisma', { ...(await import('@/lib/prisma')) })
previousNamespaces.set('@/lib/auth/session-context', {
  ...(await import('@/lib/auth/session-context')),
})
previousNamespaces.set('@/lib/audit/logger', { ...(await import('@/lib/audit/logger')) })

const base = (specifier: string): Record<string, unknown> =>
  previousNamespaces.get(specifier) ?? {}

/**
 * The real `AuditLogAction` enum, read out before the module is replaced, so the `action`
 * asserted below is the production constant rather than a copy of it that could drift.
 * Only `logAuditEvent` is under test.
 */
const { AuditLogAction } = await import('@/lib/audit/logger')

const FAKES = [
  {
    specifier: '@/lib/prisma',
    factory: () => ({
      ...base('@/lib/prisma'),
      prisma: {
        systemConfig: ROOT_MODEL,
        systemError: { create: systemErrorCreate },
        $transaction,
      },
    }),
  },
  {
    specifier: '@/lib/auth/session-context',
    factory: () => ({
      ...base('@/lib/auth/session-context'),
      getCachedSessionAndTenant,
      getTokenTenantId: async () => null,
    }),
  },
  {
    specifier: '@/lib/audit/logger',
    factory: () => ({
      ...base('@/lib/audit/logger'),
      AuditLogAction,
      logAuditEvent,
      createAuditLog: logAuditEvent,
      queryAuditLogs: async () => ({ logs: [], total: 0 }),
    }),
  },
] as const

// Also registered at load time, so the route imports below resolve these specifiers through
// the doubles and the file is correct in a run that never reaches `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

const { UnauthorizedError } = await import('@/lib/tenant')
const { GET, PATCH } = await import('@/app/api/admissions/status/route')

function getRequest(): NextRequest {
  return new NextRequest('http://localhost/api/admissions/status')
}

/** A PATCH request carrying `body` as its raw JSON. */
function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admissions/status', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

/** The flat `{ open, isOverridden, updatedAt, version }` body a GET answers. */
async function readAdmissionsStatus(res: Response) {
  return (await readJson(res)) as {
    open: boolean
    isOverridden: boolean
    updatedAt: string | null
    version: number
  }
}

/** The `{ status }` body a PATCH answers. */
async function readPatchedStatus(res: Response) {
  return (await readJson(res)).status as {
    open: boolean
    isOverridden: boolean
    updatedAt: string | null
    version: number
  }
}

/** Count every database call and transaction, so a rejected request cannot write. */
function dbCalls(): number {
  return (
    findUnique.mock.calls.length +
    upsert.mock.calls.length +
    deleteMany.mock.calls.length +
    systemErrorCreate.mock.calls.length +
    $transaction.mock.calls.length
  )
}

/** The one recorded call named `name`, failing loudly if it is ambiguous. */
function singleCall(name: 'findUnique' | 'upsert' | 'deleteMany'): ConfigArgs {
  const mock = { findUnique, upsert, deleteMany }[name]
  expect(mock).toHaveBeenCalledTimes(1)
  return mock.mock.calls[0][0]
}

/**
 * How many times `name` has been called so far. A loop over several sessions
 * accumulates, so the assertions there are deltas — otherwise the second
 * iteration fails on a count the first one legitimately produced.
 */
function callCount(name: 'findUnique' | 'upsert'): number {
  return { findUnique, upsert }[name].mock.calls.length
}

/**
 * Assert a status code while naming the case that produced it. A table-driven
 * authorization check otherwise reports "expected 403, received 200" without
 * saying WHICH role was let through, which is the only fact a reader needs to
 * act on. Reported as an object for the same reason the source-text assertions
 * elsewhere in this suite report `{ route, needle, found }`.
 */
function expectStatus(
  res: Response,
  expected: number,
  label: { verb: 'GET' | 'PATCH'; role: PlatformRole | null }
): void {
  expect({ ...label, status: res.status }).toEqual({ ...label, status: expected })
}

beforeEach(() => {
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
  // Reset rather than only clear: a leaked implementation from one test would
  // let the next test pass on data it did not set up.
  steps = []
  receivers = []
  row = null
  removedRows = 0
  writtenVersion = null
  writtenAt = SAVED_AT
  session = SESSION

  // `function` not arrow: the receiver is the only evidence of which handle a
  // query ran on, and an arrow would discard it.
  findUnique.mockReset()
  findUnique.mockImplementation(function (this: unknown, _args: ConfigArgs) {
    record(this, 'findUnique')
    return Promise.resolve(row)
  })

  upsert.mockReset()
  upsert.mockImplementation(function (this: unknown, _args: ConfigArgs) {
    record(this, 'upsert')
    return Promise.resolve({
      updatedAt: writtenAt,
      // Emulate the column: `{ increment: 1 }` means the stored value plus one,
      // worked out by the database.
      version: writtenVersion ?? (row?.version ?? 0) + 1,
    })
  })

  deleteMany.mockReset()
  deleteMany.mockImplementation(function (this: unknown, _args: ConfigArgs) {
    record(this, 'deleteMany')
    return Promise.resolve({ count: removedRows })
  })

  systemErrorCreate.mockReset()
  systemErrorCreate.mockImplementation(async () => ({}))

  $transaction.mockReset()
  $transaction.mockImplementation(async (fn: (tx: typeof TX_CLIENT) => Promise<unknown>) => {
    steps.push('transaction')
    return fn(TX_CLIENT)
  })

  logAuditEvent.mockReset()
  logAuditEvent.mockImplementation(async () => {
    steps.push('logAuditEvent')
    return null
  })
})

/**
 * The roles `ADMISSIONS_MANAGER_ROLES` admits, and the ones it does not. Read
 * from the production sets rather than spelled out here, so a future edit to
 * either set is caught by this file's authorization tests instead of by a human
 * noticing the copy had drifted.
 */
const ALLOWED = [PLATFORM_ROLES.HEADMASTER, PLATFORM_ROLES.ADMIN_STAFF, PLATFORM_ROLES.ADMISSIONS_OFFICER]
const DENIED = [
  PLATFORM_ROLES.ASSISTANT_HEAD,
  PLATFORM_ROLES.HEAD_TEACHER,
  PLATFORM_ROLES.CLASSROOM_TEACHER,
  PLATFORM_ROLES.ACCOUNTANT,
  PLATFORM_ROLES.PARENT,
  null,
]

describe('/api/admissions/status - authorization precedes every side effect', () => {
  it('should refuse every role outside the admissions set on BOTH verbs, without touching the database', async () => {
    // ASSISTANT_HEAD is on neither side of this: the set is not "platform admin
    // plus a bit", it is its own list. A deputy who cannot sign a leave form is
    // not the person closing an intake window either, and `null` — an
    // unauthenticated session or an unrecognised role name — must fail closed on
    // both verbs rather than passing `canManageAdmissions`' `.includes()`.
    for (const role of DENIED) {
      session = { ...SESSION, role }

      const read = await GET(getRequest())
      expectStatus(read, 403, { verb: 'GET', role })
      expect(await read.text()).toBe('Forbidden')
      // A denial that reached storage would let a parent close a school's
      // admissions while the response said no.
      expect(dbCalls()).toBe(0)
      expect(logAuditEvent).toHaveBeenCalledTimes(0)

      const write = await PATCH(patchRequest({ open: false }))
      expectStatus(write, 403, { verb: 'PATCH', role })
      expect(await write.text()).toBe('Forbidden')
      expect(dbCalls()).toBe(0)
      expect(logAuditEvent).toHaveBeenCalledTimes(0)
    }
  })

  it('should let the admissions set through on both verbs, so the refusals above are load-bearing', async () => {
    // ADMIN_STAFF and ADMISSIONS_OFFICER are the widening the feature exists
    // for: the front-office admin fielding calls from parents and the person
    // doing the intake are the ones who know when the window opens. If all three
    // were refused, every assertion in the block above would still pass.
    for (const role of ALLOWED) {
      session = { ...SESSION, role }

      const reads = callCount('findUnique')
      const read = await GET(getRequest())
      expectStatus(read, 200, { verb: 'GET', role })
      // One row per read, on the pooled client — a read that opened a
      // transaction would cost a connection to look at a single indexed key.
      expect({ role, reads: callCount('findUnique') - reads }).toEqual({ role, reads: 1 })

      const writes = callCount('upsert')
      const write = await PATCH(patchRequest({ open: true }))
      expectStatus(write, 200, { verb: 'PATCH', role })
      expect({ role, writes: callCount('upsert') - writes }).toEqual({ role, writes: 1 })
    }
  })

  it('should refuse a role before it even parses the body', async () => {
    session = { ...SESSION, role: PLATFORM_ROLES.PARENT }

    // A body the schema would refuse, so the 403 can only come from the role
    // gate. If parsing came first, a parent would be told their body was wrong —
    // which is an answer about them rather than about their permissions, and
    // invites a retry that will never succeed.
    const res = await PATCH(patchRequest({ open: 'yes', expectedVersion: -1 }))

    expect(await res.text()).toBe('Forbidden')
    expect(dbCalls()).toBe(0)
  })

  it('should answer an unauthenticated session with 401, not a 500', async () => {
    session = new UnauthorizedError()
    const res = await PATCH(patchRequest({ open: false }))

    // The catch hands the error to `toErrorResponse`, which maps
    // UnauthorizedError to a 401 before it logs or persists anything. A 500
    // here would mean every unauthenticated probe of this route is filed as a
    // platform fault, which is how a routine lockout gets diagnosed as an
    // outage.
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
    expect(dbCalls()).toBe(0)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
    // Nothing is persisted for an auth failure, so a burst of probes cannot
    // fill the errors page — which is the contrast that makes "a 403 records
    // nothing" mean something.
    expect(systemErrorCreate).toHaveBeenCalledTimes(0)
  })
})

describe('PATCH /api/admissions/status - the audit entry is the product', () => {
  it('should file one ADMISSIONS_TOGGLE entry, attributed to the session that made the change', async () => {
    row = { value: false, isEditable: true, version: 2, updatedAt: SAVED_AT }

    const res = await PATCH(patchRequest({ open: true }))

    expect(res.status).toBe(200)
    expect(logAuditEvent).toHaveBeenCalledTimes(1)
    const entry = logAuditEvent.mock.calls[0][0]
    expect(entry.action).toBe(AuditLogAction.ADMISSIONS_TOGGLE)
    // `entity` is `admissions`, not `feature_flag`, so this flag's history
    // reads separately from a platform flag change even though both are stored
    // in the same table. `entityId` is the flag key because that is the row a
    // reader will come looking for.
    expect(entry.entity).toBe('admissions')
    expect(entry.entityId).toBe(ADMISSIONS_OPEN_FLAG_KEY)
    expect(entry.description).toBe('Admissions opened')
    // Audit rows are read back per tenant. An entry filed under the wrong tenant
    // is invisible to the school that made the change and visible to one that
    // did not.
    expect(entry.userId).toBe(SESSION.userId)
    expect(entry.tenantId).toBe(SESSION.tenantId)
    expect(entry.schoolId).toBe(SESSION.schoolId)
  })

  it('should record the from/to pair in `changes`, not only in the description', async () => {
    row = { value: false, isEditable: true, version: 2, updatedAt: SAVED_AT }

    await PATCH(patchRequest({ open: true }))

    // `logger.ts` hashes `changes ?? details ?? {}` into the entry's chain hash,
    // and this route passes no `details` to fall back on. An entry with no
    // payload therefore hashes as `{}`, which means its values could be
    // rewritten in the database without breaking the chain — the description
    // ("Admissions opened") is the only untrusted part, and it is not covered.
    // Both members are the flag's own old and new value: `from` came out of the
    // same transactional read as the write, so it cannot observe a concurrent
    // change, and `to` passed this route's own `z.boolean()`.
    expect(logAuditEvent.mock.calls[0][0].changes).toEqual({ from: false, to: true })
  })

  it('should record a close as the mirror of an open, from the value that was stored', async () => {
    // The registry default is false, so `open: false` is a RESET: the row is
    // deleted, not overwritten. The entry still has to read as a close with a
    // real `from`, which is what makes the audit trail reconstructable after
    // the row is gone.
    row = { value: true, isEditable: true, version: 3, updatedAt: SAVED_AT }
    removedRows = 1

    const res = await PATCH(patchRequest({ open: false }))

    expect(res.status).toBe(200)
    const entry = logAuditEvent.mock.calls[0][0]
    expect(entry.description).toBe('Admissions closed')
    expect(entry.changes).toEqual({ from: true, to: false })
    expect(steps).toEqual(['transaction', 'findUnique', 'deleteMany', 'logAuditEvent'])
  })

  it('should not file the change under SYSTEM_UPDATE, whatever else it does', async () => {
    row = { value: false, isEditable: true, version: 2, updatedAt: SAVED_AT }

    await PATCH(patchRequest({ open: true }))

    // THE regression this route exists to prevent. If a future refactor routes
    // admissions through `PATCH /api/system/config/:key`, the flag would still
    // work and every response would still be correct — but its history would
    // silently move from the `ADMISSIONS_TOGGLE` filter an auditor reads to the
    // `SYSTEM_UPDATE` bucket shared with SSO and infrastructure changes, and the
    // two writers would produce two shapes of entry for one flag. Pinning the
    // action here is what makes that change a test failure rather than a review
    // comment.
    expect(logAuditEvent.mock.calls[0][0].action).not.toBe(AuditLogAction.SYSTEM_UPDATE)
  })
})

describe('PATCH /api/admissions/status - a no-op writes no audit entry', () => {
  it('should file nothing when the stored row already holds the submitted value', async () => {
    row = { value: true, isEditable: true, version: 2, updatedAt: SAVED_AT }

    const res = await PATCH(patchRequest({ open: true }))

    // The honest no-op. The upsert still fires — `true` differs from the
    // registry default of `false`, so an override row IS the correct stored
    // state — but the value a reader would report has not moved, and an entry
    // reading "from true to true" is pure noise in a tamper-evident chain.
    // NOTE ON "ZERO WRITES": this route cannot make a zero-write no-op, because
    // `applyFeatureFlagChange` always executes the storage transition and this
    // route delegates to it rather than reimplementing the decision. What is
    // suppressed is the AUDIT ENTRY, and that is what the steps below pin.
    expect(res.status).toBe(200)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
    expect(steps).toEqual(['transaction', 'findUnique', 'upsert'])
    expect(await readPatchedStatus(res)).toEqual({
      open: true,
      isOverridden: true,
      updatedAt: SAVED_AT.toISOString(),
      version: 3,
    })
  })

  it('should file nothing when there is no row and the submitted value is the default', async () => {
    // `open: false` IS the registry default, so this is the delete arm: the row
    // is removed, and nothing was ever stored, so nothing was removed. This is
    // the case the `removed` discriminant exists for — `change.removed` is only
    // present on the deletion arm of the result union, which is why the route
    // reaches it through `isOverridden` rather than destructuring it.
    const res = await PATCH(patchRequest({ open: false }))

    expect(res.status).toBe(200)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
    expect(steps).toEqual(['transaction', 'findUnique', 'deleteMany'])
    expect(deleteMany).toHaveBeenCalledTimes(1)
  })

  it('should file nothing when a concurrent reset already emptied the row', async () => {
    // The one case where the value guard alone is not enough. `from` is `true`
    // and the resolved value is `false`, so `from !== open` is TRUE — and without
    // the `removed > 0` half of the guard this case would file an entry telling
    // an auditor an override was reverted when the delete removed nothing.
    row = { value: true, isEditable: true, version: 3, updatedAt: SAVED_AT }
    removedRows = 0

    const res = await PATCH(patchRequest({ open: false }))

    expect(res.status).toBe(200)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
    // The guard is two halves and both are load-bearing: the first case above is
    // the only one `removed` would refuse, and this one is the only one
    // `from !== open` would let through.
    expect(steps).toEqual(['transaction', 'findUnique', 'deleteMany'])
  })

  it('should still store the write when the audit is suppressed', async () => {
    // The gate is on the audit entry, not on the mutation. Suppressing the entry
    // must not turn "saving the value you already have" into a failed save.
    row = { value: true, isEditable: true, version: 2, updatedAt: SAVED_AT }

    const res = await PATCH(patchRequest({ open: true }))

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(deleteMany).toHaveBeenCalledTimes(0)
  })
})

describe('PATCH /api/admissions/status - a write never leaves the session tenant', () => {
  it('should scope the read and the upsert to the session tenant, never a body-supplied one', async () => {
    const res = await PATCH(patchRequest({ open: true, tenantId: 'tenant-from-the-body' }))

    expect(res.status).toBe(200)
    // A flag flipped in one school must never write into another's row: the
    // `SystemConfig` unique key is `(tenantId, key)`, so the tenant IS the row,
    // and a read scoped to the wrong one would compare this school's version
    // against a stranger's value.
    expect(singleCall('findUnique').where).toEqual({
      tenantId_key: { tenantId: SESSION.tenantId, key: ADMISSIONS_OPEN_FLAG_KEY },
    })
    const arg = singleCall('upsert')
    expect(arg.where).toEqual({
      tenantId_key: { tenantId: SESSION.tenantId, key: ADMISSIONS_OPEN_FLAG_KEY },
    })
    expect(arg.create?.tenantId).toBe(SESSION.tenantId)
    expect(arg.update?.value).toBe(true)
  })

  it('should scope the reset delete to the session tenant too', async () => {
    row = { value: true, isEditable: true, version: 3, updatedAt: SAVED_AT }
    removedRows = 1

    const res = await PATCH(patchRequest({ open: false, tenantId: 'tenant-from-the-body' }))

    expect(res.status).toBe(200)
    // The delete takes a flat `where` rather than a compound key, so a dropped
    // tenant here would delete another school's admissions row outright.
    expect(singleCall('deleteMany').where).toEqual({
      tenantId: SESSION.tenantId,
      key: ADMISSIONS_OPEN_FLAG_KEY,
    })
  })

  it('should read and write inside the one transaction, so the audit cannot describe a row the write never saw', async () => {
    row = { value: false, isEditable: true, version: 2, updatedAt: SAVED_AT }

    await PATCH(patchRequest({ open: true }))

    // The route itself makes no database call on the write path — it delegates
    // wholly to `applyFeatureFlagChange` — so these receivers are the delegated
    // read and write. Both on the transaction handle is what makes the gate, the
    // precondition and the write one statement about one moment instead of two
    // about two.
    expect(steps).toEqual(['transaction', 'findUnique', 'upsert', 'logAuditEvent'])
    expect(receivers).toEqual(['transaction', 'transaction'])
    expect($transaction).toHaveBeenCalledTimes(1)
  })
})

describe('PATCH /api/admissions/status - a stale precondition is refused, not applied', () => {
  it('should answer 409 with the stored version when another session got there first', async () => {
    row = { value: false, isEditable: true, version: 9, updatedAt: SAVED_AT }

    const res = await PATCH(patchRequest({ open: true, expectedVersion: 7 }))

    // Without the precondition, the second tab's toggle lands and the first
    // tab's is silently gone — the row looks exactly as though only one change
    // was ever made, and so does the audit trail.
    expect(res.status).toBe(409)
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(0)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
  })

  it('should report the version actually stored, not the caller’s', async () => {
    row = { value: false, isEditable: true, version: 9, updatedAt: SAVED_AT }

    const res = await PATCH(patchRequest({ open: true, expectedVersion: 7 }))

    // 9 and not 7: echoing the caller's own stale number would tell the client to
    // resync to the state it already had, and its retry would overwrite the
    // change it just collided with. `details` carries it so a client can recover
    // rather than guess.
    expect(await readJson(res)).toEqual({
      error: `Feature flag '${ADMISSIONS_OPEN_FLAG_KEY}' was changed by another session`,
      details: { currentVersion: 9 },
    })
  })

  it('should proceed when the precondition matches, and report the version the write returned', async () => {
    row = { value: false, isEditable: true, version: 7, updatedAt: SAVED_AT }
    writtenVersion = 11

    const res = await PATCH(patchRequest({ open: true, expectedVersion: 7 }))

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    // A version the `{ increment: 1 }` could not have produced from 7. A handler
    // computing `previous + 1` itself would answer 8 here and be wrong, and the
    // next request would send a precondition the database cannot satisfy.
    expect((await readPatchedStatus(res)).version).toBe(11)
  })

  it('should treat a precondition of 0 as "there is no override"', async () => {
    const res = await PATCH(patchRequest({ open: true, expectedVersion: 0 }))

    // No row IS version 0 — which is what the GET publishes as `version` for a
    // flag nobody has overridden. Without that, "no override" would be an absence
    // the client could not express as a precondition at all, and the optimistic
    // concurrency this route depends on would be unusable on a fresh tenant.
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})

describe('PATCH /api/admissions/status - a rejected body never reaches storage', () => {
  /**
   * Every body here is a 400 with zero database calls. `open` is typed
   * `z.boolean()` rather than coerced, because a truthy string from a client
   * that sent `"false"` would open admissions for a school that asked to close
   * them — and the wrong value would be published to parents.
   */
  const REJECTED: Array<{ label: string; body: unknown }> = [
    // Missing the key entirely. `z.object` requires it, so this is refused by
    // the body schema rather than being read as `undefined` and closing
    // admissions by accident.
    { label: '{}', body: {} },
    { label: '{ open: "true" }', body: { open: 'true' } },
    { label: '{ open: "false" }', body: { open: 'false' } },
    { label: '{ open: 1 }', body: { open: 1 } },
    { label: '{ open: 0 }', body: { open: 0 } },
    { label: '{ open: null }', body: { open: null } },
    { label: '{ open: [] }', body: { open: [] } },
    // A precondition the `version` column can never hold. These are bad bodies
    // rather than conflicts a client can ever resolve, and answering 409 would
    // invite an endless resync-and-retry loop.
    { label: '{ open: true, expectedVersion: -1 }', body: { open: true, expectedVersion: -1 } },
    { label: '{ open: true, expectedVersion: 1.5 }', body: { open: true, expectedVersion: 1.5 } },
    { label: '{ open: true, expectedVersion: "1" }', body: { open: true, expectedVersion: '1' } },
    { label: '{ open: true, expectedVersion: null }', body: { open: true, expectedVersion: null } },
  ]

  for (const { label, body } of REJECTED) {
    it(`should answer 400 for ${label} without writing anything`, async () => {
      const res = await PATCH(patchRequest(body))

      expect(res.status).toBe(400)
      const json = await readJson(res)
      expect(json.error).toBe('Invalid request body')
      // The issues, not a bare status: a client that renders "expectedVersion
      // must be non-negative" needs to know WHICH field was refused.
      expect(json.details).toBeArray()
      expect((json.details as unknown[]).length).toBeGreaterThan(0)
      // A 400 that stored a row would let a crafted body change a school's
      // admissions while the client is told the request was refused.
      expect(dbCalls()).toBe(0)
      expect(logAuditEvent).toHaveBeenCalledTimes(0)
    })
  }

  it('should answer 400 rather than 409 for a precondition the column cannot hold', async () => {
    // The distinction, stated as its own case because it is the one that is easy
    // to lose: `z.number().int().nonnegative()` is the ONLY reason `-1` is a
    // 400. Drop `nonnegative()` and `-1` parses, reaches the conflict check,
    // and can never match `row?.version ?? 0` — so the client gets a 409 telling
    // it to resync, retries, and gets another 409 forever. The 409 path is
    // reachable (the stale-precondition block above drives it), so this is a
    // choice between two reachable answers rather than a dead branch.
    const res = await PATCH(patchRequest({ open: true, expectedVersion: -1 }))

    expect(res.status).toBe(400)
  })

  it('should answer 400 for a request with no body at all', async () => {
    // `req.json()` rejects on an empty body and the handler substitutes `{}`,
    // which is the same rejection as an explicit `{}` — a client that sends an
    // empty PATCH should not be able to tell the difference by status.
    const res = await PATCH(
      new NextRequest('http://localhost/api/admissions/status', { method: 'PATCH' })
    )

    expect(res.status).toBe(400)
    expect(dbCalls()).toBe(0)
  })
})

describe('PATCH /api/admissions/status - the response comes from the write, not a read-back', () => {
  it('should report the submitted value even though the only thing storage said was the opposite', async () => {
    row = { value: false, isEditable: true, version: 2, updatedAt: SAVED_AT }
    // `writeOverrideRow`'s `select` is `{ updatedAt, version }` — production
    // cannot hand a written value back from the write, so a read-back is the only
    // other source a handler could reach for. This mock adds one anyway: a
    // handler that read `value` off the write result, or re-read the row, would
    // answer `false` here. The response answers `true`.
    upsert.mockImplementation(function (this: unknown, _args: ConfigArgs) {
      record(this, 'upsert')
      return Promise.resolve({ updatedAt: writtenAt, version: writtenVersion ?? 3, value: false })
    })

    const res = await PATCH(patchRequest({ open: true }))

    expect(res.status).toBe(200)
    expect((await readPatchedStatus(res)).open).toBe(true)
    // And there is no second read to have consulted: the only `findUnique` is
    // the delegated pre-write read, which returned `false`. A handler that
    // re-read after the write to "confirm" the new state would show up here as a
    // second `findUnique`, and a round trip that can observe a concurrent
    // change and answer with a state nobody asked for.
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(steps).toEqual(['transaction', 'findUnique', 'upsert', 'logAuditEvent'])
  })

  it('should report the resolved default, not the submitted value, when the write left no row', async () => {
    // `open: false` is the registry default, so the write deletes rather than
    // storing. The submitted value happens to equal the default here, which is
    // the invariant that makes "no row" and "stored false" the same reader
    // answer — and therefore safe to derive `open` from the write's arms.
    row = { value: true, isEditable: true, version: 6, updatedAt: SAVED_AT }
    removedRows = 1

    const res = await PATCH(patchRequest({ open: false }))

    expect(await readPatchedStatus(res)).toEqual({
      open: false,
      isOverridden: false,
      updatedAt: null,
      version: 0,
    })
  })

  it('should report the timestamp the write returned, not one generated locally', async () => {
    row = { value: false, isEditable: true, version: 4, updatedAt: SAVED_AT }
    writtenAt = new Date('2026-05-06T07:08:09.000Z')

    const res = await PATCH(patchRequest({ open: true }))
    const sent = singleCall('upsert').update?.updatedAt as Date

    // `writeOverrideRow` stamps its own `new Date()` on the upsert, so the value
    // it sends and the value it returns are two different clocks. Reporting the
    // sent one would claim a write time the row does not have, and would differ
    // from what the next GET reports.
    expect(sent).toBeInstanceOf(Date)
    expect(sent.toISOString()).not.toBe(writtenAt.toISOString())
    expect((await readPatchedStatus(res)).updatedAt).toBe(writtenAt.toISOString())
  })

  it('should never report a timestamp for a state with no row behind it', async () => {
    // `isOverridden: false` with a non-null `updatedAt` is the contradictory pair
    // that renders as "someone changed this" with nothing stored to change it
    // back. It is unrepresentable here: the write result is a discriminated
    // union, so the two cannot be assembled independently. Both arms are walked,
    // because only the deletion arm can even reach the contradiction — and it is
    // the one a reset takes.
    for (const [label, previous] of [
      ['no row, submitted default', null],
      ['a row, submitted default (reset)', { value: true, isEditable: true, version: 3, updatedAt: SAVED_AT }],
    ] as const) {
      row = previous as StoredRow | null
      removedRows = previous ? 1 : 0
      const status = await readPatchedStatus(await PATCH(patchRequest({ open: false })))

      // Reported as an object so a failure names which arm produced the bad pair
      // rather than only "expected null, received 2026-…".
      expect({ label, isOverridden: status.isOverridden, updatedAt: status.updatedAt }).toEqual({
        label,
        isOverridden: false,
        updatedAt: null,
      })
    }
  })

  it('should answer a read-only row with 403 and nothing else', async () => {
    // The admissions UI does not offer the control for a locked row, but a
    // crafted request bypasses the UI entirely. The row lock is the tenant's own
    // `isEditable`, so a school can freeze its admissions flag and still read it.
    row = { value: false, isEditable: false, version: 4, updatedAt: SAVED_AT }

    const res = await PATCH(patchRequest({ open: true }))

    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({
      error: `Feature flag '${ADMISSIONS_OPEN_FLAG_KEY}' is read-only`,
    })
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(0)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
  })

  it('should persist a SystemError row for a 500, so the 4xx silences above mean something', async () => {
    // The handler logs the fault through `logError`, which writes a JSON line to
    // stderr. Swallowed here so a deliberately provoked 500 does not look like a
    // real failure in the suite output.
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    try {
      upsert.mockImplementation(function (this: unknown, _args: ConfigArgs) {
        record(this, 'upsert')
        throw new Error('database unavailable')
      })

      const res = await PATCH(patchRequest({ open: true }))

      expect(res.status).toBe(500)
      // The contrast the 4xx assertions rest on: an unexpected fault IS recorded
      // and attributed to the tenant. If this ever stopped being true, "a 403
      // writes no error row" would pass for the wrong reason.
      expect(systemErrorCreate).toHaveBeenCalledTimes(1)
      const errorRow = systemErrorCreate.mock.calls[0][0].data as Record<string, unknown>
      expect(errorRow.tenantId).toBe(SESSION.tenantId)
      expect(errorRow.endpoint).toBe('PATCH /api/admissions/status')
      expect(consoleError).toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('GET /api/admissions/status - the read path resolves, and writes nothing', () => {
  it('should read one row of three columns and touch nothing else', async () => {
    const res = await GET(getRequest())

    expect(res.status).toBe(200)
    // A GET that writes is unusable on a read-only replica and races itself, and
    // this one feeds a switch on a page a member of staff may reload at any
    // moment.
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(0)
    expect($transaction).toHaveBeenCalledTimes(0)
    expect(systemErrorCreate).toHaveBeenCalledTimes(0)
    // No `tenant` relation and no writability lookup: the unique key already
    // scopes the row, and asking whether it is writable would put a second query
    // on a read that the public site also depends on being cheap.
    expect(singleCall('findUnique').select).toEqual({
      value: true,
      updatedAt: true,
      version: true,
    })
  })

  it('should scope the read to the session tenant', async () => {
    await GET(getRequest())

    expect(singleCall('findUnique').where).toEqual({
      tenantId_key: { tenantId: SESSION.tenantId, key: ADMISSIONS_OPEN_FLAG_KEY },
    })
  })

  it('should resolve the registry default when no row exists', async () => {
    row = null

    const status = await readAdmissionsStatus(await GET(getRequest()))

    // A newly created tenant has no `SystemConfig` rows and must still resolve
    // every flag, which is why the registry holds the default and the table holds
    // overrides only. `version: 0` is the token a client echoes back as
    // `expectedVersion`, so "there is no override" has to be expressible as a
    // precondition rather than as an absence.
    expect({ open: status.open, version: status.version, updatedAt: status.updatedAt }).toEqual({
      open: false,
      version: 0,
      updatedAt: null,
    })
  })

  it('should report isOverridden false when no row exists', async () => {
    // A defect that was fixed, kept as a regression guard because the wrong
    // answer here is indistinguishable from the right one except by asserting
    // it. The handler reads `isOverridden: row !== null`; the history of how it
    // came to, and why `!== undefined` was wrong for a `findUnique` result, is
    // below.
    //
    // Prisma's `findUnique` resolves to `null` when there is no record, not to
    // `undefined`. The handler guards with `row !== undefined`, so an absent row
    // is reported as an OVERRIDE. Every other field on this response is
    // null-safe (`row?.updatedAt`, `row?.version`), which is exactly why the one
    // field that is not stands out as an oversight rather than a decision.
    //
    // `lib/system-config.ts` gets the same answer right on its read path by
    // accident of where the row comes from: `resolveFeatureFlags` looks the key
    // up in a `Map`, and a `Map.get` miss IS `undefined`. Copying that
    // `!== undefined` guard onto a `findUnique` result is what broke here.
    //
    // Why it matters and is not cosmetic: the field's own docstring says it is
    // "distinct from `open === false`, which a default-closed tenant also
    // reports". A school that has never touched admissions reports
    // `open: false, isOverridden: true` — an override badge over a row that does
    // not exist, which is the contradictory pair the write path treats as
    // unrepresentable. The one-line fix is in the handler: `isOverridden: row !=
    // null`, or `Boolean(row)`.
    row = null

    const status = await readAdmissionsStatus(await GET(getRequest()))

    expect({ flag: ADMISSIONS_OPEN_FLAG_KEY, isOverridden: status.isOverridden }).toEqual({
      flag: ADMISSIONS_OPEN_FLAG_KEY,
      isOverridden: false,
    })
  })

  it('should resolve a stored row, reporting the version a client can seed from', async () => {
    const STORED_AT = new Date('2026-01-15T08:30:00.000Z')
    row = { value: true, isEditable: true, version: 4, updatedAt: STORED_AT }

    const res = await GET(getRequest())

    expect(await readAdmissionsStatus(res)).toEqual({
      open: true,
      isOverridden: true,
      updatedAt: STORED_AT.toISOString(),
      version: 4,
    })
  })

  it('should resolve a non-boolean stored value to CLOSED, not to its truthiness', async () => {
    // `SystemConfig.value` is an untyped JSON column and nothing at the schema
    // level stops a string or a number landing in it. Truthiness here would
    // publish a school as open when nothing authorised that, and the same row
    // read by the public site falls back to its own fail-closed default — so a
    // truthy answer would have the portal and the application form disagree
    // about whether anyone can apply.
    for (const value of ['true', 'false', 1, 0, 'yes', {}, [], null]) {
      row = { value, isEditable: true, version: 3, updatedAt: SAVED_AT }

      const status = await readAdmissionsStatus(await GET(getRequest()))

      // The ROW still exists, so `isOverridden` and `version` keep reporting it:
      // the value is unreadable, the row is not gone, and a client that loses the
      // concurrency token cannot write safely against a state it cannot see.
      expect({ value, open: status.open, isOverridden: status.isOverridden, version: status.version }).toEqual(
        { value, open: false, isOverridden: true, version: 3 }
      )
    }
  })
})
