/**
 * GET   /api/admissions/status — whether this school is taking applications
 * PATCH /api/admissions/status — open or close it
 *
 * The one and only writer for the `admissions_open` feature flag. The generic
 * `PATCH /api/system/config/:key` refuses that key with a pointer here (its
 * registry entry declares `manageRoles: []`), so admissions state has exactly
 * one route and therefore exactly one audit action to read back — two writers
 * for one flag would produce two audit lines that disagree about who changed
 * what, and nothing in the data to arbitrate.
 *
 * The key comes from `@novastar/shared-types` rather than a literal, because the
 * public site reads the same string to decide whether to publish the application
 * form. Two spellings would strand this route's writes where the site never
 * looks and it would fall back to its own default — a school that closed
 * admissions still inviting applications, with no error anywhere.
 *
 * Gate: `canManageAdmissions` — HEADMASTER, ADMIN_STAFF, ADMISSIONS_OFFICER. It
 * is wider than the platform-admin set because when this school is taking
 * applications is a per-tenant operational decision, not platform
 * infrastructure. It is still per tenant: `tenantId` comes from the session, so
 * the set widens who may act within a school, never which school.
 *
 * GET response: `{ open, isOverridden, updatedAt, version }`. `open` is the
 * effective state — the stored override, or the fail-closed registry default.
 * `version` is the optimistic-concurrency token, `0` when no override row
 * exists, to be echoed back as `expectedVersion`.
 *
 * PATCH body: `{ open: boolean, expectedVersion?: number }`. Response:
 * `{ status: { open, isOverridden, updatedAt, version } }`, where `open` is the
 * resolved post-write value taken from the write itself, never from a read-back
 * that could observe a concurrent change and report a state nobody asked for.
 *
 * Errors: `403` a role outside `ADMISSIONS_MANAGER_ROLES` or a flag the stored
 * row has locked, `400` malformed body, and `409` a stale `expectedVersion`,
 * whose body is `{ error, details: { currentVersion } }` — the same
 * `{ error, details? }` shape the 400s use, carrying the version actually stored
 * so the client can resync and decide again rather than blindly retry.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { ADMISSIONS_OPEN_DEFAULT, ADMISSIONS_OPEN_FLAG_KEY } from '@novastar/shared-types'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { logAuditEvent, AuditLogAction } from '@/lib/audit/logger'
import { toErrorResponse } from '@/lib/api-response'
import { canManageAdmissions } from '@/lib/constants/platform-roles'
import { applyFeatureFlagChange } from '@/lib/system-config'

/**
 * Body of a PATCH. `expectedVersion` is the same optional precondition the
 * generic flag route takes, with the same rationale: optional so no existing
 * client breaks, but present-and-checked so two tabs of the admissions page
 * cannot each overwrite the other's toggle. Non-negative because the column is,
 * so a negative value could only be a client bug and is rejected as a bad body
 * rather than as a conflict no stored version could ever satisfy.
 */
const patchBodySchema = z.object({
  open: z.boolean(),
  expectedVersion: z.number().int().nonnegative().optional(),
})

export async function GET(_req: NextRequest) {
  // Hoisted so the catch block can attribute the failure to a tenant.
  let ctx: { tenantId?: string; userId?: string } = {}
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    if (!canManageAdmissions(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // One row, no relation, and no second app. The public site is deliberately
    // NOT queried here: it is a static export whose copy of this state is baked
    // at its own build time, so asking it would return this school's answer to
    // a question about the portal, one deploy behind. And no `tenant` relation is
    // needed either — `SystemConfig`'s unique key is `(tenantId, key)`, so the
    // row is already tenant-scoped by construction and a join would only add a
    // second table to read what the key already guarantees.
    const row = await prisma.systemConfig.findUnique({
      where: { tenantId_key: { tenantId: session.tenantId, key: ADMISSIONS_OPEN_FLAG_KEY } },
      select: { value: true, updatedAt: true, version: true },
    })

    // Coerced only after confirming it is a boolean. `SystemConfig.value` is an
    // untyped `JSON` column, so a row could hold a string or a number; reporting
    // that as-is would hand the admissions page a switch whose truthiness is a
    // data-integrity accident, and reporting it as truthy would publish a school
    // as open when nothing authorised that. A non-boolean is treated as absent,
    // which is the same fail-closed answer the public site gives for the same row.
    const open = typeof row?.value === 'boolean' ? row.value : ADMISSIONS_OPEN_DEFAULT

    return NextResponse.json({
      open,
      // Whether a row exists at all, which is what tells an operator whether
      // closing admissions deleted an override or was never overridden. Distinct
      // from `open === false`, which a default-closed tenant also reports.
      //
      // `!== null`, not `!== undefined`. `findUnique` resolves to `null` on a
      // miss, and `null !== undefined` is `true` — so the original check reported
      // `isOverridden: true` for every school that had never touched admissions,
      // the exact case the field exists to distinguish. `resolveFeatureFlags` gets
      // the same question right with `row !== undefined` only because its lookup
      // is a `Map.get`, whose miss really is `undefined`; the two lookups are not
      // interchangeable, and the `row?.` on the two lines below are null-safe in
      // both. `row != null` would also be correct here and tolerates a future
      // refactor to `?? undefined`; `!== null` is used so a miss cannot be read
      // as "overridden" under either representation.
      isOverridden: row !== null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      version: row?.version ?? 0,
    })
  } catch (error) {
    return toErrorResponse('ADMISSIONS_STATUS_API', error, {
      ...ctx,
      endpoint: 'GET /api/admissions/status',
    })
  }
}

export async function PATCH(req: NextRequest) {
  // Hoisted so the catch block can attribute the failure to a tenant.
  let ctx: { tenantId?: string; userId?: string } = {}
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    if (!canManageAdmissions(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const body = patchBodySchema.safeParse(await req.json().catch(() => ({})))
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: body.error.issues },
        { status: 400 }
      )
    }

    // Gate, precondition, previous-value read and write, as one transaction, and
    // delegated rather than reimplemented: "overrides only" is enforced there, so
    // closing admissions deletes the row instead of storing `false`, and the
    // audit line's "from" is read inside the same transaction as the write and
    // therefore cannot observe a concurrent change. Nothing above this line has
    // touched storage, so the 403 and 400 decided so far cost zero writes.
    const change = await applyFeatureFlagChange(
      session.tenantId,
      ADMISSIONS_OPEN_FLAG_KEY,
      body.data.open,
      body.data.expectedVersion
    )

    // The UI does not offer this control for a locked flag, but a crafted
    // request bypasses the UI entirely — enforce it here or the column is theatre.
    if (change.status === 'read-only') {
      return NextResponse.json(
        { error: `Feature flag '${ADMISSIONS_OPEN_FLAG_KEY}' is read-only` },
        { status: 403 }
      )
    }

    // Somebody else opened or closed admissions between this client's read and
    // this request. 409 with the stored version is the only answer that lets the
    // client recover: it can resync and decide again, rather than either losing
    // its toggle or replaying it over the top of somebody else's.
    if (change.status === 'conflict') {
      return NextResponse.json(
        {
          error: `Feature flag '${ADMISSIONS_OPEN_FLAG_KEY}' was changed by another session`,
          details: { currentVersion: change.currentVersion },
        },
        { status: 409 }
      )
    }

    const { previousValue: from, isOverridden, updatedAt, version } = change

    // What admissions now resolve to, taken from the write's own arms rather
    // than read back: an override row survives, so the submitted value is what
    // readers get; no row, so the registry default is — and the submitted value
    // that produced that outcome was itself the default. Reading storage here
    // instead would add a round trip that can disagree with the write.
    const open = isOverridden ? body.data.open : ADMISSIONS_OPEN_DEFAULT

    // Record only what actually changed. Storage must have moved AND the value a
    // reader would report must have moved. Either half alone is not enough: the
    // upsert always fires, so re-saving a school that is already open would log
    // a second "admissions opened" — the noise this line exists to avoid — and
    // closing a school that was never open would tell an auditor an override was
    // reverted when no row ever existed. What is left is the honest no-op:
    // nothing stored, nothing needing storage.
    //
    // `removed` is reached through the `isOverridden` discriminant rather than
    // destructured, because the result type only carries it on the arm where a
    // deletion happened: an override has no row count to report, and widening the
    // type with a `removed: 0` placeholder would hide exactly the case this half
    // of the guard exists for.
    const storageMoved = isOverridden || change.removed > 0
    if (storageMoved && from !== open) {
      await logAuditEvent({
        userId: session.userId,
        action: AuditLogAction.ADMISSIONS_TOGGLE,
        entity: 'admissions',
        entityId: ADMISSIONS_OPEN_FLAG_KEY,
        // From `open`, never from `isOverridden`. `isOverridden` says whether a row
        // survived; reading "a row survived" as "admissions are open" only works
        // because the registry default happens to be `false`. Flip
        // `ADMISSIONS_OPEN_DEFAULT` to `true` and this line reports "opened" for a
        // school that was just closed and "closed" for one that was just opened —
        // while `changes` two lines below records the opposite. That is precisely
        // the two-audit-lines-that-disagree case this route exists to prevent, and
        // it would be a lie in prose that no test on the payload would catch.
        description: open ? 'Admissions opened' : 'Admissions closed',
        // Deliberately terse: the from/to pair lives in `changes`, which is what
        // this entry is hashed over. `logger.ts` hashes `changes` into the chain
        // hash, and this route passes no `details` to fall back on — without a
        // payload the hash would cover only the action, entity id and timestamp,
        // so the values this entry records could be rewritten in the database
        // without breaking the chain. Both members are the flag's own old and new
        // value, already known to be JSON: `from` came out of a `JSON` column and
        // `open` passed this route's own `z.boolean()`. Nothing secret can ride
        // along, and the flag is the only thing this route can write.
        changes: {
          from: from as Prisma.InputJsonValue,
          to: open,
        },
        tenantId: session.tenantId,
        schoolId: session.schoolId ?? undefined,
      })
    }

    return NextResponse.json({
      status: {
        open,
        isOverridden,
        updatedAt: updatedAt ? updatedAt.toISOString() : null,
        // The token to send back as `expectedVersion` next time. Straight from
        // the write, so a client that stores it is holding the version that is
        // actually in the database rather than one it predicted.
        version,
      },
    })
  } catch (error) {
    return toErrorResponse('ADMISSIONS_STATUS_API', error, {
      ...ctx,
      endpoint: 'PATCH /api/admissions/status',
    })
  }
}