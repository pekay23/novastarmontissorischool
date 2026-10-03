/**
 * PATCH  /api/system/config/:key   — update or reset a feature flag
 *
 * Only HEADMASTER role can access. Mutations are audit-logged.
 *
 * Response: `{ flag: { key, value, reset, isOverridden, updatedAt, version } }`.
 * `reset` reports what the client asked for; `isOverridden`, `updatedAt` and
 * `version` report what is actually stored, because `SystemConfig` holds
 * overrides only and a save of the registry default correctly stores no row.
 * `updatedAt` is therefore the persisted override row's timestamp as an ISO
 * string, and `null` whenever no row survives. `value` is the value the flag
 * resolves to, which is the submitted one unless the submission was the default.
 * The stored triple comes from the write itself, so they cannot disagree: a
 * successful write never reports `isOverridden: true` alongside a null timestamp.
 *
 * `version` is the optimistic-concurrency token: `0` when no override row
 * exists, `1` on the row a first write creates, and one more on every later
 * write. Send it back as `expectedVersion` on the next request.
 *
 * Errors: `404` unknown flag, `400` malformed body or a value the flag's own
 * registry schema refuses, `403` a non-HEADMASTER caller or a read-only flag,
 * and `409` when `expectedVersion` no longer matches — whose body is
 * `{ error, details: { currentVersion } }`, the same `{ error, details? }` shape
 * the 400s use, carrying the version that is actually stored so the client can
 * resync and retry. `expectedVersion` is optional throughout: a request that
 * omits it asks for no precondition and keeps last-write-wins semantics.
 *
 * `ConfigFlag` and `PatchedFlagResponse` in the settings page mirror this
 * shape.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { logAuditEvent, AuditLogAction } from '@/lib/audit/logger'
import { toErrorResponse } from '@/lib/api-response'
import { isPlatformAdmin } from '@/lib/constants/platform-roles'
import { FEATURE_FLAGS, type FeatureFlagKey, applyFeatureFlagChange } from '@/lib/system-config'

/**
 * The optimistic-concurrency precondition, on both branches below: a write and a
 * reset can each be made stale by another tab, and a reset that lands after
 * someone else already reset is still a change that was made blind.
 *
 * Optional, and that is deliberate. A precondition nobody supplies would break
 * every existing client, and making it mandatory would turn "the server refuses
 * a write based on state the client never read" into a rule the API cannot
 * state. Absent means "not requested" — the write proceeds on last-write-wins,
 * which is what the API has always done; present means "refuse unless the stored
 * version still matches". Non-negative because the column is non-negative, so a
 * negative value could only ever be a client bug and is rejected as a bad body
 * rather than reported as a conflict it can never satisfy.
 */
const expectedVersionSchema = z.number().int().nonnegative().optional()

/**
 * Body of a PATCH, as a union because the two cases are not the same request:
 * a write has to carry a `value`, a reset must not need one — the reset path
 * uses the registry default and never reads what was sent. `reset` stays
 * optional on the write branch because omitting it is how a plain update has
 * always been expressed. What the value may be is decided by the flag's own
 * registry schema below, not here.
 */
const patchBodySchema = z.discriminatedUnion('reset', [
  z.object({ reset: z.literal(true), expectedVersion: expectedVersionSchema }),
  z.object({
    reset: z.literal(false).optional(),
    value: z.unknown(),
    expectedVersion: expectedVersionSchema,
  }),
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
    // Only now, once the key is known to be a real flag: the catch block
    // interpolates this into the stored `endpoint`, and an arbitrary URL segment
    // has no business being written into a row an operator later reads back.
    flagKey = key

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

    // What the flag holds once this request is applied: the submitted value on
    // a write, the registry default when the request asked for a reset. A save
    // that lands on the default also resolves to the default, because the write
    // treats that as a reset rather than a write.
    const resetRequested = body.data.reset === true
    const resolvedValue = resetRequested ? definition.defaultValue : newValue

    // Gate, precondition, previous-value read and write, as one transaction.
    // Nothing above this line has touched storage, so every status code decided
    // so far — 403, 400, 404 — still costs zero writes.
    //
    // The read the audit line needs is no longer a separate concern from
    // ordering: it is the same read that enforces the gate, and it is inside the
    // same transaction as the write, so "from" cannot be a read-back of the
    // value just written and cannot observe a concurrent reset.
    const change = await applyFeatureFlagChange(
      session.tenantId,
      flag,
      resolvedValue,
      body.data.expectedVersion
    )

    // The UI disables controls for read-only flags, but a crafted request
    // bypasses that entirely — enforce it here or the column is theatre.
    if (change.status === 'read-only') {
      return NextResponse.json({ error: `Feature flag '${key}' is read-only` }, { status: 403 })
    }

    // Another tab wrote between this client's read and this request, so applying
    // the change now would silently discard that write. 409 with the stored
    // version is the only answer that lets the client recover: it can resync and
    // decide again, rather than either losing its edit or replaying it over the
    // top of somebody else's.
    if (change.status === 'conflict') {
      return NextResponse.json(
        {
          error: `Feature flag '${key}' was changed by another session`,
          details: { currentVersion: change.currentVersion },
        },
        { status: 409 }
      )
    }

    const { previousValue: from, isOverridden, updatedAt, version } = change

    // Record only what actually changed. Storage must have moved AND the value
    // the reader would report must have moved. Either half alone is not enough:
    // an upsert always fires, so saving the value a flag already holds would log
    // "updated from true to true" — the exact noise this line exists to avoid.
    // And "reset to default" for a flag that was already at its default would
    // tell an auditor an override was reverted when no row ever existed. What is
    // left is the honest no-op: nothing stored, nothing needing storage.
    //
    // `removed` is reached through the `isOverridden` discriminant rather than
    // destructured, because the result type only carries it on the arm where a
    // deletion happened: an override has no row count to report, and widening
    // the type with a `removed: 0` placeholder would hide exactly the case this
    // half of the guard exists for.
    const storageMoved = isOverridden || change.removed > 0
    if (storageMoved && from !== resolvedValue) {
      await logAuditEvent({
        userId: session.userId,
        action: AuditLogAction.SYSTEM_UPDATE,
        entity: 'feature_flag',
        entityId: flag,
        description: isOverridden
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
        isOverridden,
        updatedAt: updatedAt ? updatedAt.toISOString() : null,
        // The token to send back as `expectedVersion` next time. Straight from
        // the write, so a client that stores it is holding the version that is
        // actually in the database rather than one it predicted.
        version,
      },
    })
  } catch (error) {
    return toErrorResponse('SYSTEM_CONFIG_API', error, {
      ...ctx,
      endpoint: flagKey ? `PATCH /api/system/config/${flagKey}` : 'PATCH /api/system/config',
    })
  }
}
