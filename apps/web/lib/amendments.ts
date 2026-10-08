import { z } from 'zod'
import { Prisma } from '@novastar/database'
// Through `@/lib/prisma` rather than `@novastar/database` directly, so this module
// sits on the same seam every other portal lib does: one specifier a test mocks,
// rather than two clients that could disagree.
import { prisma } from '@/lib/prisma'

/**
 * The server side of the amendment trail: one row per CHANGED FIELD, written in
 * the same transaction as the edit it describes.
 *
 * ## WHAT THE TABLE EXPECTS, AND WHY EVERY RULE HERE FOLLOWS FROM IT
 *
 * `RecordAmendment` is not an `AuditLog` row with a reason column. Reading
 * `packages/database/prisma/schema.prisma` and the migration that creates it,
 * four of its properties are load-bearing, and each one is a rule below rather
 * than a preference:
 *
 *  1. **Grain is the value, not the record.** `field`, `oldValue` and `newValue`
 *     are per-field columns, so a three-field correction is three rows. Which
 *     means the rows have to be told apart from a field the patch merely
 *     NAMED: `changedFields` emits a row only where the encoded value actually
 *     differs, because the generic settings form submits its whole field set on
 *     every save and an unfiltered diff would record twenty rows for a one-field
 *     typo and read as twenty decisions.
 *  2. **`groupId` has no `@default`, on purpose.** The migration says a
 *     `cuid()` default "would give every row a DIFFERENT value and group
 *     nothing, and that is the worst failure available: the column would look
 *     like it works." So nothing here may let the database mint it —
 *     `mintAmendmentGroupId` is the only source, and every row of one edit is
 *     handed the same value.
 *  3. **`oldValue` is SQL NULL only for an insert.** On an update both sides
 *     carry a tagged envelope, and "this field was not part of the change" is an
 *     ABSENT key rather than a `null`. So `encodeAmendmentValue` answers `null`
 *     for `undefined` and a caller drops the field; it never writes SQL NULL for
 *     an update.
 *  4. **`reason` is `NOT NULL` plus a `btrim(reason) <> ''` CHECK.** A CHECK
 *     Prisma cannot express, so the database would reject `''` with a driver
 *     error and the write would fail as a 500 after the row was already
 *     changed. `amendmentReasonSchema` refuses it at the boundary instead, as a
 *     400, before anything is written.
 *
 * ## WHERE THE REASON COMES FROM, AND WHY IT IS MIRRORED HERE
 *
 * The reserved body key is `'amendmentReason'`, declared once in
 * `components/config/amendment.ts` and once here. Two declarations rather than
 * one shared constant is a deliberate trade: that module is a client component
 * and this one is server-side, so importing across the boundary would put a
 * component module into a route's import graph (and a route's `server-only`
 * constraint into the browser bundle's). The duplication is one string literal
 * on each side, and `tests/amendment-write.test.ts` asserts the two agree, so a
 * rename on either side is a failing test rather than a silent wire mismatch.
 *
 * ## WHY THE REASON IS REQUIRED ONLY ON A LOCKED ROW
 *
 * The brief's rule is that the amendment is required when a write changes
 * existing data and never on a create, and the schema settles the narrower case:
 * the `finalizedAt`/`finalizedById` lock columns exist on exactly the four models
 * whose values get disputed, and a non-null `finalizedAt` IS the lock. Requiring
 * a reason on EVERY update would mean editing an unlocked student — a typo in a
 * class name — demands a justification, which is the trail becoming noise. So
 * `planAmendments` asks two questions in this order: did the patch change a
 * stored value, and is the row reason-gated? A reason is owed only when both are
 * yes. A caller who supplies one anyway gets it recorded; recording more
 * evidence is the safe direction, and the client deliberately never does it.
 */

/**
 * The reserved top-level key carrying an amendment reason in a PATCH body.
 *
 * Mirrors `AMENDMENT_REASON_KEY` in `components/config/amendment.ts`; see the
 * header for why this is two constants rather than one.
 */
export const AMENDMENT_REASON_KEY = 'amendmentReason'

/**
 * The longest reason the boundary accepts, in characters after trimming.
 *
 * A bound rather than a hope: `reason` is an unindexed `TEXT` column that is
 * denormalised onto every field row of an edit, so an unbounded one would let a
 * caller store megabytes N times over in an append-only table nothing may ever
 * prune. 1000 characters is roughly four sentences, which is longer than any
 * real justification for one field and short enough that a paste accident is
 * refused rather than stored. Over the limit is a 400.
 */
export const AMENDMENT_REASON_MAX_LENGTH = 1000

/**
 * The reason, as the boundary parses it.
 *
 * `trim()` runs before the length checks, so `'   '` is a 400 rather than a
 * stored string of spaces that would then trip the migration's own
 * `btrim(reason) <> ''` CHECK as a 500. Order is load-bearing: `trim` then
 * `min(1)` then `max` is the only order under which a reason of 1002 spaces is
 * refused as blank rather than as too long, and either answer is correct here.
 */
export const amendmentReasonSchema = z.string().trim().min(1).max(AMENDMENT_REASON_MAX_LENGTH)

/** What the boundary decided about the key the body carried, if any. */
export interface AmendmentReasonRead {
  /** Whether the reserved key was present at all. */
  readonly supplied: boolean
  /** Whether it is present AND acceptable. The only value a writer may store. */
  readonly usable: boolean
  /** The trimmed reason. `''` whenever `usable` is false, so it cannot leak. */
  readonly reason: string
  /**
   * Why it was refused, as fixed strings.
   *
   * Built from the issue CODE and never from `issue.input`, because this list
   * reaches the client inside the 400 body and the input is operator-supplied
   * free text. Nothing in this module interpolates the reason into an error
   * message, a log line or a description.
   */
  readonly problems: readonly string[]
}

const REASON_TOO_LONG = `amendmentReason must be at most ${AMENDMENT_REASON_MAX_LENGTH} characters`
const REASON_BLANK = 'amendmentReason must not be blank'
const REASON_NOT_A_STRING = 'amendmentReason must be a string'

/**
 * The reason a caller supplied, or the refusal it earned.
 *
 * Accepts `unknown` because the caller is a parsed JSON body, and every guard
 * here is the boundary: a body that is not an object carries no key, and a value
 * that is not a string is refused rather than coerced. Nothing downstream ever
 * sees the raw value.
 */
export function readAmendmentReason(body: unknown): AmendmentReasonRead {
  if (body === null || typeof body !== 'object') return { supplied: false, usable: false, reason: '', problems: [] }
  const supplied = (body as Record<string, unknown>)[AMENDMENT_REASON_KEY]
  // An explicit `undefined` is not a supplied reason: JSON has no `undefined`,
  // so it can only arrive from a caller that built the object in memory.
  if (supplied === undefined) return { supplied: false, usable: false, reason: '', problems: [] }

  const parsed = amendmentReasonSchema.safeParse(supplied)
  if (parsed.success) return { supplied: true, usable: true, reason: parsed.data, problems: [] }
  return { supplied: true, usable: false, reason: '', problems: describeReasonIssues(parsed.error) }
}

/**
 * Zod issues, as fixed sentences.
 *
 * Keyed on `issue.code` and nothing else. `issue.message` is also safe on its
 * own, but it is a library string this file does not control, and an error
 * message that changes with a dependency bump is an error message that has to be
 * re-read; the three codes `amendmentReasonSchema` can raise are enumerated here
 * instead.
 */
function describeReasonIssues(error: z.ZodError): string[] {
  const codes = error.issues.map((issue) => issue.code)
  // A value that is not a string is answered with the one sentence about being a
  // string, and nothing else. zod also raises `too_small` for it — a non-string
  // still has no length — and "must not be blank" is not a true statement about a
  // number. The other case, a string that is too long or too short, raises exactly
  // one issue and is reported on its own terms.
  if (codes.includes('invalid_type')) return [REASON_NOT_A_STRING]
  if (codes.includes('too_big')) return [REASON_TOO_LONG]
  return [REASON_BLANK]
}

/**
 * Is this stored row reason-gated?
 *
 * Keyed on `finalizedAt` alone, for the reason the lock migration gives: that is
 * the lock, clearing the pair is the unlock, and `finalizedById` is separately
 * `ON DELETE SET NULL`, so it is legitimately null on a locked row whose
 * finaliser has been removed. Reads `null` and `undefined` alike, because a read
 * that selects a fixed column set omits the key and an omitted key is not an
 * unlock. Mirrors `isLockedRecord` in `components/config/amendment.ts`.
 */
export function isReasonGated(stored: unknown): boolean {
  if (stored === null || typeof stored !== 'object') return false
  const value = (stored as Record<string, unknown>).finalizedAt
  return value !== null && value !== undefined
}

/**
 * One side of one field's change, as the tagged envelope the migration defines.
 *
 * The index signature is not decoration: `oldValue`/`newValue` are `Json`
 * columns, and Prisma's `InputJsonObject` is a mapped type with a string index
 * signature, so an interface without one is not assignable to it. Declaring the
 * permitted value types here is what lets the rows be built with no cast at all,
 * and it states the envelope's real constraint — a tag and at most one scalar —
 * instead of hiding it behind one.
 *
 * `null` from `encodeAmendmentValue` means "not part of this change", which is
 * a statement about the REQUEST and is expressed by omitting the key — never by
 * writing SQL NULL, which the schema reserves for an insert.
 */
export interface AmendmentValue {
  readonly [key: string]: string | number | boolean | undefined
  readonly kind: string
  readonly value?: string | number | boolean
}

/** The envelope for a column that held SQL NULL. */
const NULL_VALUE: AmendmentValue = { kind: 'null' }

/**
 * Is this a Prisma `Decimal` without importing the class?
 *
 * Duck-typed on `toFixed`, which `decimal.js` (what Prisma's `Decimal` is) and
 * `number` both carry and `Date` and `string` do not. Numbers are handled
 * before this is reached, so the one overlap cannot misclassify. Importing
 * `Prisma.Decimal` instead would work too and would couple this file to a
 * concrete runtime class the schema is free to swap.
 */
function isDecimalLike(value: object): boolean {
  return typeof (value as { toFixed?: unknown }).toFixed === 'function'
}

/**
 * Encode one stored or submitted value as the migration's tagged envelope.
 *
 * The tags exist because a bare JSON value loses two things the trail needs: a
 * `@db.Decimal(12,2)` through a JSON number prints `72.5` for `72.50`, and a
 * bare `null` cannot be told from an absent key. So decimals travel as STRINGS,
 * dates as ISO strings tagged `datetime`, and a column that held SQL NULL is
 * `{"kind":"null"}` — a value, distinct from the key that is not there.
 *
 * `undefined` is the one input that has no envelope, because it is not a value
 * the column ever held. `null` is returned for it, and `changedFields` drops the
 * field, which is how "this field was not part of the change" stays
 * expressible.
 */
export function encodeAmendmentValue(value: unknown): AmendmentValue | null {
  if (value === undefined) return null
  if (value === null) return NULL_VALUE
  if (value instanceof Date) {
    // A date column and a timestamp column are told apart by shape, not by
    // knowledge of the schema: Prisma hands both back as `Date`, and a
    // `datetime` ISO string with a time component is distinguishable from a bare
    // `YYYY-MM-DD` one. A `Date` at exactly midnight is tagged `datetime` even
    // where the column was `date`, which over-specifies rather than loses.
    return { kind: 'datetime', value: value.toISOString() }
  }
  if (typeof value === 'boolean') return { kind: 'bool', value }
  if (typeof value === 'number') {
    // `NaN` and `Infinity` are not JSON numbers, so they travel as decimal
    // strings. No column in this schema is a float, so a non-finite number here
    // means something upstream produced it, and stringifying keeps the evidence
    // rather than serialising it to `null`.
    return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'decimal', value: String(value) }
  }
  // A `BigInt` column cannot go through a JSON number without losing precision
  // past 2^53, so it travels as an integer string.
  if (typeof value === 'bigint') return { kind: 'number', value: value.toString() }
  if (typeof value === 'string') return { kind: 'string', value }
  if (typeof value === 'object' && isDecimalLike(value)) {
    // `toString` on a decimal.js value keeps the stored scale: `72.50` stays
    // `72.50`, which is the entire reason this is a string.
    return { kind: 'decimal', value: String(value) }
  }
  // A `Json` column, or anything else this route has not seen before. Encoded as
  // its own JSON text rather than `[object Object]`, which a reader could not
  // tell from a stored value. A value that will not serialise is named as such,
  // because an honest marker beats a fabricated one in an evidence trail.
  try {
    const serialised = JSON.stringify(value)
    return { kind: 'string', value: serialised ?? String(value) }
  } catch {
    return { kind: 'string', value: '[unserialisable value]' }
  }
}

/** One field's before and after, in envelopes, ready to become a row. */
export interface AmendmentFieldChange {
  readonly field: string
  readonly before: AmendmentValue
  readonly after: AmendmentValue
}

/**
 * Are these two envelopes the same value?
 *
 * Both sides are primitives by construction, so the serialised form is normally a
 * complete comparison — with one pairing that needs naming.
 *
 * `fee_line_item.amount` is a `@db.Decimal(12,2)` column while the registry's
 * update schema for it is `z.number()`, because the settings form posts a JSON
 * number. So a caller re-submitting the amount it can already read writes
 * `1200` while the stored row holds the decimal `1200.00`, and the two encode as
 * `{kind:'decimal',value:'1200.00'}` and `{kind:'number',value:1200}`. Compared as
 * serialised text those are different kinds, which would record a change to a fee
 * nobody touched on every single settings-form save — the trail manufacturing
 * evidence of an edit that did not happen, which is the failure the schema calls
 * worse than no trail at all. A decimal and a number that agree numerically are
 * the same value, and a real difference still shows as one.
 *
 * `Number` is safe here rather than a rounding risk: it is only asked whether two
 * representations AGREE, never used to store the value, and the value that is
 * stored is still the decimal string on `before` or the exact number on `after`.
 */
function sameValue(left: AmendmentValue, right: AmendmentValue): boolean {
  if (JSON.stringify(left) === JSON.stringify(right)) return true
  if (left.kind === 'decimal' && right.kind === 'number') return Number(left.value) === right.value
  if (right.kind === 'decimal' && left.kind === 'number') return Number(right.value) === left.value
  return false
}

/**
 * The fields this patch actually CHANGED.
 *
 * Three filters, and each one removes a row the trail would otherwise carry:
 *
 *  - `undefined` written values, which are fields the patch did not mention. The
 *    schema says that state is expressed by omitting the key.
 *  - values that encode identically on both sides, which are the majority of a
 *    settings-form save. `before` is read from the stored row and encoded through
 *    the SAME function as `after`, so a `Date` column compares as two
 *    timestamps rather than as a `Date` and an ISO string and reporting every
 *    date as changed.
 *  - nothing else. A field the stored row lacks is encoded as `{"kind":"null"}`
 *    rather than skipped, because the schema requires both sides of an update to
 *    carry an envelope and skipping would drop a real change from the trail on the
 *    strength of a partial read. The route's own read selects no columns, so for
 *    a real row this branch does not arise.
 */
export function changedFields(
  write: Record<string, unknown>,
  stored: Record<string, unknown> | null | undefined,
): AmendmentFieldChange[] {
  const changes: AmendmentFieldChange[] = []
  for (const [field, next] of Object.entries(write)) {
    const after = encodeAmendmentValue(next)
    if (after === null) continue
    const before = encodeAmendmentValue(stored?.[field]) ?? NULL_VALUE
    if (sameValue(before, after)) continue
    changes.push({ field, before, after })
  }
  return changes
}

/**
 * The one id tying every field row of a single logical edit together.
 *
 * Minted here rather than defaulted by the column, because the migration calls
 * a default the worst available failure: the column would look like it works
 * while grouping nothing. `crypto.randomUUID` rather than a timestamp, because a
 * timestamp is guessable and two edits inside the same millisecond would collide
 * into one group — which is the failure the column was designed to prevent.
 */
export function mintAmendmentGroupId(): string {
  return crypto.randomUUID()
}

/**
 * `RecordAmendment.entity`, which is the Prisma MODEL name.
 *
 * `ENTITY_CONFIG_MAP[...].model` is the delegate name (`'student'`), the column
 * documents the model name (`'Student'`), and the client's history endpoint takes
 * the registry key — so the mapping has to live somewhere, and the only place
 * that holds both spellings is the route that owns the registry. Prisma derives a
 * delegate name from a model name by lowercasing the first letter and nothing
 * else, so this is the exact inverse. Asserted against `schema.prisma` for every
 * registry entry in `tests/amendment-write.test.ts`.
 */
export function amendmentEntityName(delegateName: string): string {
  return delegateName.charAt(0).toUpperCase() + delegateName.slice(1)
}

/** What a caller is told when a reason-gated row changes with no usable reason. */
export const MISSING_AMENDMENT_REASON =
  'This record is locked, so a reason is required for the change. Describe what is being corrected and why.'

/** Everything `planAmendments` needs, and nothing it does not. */
export interface AmendmentPlanInput {
  /** What `readAmendmentReason` decided about the reserved key. */
  readonly reason: AmendmentReasonRead
  /** The validated patch, already stripped of the reserved key. */
  readonly write: Record<string, unknown>
  /** The stored row as the scoped lookup found it, read before the write. */
  readonly stored: Record<string, unknown> | null
  /** `ENTITY_CONFIG_MAP[...].model` — the delegate name, not the model name. */
  readonly model: string
  /** The row's id, from the path: the row the scoped `where` matched. */
  readonly entityId: string
  readonly tenantId: string
  readonly schoolId: string | null
  /** The acting user. Exactly one actor is named, which the database CHECKs. */
  readonly userId: string
}

/** What to write, or the refusal a locked row has earned. */
export interface AmendmentPlan {
  /** The rows to insert, sharing one writer-minted `groupId`. Empty means none. */
  readonly rows: readonly Prisma.RecordAmendmentCreateManyInput[]
  /** The 400 a reason-gated row earns for changing with no usable reason. */
  readonly refusal: readonly string[] | null
  /** Whether the write and its amendments have to share a transaction. */
  readonly required: boolean
}

/**
 * Decide what this edit owes the trail, before anything is written.
 *
 * Pure, and the reason the route stays readable: the interesting half of this
 * feature is a set of rules about what is owed, and rules that are only visible
 * in a route handler are rules nobody can test directly. No database, no
 * request, no response.
 *
 * The two refusals, and why both are 400s against `VALIDATION_FAILED` rather than
 * something new:
 *
 *  - The key was supplied and is unusable. `readAmendmentReason` has already run
 *    at the boundary, so this is `''`, `'   '`, a non-string, or 1001 characters
 *    — a request that cannot be served as written, which is exactly what the
 *    route's existing schema-400 says.
 *  - The key was absent, the patch changed a stored value, and the row is
 *    reason-gated. This is the refusal the lock exists to produce, and it is
 *    stated in the same words the client uses so the two cannot drift.
 *
 * `required` is deliberately narrow: true only when rows are actually to be
 * written. A write with nothing to amend has nothing to be atomic with, and
 * opening a transaction around a single statement would be a claim about
 * atomicity that nothing here backs up.
 */
export function planAmendments(input: AmendmentPlanInput): AmendmentPlan {
  const changes = changedFields(input.write, input.stored)
  const locked = isReasonGated(input.stored)
  const owed = changes.length > 0 && locked

  if (input.reason.supplied && !input.reason.usable) {
    return { rows: [], refusal: [...input.reason.problems], required: false }
  }
  if (owed && !input.reason.usable) {
    return { rows: [], refusal: [MISSING_AMENDMENT_REASON], required: false }
  }
  if (!input.reason.usable || changes.length === 0) {
    // Either nothing changed, so there is nothing to amend, or the caller is not
    // declaring a reason. A no-op patch that arrived with a reason records
    // nothing: the trail says a value moved, and none did.
    return { rows: [], refusal: null, required: false }
  }

  const groupId = mintAmendmentGroupId()
  const rows = changes.map((change) => ({
    tenantId: input.tenantId,
    // Nullable for the same reason `AuditLog.schoolId` is: a cross-tenant
    // operator action has no school to name, and recording a plausible-looking
    // one would be worse than recording the truth.
    schoolId: input.schoolId,
    entity: amendmentEntityName(input.model),
    entityId: input.entityId,
    groupId,
    field: change.field,
    // Both sides carry an envelope. `oldValue` is SQL NULL only for an insert,
    // and this path never runs for one.
    oldValue: change.before,
    newValue: change.after,
    reason: input.reason.reason,
    // Exactly one actor, which the database CHECKs make unrepresentable
    // otherwise. This is a tenant session, so `operatorId` stays null: pointing
    // it at anything would attribute a tenant action to somebody outside it.
    userId: input.userId,
    operatorId: null,
  }))
  return { rows, refusal: null, required: true }
}

/**
 * Transaction bounds, as `api/attendance-takers/route.ts` sets them.
 *
 * `maxWait` is how long a statement may wait for the transaction to be handed a
 * connection before failing outright, and `timeout` how long the whole thing may
 * run. Both matter more here than on a single-statement write: a transaction
 * that gives up halfway is exactly the case where the amendment and the edit
 * must not land apart, and the rollback this depends on is only guaranteed if the
 * driver aborts the whole transaction rather than leaving it open.
 */
export const AMENDMENT_TRANSACTION_BOUNDS = { maxWait: 2_000, timeout: 30_000 } as const

/**
 * The subset of a model's delegate this module calls.
 *
 * The route reads models off a dynamic registry key, so it cannot name
 * `PrismaDelegate` without a cast. The cast is confined to this one function
 * rather than spread across the call, and only `update` is asked for — the
 * amendment trail must never grow an `update` or a `delete` on this model, and an
 * interface that does not declare them is a compile error rather than a review
 * question.
 */
interface WritableDelegate {
  update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>
}

/** One model's delegate on the client it was handed, not on the module's. */
function delegateOn(client: unknown, model: string): WritableDelegate {
  return (client as Record<string, WritableDelegate>)[model]
}

/** What `applyAmendmentWrite` needs. */
export interface AmendmentWriteInput {
  /** `ENTITY_CONFIG_MAP[...].model` — the delegate name. */
  readonly model: string
  /** The scoped `where` the route already built. Never a bare `{ id }`. */
  readonly where: Record<string, unknown>
  /** The validated patch. */
  readonly data: Record<string, unknown>
  /** A non-empty `planAmendments` row set, all sharing one `groupId`. */
  readonly rows: readonly Prisma.RecordAmendmentCreateManyInput[]
}

/**
 * The config write and its amendment rows, in ONE transaction.
 *
 * Two statements that must not be able to come apart, because half of each is
 * worse than none of it. An amendment row that outlives a rolled-back edit is a
 * trail claiming a value changed when it did not, and the schema is explicit that
 * a trail a reader cannot trust is strictly worse than no trail, because it
 * manufactures positive evidence of an honest history. An edit that lands with no
 * amendment is the mirror failure: the reason the lock asked for is gone, and the
 * only record of the change is a diff in `AuditLog` with no justification.
 *
 * The interactive form, not `prisma.$transaction([a, b])`, for two reasons that
 * both matter to that guarantee:
 *
 *  - `tx` is the ONLY client in scope inside the callback, so the amendment
 *    insert cannot reach the outer client by accident. With the array form both
 *    promises are built against the outer client and correctness rests on Prisma
 *    honouring the batching, rather than on the code being unable to express the
 *    mistake.
 *  - The transaction boundary is visible at the call site. `$transaction` appears
 *    once, the two writes appear inside it, and there is nowhere else in this
 *    module for a third statement to go.
 *
 * Both statements go through `tx`, `tx.recordAmendment` rather than `prisma`'s,
 * so a test that makes the amendment insert reject observes the edit rolled back
 * rather than observing two independent writes that happened to be adjacent.
 *
 * `createMany` and not `create` per row: one statement for the whole group, so a
 * six-field correction is two statements rather than seven, and the group's rows
 * cannot interleave with another edit's between them. It returns a count rather
 * than rows, and nothing here needs the rows back.
 */
export async function applyAmendmentWrite(input: AmendmentWriteInput): Promise<unknown> {
  return prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const updated = await delegateOn(tx, input.model).update({ where: input.where, data: input.data })
      await tx.recordAmendment.createMany({ data: [...input.rows] })
      return updated
    },
    AMENDMENT_TRANSACTION_BOUNDS,
  )
}