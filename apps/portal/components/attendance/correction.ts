import {
  AMENDMENT_REASON_MAX_LENGTH,
  isLockedRecord,
  lockColumnsOf,
  withAmendmentReason,
} from '../config/amendment'

/**
 * What the marking screen has to know about correcting a register.
 *
 * ## WHY THIS IS SEPARATE FROM THE PAGE
 *
 * Every rule here is a decision, and a decision inside a 450-line client
 * component is a decision no test can reach: the portal renders pages with
 * `renderToStaticMarkup`, which never runs an effect, an event handler or a
 * `fetch`. So the two questions the marking screen asks — "does this row need a
 * reason from me?" and "may this caller unlock it?" — are answered by exported
 * functions over plain objects, and the page is left holding only wiring.
 *
 * ## WHY UNLOCKING NEEDS A DIFFERENT KEY THAN CORRECTING
 *
 * `attendance:delete` is withheld from every role whose grant rule excludes a
 * `delete` action, which today means everyone except `HEADMASTER`. That is the
 * point: correcting a settled register needs `attendance:edit`, a key a
 * classroom teacher holds, while lifting the lock needs the key the Head of
 * School holds. The route re-checks this server-side — `hasPermission`, not this
 * function — so a caller who forges the role in the session is refused there.
 * This is a courtesy gate, and it is deliberately allowed to be wrong.
 */
import { permissionsForRole, type PlatformRoleName } from '@novastar/shared-types'

/**
 * The longest reason the textarea accepts, pinned to the server's bound.
 *
 * `apps/portal/lib/amendments.ts` owns the real limit and the client half lives
 * in `../config/amendment`; this is an alias rather than a second literal so a
 * change on either side cannot leave the textarea accepting a reason the server
 * will refuse. The server's answer to a longer one is a 400 AFTER the user has
 * written and submitted it, which loses the sentence they spent a minute on.
 */
export const REASON_MAX_LENGTH = AMENDMENT_REASON_MAX_LENGTH

/** Is this register row settled, and therefore in need of a written reason? */
export function isSettledRecord(record: unknown): boolean {
  return isLockedRecord(record)
}

/** The lock's own columns, for display beside the row. */
export function settledColumnsOf(record: unknown): { finalizedAt: string | null; finalizedById: string | null } {
  return lockColumnsOf(record)
}

/**
 * May this caller lift the lock on a settled register?
 *
 * Derived from the same grant table the server enforces, in the spirit of
 * `canAmendRecord` in `../config/amendment`. An unknown or absent role is
 * denied rather than defaulting to the widest grant.
 */
export function canUnlockAttendance(role: string | null | undefined): boolean {
  if (!role) return false
  return permissionsForRole(role as PlatformRoleName).includes('attendance:delete')
}

/** One field a correction would change, as the wire carries it. */
export type AttendanceFieldPatch = 'status' | 'period' | 'notes'

/**
 * Which of these three fields a correction would actually change.
 *
 * Built by DIFFING against the stored row rather than by listing the keys the
 * form submitted. The register form renders every student on every save, so a
 * key list would ask for a reason about a status nobody touched; and the server
 * filters the same way — `changedFields` drops a value that encodes identically
 * on both sides — so a reason prompt for an untouched field would be a promise
 * the server does not keep.
 *
 * `notes` is compared after the same normalisation the write path applies, so
 * clearing a note to `''` reads here as a real change (it becomes `null`) rather
 * than as "identical".
 *
 * A MISSING stored row yields nothing. There is no record to amend, so every
 * supplied field would read as a change and the screen would demand a reason for
 * marking a student who has never been marked. The caller only reaches this with a
 * real row in hand — the correction branch is guarded on the row existing — but
 * the answer for the unreachable case is the one that cannot demand something
 * pointless.
 */
export function changedAttendanceFields(
  stored: { status?: unknown; period?: unknown; notes?: unknown } | null | undefined,
  next: { status?: unknown; period?: unknown; notes?: unknown },
): AttendanceFieldPatch[] {
  if (stored === null || stored === undefined) return []
  const fields: AttendanceFieldPatch[] = []
  const normaliseNotes = (value: unknown): unknown =>
    typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value
  const normalisePeriod = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value)

  if (next.status !== undefined && next.status !== stored?.status) fields.push('status')
  if (next.period !== undefined && normalisePeriod(next.period) !== normalisePeriod(stored?.period)) {
    fields.push('period')
  }
  if (next.notes !== undefined && normaliseNotes(next.notes) !== normaliseNotes(stored?.notes)) {
    fields.push('notes')
  }
  return fields
}

/**
 * The body one correction is sent as.
 *
 * `withAmendmentReason` attaches the reserved key ONLY for a settled row and
 * strips it otherwise — the asymmetry is the whole point, because an unlocked
 * edit that acquired a reason would make the reason the only evidence that
 * anybody thought about the change, which is the silent edit the lock exists to
 * make impossible.
 */
export function attendanceCorrectionBody(
  record: unknown,
  fields: AttendanceFieldPatch[],
  values: Partial<Record<AttendanceFieldPatch, string | null>>,
  reason: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const field of fields) {
    if (values[field] !== undefined) patch[field] = values[field]
  }
  return withAmendmentReason(patch, { locked: isSettledRecord(record), reason })
}