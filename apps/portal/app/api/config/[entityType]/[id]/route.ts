import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ENTITY_CONFIG_MAP, type EntityApiConfig } from '@novastar/shared-types'
import {
  gradingScaleBandWriteRule,
  gradingScaleParentScopeWriteRule,
  gradingScaleScopeWhere,
  type CallerScope,
  type CrossRowWriteRule,
  type CrossRowWriteTarget,
  type ParentScopeWriteRule,
} from '@novastar/shared-utils'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { logError } from '@/lib/logger'
import { isUniqueConstraintViolation, duplicateResponse } from '@/lib/prisma-conflict'
import { AuditLogAction, logAuditEvent } from '@/lib/audit/logger'
import {
  AMENDMENT_REASON_KEY,
  applyAmendmentWrite,
  planAmendments,
  readAmendmentReason,
} from '@/lib/amendments'
import { declaredParentRefusal, siblingWriteProblems } from '../../write-checks'

/**
 * Cross-row rules, keyed by the kind a registry entry declares. Dispatched rather
 * than branched: this file never names an entity, so the rule travels with the
 * entity's definition in `ENTITY_CONFIG_MAP`. Typing the record by
 * `CrossRowWriteRuleKind` makes a kind without a rule a compile error.
 */
const CROSS_ROW_WRITE_RULES: Record<
  NonNullable<EntityApiConfig['writeValidation']>['kind'],
  CrossRowWriteRule
> = {
  grading_scale_bands: gradingScaleBandWriteRule,
}

/**
 * Which row a write hangs from, and the predicate that proves it is the caller's
 * own. Dispatched by the same kind as the rule above, so registering a cross-row
 * entity without stating its parent is a compile error.
 *
 * `findParent` is the one piece this module cannot own: shared-utils holds no
 * database client, so the read arrives here, from the route.
 */
type ParentScopeCheck<Where = Record<string, unknown>> = ParentScopeWriteRule<Where> & {
  findParent: (where: Where) => Promise<unknown>
}

const PARENT_SCOPE_CHECKS: Record<
  NonNullable<EntityApiConfig['writeValidation']>['kind'],
  ParentScopeCheck<ReturnType<typeof gradingScaleScopeWhere>>
> = {
  grading_scale_bands: {
    ...gradingScaleParentScopeWriteRule,
    findParent: (where) => prisma.gradingScale.findFirst({ where }),
  },
}

/** The reads one request's cross-row checks need, bound to that request's caller. */
interface CrossRowReads {
  /** A parent row, read under this caller's scope; null when not the caller's. */
  readParent: (id: string) => Promise<unknown>
  readScaleBands: Parameters<CrossRowWriteRule>[0]['readScaleBands']
}

/**
 * The database reads a cross-row check needs, scoped to the caller making them.
 *
 * Scoping is not an optimisation here. The read of a scale's bands is what turns
 * an overlap into a 400 that names the bands involved, so an unscoped read both
 * refuses this school's write for a conflict on another school's scale and prints
 * that school's band keys in the refusal.
 *
 * The parent lookup is memoised per id because one write asks it twice — once to
 * prove the parent it names is the caller's, and once again here, while judging
 * the row against its siblings — and the answer cannot change between them.
 */
function crossRowReads(entityConfig: EntityApiConfig, scope: CallerScope): CrossRowReads {
  const kind = entityConfig.writeValidation?.kind
  const parents = new Map<string, Promise<unknown>>()
  const readParent = (id: string): Promise<unknown> => {
    if (kind === undefined) return Promise.resolve(null)
    const cached = parents.get(id)
    if (cached) return cached
    const check = PARENT_SCOPE_CHECKS[kind]
    const found = check.findParent(check.scopeWhere({ ...scope, id }))
    parents.set(id, found)
    return found
  }
  const readScaleBands: CrossRowReads['readScaleBands'] = async (gradingScaleId) => {
    // A scale the caller cannot see reads as an empty scale. The rule then has
    // nothing to judge against, which accepts the write — the safe direction,
    // since the alternative is answering from another school's bands. A delete
    // reaches this too, and is the case that matters most: the row is already the
    // caller's, and removing it is the safe direction whatever it hung from.
    if ((await readParent(gradingScaleId)) === null) return []
    return prisma.gradingLevel.findMany({
      where: { gradingScaleId, tenantId: scope.tenantId },
      select: { id: true, key: true, minScore: true, maxScore: true },
    })
  }
  return { readParent, readScaleBands }
}

/**
 * The refusal an edit earns by naming a parent that is not the caller's.
 *
 * Two declarations answer that, and they are two because they were built at two
 * different times. A cross-row entity declares its parent as part of the rule it
 * dispatches — a band's parent is its scale, and that is already in the kind's
 * hand. Every other entity that names a foreign key declares the parents it names
 * in `parentRefs`, and `declaredParentRefusal` proves all of them.
 *
 * The row being written is proved to be the caller's by the lookup above, and that
 * proves nothing about the row it hangs from. On an edit the parent is whichever
 * one this patch names, falling back to the one the stored row already hangs from,
 * which is what closes the second half of the hole: a patch that moves a row onto
 * a sibling school's parent is refused here exactly as a create attaching to one
 * is. A patch that names none is not exempt either — the row it edits already
 * hangs from a parent that is not the caller's, and editing it would keep that in
 * place rather than repair anything. That fallback is also what the generic
 * settings form forces: it submits the whole field set on every edit, so the value
 * arriving here is usually the row's own parent whether or not it was touched.
 *
 * 404, and the same 404 whether the parent is missing or simply belongs to
 * another school — telling those apart would confirm that another school's row
 * exists. A patch naming no resolvable parent at all is refused the same way: an
 * unproven parent is a foreign one.
 *
 * Never applied to a delete. The row being deleted is already proved to be the
 * caller's, and refusing to remove a row precisely because its parent turned out
 * to be somebody else's would strand the very rows this hole created.
 */
async function parentWriteRefusal(
  entityConfig: EntityApiConfig,
  context: CrossRowWriteTarget,
  reads: Pick<CrossRowReads, 'readParent'>,
  scope: CallerScope,
): Promise<NextResponse | null> {
  const kind = entityConfig.writeValidation?.kind
  if (kind !== undefined) {
    const parentId = PARENT_SCOPE_CHECKS[kind].parentId(context)
    if (parentId === null || (await reads.readParent(parentId)) === null) {
      return NextResponse.json({ error: 'Parent not found' }, { status: 404 })
    }
  }
  return declaredParentRefusal(entityConfig, context, scope)
}

/**
 * The problems a write would leave behind, judged against its siblings. Empty for
 * every entity that declares no rule. Throws rather than returning when a declared
 * kind has no registered rule: failing closed is the only safe answer for a check
 * that exists because the unchecked path mis-grades.
 */
async function crossRowWriteProblems(
  entityConfig: EntityApiConfig,
  context: {
    operation: 'create' | 'update' | 'delete'
    write: Record<string, unknown>
    existing: Record<string, unknown> | null
  },
  reads: Pick<CrossRowReads, 'readScaleBands'>,
): Promise<string[]> {
  const kind = entityConfig.writeValidation?.kind
  if (kind === undefined) return []
  const rule = CROSS_ROW_WRITE_RULES[kind]
  if (rule === undefined) {
    throw new Error(`No cross-row write rule is registered for "${kind}"`)
  }
  return rule({ ...context, readScaleBands: reads.readScaleBands })
}

/**
 * Audit of a config edit, and of the delete beside it.
 *
 * Same helper, same parameter set and same rationale as the create route's audit
 * section, which is the fuller statement of both; this file is a sibling rather than
 * a caller of it, exactly as `CROSS_ROW_WRITE_RULES` and `PARENT_SCOPE_CHECKS`
 * already are. Two things are specific to an edit:
 *
 * - The diff has a real `before`. `auditFields` is handed the stored row as well as
 *   the patch, so a changed hire date or role records the value it replaced. An
 *   edit that names fields it did not change — which every edit from the generic
 *   settings form does, since it submits the whole field set — records those with
 *   `before` equal to `after`, which is visible rather than misleading.
 * - An edit has two refusals worth recording instead of one, and the first is the
 *   higher-value of the two: `buildScopeWhere` scopes the lookup by tenant and
 *   school, so a PATCH aimed at a row in another tenant or another school lands
 *   here and is refused with the same 404 as a row that does not exist. The
 *   attempt is what the trail needs; the answer deliberately cannot say which of
 *   the two it was, and the entry below does not claim to either.
 *
 * A delete records the same two things and one fewer refusal. It files the
 * success entry the same way — after the write, scoped to the caller, attributed
 * to the row the scoped `where` matched — and it files the same `ROW_OUT_OF_SCOPE`
 * entry, because the out-of-scope lookup above is literally the same statement and
 * a delete aimed at another school's row is the more urgent of the two attempts to
 * record. It does not file `PARENT_NOT_OWNED`, and that is not an omission: a
 * delete never reaches `parentWriteRefusal`, because the row it would refuse to
 * remove is already proved to be the caller's and stranding such a row is what
 * the parent hole created.
 *
 * ## Reads, and every remaining refusal
 *
 * `GET` files an entry for every row it returns, under the policy argued at
 * `auditConfigRead` below: this handler answers with one person's whole stored row,
 * so it is the read the trail was missing.
 *
 * A 403, a schema 400 and a sibling-rule 400 are now all recorded, where before
 * this file recorded only the two refusals above. The earlier reasoning was that a
 * row per attempt would bury the rows that mean something; it was right about volume
 * and wrong about which attempts, because the three it dropped are the ones the
 * caller is told nothing about. A 403 and a 400 are the same two words to anyone
 * probing for another school's ids, so a run of them is the only evidence that a run
 * of them happened. The reason codes are argued at `auditRefusedWrite`.
 *
 * Still deliberately unrecorded, for the reason the collection route gives: an
 * unknown entity type and the `No school assigned` 400, which are facts about the
 * request and not attempts on the data.
 */

/** One field's value as the audit trail records it: what a `Json` column accepts. */
type AuditFieldValue = string | number | boolean | Date | null

/**
 * Each field the edit touched, with the value on either side of it.
 *
 * `unknown` where the value enters and this type where it lands, on the strength of
 * the registry: every write schema types its fields as strings, numbers, booleans,
 * dates and nulls, none declares a JSON column, and zod has already rejected
 * anything else. The stored half is narrower still — it came out of a `Json`-
 * serialising column read, so it is already whatever Prisma hands back.
 */
type AuditFields = Record<string, { before: AuditFieldValue; after: AuditFieldValue }>

/** The diff, over the fields the patch carried. `before` is null when the patch asked for null. */
function auditFields(write: Record<string, unknown>, stored?: Record<string, unknown> | null): AuditFields {
  const fields: AuditFields = {}
  for (const [field, value] of Object.entries(write)) {
    if (value === undefined) continue
    fields[field] = {
      before: (stored?.[field] ?? null) as AuditFieldValue,
      after: value as AuditFieldValue,
    }
  }
  return fields
}

/**
 * The diff a delete records: every value the row held, and nothing after it.
 *
 * A delete has no payload to diff against, so the stored row is the only record of
 * what left — and it is the half an auditor cannot get anywhere else, because a
 * student's date of birth and admission date are gone with the row. `before` is the
 * value the row held and `after` is null throughout, which is what distinguishes
 * this entry from a create's (`before` null) and from an update's (both sides real).
 *
 * The five columns a body may not carry are dropped for the same reason PATCH drops
 * them from the payload: the id, the tenant and school are already the entry's own
 * columns, and the two timestamps say when the row was last written rather than what
 * it held.
 */
function removedFields(stored: Record<string, unknown>): AuditFields {
  const {
    id: _id,
    tenantId: _tenantId,
    schoolId: _schoolId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...held
  } = stored
  const fields: AuditFields = {}
  for (const [field, value] of Object.entries(held)) {
    fields[field] = { before: value as AuditFieldValue, after: null }
  }
  return fields
}

/**
 * The acting user's email, recorded beside the id.
 *
 * `userId` goes in its own column, which is the canonical way to say who acted, and
 * it is a foreign key: an entry whose user row is later deleted stops naming
 * anybody. The email is copied into the hashed payload for that case, and
 * `logger.ts` hashes `changes` into the chain hash, so it cannot be rewritten in
 * the database afterwards without breaking the chain. `description` is not hashed,
 * so the email is not written there. `null` when the session carries no email, so
 * the field is always present.
 */
function actorEmailOf(user: unknown): string | null {
  const email = (user as { email?: unknown } | null | undefined)?.email
  return typeof email === 'string' && email.length > 0 ? email : null
}

/**
 * The refusal codes this route files, and what each one names.
 *
 * Distinct from `ROW_OUT_OF_SCOPE` (the scoped lookup found no row) and
 * `PARENT_NOT_OWNED` (the row names a parent that is not the caller's), because each
 * of these is a different check refusing for a different reason:
 *
 * - `PERMISSION_DENIED` — the caller does not hold `config:write`. A repeated rate of
 *   these against one `userId` on one id is permission probing, which is the signal
 *   they are recorded for: the 403 tells the caller nothing and leaves the attempt
 *   nowhere else.
 * - `VALIDATION_FAILED` — the request cannot be served as written, whether zod
 *   refused the patch or a cross-row rule found the row it would leave behind
 *   ambiguous. The `description` says which, because the reason code deliberately
 *   cannot: a body the caller never sent and a band conflict they never saw are the
 *   same statement about the request.
 * - `SYSTEM_ROW_PROTECTED` — the row carries `isSystem`. This is a 403 about the ROW
 *   rather than the caller, and it gets its own code so an operator can tell "you may
 *   not delete anything" from "you may not delete this one": the first is a role
 *   problem, the second is a guardrail doing its job.
 *
 * `SYSTEM` for the action, for the reason the sibling refusals give: `AuditLogAction`
 * has no denied member and adding one is a change to the shared enum rather than to
 * this route. `refused: true` inside the hashed `changes` is what makes the entry
 * impossible to misread as a write, and `successRows()` in
 * `tests/config-write-audit.test.ts` treats any entry that is not `SYSTEM` +
 * `refused: true` as a claim of success — so a refusal filed any other way fails
 * that suite.
 */
async function auditRefusedWrite(params: {
  userId: string
  tenantId: string
  schoolId: string | null
  actorEmail: string | null
  entityType: string
  id: string
  description: string
  reason: 'PERMISSION_DENIED' | 'VALIDATION_FAILED' | 'SYSTEM_ROW_PROTECTED'
}): Promise<void> {
  await logAuditEvent({
    userId: params.userId,
    tenantId: params.tenantId,
    schoolId: params.schoolId ?? undefined,
    action: AuditLogAction.SYSTEM,
    entity: params.entityType,
    // The id from the path: the caller's own claim about which row it was reaching,
    // which is the one thing an operator needs to see a run of attempts. Not a row
    // id in the `ROW_OUT_OF_SCOPE` sense — no row was proven to exist — and not the
    // row's values.
    entityId: params.id,
    description: params.description,
    changes: { actorEmail: params.actorEmail, refused: true, reason: params.reason },
  })
}

/**
 * Audit of a config read, and the policy that decides which reads get a row.
 *
 * A single-row read is ALWAYS recorded, and this handler is the one that matters for
 * it: `GET /api/config/[entityType]/[id]` answers with one person's whole stored row
 * — a date of birth, a gender, an admission number, a hire date — so it is the read
 * the trail was missing entirely.
 *
 * The row's VALUES are deliberately not copied into `changes`. The caller already
 * holds them, and writing a second copy into a table with weaker access control than
 * the register itself would turn an audit trail into a shadow register. The entry
 * names WHICH row was read, which is what answers "who looked at this child's
 * record"; the values answer themselves from the row while it still exists.
 *
 * The action, `READ`, is argued in full at `auditConfigRead` in the sibling collection
 * route. `SYSTEM` is unavailable there and unavailable here for one reason: the routes
 * give it exactly one meaning — a refusal — and `successRows()` in
 * `tests/config-write-audit.test.ts` classifies on that, so a successful read filed as
 * `SYSTEM` would vanish from any reader's answer to "what happened".
 *
 * `changes.read === true` stays for the reason given at the sibling: it is the hashed
 * half of the entry, and it is how every read already in the trail is findable. The
 * description that begins "Read" is the human-readable half of the same statement —
 * the entry still has to say which row it is about when an operator is reading a list
 * rather than filtering one.
 */
async function auditConfigRead(params: {
  userId: string
  tenantId: string
  schoolId: string | null
  actorEmail: string | null
  entityType: string
  id: string
}): Promise<void> {
  await logAuditEvent({
    userId: params.userId,
    tenantId: params.tenantId,
    schoolId: params.schoolId ?? undefined,
    action: AuditLogAction.READ,
    entity: params.entityType,
    entityId: params.id,
    description: `Read ${params.entityType} ${params.id}`,
    changes: {
      actorEmail: params.actorEmail,
      read: true,
      // The entry's own columns already carry these, and repeating them is deliberate
      // rather than redundant: `changes` is the only half `logger.ts` folds into the
      // chain hash, so it is the only half an auditor can rely on to say what the
      // read was scoped to.
      scope: { tenantId: params.tenantId, schoolId: params.schoolId },
    },
  })
}

/**
 * Builds a Prisma `where` clause for a single entity lookup.
 * Always includes `id` and `tenantId`. Only includes `schoolId` when the
 * entity type is school-scoped (has a schoolId column in Prisma).
 * Adds `isActive: true` for models that support soft-delete.
 * This prevents 500 errors (Unknown argument) for tenant-only entities
 * and prevents silent tenant-wide queries when schoolId is absent.
 */
function buildScopeWhere(
  id: string,
  tenantId: string,
  schoolId: string | null,
  schoolScoped: boolean,
  includeActive: boolean
): Record<string, unknown> {
  const where: Record<string, unknown> = { id, tenantId }
  if (schoolScoped) {
    where.schoolId = schoolId
  }
  if (includeActive) {
    where.isActive = true
  }
  return where
}

// Dynamic Prisma model access — ENTITY_CONFIG_MAP is a closed, hardcoded set of
// valid Prisma model names. We use a typed delegate interface instead of `as any`
// to retain TypeScript safety on method signatures.
interface PrismaDelegate {
  findUnique: (args: { where: Record<string, unknown>; select?: Record<string, unknown>; include?: Record<string, unknown> }) => Promise<unknown | null>
  findFirst: (args: { where?: Record<string, unknown>; select?: Record<string, unknown>; include?: Record<string, unknown>; skip?: number; take?: number; orderBy?: Record<string, unknown> }) => Promise<unknown | null>
  findMany: (args: { where?: Record<string, unknown>; select?: Record<string, unknown>; include?: Record<string, unknown>; skip?: number; take?: number; orderBy?: Record<string, unknown> }) => Promise<unknown[]>
  update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>
  delete: (args: { where: Record<string, unknown> }) => Promise<unknown>
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>
}
const getModel = (modelName: string): PrismaDelegate => (prisma as unknown as Record<string, PrismaDelegate>)[modelName]

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entityType: string; id: string }> }
) {
  try {
    const { entityType, id } = await params
    const entityConfig = ENTITY_CONFIG_MAP[entityType]

    if (!entityConfig) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    const { tenantId, schoolId, userId, user } = await getTenantContext()
    const actorEmail = actorEmailOf(user)

    // RBAC: use @novastar/auth hasPermission (handles delegations + role inheritance)
    if (!(await hasPermission(userId, 'config:read', tenantId, schoolId ?? undefined))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const schoolScoped = entityConfig.schoolScoped
    if (schoolScoped && !schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const model = getModel(entityConfig.model)
    const entity = await model.findFirst({
      where: buildScopeWhere(id, tenantId, schoolId, schoolScoped, entityConfig.softDelete),
    })

    if (!entity) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    // After the row was proven to be this caller's and before the answer goes out. A
    // read that found nothing files nothing, because the 404 says nothing about
    // whether the row exists elsewhere either — a probe for another school's ids
    // would otherwise write a trail of its own, naming ids it never proved were real.
    await auditConfigRead({ userId, tenantId, schoolId, actorEmail, entityType, id })

    return NextResponse.json(entity)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (error instanceof Error && error.name === 'ServerConfigError') {
      logError('ServerConfig', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    logError('ConfigEntity', error)
    return NextResponse.json({ error: 'Failed to fetch entity' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entityType: string; id: string }> }
) {
  try {
    const { entityType, id } = await params
    const entityConfig = ENTITY_CONFIG_MAP[entityType]

    if (!entityConfig) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    const { tenantId, schoolId, userId, user } = await getTenantContext()
    const actorEmail = actorEmailOf(user)

    // RBAC: use @novastar/auth hasPermission (handles delegations + role inheritance)
    if (!(await hasPermission(userId, 'config:write', tenantId, schoolId ?? undefined))) {
      await auditRefusedWrite({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        id,
        description: `Refused to update ${entityType} ${id}: the caller does not hold config:write`,
        reason: 'PERMISSION_DENIED',
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const schoolScoped = entityConfig.schoolScoped
    if (schoolScoped && !schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const body = await req.json()

    // The amendment reason is parsed HERE, at the boundary, and REFUSED below,
    // beside the other refusals. Both halves are deliberate. Parsing now is what
    // keeps an operator's free text out of everything downstream of this line: by
    // the time the plan is built, the value is either a trimmed string this module
    // minted a bound for, or nothing at all. Refusing later is what keeps the
    // refusals in one place — the route already answers `Validation failed` with
    // an `issues` list for a body it cannot serve, and a second refusal site with
    // its own shape is a second thing to keep consistent.
    const amendmentReason = readAmendmentReason(body)

    // Remove immutable fields, and the reserved amendment key with them. Stripping
    // it here rather than relying on zod to drop an unknown key is the difference
    // between "the route decided this body carries no reason" and "the schema
    // happened not to mention it"; the key is also why a caller cannot smuggle a
    // column called `amendmentReason` into a write on a model that has none.
    const {
      id: _id,
      tenantId: _tenantId,
      schoolId: _schoolId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      [AMENDMENT_REASON_KEY]: _amendmentReason,
      ...data
    } = body

    const validated = entityConfig.updateSchema.safeParse(data)
    if (!validated.success) {
      await auditRefusedWrite({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        id,
        description: `Refused to update ${entityType} ${id}: the body does not match the update schema`,
        reason: 'VALIDATION_FAILED',
      })
      return NextResponse.json({ error: 'Validation failed', issues: validated.error.format() }, { status: 400 })
    }

    // Verify entity belongs to tenant/school before update
    const model = getModel(entityConfig.model)
    const scopeWhere = buildScopeWhere(id, tenantId, schoolId, schoolScoped, entityConfig.softDelete)
    const existing = await model.findFirst({ where: scopeWhere })
    if (!existing) {
      // The row is not in this caller's tenant and school. Whether it belongs to
      // another school, to another tenant, or does not exist at all is exactly what
      // this handler must not say, so the entry records the attempt without
      // guessing the cause: `ROW_OUT_OF_SCOPE` says the write was refused and where
      // it was aimed, not why the row was invisible. An operator reading the log
      // sees who aimed at which id and how often, which is the signal; a caller
      // probing for another school's rows still learns nothing they did not already
      // know, because the entry exists only in this tenant's own trail.
      await logAuditEvent({
        userId,
        tenantId,
        schoolId: schoolId ?? undefined,
        action: AuditLogAction.SYSTEM,
        entity: entityType,
        // The id that was asked for, which is the caller's own claim about what it
        // was trying to reach. It is not a row id — no row was found.
        entityId: id,
        description: `Refused to update ${entityType} ${id}: the row is not in this tenant and school`,
        changes: { actorEmail, refused: true, reason: 'ROW_OUT_OF_SCOPE' },
      })
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    // Both reads are bound to this caller, not to the module.
    const scope: CallerScope = { tenantId, schoolId }
    const reads = crossRowReads(entityConfig, scope)

    // The row is proved to be the caller's. The row it hangs from is not, and an
    // edit can change which one that is — so it is resolved and proved before the
    // patch is judged, never assumed from the stored row.
    const parentRefusal = await parentWriteRefusal(
      entityConfig,
      {
        operation: 'update',
        write: validated.data as Record<string, unknown>,
        existing: existing as Record<string, unknown>,
      },
      reads,
      scope,
    )
    if (parentRefusal) {
      // The same refusal the create route records, for the same reason: the row is
      // the caller's but the row it hangs from is not, and an edit can change which
      // one that is. No row was written, the success entry below never runs, and the
      // stored row's own id is recorded so an operator can see which row someone
      // tried to move — not its values, and not the foreign parent's id, which
      // belongs in another tenant's trail.
      await logAuditEvent({
        userId,
        tenantId,
        schoolId: schoolId ?? undefined,
        action: AuditLogAction.SYSTEM,
        entity: entityType,
        entityId: id,
        description: `Refused to update ${entityType} ${id}: the edit names a parent this caller does not own`,
        changes: { actorEmail, refused: true, reason: 'PARENT_NOT_OWNED' },
      })
      return parentRefusal
    }

    // Judged against the row as it would be stored — the patch merged over what
    // is there now — so a partial patch that leaves this row's siblings unable to
    // grade between them is refused instead of persisted.
    const siblingProblems = await crossRowWriteProblems(
      entityConfig,
      {
        operation: 'update',
        write: validated.data as Record<string, unknown>,
        existing: existing as Record<string, unknown>,
      },
      reads,
    )
    if (siblingProblems.length > 0) {
      await auditRefusedWrite({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        id,
        description: `Refused to update ${entityType} ${id}: it conflicts with the rows it must sit beside`,
        reason: 'VALIDATION_FAILED',
      })
      return NextResponse.json({ error: 'Validation failed', issues: siblingProblems }, { status: 400 })
    }

    // And the other kind of sibling: this row against others of its OWN kind, judged
    // as it would be stored. A grading scale's applicability is the question, and it
    // is asked on an edit exactly as on a create because the edit is how a school
    // makes two scales claim one level.
    const ownKindProblems = await siblingWriteProblems(
      entityConfig,
      {
        operation: 'update',
        write: validated.data as Record<string, unknown>,
        existing: existing as Record<string, unknown>,
      },
      scope,
    )
    if (ownKindProblems.length > 0) {
      await auditRefusedWrite({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        id,
        description: `Refused to update ${entityType} ${id}: it overlaps a sibling row of its own kind`,
        reason: 'VALIDATION_FAILED',
      })
      return NextResponse.json({ error: 'Validation failed', issues: ownKindProblems }, { status: 400 })
    }

    // What this edit owes the amendment trail, and whether it is owed at all. The
    // plan is pure and knows nothing about requests or responses, so every rule
    // about WHEN a reason is required lives in one testable place rather than in
    // the middle of this handler. Judged against the stored row, because that is
    // what decides whether the row is reason-gated — a body cannot unlock itself by
    // submitting a blank `finalizedAt`.
    const plan = planAmendments({
      reason: amendmentReason,
      write: validated.data as Record<string, unknown>,
      stored: existing as Record<string, unknown>,
      model: entityConfig.model,
      entityId: id,
      tenantId,
      schoolId,
      userId,
    })
    if (plan.refusal) {
      // Filed under the existing VALIDATION_FAILED code and nothing new: this is a
      // request that cannot be served as written, which is the same claim the
      // schema 400 above makes. The description carries no part of the reason —
      // operator-supplied free text has no business in a log line, and
      // `logger.ts` does not hash `description`, so a reason written there could be
      // rewritten in the database without breaking the chain.
      await auditRefusedWrite({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        id,
        description: `Refused to update ${entityType} ${id}: the change owes the trail a reason it was not given`,
        reason: 'VALIDATION_FAILED',
      })
      return NextResponse.json({ error: 'Validation failed', issues: plan.refusal }, { status: 400 })
    }

    // One write. When the trail has something to record, the edit and its field
    // rows go through the same transaction so neither can land without the other;
    // when it has nothing to record there is nothing to be atomic with, and a
    // transaction around a single statement would be a claim nothing here backs
    // up. Both paths name the same scoped `where`, so the transaction cannot widen
    // the write the checks above proved.
    const updated = plan.required
      ? await applyAmendmentWrite({
          model: entityConfig.model,
          where: scopeWhere,
          data: validated.data as Record<string, unknown>,
          rows: plan.rows,
        })
      : await model.update({
          where: scopeWhere,
          data: validated.data as Record<string, unknown>,
        })

    // After the write and after every refusal above it, so this entry can only ever
    // describe a row that exists. `schoolId` is the caller's, the same value the row
    // was scoped and written with, which keeps this school's audit chain its own.
    await logAuditEvent({
      userId,
      tenantId,
      schoolId: schoolId ?? undefined,
      action: AuditLogAction.UPDATE,
      entity: entityType,
      // The id from the path rather than from the update result: it is the row the
      // scoped `where` matched, so it is the row that was changed, and the route
      // never has to trust a driver's return value to name it.
      entityId: id,
      description: `Updated ${entityType} ${id}`,
      // The diff over the fields the patch carried, each against the stored value it
      // replaced. `existing` is the row as the scoped lookup found it, read before
      // the write, which is the only place the `before` half can come from.
      changes: {
        actorEmail,
        fields: auditFields(validated.data as Record<string, unknown>, existing as Record<string, unknown>),
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (error instanceof Error && error.name === 'ServerConfigError') {
      logError('ServerConfig', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    if (isUniqueConstraintViolation(error)) {
      return duplicateResponse()
    }
    logError('ConfigEntity', error)
    return NextResponse.json({ error: 'Failed to update entity' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ entityType: string; id: string }> }
) {
  try {
    const { entityType, id } = await params
    const entityConfig = ENTITY_CONFIG_MAP[entityType]

    if (!entityConfig) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    const { tenantId, schoolId, userId, user } = await getTenantContext()
    const actorEmail = actorEmailOf(user)

    // RBAC: use @novastar/auth hasPermission (handles delegations + role inheritance)
    if (!(await hasPermission(userId, 'config:write', tenantId, schoolId ?? undefined))) {
      await auditRefusedWrite({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        id,
        description: `Refused to delete ${entityType} ${id}: the caller does not hold config:write`,
        reason: 'PERMISSION_DENIED',
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const schoolScoped = entityConfig.schoolScoped
    if (schoolScoped && !schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // Check if entity exists and belongs to tenant/school
    const model = getModel(entityConfig.model)
    const scopeWhere = buildScopeWhere(id, tenantId, schoolId, schoolScoped, entityConfig.softDelete)
    const entity = await model.findFirst({ where: scopeWhere })
    if (!entity) {
      // The same refusal the edit records, for the same reason and with the same
      // answer: the row is not in this caller's tenant and school, and whether it
      // belongs to another school, to another tenant, or does not exist at all is
      // what this handler must not say. A delete aimed at another school's row is
      // the more urgent of the two attempts to record, not a lesser one — the trail
      // has to say who aimed at which id, and the caller learns nothing from the
      // entry that they did not already know, because it lives in this tenant's own
      // trail either way.
      await logAuditEvent({
        userId,
        tenantId,
        schoolId: schoolId ?? undefined,
        action: AuditLogAction.SYSTEM,
        entity: entityType,
        // The id that was asked for, which is the caller's own claim about what it
        // was trying to reach. It is not a row id — no row was found.
        entityId: id,
        description: `Refused to delete ${entityType} ${id}: the row is not in this tenant and school`,
        changes: { actorEmail, refused: true, reason: 'ROW_OUT_OF_SCOPE' },
      })
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    // Check if system entity (protected)
    const entityRecord = entity as Record<string, unknown>
    const isSystem = 'isSystem' in entityRecord && entityRecord.isSystem === true
    if (isSystem) {
      // Recorded as its own refusal code rather than folded into `PERMISSION_DENIED`:
      // the caller may well hold `config:write`, and the distinction between "you may
      // not remove anything" and "you may not remove this one" is the difference
      // between a role problem and a guardrail working.
      await auditRefusedWrite({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        id,
        description: `Refused to delete ${entityType} ${id}: the row is a system row`,
        reason: 'SYSTEM_ROW_PROTECTED',
      })
      return NextResponse.json({ error: 'System entities cannot be deleted' }, { status: 403 })
    }

    // A delete is a write too, and for a scale's bands it is the destructive one:
    // removing a middle band opens a hole that would silently hand every child in
    // that range the band below it. Refused here, with the range named, so an
    // admin widens a neighbour first. The row is already the caller's, so this is
    // the one write that does not also prove the scale it hangs from — see
    // `parentWriteRefusal`.
    const siblingProblems = await crossRowWriteProblems(
      entityConfig,
      {
        operation: 'delete',
        write: {},
        existing: entityRecord,
      },
      crossRowReads(entityConfig, { tenantId, schoolId }),
    )
    if (siblingProblems.length > 0) {
      await auditRefusedWrite({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        id,
        description: `Refused to delete ${entityType} ${id}: it conflicts with the rows it must sit beside`,
        reason: 'VALIDATION_FAILED',
      })
      return NextResponse.json({ error: 'Validation failed', issues: siblingProblems }, { status: 400 })
    }

    // Soft-delete: if the model has an `isActive` column, set it to false
    // to preserve audit trail and referential integrity. Fall back to
    // hard-delete only for models without an `isActive` column.
    const hasActiveFlag = 'isActive' in entityRecord
    if (hasActiveFlag) {
      await model.update({
        where: scopeWhere,
        data: { isActive: false },
      })
    } else {
      await model.delete({ where: scopeWhere })
    }

    // After the write and after every refusal above it, so this entry can only ever
    // describe a row that existed. It is the entry that makes a destructive write
    // answerable afterwards: the row's own values are gone with it, and a hard
    // delete leaves nothing else to say who removed a child's date of birth. Not a
    // transaction client, because this handler is not in one — the delete above is a
    // single statement and `api/promotions` has a `tx` only because it moves a whole
    // cohort of rows that has to roll back together.
    await logAuditEvent({
      userId,
      tenantId,
      schoolId: schoolId ?? undefined,
      action: AuditLogAction.DELETE,
      entity: entityType,
      // The id from the path rather than from the delete result: it is the row the
      // scoped `where` matched, so it is the row that went, and the route never has
      // to trust a driver's return value to name it.
      entityId: id,
      description: `Deleted ${entityType} ${id}`,
      changes: {
        actorEmail,
        // Whether the row is gone or only flagged inactive. Those are different
        // promises to whoever reads this: a hard-deleted child's record is
        // unrecoverable through this endpoint, and an entry that did not say which
        // it was would be read as the softer of the two.
        softDeleted: hasActiveFlag,
        fields: removedFields(entityRecord),
      },
    })

    return NextResponse.json({ success: true, softDeleted: hasActiveFlag })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (error instanceof Error && error.name === 'ServerConfigError') {
      logError('ServerConfig', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    logError('ConfigEntity', error)
    return NextResponse.json({ error: 'Failed to delete entity' }, { status: 500 })
  }
}