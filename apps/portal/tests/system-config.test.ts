import { describe, it, expect, beforeEach, mock } from 'bun:test'
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
 */

/** Keys that exist on `Object.prototype` but are not flags. */
const PROTO_KEYS = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'] as const

/** A row as `resolveFeatureFlags` selects it. */
interface ConfigRow {
  key: string
  value: unknown
  isEditable: boolean
  updatedAt: Date
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

const SAVED_AT = new Date('2026-02-03T10:00:00.000Z')

const findMany = mock(async (_args: ConfigArgs): Promise<ConfigRow[]> => [])
const findUnique = mock(async (_args: ConfigArgs): Promise<{ isEditable: boolean } | null> => null)
const upsert = mock(async (_args: ConfigArgs): Promise<{ updatedAt: Date }> => ({ updatedAt: SAVED_AT }))
const deleteMany = mock(async (_args: ConfigArgs): Promise<{ count: number }> => ({ count: 0 }))

/**
 * `lib/system-config.ts` imports the server-only Prisma client at module scope,
 * so both have to be replaced before it loads. There is no test preload in this
 * repo, so `mock.module` is the mechanism — hence the dynamic import below.
 * Only the four methods the module actually calls are exposed, so an accidental
 * new database call fails loudly instead of silently returning undefined.
 */
mock.module('@/lib/prisma', () => ({
  prisma: { systemConfig: { findMany, findUnique, upsert, deleteMany } },
}))
mock.module('server-only', () => ({}))

const {
  FEATURE_FLAGS,
  clearFeatureFlagOverride,
  featureFlagDefinitions,
  isFeatureFlagWritable,
  resolveFeatureFlags,
  setFeatureFlag,
} = await import('@/lib/system-config')

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

/** Count every database call made by a block, so a read path cannot write. */
function dbCalls(): number {
  return findMany.mock.calls.length + findUnique.mock.calls.length + upsert.mock.calls.length + deleteMany.mock.calls.length
}

beforeEach(() => {
  // Reset rather than only clear: a leaked implementation from one test would
  // let the next test pass on data it did not set up.
  findMany.mockReset()
  findMany.mockImplementation(async () => [])
  findUnique.mockReset()
  findUnique.mockImplementation(async () => null)
  upsert.mockReset()
  upsert.mockImplementation(async () => ({ updatedAt: SAVED_AT }))
  deleteMany.mockReset()
  deleteMany.mockImplementation(async () => ({ count: 0 }))
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
    upsert.mockImplementation(async () => ({ updatedAt: SAVED_AT }))
    const result = await setFeatureFlag('tenant-override', 'ai_enabled', true)

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(deleteMany).toHaveBeenCalledTimes(0)
    expect(result).toEqual({ isOverridden: true, updatedAt: SAVED_AT })
  })

  it('should write the tenant it was handed rather than one from anywhere else', async () => {
    upsert.mockImplementation(async () => ({ updatedAt: SAVED_AT }))
    await setFeatureFlag('tenant-arg-42', 'sso_google', true)

    const arg = upsert.mock.calls[0][0]
    // A dropped or defaulted tenantId here would cross-wire one school's SSO
    // settings into another's.
    expect(arg.where).toEqual({ tenantId_key: { tenantId: 'tenant-arg-42', key: 'sso_google' } })
    expect(arg.create?.tenantId).toBe('tenant-arg-42')
    expect(arg.update?.value).toBe(true)
  })

  it('should compare against the true default of offline_mode, not against false', async () => {
    upsert.mockImplementation(async () => ({ updatedAt: SAVED_AT }))
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
    { key: 'offline_mode', value: null, isEditable: true, updatedAt: ROW_AT },
    { key: 'ai_enabled', value: true, isEditable: false, updatedAt: ROW_AT },
    { key: 'sso_google', value: true, isEditable: true, updatedAt: ROW_AT },
    { key: 'sms_enabled', value: false, isEditable: true, updatedAt: ROW_AT },
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
    findMany.mockImplementation(async () => [...ROWS, { key: 'legacy_flag', value: true, isEditable: true, updatedAt: ROW_AT }])
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