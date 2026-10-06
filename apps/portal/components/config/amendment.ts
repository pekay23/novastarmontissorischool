/**
 * The amendment trail, as the portal needs to speak about it.
 *
 * `RecordAmendment` (migrations `20261004170000_record_amendment_trail` and
 * `20261004170500_amendment_lock_columns`) records one row per CHANGED FIELD,
 * append-only, tied together by a writer-minted `groupId`. Everything in this
 * module exists because of that grain:
 *
 *   - One edit is many rows, so the trail is read GROUPS, never rows. A
 *     three-field correction is one group with one reason, and showing it as
 *     three rows would imply three reasons and three decisions.
 *   - `oldValue`/`newValue` are tagged envelopes, not bare JSON, so nothing here
 *     renders `value` without first reading `kind`. `{"kind":"null"}` is a value
 *     (the column held SQL NULL) and an ABSENT key is the other thing entirely —
 *     "this field was not part of the change".
 *   - `reason` is non-empty by database CHECK, so a group without one cannot
 *     exist. The UI still states it, because a stated reason and a rendered
 *     reason are different claims.
 *
 * WHAT "LOCKED" MEANS — quoted from the lock migration's own header, because the
 * word is otherwise read as "immutable": locked means "cannot be edited
 * SILENTLY, not cannot be edited". A locked row is still editable; the edit has to
 * carry a reason. So the UI offers the edit and asks for the reason, rather than
 * greying the row out and turning a data-entry mistake into a support escalation.
 *
 * THE RESERVED BODY KEY
 * ---------------------
 * The reason travels as one reserved top-level key alongside the field edits, and
 * the config route strips it before the entity update. It is declared here as a
 * single constant so the wire name lives in exactly one place ON THIS SIDE.
 *
 * SETTLED, NOT ASSUMED. `apps/portal/lib/amendments.ts` declares the same
 * constant and the config PATCH/POST routes consume it, so the key is no longer an
 * assumption: it is `'amendmentReason'` on both sides, pinned by
 * `tests/amendment-write.test.ts`.
 *
 * The duplication with that module is deliberate and required, not an oversight:
 * it imports `prisma` and `@novastar/database`, so a `'use client'` module that
 * imported it would pull the Prisma client into the browser bundle. The shared
 * fact is a string. Everything else — the grouping, the envelope decoding, the
 * loading — exists ONLY here, because there is no server side that reads a trail
 * back into groups.
 */

import { permissionsForRole, type PlatformRoleName } from '@novastar/shared-types'

/**
 * The reserved top-level PATCH body key carrying the amendment reason.
 *
 * It is NOT an entity field: the config route strips it before the update, which
 * is why sending it is harmless on a row that is not locked and required on one
 * that is. Nothing in `packages/shared-types` declares it — that package belongs
 * to the backend worker — so this constant is the frontend's single point of
 * contact with the wire.
 */
export const AMENDMENT_REASON_KEY = 'amendmentReason'

/**
 * Where the history is read from. NOT YET IMPLEMENTED.
 *
 * The WRITE side of the trail is implemented and tested
 * (`app/api/config/[entityType]/[id]/route.ts`, `lib/amendments.ts`), and the READ
 * side is not: there is no route under `app/api/` serving it, and the 404 branch
 * of `loadAmendmentGroups` exists because that is the live answer today rather
 * than a prediction.
 *
 * Inferred from two conventions rather than invented: the repo routes pluralise
 * the resource (`/api/announcements`, `/api/audit-logs`), so `RecordAmendment`
 * becomes `/api/record-amendments`; and the record is selected by query string
 * because `RecordAmendment` is entity-agnostic and has no `[entityType]` segment
 * of its own to hang a path on.
 *
 * `entityType` is the config registry's own key (`'student'`, `'parent'`), NOT
 * the Prisma model name `RecordAmendment.entity` stores (`'Student'`). The route
 * owns that mapping through `ENTITY_CONFIG_MAP`, because it is the only place
 * that mapping exists, and a client guessing model names would break the day an
 * entry is renamed.
 */
export const AMENDMENT_HISTORY_ENDPOINT = '/api/record-amendments'

/**
 * The longest reason accepted, mirroring `AMENDMENT_REASON_MAX_LENGTH` in
 * `lib/amendments.ts`.
 *
 * A repeated constant, for the same bundling reason as the key above. Enforced
 * here because the server's answer to a longer one is a 400 AFTER the user has
 * written and submitted it: the reason would be lost, and the dialog would report
 * a bare failure for something the user could have been told while typing.
 */
export const AMENDMENT_REASON_MAX_LENGTH = 1000

/** The query that selects one record's whole history. */
export function amendmentHistoryQuery(entityType: string, entityId: string): string {
  return `${AMENDMENT_HISTORY_ENDPOINT}?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`
}

/**
 * Is this record reason-gated?
 *
 * Keyed on the presence of `finalizedAt` alone, which is what the lock columns
 * mean: a non-null `finalizedAt` IS the lock, and clearing the two columns is the
 * unlock. `finalizedById` is deliberately not part of the test — the migration
 * gives it `ON DELETE SET NULL`, so it is legitimately null on a locked row whose
 * finaliser has since been removed, and treating that as "unlocked" would drop the
 * requirement on exactly the record most likely to be disputed.
 *
 * Reads `null` and `undefined` alike: a JSON payload from a route that selects a
 * fixed column set omits the key entirely, and an omitted key is not an unlock.
 */
export function isLockedRecord(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false
  const value = (record as Record<string, unknown>).finalizedAt
  return value !== null && value !== undefined
}

/** The lock's own columns, for display. Absent is not an unlock — see `isLockedRecord`. */
export function lockColumnsOf(record: unknown): { finalizedAt: string | null; finalizedById: string | null } {
  if (!record || typeof record !== 'object') return { finalizedAt: null, finalizedById: null }
  const row = record as Record<string, unknown>
  const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  return { finalizedAt: str(row.finalizedAt), finalizedById: str(row.finalizedById) }
}

/**
 * What a person is told before they type anything.
 *
 * Named for the locked row, and it states the consequence rather than the rule:
 * the reason is recorded against the field that changed, which is what makes it
 * worth collecting.
 */
export function lockNotice(recordName: string): string {
  return `This ${recordName.toLowerCase()} is locked. You can still correct it, but every change must carry a reason, and the reason is recorded against each field you change.`
}

/** The refusal shown when a locked row is submitted with no reason. */
export const MISSING_REASON_MESSAGE =
  'This record is locked, so a reason is required. Describe what is being corrected and why.'

/**
 * Attach the reason to a write body, and only where one is owed.
 *
 * The asymmetry is the whole point:
 *
 *   - Locked: the reason goes in under the reserved key. The route refuses
 *     without it, and mints ONE `groupId` for the body so a multi-field edit is
 *     one group.
 *   - NOT locked: the reserved key is REMOVED even if something upstream put one
 *     there. An unlocked edit must not acquire a reason, because the reason
 *     would then be the only record that anybody thought about the edit — which
 *     is the silent edit the lock exists to make impossible. Stripping it here
 *     also means a create cannot smuggle the key past the route's strip list.
 */
export function withAmendmentReason(
  fields: Record<string, unknown>,
  options: { locked: boolean; reason: string | null | undefined },
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...fields }
  if (!options.locked) {
    delete body[AMENDMENT_REASON_KEY]
    return body
  }
  body[AMENDMENT_REASON_KEY] = (options.reason ?? '').trim()
  return body
}

/**
 * Is this reason one the server will accept?
 *
 * Mirrors `amendmentReasonSchema` in `lib/amendments.ts`: a string, trimmed, at
 * least one character, at most `AMENDMENT_REASON_MAX_LENGTH` after trimming. The
 * blank test is the load-bearing one; the length test is what stops a paste from
 * becoming a 400 after submission.
 */
export function isUsableReason(reason: string | null | undefined): boolean {
  if (typeof reason !== 'string') return false
  const trimmed = reason.trim()
  return trimmed.length > 0 && trimmed.length <= AMENDMENT_REASON_MAX_LENGTH
}

/**
 * One field's change, as a person reads it.
 *
 * `oldValue`/`newValue` are the tagged envelopes the migration documents. SQL
 * NULL in `oldValue` means INSERT and nothing else, and is rendered as such
 * rather than as an empty cell, because "this row was created" and "this field
 * had nothing there" are different facts about a register.
 */
export interface AmendmentFieldChange {
  field: string
  before: string
  after: string
}

/**
 * Decode one envelope into text.
 *
 * Every branch reads `kind` first. A bare `value` with no `kind` is not a shape
 * the table defines, so it renders as an explicit unreadable marker instead of
 * `[object Object]` — a wrong-looking value in an evidence trail is worse than a
 * missing one, because a reader cannot tell it apart from a real one.
 */
export function decodeValue(envelope: unknown): string {
  if (envelope === null) return '(inserted — no previous value)'
  if (envelope === undefined) return '(not part of this change)'
  if (typeof envelope !== 'object') return String(envelope)
  const tagged = envelope as { kind?: unknown; value?: unknown }
  switch (tagged.kind) {
    case 'null':
      return '(empty)'
    case 'bool':
      return tagged.value ? 'Yes' : 'No'
    // Decimal as a STRING in the envelope, and rendered verbatim: a JSON number
    // would print 72.5 for a stored 72.50.
    //
    // The `value === undefined` test is load-bearing. A known `kind` with no
    // `value` is a half-written envelope, and `String(undefined)` would put the
    // literal word "undefined" into an evidence trail — indistinguishable, to a
    // reader, from a stored value that happens to be the string "undefined".
    case 'number':
    case 'decimal':
    case 'string':
    case 'enum':
    case 'date':
    case 'datetime':
      if (tagged.value === undefined) return '(unrecognised value)'
      return typeof tagged.value === 'string' ? tagged.value : String(tagged.value)
    default:
      return '(unrecognised value)'
  }
}

/**
 * One edit, reassembled from the rows that describe it.
 *
 * `actor` is resolved from `userId`/`operatorId`. Exactly one is named, by a
 * database CHECK, so both being null is a broken row rather than an anonymous
 * one — it is rendered as such instead of being smoothed into a blank.
 */
export interface AmendmentGroup {
  groupId: string
  at: string
  actor: string
  reason: string
  fields: AmendmentFieldChange[]
}

interface RawAmendmentRow {
  id?: unknown
  groupId?: unknown
  field?: unknown
  oldValue?: unknown
  newValue?: unknown
  reason?: unknown
  userId?: unknown
  operatorId?: unknown
  createdAt?: unknown
}

/**
 * Fold per-field rows back into per-edit groups, newest first.
 *
 * Grouping happens HERE rather than in the route because the grouping key is
 * client-irrelevant until it is read: the route knows the rows, the reader knows
 * that a register correction is one decision and not six. Ordering is
 * `createdAt` descending within a group so the fields read in the order they were
 * changed, and groups are ordered by their most recent row, so the newest
 * correction is first.
 */
export function groupAmendments(rows: unknown): AmendmentGroup[] {
  if (!Array.isArray(rows)) return []
  const byGroup = new Map<string, { rows: RawAmendmentRow[]; latest: number }>()

  for (const row of rows as RawAmendmentRow[]) {
    const groupId = typeof row?.groupId === 'string' ? row.groupId : ''
    const entry = byGroup.get(groupId) ?? { rows: [], latest: 0 }
    entry.rows.push(row)
    const at = Date.parse(String(row?.createdAt ?? ''))
    if (Number.isFinite(at) && at > entry.latest) entry.latest = at
    byGroup.set(groupId, entry)
  }

  const groups: AmendmentGroup[] = []
  for (const [groupId, entry] of byGroup) {
    const ordered = [...entry.rows].sort(
      (a, b) => Date.parse(String(a.createdAt ?? '')) - Date.parse(String(b.createdAt ?? '')),
    )
    groups.push({
      groupId,
      at: new Date(entry.latest).toISOString(),
      actor: actorLabel(ordered[0]),
      reason: typeof ordered[0]?.reason === 'string' && ordered[0].reason.trim() !== ''
        ? ordered[0].reason
        : '(no reason recorded)',
      fields: ordered.map((row) => ({
        field: typeof row.field === 'string' ? row.field : '(unnamed field)',
        before: decodeValue(row.oldValue),
        after: decodeValue(row.newValue),
      })),
    })
  }

  return groups.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/**
 * The three things a history read can be, kept apart.
 *
 * `not-implemented` is NOT an error branch. The route does not exist yet, and
 * conflating a missing route with a failing one would report "could not load" for
 * a feature that is not built, and would make an empty history and an unreachable
 * history look the same to a person deciding whether to trust a register.
 */
export type AmendmentHistoryRead =
  | { status: 'ok'; groups: AmendmentGroup[] }
  | { status: 'not-implemented' }
  | { status: 'failed'; message: string }

/** The part of `fetch` this read uses, so a test can supply the transport. */
export interface AmendmentFetch {
  (endpoint: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
}

/**
 * Read one record's trail.
 *
 * Separated from the dialog that displays it, and given the transport, for a
 * reason that came from a surviving mutation: with the `fetch` inline in the
 * component, deleting the call that opens the dialog could not be detected by
 * any test, because `renderToStaticMarkup` never runs an effect and the portal
 * has no DOM harness. The effect remains the untestable part — the wiring
 * between `open` and this call is asserted against the source — but the request
 * itself, and every branch of the response, are executed here.
 */
export async function loadAmendmentGroups(
  endpoint: string,
  doFetch: AmendmentFetch = fetch as AmendmentFetch,
): Promise<AmendmentHistoryRead> {
  let res: Awaited<ReturnType<AmendmentFetch>>
  try {
    res = await doFetch(endpoint)
  } catch {
    return { status: 'failed', message: 'Could not reach the server. Check your connection and try again.' }
  }
  if (!res.ok) {
    if (res.status === 404) {
      return { status: 'not-implemented' }
    }
    return { status: 'failed', message: `Could not load amendment history (${res.status}).` }
  }
  const payload = (await res.json()) as { data?: unknown }
  return { status: 'ok', groups: groupAmendments(payload.data) }
}

/** The sentence shown for each failure, so the dialog holds no branch of its own. */
export function historyReadMessage(read: AmendmentHistoryRead): string | null {
  switch (read.status) {
    case 'ok':
      return null
    case 'not-implemented':
      return 'The amendment history endpoint is not implemented yet.'
    case 'failed':
      return read.message
  }
}

function actorLabel(row: RawAmendmentRow | undefined): string {
  const user = typeof row?.userId === 'string' ? row.userId : null
  const operator = typeof row?.operatorId === 'string' ? row.operatorId : null
  if (user && operator) return '(row names two actors — the trail is inconsistent)'
  if (user) return user
  if (operator) return `${operator} (platform operator)`
  return '(no actor recorded)'
}

/**
 * Who may amend, derived from the same grant rules the seed applies.
 *
 * An amendment is an ordinary edit that additionally leaves a trail, so it needs
 * the edit's own permission and nothing more: no separate `amendment:*` key
 * exists in the catalog, and inventing one here would mean the UI refused a
 * correction the backend would have accepted.
 */
export function canAmendRecord(role: string | null | undefined): boolean {
  if (!role) return false
  const granted = permissionsForRole(role as PlatformRoleName)
  return granted.includes('config:write')
}