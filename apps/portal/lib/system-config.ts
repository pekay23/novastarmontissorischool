import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

/**
 * Feature flag definitions.
 *
 * This registry — not the database — is the source of truth for what flags
 * exist and what they default to. `SystemConfig` stores *overrides only*: a
 * row exists if and only if someone deliberately changed a flag away from
 * its default.
 *
 * That distinction is what makes reads safe and tenants self-provisioning:
 *
 *   * A GET never writes, so it is safe on read-only replicas, in caches, and
 *     under concurrent requests.
 *   * A newly created tenant has no rows and still resolves every flag from
 *     its default, so nothing needs to be seeded per tenant.
 *   * Changing a default in this file takes effect immediately for every
 *     tenant that never overrode it, instead of being shadowed by seeded
 *     mirror rows.
 *
 * The last point is only true if the write path enforces the rule too, so it
 * does: `setFeatureFlag` stores a row only when the submitted value differs
 * from the registry default, and a submitted value that *is* the default is a
 * reset. That is what keeps "overrides only" an invariant of the data rather
 * than a convention the code follows by hand.
 */
/**
 * The shape every registry entry must satisfy.
 *
 * `isEditable` is the registry-level lock. It is deliberately independent of the
 * `SystemConfig` row, so deleting a tenant's override row — which is exactly
 * what "reset to default" does — cannot re-enable a flag the registry has
 * locked.
 */
export interface FlagDefinition {
  description: string
  category: string
  defaultValue: unknown
  schema: z.ZodType
  isEditable: boolean
}

/**
 * Declared `as const satisfies Record<string, FlagDefinition>` so each entry is
 * still checked against `FlagDefinition` while the key set stays a real union
 * (`FeatureFlagKey`). As a plain `Record<string, …>` the key type was `string`,
 * which type-checked an index into a key that was not there and only failed at
 * runtime.
 */
export const FEATURE_FLAGS = {
  ai_enabled: {
    description: 'Enable AI-powered report cards and data query',
    category: 'academics',
    defaultValue: false,
    isEditable: true,
    schema: z.boolean(),
  },
  sms_enabled: {
    description: 'Enable SMS notifications (requires MTN MoMo key)',
    category: 'communications',
    defaultValue: false,
    isEditable: true,
    schema: z.boolean(),
  },
  offline_mode: {
    description: 'Enable offline-first (IndexedDB sync)',
    category: 'infrastructure',
    defaultValue: true,
    isEditable: true,
    schema: z.boolean(),
  },
  sso_google: {
    description: 'Enable Google SSO login',
    category: 'auth',
    defaultValue: false,
    isEditable: true,
    schema: z.boolean(),
  },
  sso_microsoft: {
    description: 'Enable Microsoft Entra ID SSO login',
    category: 'auth',
    defaultValue: false,
    isEditable: true,
    schema: z.boolean(),
  },
  sso_saml: {
    description: 'Enable SAML SSO login',
    category: 'auth',
    defaultValue: false,
    isEditable: true,
    schema: z.boolean(),
  },
} as const satisfies Record<string, FlagDefinition>

/** The registered flag keys. */
export type FeatureFlagKey = keyof typeof FEATURE_FLAGS

export interface ResolvedFlag {
  key: string
  value: unknown
  description: string
  category: string
  /** True when a row exists for this flag — i.e. it was deliberately changed. */
  isOverridden: boolean
  /**
   * Whether the Head of School may change it. A flag is editable only when
   * neither the registry nor the stored row locks it: all six registered flags
   * are editable in the registry today, so this is currently the row's own
   * `isEditable`, defaulting to editable when there is no row.
   */
  isEditable: boolean
  updatedAt: string | null
}

/**
 * Every registered flag with its effective value for a tenant: the stored
 * override where one exists, otherwise the registry default.
 *
 * Read-only. Does not create, update, or delete anything.
 */
export async function resolveFeatureFlags(tenantId: string): Promise<ResolvedFlag[]> {
  const rows = await prisma.systemConfig.findMany({
    where: { tenantId },
    select: { key: true, value: true, isEditable: true, updatedAt: true },
  })
  const byKey = new Map(rows.map((r) => [r.key, r]))

  return Object.entries(FEATURE_FLAGS).map(([key, def]) => {
    const row = byKey.get(key)
    return {
      key,
      // A stored value of null is not a meaningful override for these flags —
      // fall back to the default rather than surfacing a null switch.
      value: row && row.value !== null ? row.value : def.defaultValue,
      description: def.description,
      category: def.category,
      isOverridden: row !== undefined,
      // Report the same value the write path enforces, so the UI never offers
      // an edit the API would reject. All six registry entries are editable
      // today, which makes this identical to `row ? row.isEditable : true`.
      isEditable: def.isEditable && (row ? row.isEditable : true),
      updatedAt: row ? row.updatedAt.toISOString() : null,
    }
  })
}

/** The registry metadata for every flag, for clients that render the catalogue. */
export function featureFlagDefinitions(): Record<
  string,
  { description: string; category: string; defaultValue: unknown }
> {
  return Object.fromEntries(
    Object.entries(FEATURE_FLAGS).map(([key, def]) => [
      key,
      { description: def.description, category: def.category, defaultValue: def.defaultValue },
    ])
  )
}

/**
 * Whether a flag exists and may be written to.
 *
 * Returns `false` for an unknown key and for a flag locked in the registry or by
 * a stored row — the UI disables those controls, but a crafted request bypasses
 * the UI entirely, so the check has to happen here too.
 *
 * `key` is untrusted (it comes from a URL) and stays typed `string` for that
 * reason. The membership test is `Object.hasOwn`, not `in`: the registry is a
 * plain object literal, so `in` and a bare `FEATURE_FLAGS[key]` both resolve
 * inherited keys — `__proto__`, `constructor`, `toString` — to a truthy value
 * that is not a flag at all.
 */
export async function isFeatureFlagWritable(tenantId: string, key: string): Promise<boolean> {
  if (!Object.hasOwn(FEATURE_FLAGS, key)) return false
  const definition = FEATURE_FLAGS[key as FeatureFlagKey]

  const row = await prisma.systemConfig.findUnique({
    where: { tenantId_key: { tenantId, key } },
    select: { isEditable: true },
  })
  // Both gates, not either: the registry lock survives clearing the override
  // row, and the row lock is per tenant. No row means nothing has locked it.
  return definition.isEditable && (row?.isEditable ?? true)
}

/**
 * What a successful save left behind, taken from the row the write itself
 * returned — never a read-back, which can observe a concurrent reset and report
 * "no row" for a write that did happen.
 *
 * A union, not a shape with a hardcoded `isOverridden: true`, because a save
 * has two honest outcomes: the value differs from the registry default and is
 * stored as an override, or it is the default and the correct stored state is
 * no row at all. Collapsing the second into the first is what produced mirror
 * rows and a response claiming an override that did not exist.
 */
export type FeatureFlagWriteResult =
  | {
      /** An override row exists after the call, so the flag is off-default. */
      isOverridden: true
      /** The database-maintained timestamp of the row that was written. */
      updatedAt: Date
    }
  | {
      /**
       * No override row exists: the submitted value is the registry default, so
       * "no row" is the correct stored state, not a failed write.
       */
      isOverridden: false
      /** No row, so no timestamp — the same shape a reset reports. */
      updatedAt: null
      /**
       * Rows the deletion removed. `0` means nothing was stored and nothing
       * needed to be, which is a no-op rather than a failure, and is what lets
       * the caller skip an audit entry for a change that never happened.
       */
      removed: number
    }

/**
 * Whether a submitted value would be indistinguishable from the default.
 *
 * The test is deliberately phrased against the READER rather than the value:
 * `resolveFeatureFlags` renders the default whenever no row exists, or when a
 * row holds a JSON `null`, so those are exactly the two cases where storing a
 * row would create an override the reader cannot act on — it would report
 * `isOverridden: true` while displaying the default. Anything the reader would
 * show as the default is therefore not stored, which keeps "a row exists if and
 * only if the effective value differs from the default" true for every input
 * rather than only for the six booleans that exist today.
 *
 * Non-primitive values are compared in JSON terms, because that is what
 * `SystemConfig.value` holds: two values that serialise identically are the same
 * stored value.
 */
function storesTheDefault(value: unknown, defaultValue: unknown): boolean {
  // A stored JSON `null` is a NOT NULL column holding JSON null, so it is
  // writable — but `resolveFeatureFlags` deliberately reads it as "no meaningful
  // override". Storing one would mint a row the reader throws away.
  if (value === null) return true
  if (value === defaultValue) return true
  if (typeof value !== 'object') return false
  return typeof defaultValue === 'object' && defaultValue !== null
    ? JSON.stringify(value) === JSON.stringify(defaultValue)
    : false
}

/**
 * Persist a flag override, creating the row on first write.
 *
 * This is the only function here that writes, and it is reached exclusively
 * from an explicit mutation.
 *
 * A value equal to the registry default is a reset, not a write: the row is
 * deleted instead of created, because storing the default as an override is
 * precisely the shadowed mirror row `SystemConfig` must not contain — it would
 * report the flag as "Overridden", show a Reset button for an override that is
 * not a deviation, and keep the tenant pinned to a value the registry no longer
 * holds. The deletion is the same one `clearFeatureFlagOverride` performs, so
 * "no override" has one code path and one set of semantics whether a caller
 * asked for a reset or simply saved the value it already had.
 *
 * Throws for a key that is not in the registry. The declared `FeatureFlagKey`
 * type says that cannot happen, but a caller holding an untrusted key must cast
 * to get here, so the runtime check stands in for the compiler rather than
 * replacing it — without it an unknown key would reach the `create` branch and
 * dereference `undefined`.
 */
export async function setFeatureFlag(
  tenantId: string,
  key: FeatureFlagKey,
  value: unknown
): Promise<FeatureFlagWriteResult> {
  if (!Object.hasOwn(FEATURE_FLAGS, key)) {
    throw new Error(`Unknown feature flag: ${key}`)
  }
  const definition = FEATURE_FLAGS[key]

  if (storesTheDefault(value, definition.defaultValue)) {
    return {
      isOverridden: false,
      updatedAt: null,
      removed: await clearFeatureFlagOverride(tenantId, key),
    }
  }

  const saved = await prisma.systemConfig.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value: value as Prisma.InputJsonValue, updatedAt: new Date() },
    create: {
      tenantId,
      key,
      value: value as Prisma.InputJsonValue,
      description: definition.description,
      category: definition.category,
    },
  })

  return { isOverridden: true, updatedAt: saved.updatedAt }
}

/**
 * Drop a tenant's override so the flag falls back to its registry default, and
 * report how many rows that removed.
 *
 * Also the deletion half of `setFeatureFlag`, which routes a save of the default
 * value here so both produce one stored state and one caller contract.
 *
 * The count is what lets the caller avoid claiming an override was reverted when
 * there was nothing there to revert. Idempotent: a second call removes nothing
 * and returns 0, which is a success, not an error.
 */
export async function clearFeatureFlagOverride(tenantId: string, key: string): Promise<number> {
  const { count } = await prisma.systemConfig.deleteMany({ where: { tenantId, key } })
  return count
}
