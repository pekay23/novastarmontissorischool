import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { DB_QUERY_TIMEOUT_MS } from '@novastar/database'
import { PLATFORM_ADMIN_ROLES, PLATFORM_ROLES } from '@/lib/constants/platform-roles'
import type { FeatureFlagKey } from '@/lib/system-config'

/**
 * Regression cover for the feature-flag platform configuration.
 *
 * Every test here pins an invariant that two adversarial review rounds found
 * broken with no failing test: a save-to-default wrote a mirror override row
 * that shadowed later default changes, and prototype-chain keys passed registry
 * membership because `in` and a bare index both resolve inherited keys on a
 * plain object literal. Both produced wrong behaviour silently, so both are
 * asserted on directly rather than inferred from a returned value.
 *
 * A third round found two more, both invisible to a test that only inspects
 * return values: the writability gate and the write were separate round trips
 * (a TOCTOU), and two tabs saving the same flag both wrote with nothing to
 * detect the second. So the transactional assertions below track *which client
 * handle* each call arrived on and *in what order*, not just what came back.
 */

/** Keys that exist on `Object.prototype` but are not flags. */
const PROTO_KEYS = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'] as const

/** A row as `resolveFeatureFlags` selects it. */
interface ConfigRow {
  key: string
  value: unknown
  isEditable: boolean
  updatedAt: Date
  version: number
}

interface ConfigArgs {
  where?: {
    tenantId?: string
    key?: string
    tenantId_key?: { tenantId: string; key: string }
  }
  select?: Record<string, boolean>
  create?: Record<string, unknown>
  update?: Record<string, unknown>
}

/** A row as the single transactional read selects it. */
interface ChangeRow {
  value: unknown
  isEditable: boolean
  version: number
  updatedAt: Date
}

const SAVED_AT = new Date('2026-02-03T10:00:00.000Z')

/**
 * The two client handles the module could reach a row through: the pooled client
 * and a transaction handle. They are deliberately distinct objects wrapping the
 * *same* mocks, so `receiver` on a recorded call is what distinguishes a query
 * made inside the transaction from one made outside it. A single shared object
 * would make both look identical and the transaction assertions vacuous.
 */
const findMany = mock(async (_args: ConfigArgs): Promise<ConfigRow[]> => [])
const findUnique = mock(async (_args: ConfigArgs): Promise<Partial<ChangeRow> | null> => null)
const upsert = mock(
  async (_args: ConfigArgs): Promise<{ updatedAt: Date; version: number }> => ({
    updatedAt: SAVED_AT,
    version: 1,
  })
)
const deleteMany = mock(async (_args: ConfigArgs): Promise<{ count: number }> => ({ count: 0 }))

/**
 * Two handles onto the *same* mock functions, so which one a call arrived on is
 * observable without giving the two paths different behaviour.
 *
 * `mock.module` exposes `ROOT_MODEL`; `$transaction` hands its callback
 * `TX_MODEL`. A call through the transaction therefore runs the same recorded
 * implementation with a different receiver, and a read hoisted above the
 * transaction shows up as `via: 'root'`. Sharing a single model object instead
 * would make the two indistinguishable and every transaction assertion here
 * vacuous.
 */
const ROOT_MODEL = { findMany, findUnique, upsert, deleteMany }
const TX_MODEL = { findMany, findUnique, upsert, deleteMany }
const TX_CLIENT = { systemConfig: TX_MODEL }

/**
 * `$transaction` runs its callback immediately against `TX_CLIENT`, exactly as
 * Prisma does against a real connection. That is what makes the receiver on a
 * recorded call meaningful: the read has to come from `TX_CLIENT` for the gate
 * and the write to share a transaction, and a read hoisted above the
 * transaction is visible as `via: 'root'`.
 */
const $transaction = mock(
  async (
    fn: (tx: typeof TX_CLIENT) => Promise<unknown>,
    _bounds?: { maxWait?: number; timeout?: number }
  ): Promise<unknown> => fn(TX_CLIENT)
)

/**
 * `lib/system-config.ts` imports the server-only Prisma client at module scope,
 * so it has to be replaced before the module loads. There is no test preload in
 * this repo, so `mock.module` is the mechanism — hence the dynamic import below.
 * Only the methods the module actually calls are exposed, so an accidental new
 * database call fails loudly instead of silently returning undefined.
 */
mock.module('server-only', () => ({}))

// ---------------------------------------------------------------------------
// Module-mock lifetime: snapshot before registering, restore after
// ---------------------------------------------------------------------------
// `mock.module` patches the LIVE namespace for the whole process and never reverts, so a
// registration made at module scope is what every file loaded afterwards binds to. Both
// boundaries are put back. `server-only` goes first because `@/lib/prisma` resolves through
// it and the package is not installed in this workspace.
//
// The `@/lib/prisma` snapshot is read HERE, before the first real registration. That is the
// load-bearing part: a `beforeEach` capture would run after this registration had already
// overwritten the namespace, so it would record this file's own factory and hand the double
// straight back to the next file.
//
// The factory SPREADS the namespace it replaces and then overrides, making the fake both a
// superset and a subset — which is what makes the restore complete, since `mock.module`
// merges and an added key could never be removed again.
const previousNamespaces = new Map<string, Record<string, unknown>>()
previousNamespaces.set('server-only', { ...(await import('server-only')) })
previousNamespaces.set('@/lib/prisma', { ...(await import('@/lib/prisma')) })

const base = (specifier: string): Record<string, unknown> =>
  previousNamespaces.get(specifier) ?? {}

const FAKES = [
  {
    specifier: '@/lib/prisma',
    factory: () => ({
      ...base('@/lib/prisma'),
      prisma: { systemConfig: ROOT_MODEL, $transaction },
      default: base('@/lib/prisma').prisma,
    }),
  },
] as const

// Also registered at load time, so the dynamic import below resolves `@/lib/prisma` through
// the double and the file is correct in a run that never reaches `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

const {
  FEATURE_FLAGS,
  applyFeatureFlagChange,
  clearFeatureFlagOverride,
  featureFlagDefinitions,
  isFeatureFlagWritable,
  manageableFlagKeys,
  resolveFeatureFlags,
  setFeatureFlag,
} = await import('@/lib/system-config')

/** Which handle a call arrived on, recorded by the mock itself. */
type Receiver = 'root' | 'transaction'

/**
 * One database call in the order it was made, with the handle it arrived on.
 *
 * `mock.calls` records arguments only, and no two of the queries here share an
 * argument shape — so without the receiver and the position a test cannot tell
 * "the gate and the write shared a transaction" from "the gate ran on the pooled
 * client and the write ran on the transaction". Both would satisfy any assertion
 * about which methods ran.
 */
interface RecordedCall {
  name: 'findMany' | 'findUnique' | 'upsert' | 'deleteMany'
  args: ConfigArgs
  via: Receiver
}
let log: RecordedCall[] = []

/** The row the single transactional read finds, or null when there is none. */
let storedRow: ChangeRow | null = null
/** Rows a delete reports removing. `0` means nothing was stored. */
let removedRows = 0
/**
 * The version a write reports back, or `null` to emulate the column's own
 * increment. A test that wants to prove the source reports the database's answer
 * rather than its own sets this to a number an increment could not produce.
 */
let writtenVersion: number | null = null
let writtenAt: Date = SAVED_AT

/** Record a call with the handle it arrived on, then delegate to the behaviour. */
function record<T>(self: unknown, name: RecordedCall['name'], args: ConfigArgs, next: () => Promise<T>) {
  log.push({ name, args, via: self === TX_MODEL ? 'transaction' : 'root' })
  return next()
}

/**
 * The only view the tests take of the live registry. `as const` makes the
 * compiler see a literal `isEditable: true` for every key, but the gate reads
 * the object at call time, so a locked entry is reachable behaviour rather than
 * a fiction — this cast exposes that one field without pretending the entry is
 * otherwise mutable.
 */
type RegistryGate = { isEditable: boolean }

/** Force one registry entry to be locked for the duration of `run`, then put it back. */
async function withRegistryLocked<T>(key: FeatureFlagKey, run: () => Promise<T>): Promise<T> {
  const entry = FEATURE_FLAGS[key] as unknown as RegistryGate
  const original = entry.isEditable
  entry.isEditable = false
  try {
    return await run()
  } finally {
    entry.isEditable = original
  }
}

/**
 * Count every database call and every transaction opened, so a read path cannot
 * write and a rejected key cannot open a connection. Counted off the mocks
 * rather than off `log`, so a test that swaps in its own implementation — and
 * with it the recording — cannot make this read lower than it is.
 */
function dbCalls(): number {
  return (
    findMany.mock.calls.length +
    findUnique.mock.calls.length +
    upsert.mock.calls.length +
    deleteMany.mock.calls.length +
    $transaction.mock.calls.length
  )
}

/** The single call named `name`, or undefined. Fails loudly if it is ambiguous. */
function call(name: RecordedCall['name']): RecordedCall {
  const found = log.filter((c) => c.name === name)
  expect(found.length).toBe(1)
  return found[0]
}

/** Put a row in place for the transactional read, at a given version. */
function storeRow(value: unknown, version: number, isEditable = true): void {
  storedRow = { value, isEditable, version, updatedAt: new Date('2026-01-15T08:30:00.000Z') }
}

beforeEach(() => {
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
  // Reset rather than only clear: a leaked implementation from one test would
  // let the next test pass on data it did not set up.
  log = []
  storedRow = null
  removedRows = 0
  writtenVersion = null
  writtenAt = SAVED_AT

  // `function` not arrow: the receiver is the only evidence of which client
  // handle a call was made on, and an arrow would discard it.
  findMany.mockReset()
  findMany.mockImplementation(function (this: unknown, args: ConfigArgs) {
    return record(this, 'findMany', args, async () => [] as ConfigRow[])
  })
  findUnique.mockReset()
  findUnique.mockImplementation(function (this: unknown, args: ConfigArgs) {
    return record(this, 'findUnique', args, async () => storedRow)
  })
  upsert.mockReset()
  upsert.mockImplementation(function (this: unknown, args: ConfigArgs) {
    return record(this, 'upsert', args, async () => ({
      updatedAt: writtenAt,
      // `update: { version: { increment: 1 } }` means the new value is the
      // stored one plus one, worked out by the column. Emulating that here is
      // what lets a test tell "the source asked the database to increment" from
      // "the source computed a number and called it the version".
      version: writtenVersion ?? (storedRow?.version ?? 0) + 1,
    }))
  })
  deleteMany.mockReset()
  deleteMany.mockImplementation(function (this: unknown, args: ConfigArgs) {
    return record(this, 'deleteMany', args, async () => ({ count: removedRows }))
  })

  $transaction.mockReset()
  $transaction.mockImplementation(
    async (fn: (tx: typeof TX_CLIENT) => Promise<unknown>, _bounds?: unknown) => fn(TX_CLIENT)
  )
})

describe('system-config - registry membership is prototype-safe', () => {
  it('should not report prototype-chain keys as registered flags', () => {
    for (const key of PROTO_KEYS) {
      expect(Object.hasOwn(FEATURE_FLAGS, key)).toBe(false)
    }
  })

  it('should still see those keys through `in`, which is the whole reason hasOwn is used', () => {
    // If this stopped holding, the hasOwn guards below would no longer be
    // load-bearing and the regression tests would be guarding nothing.
    for (const key of PROTO_KEYS) {
      expect(key in FEATURE_FLAGS).toBe(true)
    }
  })

  it('should refuse prototype-chain keys without issuing a database query', async () => {
    for (const key of PROTO_KEYS) {
      expect(await isFeatureFlagWritable('tenant-proto', key)).toBe(false)
    }
    // A lookup before the membership check would make a crafted key reach the
    // database, so the guard has to short-circuit ahead of it.
    expect(findUnique).toHaveBeenCalledTimes(0)
    expect(findMany).toHaveBeenCalledTimes(0)
  })
})

describe('system-config - isFeatureFlagWritable requires both gates', () => {
  it('should allow a flag whose registry entry and stored row are both editable', async () => {
    findUnique.mockImplementation(async () => ({ isEditable: true }))
    expect(await isFeatureFlagWritable('tenant-a', 'ai_enabled')).toBe(true)
  })

  it('should refuse a flag locked by its own stored row', async () => {
    findUnique.mockImplementation(async () => ({ isEditable: false }))
    expect(await isFeatureFlagWritable('tenant-a', 'ai_enabled')).toBe(false)
  })

  it('should allow a flag with no stored row, because nothing has locked it', async () => {
    findUnique.mockImplementation(async () => null)
    expect(await isFeatureFlagWritable('tenant-a', 'ai_enabled')).toBe(true)
  })

  it('should refuse a flag locked in the registry even when its row is editable', async () => {
    findUnique.mockImplementation(async () => ({ isEditable: true }))
    // The registry lock has to survive clearing the override row, otherwise a
    // reset would silently hand write access back.
    expect(await withRegistryLocked('ai_enabled', () => isFeatureFlagWritable('tenant-a', 'ai_enabled'))).toBe(false)
  })

  it('should refuse a flag locked in the registry even when there is no row', async () => {
    findUnique.mockImplementation(async () => null)
    expect(await withRegistryLocked('ai_enabled', () => isFeatureFlagWritable('tenant-a', 'ai_enabled'))).toBe(false)
  })

  it('should scope the row lookup to the tenant and key it was asked about', async () => {
    findUnique.mockImplementation(async () => ({ isEditable: true }))
    await isFeatureFlagWritable('tenant-lookup', 'sso_saml')
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(findUnique.mock.calls[0][0].where).toEqual({
      tenantId_key: { tenantId: 'tenant-lookup', key: 'sso_saml' },
    })
  })

  it('should refuse an unregistered key without querying the database', async () => {
    expect(await isFeatureFlagWritable('tenant-a', 'not_a_flag')).toBe(false)
    expect(findUnique).toHaveBeenCalledTimes(0)
  })
})

describe('system-config - setFeatureFlag stores overrides only', () => {
  it('should delete rather than write when the value equals the registry default', async () => {
    deleteMany.mockImplementation(async () => ({ count: 2 }))
    // offline_mode defaults to true, so storing true is storing nothing new.
    const result = await setFeatureFlag('tenant-a', 'offline_mode', true)

    // A mirror row here would report the flag as overridden and pin the tenant
    // to a value the registry no longer holds.
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(1)
    expect(deleteMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a', key: 'offline_mode' })
    expect(result).toEqual({ isOverridden: false, updatedAt: null, removed: 2 })
  })

  it('should take the delete path for a default of false too, not just true', async () => {
    deleteMany.mockImplementation(async () => ({ count: 0 }))
    const result = await setFeatureFlag('tenant-a', 'ai_enabled', false)

    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ isOverridden: false, updatedAt: null, removed: 0 })
  })

  it('should not store a JSON null, which the reader already renders as the default', async () => {
    deleteMany.mockImplementation(async () => ({ count: 1 }))
    const result = await setFeatureFlag('tenant-a', 'ai_enabled', null)

    // `resolveFeatureFlags` reads a stored `null` as "no meaningful override"
    // and shows the default. Writing one would leave a row it then discards:
    // the UI would report an override while displaying the default, and no
    // future change to that default would ever reach this tenant.
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ isOverridden: false, updatedAt: null, removed: 1 })
  })

  it('should write an override when the value differs from the registry default', async () => {
    upsert.mockImplementation(async () => ({ updatedAt: SAVED_AT, version: 1 }))
    const result = await setFeatureFlag('tenant-override', 'ai_enabled', true)

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(deleteMany).toHaveBeenCalledTimes(0)
    expect(result).toEqual({ isOverridden: true, updatedAt: SAVED_AT })
  })

  it('should write the tenant it was handed rather than one from anywhere else', async () => {
    upsert.mockImplementation(async () => ({ updatedAt: SAVED_AT, version: 1 }))
    await setFeatureFlag('tenant-arg-42', 'sso_google', true)

    const arg = upsert.mock.calls[0][0]
    // A dropped or defaulted tenantId here would cross-wire one school's SSO
    // settings into another's.
    expect(arg.where).toEqual({ tenantId_key: { tenantId: 'tenant-arg-42', key: 'sso_google' } })
    expect(arg.create?.tenantId).toBe('tenant-arg-42')
    expect(arg.update?.value).toBe(true)
  })

  it('should compare against the true default of offline_mode, not against false', async () => {
    upsert.mockImplementation(async () => ({ updatedAt: SAVED_AT, version: 1 }))
    const result = await setFeatureFlag('tenant-a', 'offline_mode', false)

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ isOverridden: true, updatedAt: SAVED_AT })
  })

  it('should reject an unregistered key instead of reaching the database', async () => {
    await expect(setFeatureFlag('tenant-a', 'not_a_flag' as FeatureFlagKey, true)).rejects.toThrow(
      'Unknown feature flag: not_a_flag'
    )
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(0)
  })

  it('should reject a prototype-chain key cast to FeatureFlagKey', async () => {
    await expect(setFeatureFlag('tenant-a', '__proto__' as FeatureFlagKey, true)).rejects.toThrow(
      'Unknown feature flag: __proto__'
    )
    expect(upsert).toHaveBeenCalledTimes(0)
  })
})

describe('system-config - clearFeatureFlagOverride is idempotent', () => {
  it('should return the number of rows the delete removed', async () => {
    deleteMany.mockImplementation(async () => ({ count: 1 }))
    expect(await clearFeatureFlagOverride('tenant-a', 'sms_enabled')).toBe(1)
  })

  it('should scope the delete to one tenant and one key', async () => {
    deleteMany.mockImplementation(async () => ({ count: 1 }))
    await clearFeatureFlagOverride('tenant-clear', 'offline_mode')

    expect(deleteMany).toHaveBeenCalledTimes(1)
    // Deleting without the tenant filter would wipe every school's override.
    expect(deleteMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-clear', key: 'offline_mode' })
  })

  it('should treat removing nothing as a success rather than an error', async () => {
    deleteMany.mockImplementation(async () => ({ count: 0 }))
    expect(await clearFeatureFlagOverride('tenant-a', 'sms_enabled')).toBe(0)
  })

  it('should still scope the delete on a repeat call', async () => {
    deleteMany.mockImplementation(async () => ({ count: 0 }))
    await clearFeatureFlagOverride('tenant-clear', 'offline_mode')
    await clearFeatureFlagOverride('tenant-clear', 'offline_mode')

    expect(deleteMany).toHaveBeenCalledTimes(2)
    for (const call of deleteMany.mock.calls) {
      expect(call[0].where).toEqual({ tenantId: 'tenant-clear', key: 'offline_mode' })
    }
  })
})

describe('system-config - resolveFeatureFlags is read-only', () => {
  const ROW_AT = new Date('2026-01-15T08:30:00.000Z')
  const ROWS: ConfigRow[] = [
    { key: 'offline_mode', value: null, isEditable: true, updatedAt: ROW_AT, version: 1 },
    { key: 'ai_enabled', value: true, isEditable: false, updatedAt: ROW_AT, version: 3 },
    { key: 'sso_google', value: true, isEditable: true, updatedAt: ROW_AT, version: 1 },
    { key: 'sms_enabled', value: false, isEditable: true, updatedAt: ROW_AT, version: 2 },
  ]

  it('should read once, scoped to the tenant, and write nothing', async () => {
    findMany.mockImplementation(async () => ROWS)
    await resolveFeatureFlags('tenant-read')

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-read' })
    // A GET that writes is unusable on a read-only replica and races itself.
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(0)
  })

  it('should filter by whichever tenant it was given', async () => {
    findMany.mockImplementation(async () => [])
    await resolveFeatureFlags('tenant-other')

    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-other' })
  })

  it('should return every registered flag in registry order, ignoring unregistered rows', async () => {
    findMany.mockImplementation(async () => [
      ...ROWS,
      { key: 'legacy_flag', value: true, isEditable: true, updatedAt: ROW_AT, version: 1 },
    ])
    const flags = await resolveFeatureFlags('tenant-read')

    expect(flags.map((f) => f.key)).toEqual(Object.keys(FEATURE_FLAGS))
  })

  it('should resolve a flag with a stored row to the stored value', async () => {
    findMany.mockImplementation(async () => ROWS)
    const flags = await resolveFeatureFlags('tenant-read')
    const ai = flags.find((f) => f.key === 'ai_enabled')

    expect(ai?.value).toBe(true)
    expect(ai?.isOverridden).toBe(true)
    expect(ai?.updatedAt).toBe(ROW_AT.toISOString())
  })

  it('should resolve a flag with no row to its default', async () => {
    findMany.mockImplementation(async () => ROWS)
    const flags = await resolveFeatureFlags('tenant-read')
    const microsoft = flags.find((f) => f.key === 'sso_microsoft')

    expect(microsoft?.value).toBe(false)
    expect(microsoft?.isOverridden).toBe(false)
    expect(microsoft?.updatedAt).toBeNull()
  })

  it('should fall back to the default when the stored value is JSON null', async () => {
    findMany.mockImplementation(async () => ROWS)
    const flags = await resolveFeatureFlags('tenant-read')
    const offline = flags.find((f) => f.key === 'offline_mode')

    // A null switch is not a setting; surfacing it would render an unrenderable control.
    expect(offline?.value).toBe(true)
    expect(offline?.value).not.toBeNull()
    expect(offline?.isOverridden).toBe(true)
    expect(offline?.updatedAt).toBe(ROW_AT.toISOString())
  })

  it('should honour a stored row even when the stored value matches the default', async () => {
    findMany.mockImplementation(async () => ROWS)
    const flags = await resolveFeatureFlags('tenant-read')
    const sms = flags.find((f) => f.key === 'sms_enabled')

    // Reads report what is stored; only the write path is allowed to prune a row
    // that happens to agree with the default.
    expect(sms?.value).toBe(false)
    expect(sms?.isOverridden).toBe(true)
    expect(sms?.updatedAt).toBe(ROW_AT.toISOString())
  })

  it('should report isEditable exactly as the write path would enforce it', async () => {
    findMany.mockImplementation(async () => ROWS)
    findUnique.mockImplementation(async (args: ConfigArgs) => {
      const row = ROWS.find((r) => r.key === args.where?.tenantId_key?.key)
      return row ? { isEditable: row.isEditable } : null
    })

    const flags = await resolveFeatureFlags('tenant-read')
    const ai = flags.find((f) => f.key === 'ai_enabled')
    const microsoft = flags.find((f) => f.key === 'sso_microsoft')

    // If these two could disagree, the UI would offer an edit the API rejects.
    expect(ai?.isEditable).toBe(false)
    expect(microsoft?.isEditable).toBe(true)
    for (const flag of flags) {
      expect(flag.isEditable).toBe(await isFeatureFlagWritable('tenant-read', flag.key))
    }
  })

  it('should report a version so a client can seed a precondition from a read', async () => {
    findMany.mockImplementation(async () => [
      { key: 'ai_enabled', value: true, isEditable: true, updatedAt: ROW_AT, version: 4 },
    ])

    const flags = await resolveFeatureFlags('tenant-read')
    const ai = flags.find((f) => f.key === 'ai_enabled')
    // The stored counter, not a local guess: a client that seeds a precondition
    // from a number this read invented would be refused by its own next write.
    expect(ai?.version).toBe(4)
  })

  it('should report version 0 for a flag with no row, matching the write path', async () => {
    findMany.mockImplementation(async () => [] as ConfigRow[])
    const flags = await resolveFeatureFlags('tenant-read')

    for (const flag of flags) {
      // `applyFeatureFlagChange` reads an absent row as 0. A read path that
      // reported `null` or omitted the field here would leave a client unable to
      // express "there is no override" as a precondition at all.
      expect(flag.version).toBe(0)
    }
  })
})

describe('system-config - applyFeatureFlagChange is one transaction', () => {
  it('should read the row and write it through the same transaction handle', async () => {
    const result = await applyFeatureFlagChange('tenant-tx', 'ai_enabled', true)

    expect(result.status).toBe('applied')
    // The whole point of the change. A gate read on the pooled client and a write
    // on the transaction are two statements about two moments, and the verdict
    // the gate reached can describe a row the write never saw.
    expect(log.map((c) => c.name)).toEqual(['findUnique', 'upsert'])
    expect(log.map((c) => c.via)).toEqual(['transaction', 'transaction'])
  })

  it('should read the row exactly once, not once per decision', async () => {
    await applyFeatureFlagChange('tenant-tx', 'ai_enabled', true)

    // Three separate reads is what this replaced: one for the gate, one for the
    // previous value, and the version. Each is a statement about a slightly
    // different moment, which is exactly the gap a concurrent request slips into.
    expect(findUnique).toHaveBeenCalledTimes(1)
  })

  it('should open exactly one transaction for the whole change', async () => {
    await applyFeatureFlagChange('tenant-tx', 'ai_enabled', true)

    // A second transaction would be a second connection for a change the gate
    // and the write have to agree about.
    expect($transaction).toHaveBeenCalledTimes(1)
  })

  it('should bound the transaction so a stalled database cannot hang the request', async () => {
    await applyFeatureFlagChange('tenant-tx', 'ai_enabled', true)

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

  it('should read the row through the transaction even when refusing to write', async () => {
    storeRow(false, 1, false)
    const result = await applyFeatureFlagChange('tenant-tx', 'ai_enabled', true)

    expect(result.status).toBe('read-only')
    expect(log.map((c) => c.via)).toEqual(['transaction'])
  })

  it('should scope the single read to the session tenant and the flag', async () => {
    await applyFeatureFlagChange('tenant-tx', 'sso_saml', true)

    // An unscoped read would apply one school's gate and version to another's row.
    expect(call('findUnique').args.where).toEqual({
      tenantId_key: { tenantId: 'tenant-tx', key: 'sso_saml' },
    })
  })

  it('should select every column the decisions need, and nothing else', async () => {
    await applyFeatureFlagChange('tenant-tx', 'ai_enabled', true)

    // The gate needs `isEditable`, the precondition needs `version`, the audit
    // line needs `value`. A read that dropped `version` could not detect a stale
    // writer; one that read the whole row would drag `id` and `tenantId` over
    // the wire for nothing.
    expect(call('findUnique').args.select).toEqual({
      value: true,
      isEditable: true,
      version: true,
      updatedAt: true,
    })
  })
})

describe('system-config - applyFeatureFlagChange refuses before it writes', () => {
  it('should refuse a flag the stored row locks, without writing', async () => {
    storeRow(false, 1, false)
    const result = await applyFeatureFlagChange('tenant-locked', 'ai_enabled', true)

    // The UI greys the control out, but a crafted request bypasses the UI
    // entirely — without this gate the `isEditable` column is theatre.
    expect(result).toEqual({ status: 'read-only' })
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(0)
  })

  it('should refuse a flag locked in the registry even when its row is editable', async () => {
    storeRow(false, 1, true)
    const result = await withRegistryLocked('ai_enabled', () =>
      applyFeatureFlagChange('tenant-locked', 'ai_enabled', true)
    )

    // The registry lock has to survive clearing the override row, otherwise a
    // reset would silently hand write access back.
    expect(result).toEqual({ status: 'read-only' })
    expect(upsert).toHaveBeenCalledTimes(0)
  })

  it('should refuse a locked flag on the reset path too', async () => {
    storeRow(true, 2, false)
    const result = await applyFeatureFlagChange('tenant-locked', 'ai_enabled', false)

    // The reset branch deletes rather than writes, so without this a locked flag
    // could be silently cleared even though the write path refuses it.
    expect(result).toEqual({ status: 'read-only' })
    expect(deleteMany).toHaveBeenCalledTimes(0)
  })

  it('should reject an unregistered key without opening a transaction', async () => {
    await expect(
      applyFeatureFlagChange('tenant-a', 'not_a_flag' as FeatureFlagKey, true)
    ).rejects.toThrow('Unknown feature flag: not_a_flag')
    // A connection is a far more expensive thing to hand a crafted URL segment
    // than a query, so the membership check has to precede the transaction too.
    expect($transaction).toHaveBeenCalledTimes(0)
    expect(dbCalls()).toBe(0)
  })

  it('should reject a prototype-chain key cast to FeatureFlagKey', async () => {
    for (const key of PROTO_KEYS) {
      await expect(
        applyFeatureFlagChange('tenant-a', key as FeatureFlagKey, true)
      ).rejects.toThrow(`Unknown feature flag: ${key}`)
    }
    expect(dbCalls()).toBe(0)
  })
})

describe('system-config - applyFeatureFlagChange enforces a version precondition', () => {
  it('should proceed when the precondition matches the stored version', async () => {
    storeRow(false, 7)
    const result = await applyFeatureFlagChange('tenant-cond', 'ai_enabled', true, 7)

    expect(result.status).toBe('applied')
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('should match a precondition of 0 against a flag with no row', async () => {
    // No row IS version 0, so "there is no override" is a precondition a client
    // can hold rather than an absence it cannot express.
    const result = await applyFeatureFlagChange('tenant-cond', 'ai_enabled', true, 0)

    expect(result.status).toBe('applied')
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('should conflict, and write nothing, when the precondition is stale', async () => {
    storeRow(false, 9)
    const result = await applyFeatureFlagChange('tenant-cond', 'ai_enabled', true, 7)

    // THE regression. Without the precondition the second tab's write lands and
    // the first tab's is silently gone — the row looks exactly as though only
    // one change was ever made.
    expect(result).toEqual({ status: 'conflict', currentVersion: 9 })
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(0)
  })

  it('should report the current version so the stale client can recover', async () => {
    storeRow(false, 9)
    const result = await applyFeatureFlagChange('tenant-cond', 'ai_enabled', true, 7)

    // 9 and not 7: a body echoing the caller's own stale number would tell the
    // client to resync to the state it already had, and it would overwrite the
    // change it just collided with.
    if (result.status === 'conflict') {
      expect(result.currentVersion).toBe(9)
    } else {
      throw new Error('expected a conflict')
    }
  })

  it('should conflict on a stale precondition for a flag with no row', async () => {
    // A row was created and reset again since this client read: the stored
    // version is back to 0, but the tab is holding the 1 it was given.
    storeRow(false, 1)
    const result = await applyFeatureFlagChange('tenant-cond', 'ai_enabled', true, 0)
    expect(result).toEqual({ status: 'conflict', currentVersion: 1 })
    expect(upsert).toHaveBeenCalledTimes(0)
  })

  it('should conflict on the reset path too, not just the write', async () => {
    storeRow(true, 3)
    const result = await applyFeatureFlagChange('tenant-cond', 'ai_enabled', false, 2)

    // A reset can be made stale exactly as a write can. Without this, a stale
    // tab could delete an override that had been changed since it last looked.
    expect(result).toEqual({ status: 'conflict', currentVersion: 3 })
    expect(deleteMany).toHaveBeenCalledTimes(0)
    expect(upsert).toHaveBeenCalledTimes(0)
  })

  it('should still write when no precondition is requested', async () => {
    storeRow(false, 9)
    const result = await applyFeatureFlagChange('tenant-cond', 'ai_enabled', true)

    // Absent means "not requested", not "must match zero". Making the
    // precondition mandatory would break every existing client; the schema
    // change makes the safe path available, it does not force it.
    expect(result.status).toBe('applied')
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('should check the writability gate before the precondition', async () => {
    storeRow(false, 9, false)
    const result = await applyFeatureFlagChange('tenant-cond', 'ai_enabled', true, 7)

    // A locked flag has no version worth reporting: the write is refused
    // whatever the caller thought it was based on, and answering 409 would invite
    // a client to retry something that can never succeed.
    expect(result).toEqual({ status: 'read-only' })
  })
})

describe('system-config - applyFeatureFlagChange moves the version the way the column does', () => {
  it('should create a first override at version 1, not 0', async () => {
    const result = await applyFeatureFlagChange('tenant-v', 'ai_enabled', true)

    // 0 is what an ABSENT row means. Creating at 0 would make a flag somebody
    // has just overridden indistinguishable from one nobody ever touched, and a
    // tab holding 0 could then overwrite the override.
    expect(call('upsert').args.create?.version).toBe(1)
    expect(result).toMatchObject({ status: 'applied', isOverridden: true, version: 1 })
  })

  it('should increment the stored version on a later write', async () => {
    storeRow(false, 4)
    const result = await applyFeatureFlagChange('tenant-v', 'ai_enabled', true)

    // `{ increment: 1 }` rather than an assigned number: the new value is derived
    // from the row the transaction read, so a caller cannot pin it backwards.
    expect(call('upsert').args.update?.version).toEqual({ increment: 1 })
    expect(result).toMatchObject({ status: 'applied', isOverridden: true, version: 5 })
  })

  it('should return the version the write reported, not one computed here', async () => {
    storeRow(false, 4)
    // A version the `{ increment: 1 }` could not have produced from 4 — a fourth
    // write, or a trigger. A source that computed `previous + 1` itself would
    // answer 5 here and be wrong.
    writtenVersion = 9
    writtenAt = new Date('2026-03-04T11:22:33.000Z')
    const result = await applyFeatureFlagChange('tenant-v', 'ai_enabled', true)

    // The counter is the database's, after its own increment. A locally computed
    // `previous + 1` would be a second opinion about what is stored, and would
    // diverge from the next GET the moment anything else touched the row.
    expect(result).toMatchObject({ version: 9 })
    if (result.status === 'applied' && result.isOverridden) {
      expect(result.updatedAt).toEqual(new Date('2026-03-04T11:22:33.000Z'))
    } else {
      throw new Error('expected an applied override')
    }
  })

  it('should return version 0 after a reset, because the row is gone', async () => {
    storeRow(true, 6)
    removedRows = 1
    const result = await applyFeatureFlagChange('tenant-v', 'ai_enabled', false)

    // This is the mechanism by which a reset invalidates other tabs' held
    // preconditions: a tab that saw version 6 can no longer match anything.
    expect(result).toEqual({
      status: 'applied',
      previousValue: true,
      version: 0,
      isOverridden: false,
      updatedAt: null,
      removed: 1,
    })
  })

  it('should report version 0 after a save of the registry default', async () => {
    storeRow(true, 2)
    removedRows = 1
    const result = await applyFeatureFlagChange('tenant-v', 'ai_enabled', false)

    // A save that lands on the default is a reset, not a write, so the stored
    // outcome is "no row" and the version has to say so.
    expect(result).toMatchObject({ version: 0, isOverridden: false, updatedAt: null })
  })
})

describe('system-config - applyFeatureFlagChange preserves the overrides-only invariant', () => {
  it('should delete rather than write when the value equals the registry default', async () => {
    removedRows = 1
    // offline_mode defaults to true, so storing true is storing nothing new.
    const result = await applyFeatureFlagChange('tenant-ovr', 'offline_mode', true)

    // A mirror row here would report the flag as overridden and pin the tenant
    // to a value the registry no longer holds.
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(call('deleteMany').args.where).toEqual({ tenantId: 'tenant-ovr', key: 'offline_mode' })
    expect(result).toMatchObject({ status: 'applied', isOverridden: false, removed: 1 })
  })

  it('should not store a JSON null, which the reader already renders as the default', async () => {
    const result = await applyFeatureFlagChange('tenant-ovr', 'ai_enabled', null)

    // `resolveFeatureFlags` reads a stored `null` as "no meaningful override"
    // and shows the default. Writing one would leave a row it then discards.
    expect(upsert).toHaveBeenCalledTimes(0)
    expect(deleteMany).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ isOverridden: false, removed: 0 })
  })

  it('should scope the delete to the tenant it was handed', async () => {
    removedRows = 1
    await applyFeatureFlagChange('tenant-arg-42', 'sms_enabled', false)

    // Deleting without the tenant filter would wipe every school's override.
    expect(call('deleteMany').args.where).toEqual({ tenantId: 'tenant-arg-42', key: 'sms_enabled' })
  })

  it('should write the tenant it was handed rather than one from anywhere else', async () => {
    await applyFeatureFlagChange('tenant-arg-42', 'sso_google', true)

    // A dropped or defaulted tenantId here would cross-wire one school's SSO
    // settings into another's.
    expect(call('upsert').args.where).toEqual({
      tenantId_key: { tenantId: 'tenant-arg-42', key: 'sso_google' },
    })
    expect(call('upsert').args.create?.tenantId).toBe('tenant-arg-42')
    expect(call('upsert').args.update?.value).toBe(true)
  })

  it('should compare against the true default of offline_mode, not against false', async () => {
    const result = await applyFeatureFlagChange('tenant-ovr', 'offline_mode', false)

    // Comparing against the wrong default would delete an override that is a
    // real deviation, leaving the tenant permanently on a value nobody chose.
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ isOverridden: true })
  })
})

describe('system-config - applyFeatureFlagChange reports the previous value for the audit line', () => {
  it('should report the stored value as the previous one', async () => {
    storeRow(true, 2)
    const result = await applyFeatureFlagChange('tenant-audit', 'ai_enabled', false)

    // A read-back after the write would return the value just written, and every
    // audit entry would read "updated from true to true".
    expect(result).toMatchObject({ previousValue: true })
  })

  it('should report the registry default as the previous value when there is no row', async () => {
    const result = await applyFeatureFlagChange('tenant-audit', 'ai_enabled', true)

    expect(result).toMatchObject({ previousValue: false })
  })

  it('should report the registry default when the stored value is a JSON null', async () => {
    // `resolveFeatureFlags` renders a stored `null` as the default, so the audit
    // line has to agree with the read path or an auditor reconstructing the
    // prior state gets a value the UI never showed.
    storeRow(null, 1)
    const result = await applyFeatureFlagChange('tenant-audit', 'ai_enabled', true)

    expect(result).toMatchObject({ previousValue: false })
  })

  it('should read the previous value before the write, in the same transaction', async () => {
    storeRow(true, 2)
    await applyFeatureFlagChange('tenant-audit', 'ai_enabled', false)

    // Both the gate's row and the audit's row are this one read. A second read
    // after the delete would find nothing at all.
    expect(log.map((c) => c.name)).toEqual(['findUnique', 'deleteMany'])
  })
})

describe('system-config - featureFlagDefinitions is a pure projection', () => {
  it('should not touch the database', () => {
    featureFlagDefinitions()
    expect(dbCalls()).toBe(0)
  })

  it('should describe every registered flag with exactly three fields', () => {
    const defs = featureFlagDefinitions()
    expect(Object.keys(defs)).toEqual(Object.keys(FEATURE_FLAGS))

    for (const [key, entry] of Object.entries(FEATURE_FLAGS)) {
      // `schema` and `isEditable` stay server-side: leaking the zod schema
      // invites client-side validation that can disagree with this one.
      expect(Object.keys(defs[key])).toEqual(['description', 'category', 'defaultValue'])
      expect(defs[key].description).toBe(entry.description)
      expect(defs[key].category).toBe(entry.category)
      expect(defs[key].defaultValue).toBe(entry.defaultValue)
      expect(defs[key].description.length).toBeGreaterThan(0)
      expect(defs[key].category.length).toBeGreaterThan(0)
    }
  })

  it('should report the documented defaults', () => {
    const defs = featureFlagDefinitions()

    // offline_mode is the only flag that ships on. A default flipped to false
    // here would silently disable offline sync for every new tenant.
    expect(defs.offline_mode.defaultValue).toBe(true)
    for (const key of ['ai_enabled', 'sms_enabled', 'sso_google', 'sso_microsoft', 'sso_saml'] as const) {
      expect(defs[key].defaultValue).toBe(false)
    }
  })

  it('should hand back a detached copy so a caller cannot reach the registry', () => {
    const first = featureFlagDefinitions()
    const second = featureFlagDefinitions()

    expect(first).not.toBe(second)
    expect(first.ai_enabled).not.toBe(second.ai_enabled)
  })
})

/**
 * What the registry is allowed to contain, and why.
 *
 * Two production comments rest on the registry holding booleans and nothing
 * else, and neither had a test:
 *
 *   * `storesTheDefault` compares with `===` rather than a deep comparison,
 *     because "every flag is registered with a scalar schema (`z.boolean()`)".
 *   * The PATCH route writes the flag's old and new value into the audit
 *     entry's `changes` payload — which `logger.ts` folds into the chain hash —
 *     on the grounds that "every registered flag is a boolean, and the
 *     `Object.hasOwn` gate above means this route never reads or writes a
 *     non-registry key".
 *
 * Neither is a type error, because `FlagDefinition.defaultValue` is `unknown` and
 * `schema` is a bare `z.ZodType`: a string-valued flag compiles cleanly, stores
 * into a JSON column, and rides into the hash. So the invariant is asserted here
 * against the registry itself.
 */
describe('system-config - the registry holds switches, not settings', () => {
  /** Every entry, widened so `manageRoles` is readable on each. */
  const entries = () =>
    Object.entries(FEATURE_FLAGS).map(
      ([key, def]) =>
        [key, def as { defaultValue: unknown; schema: { safeParse: (v: unknown) => { success: boolean } } }] as const,
    )

  it('should default every registered flag to a boolean', () => {
    for (const [key, def] of entries()) {
      // `typeof` rather than a list of accepted defaults: a flag added tomorrow
      // with a string default is the defect, and it is invisible to any
      // hand-written key list.
      expect({ key, type: typeof def.defaultValue }).toEqual({ key, type: 'boolean' })
    }
  })

  it('should accept only booleans through every registered flag’s own schema', () => {
    for (const [key, def] of entries()) {
      expect({ key, accepted: def.schema.safeParse(true).success }).toEqual({ key, accepted: true })
      expect({ key, accepted: def.schema.safeParse(false).success }).toEqual({ key, accepted: true })
      // A string, a number or a document would be stored verbatim and then
      // rendered by a control that only knows on and off. `''` and `0` are here
      // because they are the falsy values a hand-written coercion would produce.
      for (const notABoolean of ['', 'true', 'false', 0, 1, {}, [], null]) {
        expect({ key, accepted: def.schema.safeParse(notABoolean).success }).toEqual({
          key,
          accepted: false,
        })
      }
    }
  })

  it('should keep every flag the PATCH route can reach boolean-valued', () => {
    // Scoped to the WRITABLE set rather than to the registry, because that is the
    // set whose values reach the tamper-evident audit payload. A flag nothing
    // can write here is out of reach of that payload too.
    const writable = manageableFlagKeys(PLATFORM_ROLES.HEADMASTER)
    expect(writable.length).toBeGreaterThan(0)

    for (const key of writable) {
      const def = FEATURE_FLAGS[key] as unknown as {
        defaultValue: unknown
        schema: { safeParse: (v: unknown) => { success: boolean } }
      }
      expect({ key, type: typeof def.defaultValue }).toEqual({ key, type: 'boolean' })
      expect({ key, accepted: def.schema.safeParse('secret').success }).toEqual({ key, accepted: false })
    }
  })

  it('should admit exactly the flags that declare a non-empty manageRoles, or none at all', () => {
    const open = (Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]).filter(
      (key) =>
        ((FEATURE_FLAGS[key] as { manageRoles?: readonly string[] }).manageRoles ??
          PLATFORM_ADMIN_ROLES).length > 0,
    )

    expect(manageableFlagKeys(PLATFORM_ROLES.HEADMASTER)).toEqual(open)
  })

  it('should keep an empty manageRoles out of every role’s writable list', () => {
    // `admissions_open` is the case that makes the rule mean something: it is
    // registered — the dedicated route resolves its default through this same
    // registry — but its empty set means the generic PATCH route refuses it for
    // every role. One writer per flag means one audit action to read back.
    const locked = Object.keys(FEATURE_FLAGS).filter(
      (key) =>
        ((FEATURE_FLAGS[key as FeatureFlagKey] as { manageRoles?: readonly string[] }).manageRoles ??
          PLATFORM_ADMIN_ROLES).length === 0,
    )
    expect(locked.length).toBeGreaterThan(0)

    for (const key of locked) {
      for (const role of Object.values(PLATFORM_ROLES)) {
        expect({ role, key, admitted: manageableFlagKeys(role).includes(key as FeatureFlagKey) }).toEqual(
          { role, key, admitted: false },
        )
      }
      // A session with no role at all is refused the same way.
      expect(manageableFlagKeys(null)).not.toContain(key as FeatureFlagKey)
    }
  })
})