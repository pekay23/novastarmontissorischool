import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { ADMISSIONS_OPEN_DEFAULT, ADMISSIONS_OPEN_FLAG_KEY } from '@novastar/shared-types'
import { PLATFORM_ADMIN_ROLES, type PlatformRole } from '@/lib/constants/platform-roles'

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
 * does: `applyFeatureFlagChange` stores a row only when the submitted value
 * differs from the registry default, and a submitted value that *is* the default
 * is a reset. That is what keeps "overrides only" an invariant of the data
 * rather than a convention the code follows by hand. `setFeatureFlag` enforces
 * the same rule for callers that do not need the transactional path.
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
  /**
   * Roles permitted to change this flag through the generic
   * `PATCH /api/system/config/:key` route.
   *
   * Absent means the platform-admin set (HEADMASTER alone) — the flag is
   * platform infrastructure. Present means exactly those roles.
   *
   * An EMPTY array is the meaningful case: it means the flag is owned by a
   * dedicated route elsewhere and no role may write it through this one, so the
   * generic route refuses it and `resolveFeatureFlags` omits it from the read.
   * That keeps one writer — and therefore one audit action — per flag.
   */
  manageRoles?: readonly PlatformRole[]
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
  // Keyed by the shared constant, not by a literal, because the public site
  // reads this exact string to decide whether to publish the application form.
  // A second spelling here would strand the portal's writes where the site does
  // not look, with no error on either side. `manageRoles: []` moves the write to
  // `PATCH /api/admissions/status`, which is the only place admissions state
  // changes: one writer per flag means one audit action to read back.
  [ADMISSIONS_OPEN_FLAG_KEY]: {
    description: 'Enable admissions and enrollment',
    category: 'academics',
    defaultValue: ADMISSIONS_OPEN_DEFAULT,
    isEditable: true,
    manageRoles: [],
    schema: z.boolean(),
  },
} as const satisfies Record<string, FlagDefinition>

/** The registered flag keys. */
export type FeatureFlagKey = keyof typeof FEATURE_FLAGS

/**
 * Whether `role` may write `flag` through the generic
 * `PATCH /api/system/config/:key` route.
 *
 * `null` — an unauthenticated session, or a role name that is not a seeded
 * platform role — is refused on BOTH paths, including the absent-`manageRoles`
 * one. `PLATFORM_ADMIN_ROLES.includes(null)` would already be false, so going
 * through `isPlatformAdmin` would give the same answer; the check is spelled
 * out here because this function is the only gate on this route, and a role set
 * that a later edit made `readonly (PlatformRole | null)[]` must not quietly
 * become an allow-everything when `null` is the caller.
 *
 * The registry entry is widened to `FlagDefinition` before the property is read:
 * the registry is an `as const` literal, so entries that declare no
 * `manageRoles` make a direct access on the key union a compile error rather
 * than the `undefined` that means "platform infrastructure".
 */
export function canManageFlag(flag: FeatureFlagKey, role: PlatformRole | null): boolean {
  if (role === null) return false
  const definition: FlagDefinition = FEATURE_FLAGS[flag]
  return (definition.manageRoles ?? PLATFORM_ADMIN_ROLES).includes(role)
}

/**
 * The flags `role` may write through the generic route, in registry order.
 *
 * Registry order rather than a sorted or filtered copy of some other list, so a
 * client rendering the returned catalogue sees the same sequence as everyone
 * reading the registry. `Object.keys` on a string-keyed object literal preserves
 * insertion order; the cast is the same one `isFeatureFlagWritable` makes, and
 * the entries it selects are all `Object.hasOwn`-checked by the registry itself.
 */
export function manageableFlagKeys(role: PlatformRole | null): FeatureFlagKey[] {
  return (Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]).filter((key) => canManageFlag(key, role))
}

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
  /**
   * The token a client echoes back as a precondition so a write that was based
   * on a stale read is refused instead of silently overwriting someone else's
   * change. `0` means no override row exists — see `applyFeatureFlagChange`.
   *
   * Published on the read path so the client can seed a precondition from the
   * state it actually rendered, rather than having to guess it.
   */
  version: number
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
    select: { key: true, value: true, isEditable: true, updatedAt: true, version: true },
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
      // Same rule the write path applies: an absent row is version 0, so a
      // client that seeds a precondition from here sends 0 for a flag nobody
      // has ever overridden.
      version: row?.version ?? 0,
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
 * The test is phrased against the READER rather than the value: `resolveFeatureFlags`
 * renders the default whenever no row exists, or when a row holds a JSON `null`,
 * so those are exactly the cases where storing a row would create an override
 * the reader cannot act on — it would report `isOverridden: true` while showing
 * the default. Anything the reader would show as the default is therefore not
 * stored.
 *
 * `undefined` counts as "not storable" for the same reason: Prisma treats it as
 * "field not provided", so an upsert carrying it would write no value at all
 * and still report a successful save.
 *
 * Deliberately a strict comparison, not a deep one. Every flag is registered
 * with a scalar schema (`z.boolean()`), and those compare by value. A deep
 * comparison would have to answer "is this the same JSON document?", which
 * `JSON.stringify` gets wrong against a `JSONB` column — the column normalises
 * key order on read, so `{b,a}` and `{a,b}` are one stored value — and it throws
 * on a cyclic input, turning a bad request into a 500. A future non-scalar flag
 * should decide this question when it is registered, where its value semantics
 * are actually known.
 */
function storesTheDefault(value: unknown, defaultValue: unknown): boolean {
  if (value === null || value === undefined) return true
  return value === defaultValue
}

/**
 * The slice of a Prisma client the write helpers below need, so the same code
 * can run against the pooled client or against a transaction handle. Typing it
 * as the intersection of the two is what forces a helper to work identically
 * either way — a helper that reached for anything outside `systemConfig` would
 * not type-check, and could not quietly escape its transaction.
 */
type SystemConfigClient = Pick<Prisma.TransactionClient, 'systemConfig'>

/**
 * Delete a tenant's override row and report how many rows that removed.
 *
 * Shared by the standalone `clearFeatureFlagOverride` and by the transaction
 * body, so "no override" has one code path and one set of semantics whichever
 * way it is reached. Scoped to one tenant and one key on every path: the tenant
 * always comes from the argument, never from a row the caller supplied.
 */
async function deleteOverride(
  client: SystemConfigClient,
  tenantId: string,
  key: string
): Promise<number> {
  const { count } = await client.systemConfig.deleteMany({ where: { tenantId, key } })
  return count
}

/**
 * Upsert an override row, creating it at version 1 and bumping the version on
 * every later write.
 *
 * `create` sets `version: 1` explicitly rather than leaning on the column
 * default. The default is what a row holds when it is *created*, and a
 * precondition of 0 means "there is no override at all" — so a first write that
 * landed on 0 would be indistinguishable from a flag nobody had ever touched,
 * and a stale tab holding 0 could overwrite it. Writing 1 on create keeps "row
 * exists" and "row does not exist" as two different numbers.
 *
 * The `update` half increments rather than assigning: a client-supplied version
 * has already been checked against the row that was read, and re-deriving the
 * new value from the old one here is what stops a caller from pinning the
 * counter backwards.
 *
 * Returns the row's own `updatedAt` and `version` rather than values computed
 * here, so the response reports what the database stored.
 */
async function writeOverrideRow(
  client: SystemConfigClient,
  tenantId: string,
  key: FeatureFlagKey,
  definition: FlagDefinition,
  value: unknown
): Promise<{ updatedAt: Date; version: number }> {
  return client.systemConfig.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: {
      value: value as Prisma.InputJsonValue,
      updatedAt: new Date(),
      version: { increment: 1 },
    },
    create: {
      tenantId,
      key,
      value: value as Prisma.InputJsonValue,
      description: definition.description,
      category: definition.category,
      version: 1,
    },
    select: { updatedAt: true, version: true },
  })
}

/**
 * Persist a flag override, creating the row on first write.
 *
 * `applyFeatureFlagChange` is what the API route uses: it puts the writability
 * check, the previous-value read and the write in one transaction, and takes a
 * version precondition. This function is the non-transactional half of the same
 * rule, kept for callers that hold no untrusted key and need only the storage
 * transition — it is NOT a safe substitute for the route, because a gate
 * checked outside the write can be invalidated by a concurrent request between
 * the two.
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
      removed: await deleteOverride(prisma, tenantId, key),
    }
  }

  const saved = await writeOverrideRow(prisma, tenantId, key, definition, value)

  return { isOverridden: true, updatedAt: saved.updatedAt }
}

/**
 * Drop a tenant's override so the flag falls back to its registry default, and
 * report how many rows that removed.
 *
 * Shares `deleteOverride` with `setFeatureFlag` and with the transaction body
 * of `applyFeatureFlagChange`, so "no override" is one delete with one set of
 * semantics no matter which door a caller came in by.
 *
 * The count is what lets the caller avoid claiming an override was reverted when
 * there was nothing there to revert. Idempotent: a second call removes nothing
 * and returns 0, which is a success, not an error.
 */
export async function clearFeatureFlagOverride(tenantId: string, key: string): Promise<number> {
  return deleteOverride(prisma, tenantId, key)
}

/**
 * What one transactional flag mutation did, or why it refused to.
 *
 * A union rather than a result object with status flags, because the three
 * outcomes are genuinely different states and a caller that ignores `status`
 * must not be handed a previous value and a timestamp for a write that never
 * happened. The applied arm is `FeatureFlagWriteResult` plus what the route
 * needs for its audit line and its response, so the contradiction it already
 * forbids — an override with no timestamp, or a timestamp with no override — is
 * still unrepresentable here.
 *
 * The two applied arms are written out rather than intersecting with the whole
 * union, because `A & (B | C)` does not distribute: `change.removed` would be a
 * compile error on the intersection even though the value is right there on one
 * of its arms. Spelling out `Extract<…>` per arm is what keeps destructuring
 * usable at the call site without weakening the invariant.
 *
 *   * `read-only` carries nothing, because nothing was learned about storage
 *     and the caller has to answer 403.
 *   * `conflict` carries the version that is actually stored, which is the only
 *     thing that lets a stale client recover instead of retrying blindly.
 */
export type FeatureFlagChangeResult =
  | { status: 'read-only' }
  | { status: 'conflict'; currentVersion: number }
  | ({
      status: 'applied'
      previousValue: unknown
      version: number
    } & Extract<FeatureFlagWriteResult, { isOverridden: true }>)
  | ({
      status: 'applied'
      previousValue: unknown
      version: number
    } & Extract<FeatureFlagWriteResult, { isOverridden: false }>)

/**
 * Bounds on the interactive transaction below, in milliseconds.
 *
 * An interactive transaction holds a pooled connection open for as long as its
 * body runs, and the Neon adapter turns every statement into a round trip, so an
 * unbounded one ties up a connection and a request for as long as the database
 * feels like answering — the request never finishes, it just stops being
 * monitored. The body below is one indexed lookup and one row write.
 *
 * `maxWait` caps how long the transaction may sit in the pool's queue before it
 * gets a connection at all; `timeout` caps the body once it has one. Both are
 * set rather than inherited from Prisma's defaults so the ceiling is a decision
 * in this file instead of a version-dependent default nobody re-reads.
 *
 * `timeout` sits deliberately ABOVE the per-query deadline, and that ordering is
 * load-bearing rather than incidental. `DB_QUERY_TIMEOUT_MS` bounds each query at
 * 10s, and the body is at most two of them, so a transaction ceiling at or below
 * that would expire first and replace a legible `DbTimeoutError` — which says
 * the database did not answer in time — with Prisma's own opaque
 * "transaction closed" failure, which says only that a deadline was crossed. The
 * ceiling is the backstop; the per-query deadline is the error a caller is meant
 * to see, so the two must be ordered the other way round.
 *
 * The remaining 10s of headroom covers the rollback. A body that gives up on a
 * query does not end the transaction quietly: the engine issues `ROLLBACK` as a
 * further statement on the same connection and only then settles the
 * `$transaction` promise, so that is one more round trip past the last query's
 * own deadline, and it is not covered by any client-side bound.
 */
const FLAG_TRANSACTION_BOUNDS = { maxWait: 2_000, timeout: 35_000 } as const

/**
 * Apply a whole flag change — gate, precondition and write — atomically.
 *
 * The route's single entry point for mutating a flag. It exists because doing
 * this in separate round trips was wrong in two distinct ways:
 *
 *   * A gate checked outside the write is a check on a state that can change
 *     before the write lands. A row locked by one request could be unlocked by
 *     the next, or the reverse, and the handler would enforce a verdict that
 *     described a row it no longer read.
 *   * Two Head of School tabs saving the same flag both read the same version
 *     and both write, so the second silently discards the first. Last write wins
 *     is indistinguishable, in the data and in the audit trail, from a change
 *     nobody else made.
 *
 * Both fall out of putting the read and the write in one transaction and
 * refusing a write whose `expectedVersion` no longer matches. A caller that
 * supplies no precondition gets last write wins still — the schema change makes
 * the safe path available, it does not force it — which is why the condition is
 * `undefined`-tolerant rather than mandatory.
 *
 * Version semantics: no row is 0, a freshly created row is 1, every later write
 * is the previous version plus one, and deleting the row returns the flag to 0.
 * That last one is what makes a reset invalidate the preconditions other tabs
 * are holding: a tab that saw an override at version 3 must not be able to
 * recreate it after someone reset it, and 0 no longer matches 3.
 *
 * Throws for a key that is not in the registry, and does so *before* opening a
 * transaction: a crafted URL segment must cost zero connections as well as zero
 * queries. Same `Object.hasOwn` reason as `isFeatureFlagWritable` — the
 * registry is a plain object literal, so an inherited key resolves to something
 * truthy that is not a flag.
 */
export async function applyFeatureFlagChange(
  tenantId: string,
  key: FeatureFlagKey,
  value: unknown,
  expectedVersion?: number
): Promise<FeatureFlagChangeResult> {
  if (!Object.hasOwn(FEATURE_FLAGS, key)) {
    throw new Error(`Unknown feature flag: ${key}`)
  }
  const definition = FEATURE_FLAGS[key]

  return prisma.$transaction(
    async (tx): Promise<FeatureFlagChangeResult> => {
      // One read, and it is the only one. The writability gate, the previous
      // value and the version precondition all need columns from the same row,
      // and reading them together inside the transaction is what makes them
      // describe the row the write below actually reaches. Three separate reads
      // would each be a statement about a moment in time, and the gate could
      // end up describing a row the write never saw.
      const row = await tx.systemConfig.findUnique({
        where: { tenantId_key: { tenantId, key } },
        select: { value: true, isEditable: true, version: true, updatedAt: true },
      })

      // Both gates, not either: the registry lock survives clearing the override
      // row, and the row lock is per tenant. No row means nothing has locked it.
      if (!(definition.isEditable && (row?.isEditable ?? true))) {
        return { status: 'read-only' }
      }

      // An absent row is version 0, which is what makes "no override" a
      // precondition a client can hold rather than an absence it cannot express.
      const currentVersion = row?.version ?? 0
      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        return { status: 'conflict', currentVersion }
      }

      // Same fallback `resolveFeatureFlags` applies, so the audit line and the
      // read path agree on what the previous value was: a stored `null` is not a
      // meaningful override and a missing row was at the default.
      const previousValue = row?.value ?? definition.defaultValue

      // A value equal to the registry default is a reset, not a write, and the
      // version goes back to 0 with the row — see the docstring above.
      if (storesTheDefault(value, definition.defaultValue)) {
        const removed = await deleteOverride(tx, tenantId, key)
        return {
          status: 'applied',
          previousValue,
          version: 0,
          isOverridden: false,
          updatedAt: null,
          removed,
        }
      }

      const saved = await writeOverrideRow(tx, tenantId, key, definition, value)
      return {
        status: 'applied',
        previousValue,
        version: saved.version,
        isOverridden: true,
        updatedAt: saved.updatedAt,
      }
    },
    FLAG_TRANSACTION_BOUNDS
  )
}
