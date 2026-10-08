import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test'
import { NextRequest } from 'next/server'
import { DB_QUERY_TIMEOUT_MS } from '@novastar/database'
import { PLATFORM_ROLES, type PlatformRole } from '@/lib/constants/platform-roles'
// Type-only on purpose: `lib/system-config.ts` opens with `import 'server-only'`,
// so a *value* import at this level would load it before `mock.module` below has
// replaced that module and fail with "Cannot find package 'server-only'". The
// two runtime exports this file needs are pulled in dynamically alongside the
// route handlers instead.
import type { FeatureFlagKey } from '@/lib/system-config'

/**
 * Regression cover for `PATCH /api/system/config/:key`.
 *
 * `tests/system-config.test.ts` pins `lib/system-config.ts`, and
 * `tests/middleware.test.ts` pins a different entity-registry route. Neither
 * reaches this handler, and three of the adversarial review rounds against this
 * one file found defects that no test could see — all of them *ordering* or
 * *concurrency* bugs, which are invisible to a test that only inspects return
 * values:
 *
 *   1. The `previous` value was read AFTER the write, so every audit entry read
 *      "updated from X to X" and an auditor could never reconstruct the prior
 *      state. Reading after a reset found no row at all.
 *   2. A reset was audit-logged even when no override row existed, telling an
 *      auditor an override had been reverted when nothing was ever stored.
 *   3. The writability gate and the write were separate round trips, so the gate
 *      could describe a row the write never saw; and two tabs saving the same
 *      flag both wrote, last one silently discarding the first.
 *
 * All three were invisible to `143 pass / 0 fail`. So the tests here assert the
 * *sequence* of the mocked calls, the *handle* each call arrived on, and the
 * *presence or absence* of the audit entry — not just the response body. A
 * response-only test would keep passing through all three regressions.
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

/** The row the single transactional read selects, or null when there is none. */
interface StoredRow {
  value: unknown
  isEditable: boolean
  version: number
  updatedAt: Date
}

/** The timestamp the mocked `upsert` hands back, deliberately not "now". */
const SAVED_AT = new Date('2026-02-03T10:00:00.000Z')

/**
 * A session with the one role the route accepts; overridden per test as needed.
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
 * The receiver of each recorded database call. The regression this file exists
 * for is half about *where* a query ran: a gate read on the pooled client and a
 * write on the transaction are two statements about two moments, so the verdict
 * the gate reached can describe a row the write never saw. Argument assertions
 * cannot see that; only the receiver can.
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

const findMany = mock(async (_args: ConfigArgs): Promise<Array<Record<string, unknown>>> => [])
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
const ROOT_MODEL = { findMany, findUnique, upsert, deleteMany }
const TX_MODEL = { findMany, findUnique, upsert, deleteMany }
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
 * are exposed, so an accidental new database call fails loudly instead of
 * silently returning undefined. `systemConfig` deliberately has no `create` or
 * `update` either: the write path only ever upserts and deletes.
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
const { FEATURE_FLAGS, manageableFlagKeys } = await import('@/lib/system-config')
const { PATCH } = await import('@/app/portal/api/system/config/[key]/route')
const { GET } = await import('@/app/portal/api/system/config/route')

/** A PATCH request carrying `body` as its raw JSON. */
function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/system/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patchRequest(key: string, body: unknown) {
  return PATCH(request(body), { params: Promise.resolve({ key }) })
}

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

/** The `{ flag }` body of a successful PATCH. */
async function readFlag(res: Response) {
  return (await readJson(res)).flag as {
    key: string
    value: unknown
    reset: boolean
    isOverridden: boolean
    updatedAt: string | null
    version: number
  }
}

/** Count every database call and transaction, so a rejected request cannot write. */
function dbCalls(): number {
  return (
    findMany.mock.calls.length +
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

  findMany.mockReset()
  findMany.mockImplementation(async () => [])

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

describe('PATCH /api/system/config/:key - authorization precedes every side effect', () => {
  it('should refuse every role other than HEADMASTER without touching the database', async () => {
    // `isPlatformAdmin` reads `PLATFORM_ADMIN_ROLES`, which is HEADMASTER alone.
    const DENIED = [
      PLATFORM_ROLES.ASSISTANT_HEAD,
      PLATFORM_ROLES.HEAD_TEACHER,
      PLATFORM_ROLES.CLASSROOM_TEACHER,
      PLATFORM_ROLES.ACCOUNTANT,
      PLATFORM_ROLES.ADMIN_STAFF,
      PLATFORM_ROLES.PARENT,
      null,
    ]

    for (const role of DENIED) {
      session = { ...SESSION, role }
      const res = await patchRequest('ai_enabled', { value: true })

      expect(res.status).toBe(403)
      expect(await res.text()).toBe('Forbidden')
      // A denial that reached storage would let a non-Head-of-School flip a
      // platform flag even though the response said no.
      expect(dbCalls()).toBe(0)
      expect(logAuditEvent).toHaveBeenCalledTimes(0)
    }
  })

  it('should let HEADMASTER through, so the denial test above is load-bearing', async () => {
    const res = await patchRequest('ai_enabled', { value: true })

    expect(res.status).toBe(200)
    // If HEADMASTER were refused too, every assertion above would still pass.
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('should answer an unauthenticated session with 401, not a 500', async () => {
    session = new UnauthorizedError()
    const res = await patchRequest('ai_enabled', { value: true })

    // The handler's catch hands the error to `toErrorResponse`, which maps
    // UnauthorizedError to a 401 before it logs or persists anything. Asserting
    // the status is the point: a 500 here would mean an unauthenticated caller
    // is recorded as a platform fault on every probe of the route.
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
    expect(dbCalls()).toBe(0)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
    // Nothing is persisted for an auth failure, so a burst of unauthenticated
    // probes cannot fill the errors page.
    expect(systemErrorCreate).toHaveBeenCalledTimes(0)
  })
})

describe('PATCH /api/system/config/:key - registry membership is checked before storage', () => {
  it('should answer 404 for prototype-chain keys without touching the database', async () => {
    // `FEATURE_FLAGS` is a plain object literal, so a bare index resolves
    // `__proto__` and `constructor` to something truthy. The gate is
    // `Object.hasOwn`, and it has to short-circuit ahead of any lookup.
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const res = await patchRequest(key, { value: true })

      expect(res.status).toBe(404)
      expect(await readJson(res)).toEqual({ error: `Unknown feature flag: ${key}` })
      expect(dbCalls()).toBe(0)
      expect(logAuditEvent).toHaveBeenCalledTimes(0)
    }
  })

  it('should answer 404 without opening a transaction', async () => {
    const res = await patchRequest('not_a_flag', { value: true })

    // A connection is a far more expensive thing to hand a crafted URL segment
    // than a query, so the membership check has to precede the transaction and
    // not merely the first statement inside it.
    expect(res.status).toBe(404)
    expect($transaction).toHaveBeenCalledTimes(0)
    expect(dbCalls()).toBe(0)
  })

  it('should answer 404 for an unknown but harmless key', async () => {
    const res = await patchRequest('not_a_flag', { reset: true })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'Unknown feature flag: not_a_flag' })
    expect(dbCalls()).toBe(0)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
  })

  it('should answer 404 for a prototype-chain key on the reset path too', async () => {
    // The reset branch never reads a value, so a membership gap here would have
    // deleted rows for a key that is not a flag rather than writing one.
    const res = await patchRequest('__proto__', { reset: true })

    expect(res.status).toBe(404)
    expect(dbCalls()).toBe(0)
  })

  it('should accept a registered key, so the 404s above are not vacuous', async () => {
    const res = await patchRequest('ai_enabled', { value: true })

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})

describe('PATCH /api/system/config/:key - a rejected body never reaches storage', () => {
  /**
   * Every body here is a 400 with zero database calls, but they are rejected at
   * two different gates and the client is told which. The distinction matters:
   * "Invalid request body" means the request shape is wrong, "Invalid value"
   * means the flag's own registry schema refused the value — a client that
   * renders these differently should not see them collapse into one.
   */
  const REJECTED: Array<{ label: string; body: unknown; error: string }> = [
    // No `reset` and no `value`: the discriminated union finds nothing to read.
    { label: '{}', body: {}, error: 'Invalid request body' },
    // A write with no value at all. `z.unknown()` in zod 4 still requires the key,
    // so this is refused by the body schema rather than by the flag's schema.
    { label: '{ reset: false }', body: { reset: false }, error: 'Invalid request body' },
    { label: '{ reset: "yes" }', body: { reset: 'yes' }, error: 'Invalid request body' },
    { label: '"hello"', body: 'hello', error: 'Invalid request body' },
    { label: '42', body: 42, error: 'Invalid request body' },
    { label: '[]', body: [], error: 'Invalid request body' },
    { label: 'null', body: null, error: 'Invalid request body' },
    // These carry a `value`, so the body shape is fine and the flag's own
    // `z.boolean()` is what refuses. Every registered flag is a boolean.
    { label: '{ value: null }', body: { value: null }, error: 'Invalid value' },
    { label: '{ value: {} }', body: { value: {} }, error: 'Invalid value' },
    { label: '{ value: [] }', body: { value: [] }, error: 'Invalid value' },
    { label: '{ value: "true" }', body: { value: 'true' }, error: 'Invalid value' },
    // A precondition that could never match a stored version. The column is
    // non-negative, so these are bad bodies rather than conflicts the client can
    // ever resolve, and answering 409 would invite an endless retry loop.
    { label: '{ value: true, expectedVersion: -1 }', body: { value: true, expectedVersion: -1 }, error: 'Invalid request body' },
    { label: '{ value: true, expectedVersion: 1.5 }', body: { value: true, expectedVersion: 1.5 }, error: 'Invalid request body' },
    { label: '{ reset: true, expectedVersion: "1" }', body: { reset: true, expectedVersion: '1' }, error: 'Invalid request body' },
    { label: '{ reset: true, expectedVersion: null }', body: { reset: true, expectedVersion: null }, error: 'Invalid request body' },
  ]

  for (const { label, body, error } of REJECTED) {
    it(`should answer 400 for ${label} without writing anything`, async () => {
      const res = await patchRequest('ai_enabled', body)

      expect(res.status).toBe(400)
      const json = await readJson(res)
      expect(json.error).toBe(error)
      // A 400 that stored a row would let a crafted body change a flag while the
      // client is told the request was refused.
      expect(json.details).toBeArray()
      expect((json.details as unknown[]).length).toBeGreaterThan(0)
      expect(dbCalls()).toBe(0)
      expect(logAuditEvent).toHaveBeenCalledTimes(0)
    })
  }

  it('should answer 400 for a request with no body at all', async () => {
    // `req.json()` rejects on an empty body and the handler substitutes `{}`,
    // which is the same rejection as an explicit `{}` — a client that sends an
    // empty PATCH should not be able to tell the difference by status.
    const res = await PATCH(new NextRequest('http://localhost/api/system/config', { method: 'PATCH' }), {
      params: Promise.resolve({ key: 'ai_enabled' }),
    })

    expect(res.status).toBe(400)
    expect(dbCalls()).toBe(0)
  })

  it('should answer 400 for an unparseable body without writing anything', async () => {
    const res = await PATCH(
      new NextRequest('http://localhost/api/system/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
      { params: Promise.resolve({ key: 'ai_enabled' }) }
    )

    expect(res.status).toBe(400)
    expect(dbCalls()).toBe(0)
  })
})

describe('PATCH /api/system/config/:key - a read-only flag is refused before storage', () => {
  it('should answer 403 for a write to a flag the stored row locks', async () => {
    row = { value: false, isEditable: false, version: 1, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { value: true })

    // The UI greys the control out, but a crafted request bypasses the UI
    // entirely — without this gate the `isEditable` column is theatre.
    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({ error: "Feature flag 'ai_enabled' is read-only" })
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(0)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
    // One read, selecting every column the gate and the audit line need — not
    // the whole row, which would drag `id` and `tenantId` over the wire.
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(findUnique.mock.calls[0][0].select).toEqual({
      value: true,
      isEditable: true,
      version: true,
      updatedAt: true,
    })
  })

  it('should answer 403 for a reset of a flag the stored row locks', async () => {
    row = { value: true, isEditable: false, version: 3, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { reset: true })

    expect(res.status).toBe(403)
    // The reset branch deletes rather than writes, so without this assertion a
    // locked flag could be silently cleared.
    expect(deleteMany).toHaveBeenCalledTimes(0)
    expect(upsert).toHaveBeenCalledTimes(0)
  })

  it('should enforce the gate inside the transaction, before any write', async () => {
    row = { value: false, isEditable: false, version: 1, updatedAt: SAVED_AT }
    await patchRequest('ai_enabled', { value: true })

    // The gate has to describe the row the write would reach. A gate read on the
    // pooled client and a write on the transaction are two statements about two
    // moments, and a request landing between them could unlock the row the gate
    // just refused — or lock the row the gate just allowed.
    expect(steps).toEqual(['transaction', 'findUnique'])
    expect(receivers).toEqual(['transaction'])
  })

  it('should not report a version for a flag it refuses to write', async () => {
    row = { value: false, isEditable: false, version: 9, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { value: true, expectedVersion: 9 })

    // 403, not 409: a locked flag has no version worth reporting, and telling
    // the client to resync and retry would invite a retry that can never succeed.
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/system/config/:key - the gate and the write share one transaction', () => {
  it('should run the read and the write on the transaction handle', async () => {
    const res = await patchRequest('ai_enabled', { value: true })

    expect(res.status).toBe(200)
    // THE regression. With the read hoisted onto the pooled client above the
    // transaction, `receivers` is ['root', 'transaction'] and this fails.
    expect(steps).toEqual(['transaction', 'findUnique', 'upsert', 'logAuditEvent'])
    expect(receivers).toEqual(['transaction', 'transaction'])
  })

  it('should read the row exactly once for the whole change', async () => {
    await patchRequest('ai_enabled', { value: true })

    // Three reads is what this replaced — one for the gate, one for the previous
    // value, one implied for the version. Each is a statement about a slightly
    // different moment, which is the gap a concurrent request slips into.
    expect(findUnique).toHaveBeenCalledTimes(1)
  })

  it('should open exactly one transaction for the whole change', async () => {
    await patchRequest('ai_enabled', { value: true })

    // A second transaction would be a second connection for a change the gate,
    // the precondition and the write all have to agree about.
    expect($transaction).toHaveBeenCalledTimes(1)
  })

  it('should bound the transaction so a stalled database cannot hang the request', async () => {
    await patchRequest('ai_enabled', { value: true })

    const bounds = $transaction.mock.calls[0][1] as { maxWait?: number; timeout?: number } | undefined
    // The Neon adapter turns every statement into a network round trip, so an
    // unbounded interactive transaction holds a pooled connection — and this
    // request — open for however long the database feels like answering.
    expect(bounds).toBeDefined()
    expect(bounds?.maxWait).toBeGreaterThan(0)
    expect(bounds?.timeout).toBeGreaterThan(0)
    // Above the per-query deadline, and deliberately so. A ceiling at or below it
    // would expire first and turn a legible "the database did not answer" into
    // Prisma's opaque "transaction closed", so the ceiling has to leave room for
    // every query in the body to reach its own deadline first.
    expect(bounds?.timeout).toBeGreaterThan(DB_QUERY_TIMEOUT_MS)
  })

  it('should scope the single read to the session tenant and the flag', async () => {
    await patchRequest('ai_enabled', { value: true })

    // An unscoped read would compare one tenant's flag against another's, and
    // the resulting `from` and version would be an unrelated school's.
    expect(singleCall('findUnique').where).toEqual({
      tenantId_key: { tenantId: SESSION.tenantId, key: 'ai_enabled' },
    })
  })

  it('should upsert against the session tenant, never a defaulted or body-supplied one', async () => {
    const res = await patchRequest('ai_enabled', { value: true, tenantId: 'tenant-from-the-body' })

    expect(res.status).toBe(200)
    const arg = singleCall('upsert')
    // A dropped or defaulted tenantId here would cross-wire one school's platform
    // settings into another's. This is the highest-severity thing these tests guard.
    expect(arg.where).toEqual({ tenantId_key: { tenantId: SESSION.tenantId, key: 'ai_enabled' } })
    expect(arg.create?.tenantId).toBe(SESSION.tenantId)
    expect(arg.update?.value).toBe(true)
  })

  it('should read the previous value before the write, from the same read', async () => {
    row = { value: false, isEditable: true, version: 2, updatedAt: SAVED_AT }
    await patchRequest('ai_enabled', { value: true })

    // The gate's row and the audit's row are one read. A read-back after the
    // upsert would return the value just written and every audit entry would
    // read "updated from true to true".
    expect(steps).toEqual(['transaction', 'findUnique', 'upsert', 'logAuditEvent'])
  })
})

describe('PATCH /api/system/config/:key - a stale precondition is refused, not applied', () => {
  it('should answer 409 when the stored version has moved on', async () => {
    row = { value: false, isEditable: true, version: 9, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { value: true, expectedVersion: 7 })

    // THE regression. Without the precondition the second tab's write lands and
    // the first tab's is silently gone — the row looks exactly as though only one
    // change was ever made, and so does the audit trail.
    expect(res.status).toBe(409)
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(0)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
  })

  it('should report the version that is actually stored, not the caller’s', async () => {
    row = { value: false, isEditable: true, version: 9, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { value: true, expectedVersion: 7 })

    // 9 and not 7: echoing the caller's own stale number would tell the client to
    // resync to the state it already had, and its retry would overwrite the
    // change it just collided with.
    expect(await readJson(res)).toEqual({
      error: "Feature flag 'ai_enabled' was changed by another session",
      details: { currentVersion: 9 },
    })
  })

  it('should proceed when the precondition matches', async () => {
    row = { value: false, isEditable: true, version: 7, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { value: true, expectedVersion: 7 })

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('should treat a precondition of 0 as "there is no override"', async () => {
    const res = await patchRequest('ai_enabled', { value: true, expectedVersion: 0 })

    // No row IS version 0. Without that, "no override" would be an absence a
    // client could not express as a precondition at all.
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('should refuse a stale precondition on the reset path too', async () => {
    row = { value: true, isEditable: true, version: 3, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { reset: true, expectedVersion: 2 })

    // A reset can be made stale exactly as a write can. Without this, a stale
    // tab could delete an override that had been changed since it last looked.
    expect(res.status).toBe(409)
    expect(deleteMany).toHaveBeenCalledTimes(0)
  })

  it('should still write when no precondition is supplied', async () => {
    row = { value: false, isEditable: true, version: 9, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { value: true })

    // Absent means "not requested", not "must match zero". Making the
    // precondition mandatory would break every existing client — the schema
    // change makes the safe path available, it does not force it.
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('should check the gate before the precondition', async () => {
    row = { value: false, isEditable: false, version: 9, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { value: true, expectedVersion: 7 })

    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/system/config/:key - the version moves the way the column does', () => {
  it('should report version 1 for a first override, not 0', async () => {
    const res = await patchRequest('ai_enabled', { value: true })
    const flag = await readFlag(res)

    // 0 is what an ABSENT row means. Creating at 0 would make a flag somebody
    // has just overridden indistinguishable from one nobody ever touched, and a
    // tab holding 0 could then overwrite the override.
    expect(singleCall('upsert').create?.version).toBe(1)
    expect(flag.version).toBe(1)
  })

  it('should report the incremented version on a later write', async () => {
    row = { value: false, isEditable: true, version: 4, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { value: true })
    const flag = await readFlag(res)

    // `{ increment: 1 }` rather than an assigned number: the new value is derived
    // from the row the transaction read, so a caller cannot pin it backwards.
    expect(singleCall('upsert').update?.version).toEqual({ increment: 1 })
    expect(flag.version).toBe(5)
  })

  it('should report the version the write returned, not one computed locally', async () => {
    row = { value: false, isEditable: true, version: 4, updatedAt: SAVED_AT }
    // A version the `{ increment: 1 }` could not have produced from 4. A handler
    // computing `previous + 1` itself would answer 5 here and be wrong.
    writtenVersion = 9
    writtenAt = new Date('2026-03-04T11:22:33.000Z')
    const res = await patchRequest('ai_enabled', { value: true })
    const flag = await readFlag(res)

    expect(flag.version).toBe(9)
    expect(flag.updatedAt).toBe('2026-03-04T11:22:33.000Z')
  })

  it('should report version 0 after a reset, because the row is gone', async () => {
    row = { value: true, isEditable: true, version: 6, updatedAt: SAVED_AT }
    removedRows = 1
    const res = await patchRequest('ai_enabled', { reset: true })
    const flag = await readFlag(res)

    // This is the mechanism by which a reset invalidates other tabs' held
    // preconditions: a tab that saw version 6 can no longer match anything.
    expect(flag.version).toBe(0)
  })
})

/**
 * The storage transitions this route can make, each with the audit entry it must
 * or must not produce and the body it must answer with. `ai_enabled` defaults to
 * `false`, so `true` is a real override and `false` is a reset. A stored row
 * starts at version 2, so every write here answers version 3 and every reset 0.
 */
const WRITE_CASES = [
  {
    name: 'no row, save a non-default value',
    body: { value: true },
    previous: null,
    removed: 0,
    audited: true,
    changes: { from: false, to: true },
    description: "Feature flag 'ai_enabled' updated from false to true",
    response: {
      key: 'ai_enabled',
      value: true,
      reset: false,
      isOverridden: true,
      updatedAt: SAVED_AT.toISOString(),
      version: 1,
    },
    steps: ['transaction', 'findUnique', 'upsert', 'logAuditEvent'] as Step[],
  },
  {
    name: 'a row already holds the submitted value',
    body: { value: true },
    previous: { value: true },
    removed: 0,
    // THE original regression. The write still happens — `true` differs from the
    // registry default of `false`, so an override row is correct — but storage
    // did not move in any way an auditor cares about, and an entry reading
    // "updated from true to true" is pure noise in a tamper-evident chain.
    audited: false,
    response: {
      key: 'ai_enabled',
      value: true,
      reset: false,
      isOverridden: true,
      updatedAt: SAVED_AT.toISOString(),
      version: 3,
    },
    steps: ['transaction', 'findUnique', 'upsert'] as Step[],
  },
  {
    name: 'a row exists, save the registry default',
    body: { value: false },
    previous: { value: true },
    removed: 1,
    audited: true,
    changes: { from: true, to: false },
    // The request did not ask for a reset and the response reports
    // `reset: false`, yet the stored outcome is a reset. A save that lands on
    // the default IS a reset, and the audit line has to say so.
    description: "Feature flag 'ai_enabled' reset to default",
    response: {
      key: 'ai_enabled',
      value: false,
      reset: false,
      isOverridden: false,
      updatedAt: null,
      version: 0,
    },
    steps: ['transaction', 'findUnique', 'deleteMany', 'logAuditEvent'] as Step[],
  },
  {
    name: 'a row exists holding a different value, but the delete removes nothing',
    body: { value: false },
    previous: { value: true },
    removed: 0,
    // A concurrent reset landing between the read and the delete. The value the
    // reader would report has not moved and no row was removed, so nothing
    // happened — but `from !== resolvedValue` is true here, which makes this the
    // one case where the `removed > 0` half of the guard is the only thing
    // standing between the handler and an entry falsely claiming an override
    // was reverted. Dropping that half audits this case; keeping it does not.
    audited: false,
    response: {
      key: 'ai_enabled',
      value: false,
      reset: false,
      isOverridden: false,
      updatedAt: null,
      version: 0,
    },
    steps: ['transaction', 'findUnique', 'deleteMany'] as Step[],
  },
  {
    name: 'no row, reset',
    body: { reset: true },
    previous: null,
    removed: 0,
    // THE other original regression. There was never an override to revert, so
    // an entry claiming one was reverted is a false record in the one log an
    // auditor is meant to be able to trust.
    audited: false,
    response: {
      key: 'ai_enabled',
      value: false,
      reset: true,
      isOverridden: false,
      updatedAt: null,
      version: 0,
    },
    steps: ['transaction', 'findUnique', 'deleteMany'] as Step[],
  },
  {
    name: 'no row, save the registry default',
    body: { value: false },
    previous: null,
    removed: 0,
    // Nothing was stored and nothing needed to be. The honest outcome is the
    // no-op, with no entry to write about it.
    audited: false,
    response: {
      key: 'ai_enabled',
      value: false,
      reset: false,
      isOverridden: false,
      updatedAt: null,
      version: 0,
    },
    steps: ['transaction', 'findUnique', 'deleteMany'] as Step[],
  },
] as const

/** Put the case's stored row in place before the request. */
function arrange(c: (typeof WRITE_CASES)[number]) {
  row = c.previous
    ? { value: c.previous.value, isEditable: true, version: 2, updatedAt: SAVED_AT }
    : null
  removedRows = c.removed
}

describe('PATCH /api/system/config/:key - the audit fires only on a real change', () => {
  for (const c of WRITE_CASES) {
    it(`should ${c.audited ? 'write an audit entry when' : 'write no audit entry when'} ${c.name}`, async () => {
      arrange(c)
      const res = await patchRequest('ai_enabled', c.body)

      expect(res.status).toBe(200)

      if (!c.audited) {
        expect(logAuditEvent).toHaveBeenCalledTimes(0)
        return
      }

      expect(logAuditEvent).toHaveBeenCalledTimes(1)
      const entry = logAuditEvent.mock.calls[0][0]
      expect(entry.action).toBe(AuditLogAction.SYSTEM_UPDATE)
      expect(entry.entity).toBe('feature_flag')
      expect(entry.entityId).toBe('ai_enabled')
      expect(entry.description).toBe(c.description)
      // `changes` is what `logger.ts` folds into the entry's chain hash, so the
      // from/to pair has to be present or the description could be rewritten in
      // the database without breaking the chain.
      expect(entry.changes).toEqual(c.changes)
    })
  }

  it('should run the same steps for every case, so the audit cases are not special', async () => {
    for (const c of WRITE_CASES) {
      arrange(c)
      steps = []
      await patchRequest('ai_enabled', c.body)
      expect(steps).toEqual(c.steps)
    }
  })

  it('should attribute the audit entry to the session that made the change', async () => {
    row = null
    await patchRequest('ai_enabled', { value: true })

    const entry = logAuditEvent.mock.calls[0][0]
    // Audit rows are read back per tenant. An entry filed under the wrong
    // tenant is invisible to the school that made the change, and visible to a
    // school that did not.
    expect(entry.tenantId).toBe(SESSION.tenantId)
    expect(entry.userId).toBe(SESSION.userId)
    expect(entry.schoolId).toBe(SESSION.schoolId)
  })

  it('should still store the write when the audit is suppressed', async () => {
    // The gate is on the audit entry, not on the mutation. Suppressing the entry
    // must not turn "saving the value you already have" into a failed save.
    row = { value: true, isEditable: true, version: 2, updatedAt: SAVED_AT }
    const res = await patchRequest('ai_enabled', { value: true })

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
  })
})

describe('PATCH /api/system/config/:key - response contract', () => {
  for (const c of WRITE_CASES) {
    it(`should answer the exact flag body for: ${c.name}`, async () => {
      arrange(c)
      const res = await patchRequest('ai_enabled', c.body)

      expect(res.status).toBe(200)
      // Exactly these six keys. An extra one would be a leak of storage detail
      // (the delete count, the stored row) that the settings page does not model.
      expect(await readJson(res)).toEqual({ flag: c.response })
    })
  }

  it('should never report a timestamp for a flag that is not overridden', async () => {
    // `isOverridden: false` with a non-null `updatedAt` is the contradictory pair
    // that renders as an "Overridden" badge with no row behind it. It is
    // unrepresentable: the write result is a discriminated union, so the two
    // cannot be assembled independently.
    for (const c of WRITE_CASES) {
      arrange(c)
      const res = await patchRequest('ai_enabled', c.body)
      const flag = await readFlag(res)

      if (flag.isOverridden === false) {
        expect(flag.updatedAt).toBeNull()
      } else {
        expect(flag.updatedAt).toBe(SAVED_AT.toISOString())
      }
    }
  })

  it('should report the timestamp the write returned, not one generated locally', async () => {
    const res = await patchRequest('ai_enabled', { value: true })
    const flag = await readFlag(res)

    // `writeOverrideRow` stamps its own `new Date()` on the upsert, so the value
    // it sends and the value it returns are two different clocks. If the handler
    // reported the sent one, the response would claim a write time the row does
    // not have — and would differ from what the next GET reports.
    const sent = singleCall('upsert').update?.updatedAt as Date
    expect(sent).toBeInstanceOf(Date)
    expect(sent.toISOString()).not.toBe(SAVED_AT.toISOString())
    expect(flag.updatedAt).toBe(SAVED_AT.toISOString())
  })

  it('should report the key it was asked about, not one echoed from the body', async () => {
    const res = await patchRequest('sso_google', { value: true, key: 'ai_enabled' })
    const flag = await readFlag(res)

    // The URL segment is the authority. A body-supplied key would let one
    // request write a different flag than the one it appears to address.
    expect(flag.key).toBe('sso_google')
    expect(flag.value).toBe(true)
  })

  it('should report the resolved value for a flag whose default is true', async () => {
    // offline_mode defaults to true, so storing true stores nothing. The
    // response has to say "resolved to true, not overridden" rather than treat
    // a successful save as a failure.
    row = { value: false, isEditable: true, version: 4, updatedAt: SAVED_AT }
    removedRows = 1
    const res = await patchRequest('offline_mode', { value: true })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      flag: {
        key: 'offline_mode',
        value: true,
        reset: false,
        isOverridden: false,
        updatedAt: null,
        version: 0,
      },
    })
    expect(singleCall('deleteMany').where).toEqual({
      tenantId: SESSION.tenantId,
      key: 'offline_mode',
    })
  })

  it('should persist a SystemError row for a 500, so the 4xx silence above means something', async () => {
    // The handler logs the fault through `logError`, which writes a JSON line to
    // stderr. Swallowed here so a deliberately provoked 500 does not look like a
    // real failure in the suite output.
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    try {
      $transaction.mockImplementation(async (fn: (tx: typeof TX_CLIENT) => Promise<unknown>) => {
        steps.push('transaction')
        return fn(TX_CLIENT)
      })
      upsert.mockImplementation(function (this: unknown, _args: ConfigArgs) {
        record(this, 'upsert')
        throw new Error('database unavailable')
      })

      const res = await patchRequest('ai_enabled', { value: true })

      expect(res.status).toBe(500)
      // The contrast the 4xx assertions rest on: an unexpected fault IS recorded
      // and attributed to the tenant. If this ever stopped being true, "a 4xx
      // writes no error row" would pass for the wrong reason.
      expect(systemErrorCreate).toHaveBeenCalledTimes(1)
      const errorRow = systemErrorCreate.mock.calls[0][0].data as Record<string, unknown>
      expect(errorRow.tenantId).toBe(SESSION.tenantId)
      expect(errorRow.endpoint).toBe('PATCH /api/system/config/ai_enabled')
      expect(consoleError).toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('GET /api/system/config - the read path is read-only', () => {
  it('should read once and write nothing', async () => {
    findMany.mockImplementation(async () => [])

    const res = await GET(new NextRequest('http://localhost/api/system/config'))

    expect(res.status).toBe(200)
    // A GET that writes is unusable on a read-only replica and races itself.
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(0)
    expect(systemErrorCreate).toHaveBeenCalledTimes(0)
    expect($transaction).toHaveBeenCalledTimes(0)
  })

  it('should read the flags of the session tenant only', async () => {
    findMany.mockImplementation(async () => [])

    await GET(new NextRequest('http://localhost/api/system/config'))

    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: SESSION.tenantId })
  })

  it('should answer every registered flag that this caller may write, without consulting the writability gate', async () => {
    findMany.mockImplementation(async () => [])

    const res = await GET(new NextRequest('http://localhost/api/system/config'))
    const json = (await readJson(res)) as { flags: Array<{ key: string }> }

    // One query for the whole catalogue. A gate lookup per flag would make the
    // read scale with the registry and reintroduce a write on the read path.
    //
    // Six, and NOT seven, although `FEATURE_FLAGS` holds seven entries. The
    // registry is seven long because `admissions_open` is registered — it needs
    // a default, a description and a schema so `resolveFeatureFlags` and the
    // dedicated route can resolve it — but its entry declares `manageRoles: []`,
    // and this GET filters to `manageableFlagKeys(session.role)`. HEADMASTER is
    // the widest role the read admits (a 403 comes before the filter), and it is
    // in nobody's `manageRoles`, so the flag drops out for EVERY caller. That is
    // the design working: one writer per flag means one audit action, and a
    // switch on the platform page would be a second door to the same state that
    // ADMIN_STAFF could reach.
    //
    // What would make this wrong again, in the order it is likely: a second
    // entry declaring `manageRoles: []` (7 again, and the pair of assertions
    // below is what makes the next reader check the list rather than the count);
    // someone giving `admissions_open` a non-empty `manageRoles` (still 6, but
    // now because a door opened rather than because none exists — the single-
    // writer block at the end of this file is the tripwire for that); or the
    // filter being dropped from the handler (7 again).
    expect(json.flags).toHaveLength(6)
    expect(findUnique).toHaveBeenCalledTimes(0)
  })

  it('should report a version on every flag so a client can seed its precondition', async () => {
    const STORED_AT = new Date('2026-01-15T08:30:00.000Z')
    findMany.mockImplementation(async () => [
      { key: 'ai_enabled', value: true, isEditable: true, updatedAt: STORED_AT, version: 4 },
    ])

    const res = await GET(new NextRequest('http://localhost/api/system/config'))
    const json = (await readJson(res)) as { flags: Array<{ key: string; version: number }> }

    const ai = json.flags.find((f) => f.key === 'ai_enabled')
    const saml = json.flags.find((f) => f.key === 'sso_saml')
    // The stored counter, and 0 for a flag with no row. A read path that
    // omitted the field would leave a client unable to express "there is no
    // override" as a precondition at all.
    expect(ai?.version).toBe(4)
    expect(saml?.version).toBe(0)
    for (const flag of json.flags) {
      expect(typeof flag.version).toBe('number')
    }
  })
it('should serve the registry metadata with the server-side fields stripped', async () => {
    findMany.mockImplementation(async () => [])

    const res = await GET(new NextRequest('http://localhost/api/system/config'))
    const json = (await readJson(res)) as {
      definitions: Record<string, Record<string, unknown>>
    }

    // The ROUTE is where the invariant has to hold. Asserting it on
    // `featureFlagDefinitions()` alone proves only that the projector redacts:
    // the handler is free to send `FEATURE_FLAGS` instead, and it did — which
    // hands every client the zod schema (`schema` serialises to `{}`, so the
    // redaction is invisible unless the key set is checked) and the registry's
    // `isEditable` lock, the two fields the projector exists to keep server-side.
    const definitions = json.definitions
    expect(Object.keys(definitions).length).toBeGreaterThan(0)

    for (const key of Object.keys(definitions)) {
      expect({ key, served: Object.keys(definitions[key]).sort() }).toEqual({
        key,
        served: ['category', 'defaultValue', 'description'],
      })
    }
    // And nothing outside the registry is described to anyone.
    for (const key of Object.keys(definitions)) {
      expect(Object.hasOwn(FEATURE_FLAGS, key)).toBe(true)
    }
  })
})

describe('PATCH /api/system/config/:key - flag keys come from the registry only', () => {
  /**
   * The keys this route admits a HEADMASTER write for, written out by hand.
   *
   * Hand-written rather than derived from the response or from
   * `manageableFlagKeys`, because deriving it would make the assertion agree with
   * whatever the registry happens to say — the failure mode every other assertion
   * in this file is written against. Six entries, seven in `FEATURE_FLAGS` — the
   * missing one is `admissions_open`, and it is missing ON PURPOSE. It is
   * registered, so it must never be added here: this route refuses it with 403
   * and a pointer to `PATCH /api/admissions/status`, which the block at the end of
   * this file pins.
   *
   * Every entry below is sent to the route, so the list is a claim about the
   * handler rather than a note about it. A list of names that is only ever
   * counted can be wrong in every direction at once and still pass.
   */
  const ADMITTED_KEYS: FeatureFlagKey[] = [
    'ai_enabled',
    'sms_enabled',
    'offline_mode',
    'sso_google',
    'sso_microsoft',
    'sso_saml',
  ]

  it('should admit every key on the list above, rather than 404ing one of them', async () => {
    for (const key of ADMITTED_KEYS) {
      const res = await patchRequest(key, { value: true })

      // A registered, editable flag is written and answered 200 — or, for
      // `offline_mode`, whose default is already true, reset and answered 200.
      // Either way it is NOT the 404 an unregistered key gets, which is the only
      // thing this assertion is about: the list and the handler agree.
      expect({ key, status: res.status, reported: (await readFlag(res)).key }).toEqual({
        key,
        status: 200,
        reported: key,
      })
    }
  })

  it('should answer 404 for a key this registry never registered', async () => {
    // A crafted segment, and the prototype-chain keys beside it in the block
    // above. It never existed, which is exactly why it proves nothing about a
    // registry that CHANGED: see the next test for that.
    const res = await patchRequest('legacy_2fa', { value: true })

    expect(res.status).toBe(404)
    expect(dbCalls()).toBe(0)
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('should refuse a key the registry has since removed', async () => {
    // The regression this block is really for: an old bookmark or a stale client
    // must get a 404, not a write against a key nothing resolves any more. It is
    // provoked by removing a REAL entry rather than by naming a key that never
    // existed, because a never-existed key cannot tell "the registry dropped it"
    // from "the registry never had it" — and it stays green if the membership
    // check is deleted outright, since `FEATURE_FLAGS[key]` would then be the
    // inherited `Object.prototype.constructor` (truthy) and the write would
    // continue.
    const registry = FEATURE_FLAGS as unknown as Record<string, unknown>
    const original = { ...FEATURE_FLAGS }
    const key = 'sms_enabled'
    delete registry[key]
    try {
      const res = await patchRequest(key, { value: true })

      expect(res.status).toBe(404)
      // Zero storage, and zero connections: membership is settled before
      // anything is read or written.
      expect(dbCalls()).toBe(0)
      expect(logAuditEvent).not.toHaveBeenCalled()
      // The error names the key, so the stale client can see what it asked for.
      expect(await readJson(res)).toEqual({ error: `Unknown feature flag: ${key}` })
    } finally {
      // Reinsert in the ORIGINAL order, not just the original contents:
      // `manageableFlagKeys` and `resolveFeatureFlags` both iterate the registry
      // with `Object.keys`, which is insertion order, so a plain
      // `registry[key] = entry` would move this flag to the end and fail every
      // order-sensitive assertion in the file for a reason that has nothing to do
      // with what they test.
      for (const existing of Object.keys(registry)) delete registry[existing]
      Object.assign(registry, original)
    }
  })

  it('should list exactly the keys this route admits a HEADMASTER write for', async () => {
    // The hand-written list above is only correct while it matches the gate, and
    // the gate is production code that can change on its own — someone widening
    // `PLATFORM_ADMIN_ROLES`, or giving a flag its own `manageRoles`. This is the
    // cross-check that turns "the list looks right" into "the list is right", and
    // it fails on either direction: a new writable flag nobody listed here, and a
    // listed flag that stopped being writable.
    expect(manageableFlagKeys(PLATFORM_ROLES.HEADMASTER)).toEqual([
      'ai_enabled',
      'sms_enabled',
      'offline_mode',
      'sso_google',
      'sso_microsoft',
      'sso_saml',
    ])
  })
})

describe('admissions_open has exactly one writer, and it is not this route', () => {
  it('should refuse a PATCH to admissions_open with a pointer, for HEADMASTER', async () => {
    const res = await patchRequest('admissions_open', { value: true })

    // The registry entry declares `manageRoles: []`, which `canManageFlag` reads
    // as "no role may write this here". HEADMASTER is the widest role this route
    // knows, so if the empty set has stopped being meaningful, this is the
    // request that proves it — and it is also the request whose disappearance
    // would put a second writer on the flag.
    expect(res.status).toBe(403)
    // Not a bare 403: a client pointed at the wrong door needs to be told which
    // one is right, and this is the only place that says so.
    expect(await readJson(res)).toEqual({
      error: "Feature flag 'admissions_open' is managed by PATCH /api/admissions/status",
    })
    // Refused before the body was read and before a transaction was opened, so a
    // crafted request costs zero connections as well as zero writes.
    expect(dbCalls()).toBe(0)
    expect(logAuditEvent).toHaveBeenCalledTimes(0)
  })

  it('should refuse it for ADMIN_STAFF and ADMISSIONS_OFFICER too', async () => {
    // The regression this whole block exists for. Both roles may open and close
    // admissions — that is the widening the feature is for, and it is deliberate.
    // What must not follow from it is the flag becoming reachable through the
    // generic route as well: two writers for one flag produce two audit lines
    // (`ADMISSIONS_TOGGLE` and `SYSTEM_UPDATE`) that disagree about who changed
    // what, with nothing in the data to arbitrate. A 403 here is what keeps the
    // write count at one.
    for (const role of [PLATFORM_ROLES.ADMIN_STAFF, PLATFORM_ROLES.ADMISSIONS_OFFICER]) {
      session = { ...SESSION, role }

      const res = await patchRequest('admissions_open', { value: true })

      expect({ role, status: res.status }).toEqual({ role, status: 403 })
      expect(dbCalls()).toBe(0)
      expect(logAuditEvent).toHaveBeenCalledTimes(0)
    }
  })

  it('should still register the flag, so the dedicated route can resolve its default', async () => {
    // Refused and hidden are different things. The flag has to STAY in the
    // registry — the default, the description and the schema all live there, and
    // `applyFeatureFlagChange` refuses an unregistered key — or the dedicated
    // route 500s on a key nobody can write through either door.
    expect(Object.hasOwn(FEATURE_FLAGS, 'admissions_open')).toBe(true)
  })

  it('should omit admissions_open from the catalogue it serves to HEADMASTER', async () => {
    findMany.mockImplementation(async () => [
      { key: 'admissions_open', value: true, isEditable: true, updatedAt: SAVED_AT, version: 5 },
    ])

    const res = await GET(new NextRequest('http://localhost/api/system/config'))
    const json = (await readJson(res)) as { flags: Array<{ key: string; value: unknown }> }

    // A stored override row exists and is still not served. The filter is on what
    // the CALLER may write, not on whether a row happens to exist, so a flag
    // owned elsewhere cannot reappear on this page by being changed — which is
    // the drift this pin stops: a switch on the platform settings page that
    // ADMIN_STAFF can reach, saving a flag whose history is filed under a
    // different audit action.
    expect(json.flags.map((f) => f.key)).toEqual([
      'ai_enabled',
      'sms_enabled',
      'offline_mode',
      'sso_google',
      'sso_microsoft',
      'sso_saml',
    ])
    expect(json.flags.some((f) => f.key === 'admissions_open')).toBe(false)
  })
})