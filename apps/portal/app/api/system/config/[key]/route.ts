/**
 * PATCH  /api/system/config/:key   — update or reset a feature flag
 *
 * Only HEADMASTER role can access. Mutations are audit-logged.
 *
 * Response: `{ flag: { key, value, reset, isOverridden, updatedAt } }`.
 * `reset` reports what the client asked for; `isOverridden` and `updatedAt`
 * report what is actually stored, because `SystemConfig` holds overrides only
 * and a save of the registry default correctly stores no row. `updatedAt` is
 * therefore the persisted override row's timestamp as an ISO string, and
 * `null` whenever no row survives. `value` is the value the flag resolves to,
 * which is the submitted one unless the submission was the default. The stored
 * pair comes from the write itself, so they cannot disagree: a successful write
 * never reports `isOverridden: true` alongside a null timestamp.
 * `ConfigFlag` and `PatchedFlagResponse` in the settings page mirror this
 * shape.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { logAuditEvent, AuditLogAction } from '@/lib/audit/logger'
import { toErrorResponse } from '@/lib/api-response'
import { isPlatformAdmin } from '@/lib/constants/platform-roles'
import {
  FEATURE_FLAGS,
  type FeatureFlagKey,
  type FeatureFlagWriteResult,
  clearFeatureFlagOverride,
  isFeatureFlagWritable,
  setFeatureFlag,
} from '@/lib/system-config'

/**
 * Body of a PATCH, as a union because the two cases are not the same request:
 * a write has to carry a `value`, a reset must not need one — the reset path
 * uses the registry default and never reads what was sent. `reset` stays
 * optional on the write branch because omitting it is how a plain update has
 * always been expressed. What the value may be is decided by the flag's own
 * registry schema below, not here.
 */
const patchBodySchema = z.discriminatedUnion('reset', [
  z.object({ reset: z.literal(true) }),
  z.object({ reset: z.literal(false).optional(), value: z.unknown() }),
])

export async function PATCH(req: NextRequest, context: { params: Promise<{ key: string }> }) {
  // Hoisted so the catch block can attribute the failure to a tenant and a key.
  let ctx: { tenantId?: string; userId?: string } = {}
  let flagKey: string | undefined
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    if (!isPlatformAdmin(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const { key } = await context.params
    flagKey = key

    // `Object.hasOwn`, not a bare lookup: the registry is a plain object
    // literal, so `FEATURE_FLAGS[key]` resolves inherited keys — `__proto__`,
    // `constructor`, `toString` — to a truthy value that is not a flag. Under
    // the old `if (!definition)` check those keys sailed through and produced a
    // 200 (reset) or a 500 (write) instead of a 404.
    if (!Object.hasOwn(FEATURE_FLAGS, key)) {
      return NextResponse.json({ error: `Unknown feature flag: ${key}` }, { status: 404 })
    }
    const flag = key as FeatureFlagKey
    const definition = FEATURE_FLAGS[flag]

    const body = patchBodySchema.safeParse(await req.json().catch(() => ({})))
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: body.error.issues },
        { status: 400 }
      )
    }

    // The registry schema, not the body schema, decides what a value may be.
    let newValue: unknown
    if (body.data.reset !== true) {
      const result = definition.schema.safeParse(body.data.value)
      if (!result.success) {
        return NextResponse.json({ error: 'Invalid value', details: result.error.issues }, { status: 400 })
      }
      newValue = result.data
    }

    // The UI disables controls for read-only flags, but a crafted request
    // bypasses that entirely — enforce it here or the column is theatre.
    if (!(await isFeatureFlagWritable(session.tenantId, flag))) {
      return NextResponse.json({ error: `Feature flag '${key}' is read-only` }, { status: 403 })
    }

    // What the flag holds once this request is applied: the submitted value on
    // a write, the registry default when the request asked for a reset. A save
    // that lands on the default also resolves to the default, because
    // `setFeatureFlag` treats that as a reset rather than a write.
    const resetRequested = body.data.reset === true
    const resolvedValue = resetRequested ? definition.defaultValue : newValue

    // Read the stored value BEFORE the write. This is the whole fix for the
    // audit line: after an `upsert` the read returns the value just written, so
    // "from" was always "to" and every entry read "updated from X to X"; after a
    // reset there is no row left to read at all. Ordering, not concurrency, is
    // what was wrong. Two overlapping PATCHes can still both report the same
    // starting value while the second overwrote the first — closing that would
    // need a transaction around the read and the write, which is not worth the
    // cost for an audit line about a boolean switch.
    const previous = await prisma.systemConfig.findUnique({
      where: { tenantId_key: { tenantId: session.tenantId, key: flag } },
      select: { value: true },
    })
    // No row means the flag was at its default, and a stored `null` is not a
    // meaningful override — the same fallback `resolveFeatureFlags` applies, so
    // the audit line and the read path agree on what the previous value was.
    const from = previous?.value ?? definition.defaultValue

    // One write, and only two possible stored states: an override row holding
    // `resolvedValue`, or no row at all. Reset removes the override so the flag
    // falls back to its registry default, and `setFeatureFlag` deletes the same
    // row when a save lands on the default — so the two share the deletion, the
    // audit rule and the response instead of forking into separate paths.
    const saved: FeatureFlagWriteResult = resetRequested
      ? {
          isOverridden: false,
          updatedAt: null,
          removed: await clearFeatureFlagOverride(session.tenantId, flag),
        }
      : await setFeatureFlag(session.tenantId, flag, newValue)

    // Record only what actually changed. An override is written by definition;
    // a removal is worth an audit line only if a row was there to remove, because
    // "reset to default" for a flag that was already at its default would tell
    // an auditor an override was reverted when no row ever existed. That leaves
    // the honest no-op — nothing stored, nothing needing storage — with no entry
    // at all rather than a misleading "updated from false to false".
    if (saved.isOverridden || saved.removed > 0) {
      await logAuditEvent({
        userId: session.userId,
        action: AuditLogAction.SYSTEM_UPDATE,
        entity: 'feature_flag',
        entityId: flag,
        description: saved.isOverridden
          ? `Feature flag '${key}' updated from ${JSON.stringify(from)} to ${JSON.stringify(resolvedValue)}`
          : `Feature flag '${key}' reset to default`,
        // `logger.ts` hashes `changes` into the entry's chain hash, and this
        // handler passes no `details` to fall back on — without a payload the
        // hash covers only the action, entity id and timestamp, so the from/to
        // values in the description could be rewritten in the database without
        // breaking the chain. Both members are the flag's own old and new value,
        // already known to be JSON: `from` came out of a JSON column and
        // `resolvedValue` passed the flag's registry schema. Nothing secret can
        // ride along — every registered flag is a boolean, and the `Object.hasOwn`
        // gate above means this route never reads or writes a non-registry key.
        changes: {
          from: from as Prisma.InputJsonValue,
          to: resolvedValue as Prisma.InputJsonValue,
        },
        tenantId: session.tenantId,
        schoolId: session.schoolId ?? undefined,
      })
    }

    return NextResponse.json({
      flag: {
        key,
        // What the flag resolves to now, which is not always what was sent: a
        // save of the default is stored as "no override", and reporting it as a
        // failure would be wrong. The client is driven by `isOverridden` and
        // `updatedAt` for its Override badge and Reset button, so a resolved
        // save reads as "Default" — a success, just not a stored one.
        value: resolvedValue,
        reset: resetRequested,
        isOverridden: saved.isOverridden,
        updatedAt: saved.updatedAt ? saved.updatedAt.toISOString() : null,
      },
    })
  } catch (error) {
    return toErrorResponse('SYSTEM_CONFIG_API', error, {
      ...ctx,
      endpoint: flagKey ? `PATCH /api/system/config/${flagKey}` : 'PATCH /api/system/config',
    })
  }
}
