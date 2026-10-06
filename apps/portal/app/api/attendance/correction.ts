import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { applyAmendmentWrite, type AmendmentPlan } from '@/lib/amendments'
import {
  attendanceVisibilityWhere,
  type Visibility,
} from '@/lib/visibility'

/**
 * The one place attendance corrections are decided, shared by every attendance
 * write path.
 *
 * ## WHY THIS FILE EXISTS
 *
 * Attendance has three writers that can all land on an existing row: the bulk
 * marking `POST /api/attendance`, the single-record correction
 * `PATCH /api/attendance/[id]`, and the unlock. Before this file each of them
 * answered "is this row locked, what does the trail owe, and does the edit have
 * to share a transaction with its amendments" for itself, and they disagreed:
 * the PATCH overwrote `markedById` with the correcting user while the POST did
 * the same thing inside its upsert, so a correction destroyed the only
 * attribution the row had. One module, three writers, no second opinion.
 *
 * ## THE MARKER IS NOT A "LAST CHANGED BY" COLUMN
 *
 * `AttendanceStudent.markedById` is `NOT NULL` and is read as "who marked this
 * register". Overwriting it on a correction is what made "changed after the
 * fact" indistinguishable from "always wrong", and it is why the model carries a
 * reason-gated lock at all: the row has nowhere else to say who last touched it.
 * So `writeAttendanceCorrection` never writes `markedById`, and
 * `attendance/route.ts` writes it only on the CREATE branch, where naming the
 * marker is the whole point of the column. "Who changed this, and when" is
 * answered by the `RecordAmendment` rows this module writes, which carry a
 * `userId` and a `createdAt` per changed field — a place to record the
 * correction without overwriting the author.
 */

/** `ENTITY_CONFIG_MAP[...].model` would be; the delegate `applyAmendmentWrite` updates through. */
export const ATTENDANCE_MODEL = 'attendanceStudent'

/** `RecordAmendment.entity` for this model. Derived, not guessed. */
export const ATTENDMENT_ENTITY = 'AttendanceStudent'

/**
 * The one predicate every attendance handler reads and writes through.
 *
 * Two things have to be in it, and the mutation handlers used to carry only the
 * first:
 *
 * - school scope, which for `AttendanceStudent` arrives through the `class`
 *   relation because the model has no `schoolId` column of its own;
 * - row scope, which is the caller's resolved `Visibility`.
 *
 * The row scope composes under `AND` rather than as a spread. A spread lets any
 * later property on the object silently overwrite the scope, so the filter a
 * caller can be trusted with stops being the filter that runs; under `AND` an
 * out-of-scope record simply does not match.
 *
 * Built once and shared by GET, PATCH, DELETE and the amendment-history read so
 * they cannot drift: the defect this exists to close was that the mutation
 * handlers applied a weaker `where` than the read handler in the same file, and
 * a single builder makes that divergence impossible to reintroduce silently.
 * The returned type is the unique-where input, so the same object can be handed
 * to `findFirst`, `update` and `delete` — the write carries the scope rather
 * than merely trusting the read that preceded it.
 */
export function scopedAttendanceWhere(input: {
  id: string
  tenantId: string
  schoolId: string
  visibility: Visibility
}): Prisma.AttendanceStudentWhereUniqueInput {
  const where: Prisma.AttendanceStudentWhereUniqueInput = {
    id: input.id,
    tenantId: input.tenantId,
    class: { schoolId: input.schoolId },
  }
  const scope = attendanceVisibilityWhere(input.visibility)
  if (Object.keys(scope).length > 0) where.AND = [scope]
  return where
}

/**
 * The lock columns, which a correction body may never carry.
 *
 * `UpdateAttendanceSchema` does not mention them, so zod would drop them and the
 * caller's `finalizedAt: null` would be silently discarded — a caller would
 * believe they unlocked a settled register and nothing would say otherwise. The
 * lock migration is explicit that unlocking is a deliberate act with its own
 * authority, so a body naming either column is REFUSED with the path that does
 * have that authority rather than quietly ignored. See `lockFieldRefusal`.
 */
export const ATTENDANCE_LOCK_FIELDS = ['finalizedAt', 'finalizedById'] as const

/** The endpoint that owns the unlock, named in the refusal below. */
export function unfinalizePath(id: string): string {
  return `/api/attendance/${id}/unfinalize`
}

/**
 * The 400 a body that tries to move the lock itself earns, or null.
 *
 * `unlockPath` is appended when the caller knows the record's id, because a
 * refusal that only says "cannot be changed" reads as a dead end — and the lock
 * is deliberately not one. Naming the endpoint turns it into "here is the path
 * that has the authority", which is the difference between a settled register and
 * an unfixable one.
 */
export function lockFieldRefusal(body: unknown, unlockPath?: string): string[] | null {
  if (body === null || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  // Key PRESENCE, not value: `{ finalizedAt: null }` is the dangerous shape, and
  // a truthiness test would read it as absent. An explicit `finalizedAt:
  // undefined` is not a JSON body at all, so it is treated as absent.
  const present = ATTENDANCE_LOCK_FIELDS.filter((field) => field in row && row[field] !== undefined)
  if (present.length === 0) return null
  const unlock =
    unlockPath === undefined
      ? 'Unlock the record first, with a written reason.'
      : `Unlock the record first, with a written reason: POST ${unlockPath}`
  return [`${present.join(' and ')} cannot be changed through a correction. ${unlock}`]
}

/**
 * Write an edit and its amendment rows, or neither.
 *
 * The only branch on `plan.required` anywhere in the attendance surface. When the
 * plan owes the trail something, the edit and the field rows go through one
 * transaction so neither can land without the other; when it owes nothing there
 * is nothing to be atomic with, and a transaction around a single statement
 * would be a claim about atomicity nothing backs up. Both branches name the same
 * scoped `where`, so the write cannot be widened by the transaction.
 *
 * `data` is the caller's validated patch and MUST NOT contain `markedById` or
 * the lock columns; the callers in this directory are responsible for that, and
 * the type carries no such prohibition because Prisma's own update input is what
 * the library's `data` is typed as.
 */
export async function writeAttendanceCorrection(input: {
  where: Prisma.AttendanceStudentWhereUniqueInput
  data: Record<string, unknown>
  plan: AmendmentPlan
}): Promise<unknown> {
  return input.plan.required
    ? await applyAmendmentWrite({
        model: ATTENDANCE_MODEL,
        where: input.where as Record<string, unknown>,
        data: input.data,
        rows: input.plan.rows,
      })
    : await prisma.attendanceStudent.update({ where: input.where, data: input.data })
}