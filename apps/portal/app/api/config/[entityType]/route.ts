import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { logError } from '@/lib/logger'
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
import { isUniqueConstraintViolation, duplicateResponse } from '@/lib/prisma-conflict'
import { AuditLogAction, logAuditEvent } from '@/lib/audit/logger'
import { declaredParentRefusal, siblingWriteProblems } from '../write-checks'

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
})

/**
 * Cross-row rules, keyed by the kind a registry entry declares.
 *
 * Dispatched, not branched: this file never names an entity, so an entity whose
 * rows are only valid together is registered in `ENTITY_CONFIG_MAP` and picked up
 * here. Typing the record by `CrossRowWriteRuleKind` means adding a kind without
 * a rule is a compile error rather than a write that skips validation.
 */
const CROSS_ROW_WRITE_RULES: Record<
  NonNullable<EntityApiConfig['writeValidation']>['kind'],
  CrossRowWriteRule
> = {
  grading_scale_bands: gradingScaleBandWriteRule,
}

/**
 * Which row a write hangs from, and the predicate that proves it is the
 * caller's own. Dispatched by the same kind as the rule above, so registering a
 * cross-row entity without stating its parent is a compile error.
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
 * refuses this school's write for a conflict on another school's scale and
 * prints that school's band keys in the refusal.
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
    // since the alternative is answering from another school's bands.
    if ((await readParent(gradingScaleId)) === null) return []
    return prisma.gradingLevel.findMany({
      where: { gradingScaleId, tenantId: scope.tenantId },
      select: { id: true, key: true, minScore: true, maxScore: true },
    })
  }
  return { readParent, readScaleBands }
}

/**
 * The refusal a write earns by naming a parent that is not the caller's.
 *
 * Two declarations answer that, and they are two because they were built at two
 * different times. A cross-row entity declares its parent as part of the rule it
 * dispatches — a band's parent is its scale, and that is already in the kind's
 * hand. Every other entity that names a foreign key declares the parents it names
 * in `parentRefs`, and `declaredParentRefusal` proves all of them. Both refuse the
 * same way.
 *
 * The reasoning is the same for either, and it is not about the row being written.
 * A band row has no `schoolId` of its own — the model is tenant-scoped — so the
 * school a band belongs to is the school of its scale, and proving the band is the
 * caller's proves nothing about the school that will grade a child against it.
 * Without this check a headmaster posts a band into a sibling school's scale and
 * the row persists with the caller's own `tenantId`: that school's reports and
 * gradebooks then grade children against it, while the school that owns the scale
 * cannot see the row to correct it and the caller has no way to undo it. A student
 * enrolled in another school's class is the same defect with the child's own
 * `schoolId` right there on the row — the register, the promotion plan and the
 * report all follow the class, not the row.
 *
 * 404, and the same 404 whether the parent is missing or simply belongs to another
 * school — telling those apart would confirm that another school's row exists. A
 * write naming no resolvable parent at all is refused the same way: an unproven
 * parent is a foreign one.
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
  // Every other entity that names a foreign key declares it, and the declaration
  // covers all of them at once rather than one entity at a time — which is what the
  // first version of this check did, and why it was still a hole everywhere else.
  return declaredParentRefusal(entityConfig, context, scope)
}

/**
 * The problems a write would leave behind, judged against its siblings.
 *
 * Empty for every entity that declares no rule, and a 400 with the reasons for
 * one that does. Throws rather than returning when a declared kind has no rule
 * registered: that is a wiring fault, and failing closed is the only safe answer
 * for a validation that exists precisely because the silent path mis-grades.
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
 * Audit of a config write.
 *
 * These routes are the portal's only way to create or change a student, a staff
 * member, a class, a fee structure or a grading band, and they wrote nothing down:
 * no audit helper call, anywhere, on any of them. A student's date of birth and a
 * staff member's hire date and role could be changed with no record of who did it
 * or when, and the settings form is one POST/PATCH away.
 *
 * The entry goes through the portal's own helper, `logAuditEvent`, with the same
 * parameter set `api/promotions` uses — `userId`, `tenantId`, `schoolId`, `action`,
 * `entity`, `entityId`, `description`, `changes` — so one table serves every write
 * in the portal and a query over it does not have to know which route wrote a row.
 *
 * ## Best-effort, and why that is the decision
 *
 * `logAuditEvent` catches everything and returns `null` on failure (that is what
 * the shared try/catch in `lib/audit/logger.ts` is for), and `api/promotions`
 * relies on exactly that: its entry is inside the cohort transaction, so it would
 * roll the promotion back if it could throw — and it cannot. `api/auth` is blunter
 * and fires the same helper without awaiting it.
 *
 * So this is best-effort too, and that is a deliberate limit rather than an
 * oversight: a write that succeeds and is refused to log is worse for the school
 * than a write that fails, and a student's admission should not be rolled back
 * because the audit table was briefly unreachable. The honest consequence, stated
 * here because it is the part a reader would otherwise assume away: **an audit
 * entry can be lost without a signal to the caller.** The only trace of the loss is
 * `[AUDIT_LOG_ERROR]` in the server log. It is awaited rather than fired and
 * forgotten so that the common case — a slow write, a normal request — really does
 * complete before the response goes out.
 *
 * ## Reads, and which of them are recorded
 *
 * `GET` files entries too, under a policy stated in full at `auditConfigRead`: a
 * single-row read always, a collection read only when the caller supplied a search
 * term. Both go through this same helper with the same parameter set, so one table
 * serves every read and every write in the portal.
 *
 * ## Refusals, all of them
 *
 * Every refusal this handler can return now files an entry: a foreign parent, a
 * missing permission, a body the create schema refuses, and each of the two
 * cross-row rules. That is a change from the earlier state of this file, which
 * recorded only the first of the four on the reasoning that a row per attempt would
 * bury the rows that mean something. The reasoning was half right and the half that
 * was wrong was the security half: the refusals it dropped are exactly the ones a
 * caller cannot be told about. A 403 and a 400 answer identically for a prober
 * asking "is this row mine", so a stream of them is the only evidence that a stream
 * of them happened — and the volume that argument feared is bounded by attempts,
 * not by traffic.
 *
 * The refusals still deliberately NOT recorded are the ones about the request rather
 * than about the data: an unknown entity type (nothing was looked up, so there is
 * nothing to reconstruct), and the `No school assigned` 400 (a caller with no school
 * is a session problem the caller is already being told about, and every write they
 * make fails identically for as long as it lasts).
 */

/** One field's value as the audit trail records it: what a `Json` column accepts. */
type AuditFieldValue = string | number | boolean | Date | null

/**
 * Each field the write touched, with the value on either side of it.
 *
 * `unknown` where the value enters and this type where it lands. Every write
 * schema in the registry types its fields as strings, numbers, booleans, dates and
 * nulls — none declares a JSON column — so the narrowing below is a statement about
 * that registry rather than an assumption about what a caller can send, and zod has
 * already rejected anything else before this runs.
 */
type AuditFields = Record<string, { before: AuditFieldValue; after: AuditFieldValue }>

/**
 * The diff a create or an update records.
 *
 * `before` is `null` for every field of a create, where nothing existed before the
 * write — which is what a create means, and the same shape as an update whose
 * stored value was null. Only the fields this write actually carried appear: the
 * record exists to say what moved, and a whole row would bury a changed hire date
 * under a dozen untouched ones.
 */
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
 * The acting user's email, recorded beside the id.
 *
 * `userId` goes in its own column, which is the canonical way to say who acted,
 * and it is a foreign key: an entry whose user row is later deleted stops naming
 * anybody at all. The email is copied into the hashed payload for exactly that
 * case. `logger.ts` hashes `changes` into the chain hash, so this value cannot be
 * rewritten in the database afterwards without breaking the chain — `description`
 * can, so the email is not written there.
 *
 * `null` when the session carries no email, so the field is always present and a
 * reader never has to tell "no email" from "not recorded".
 */
function actorEmailOf(user: unknown): string | null {
  const email = (user as { email?: unknown } | null | undefined)?.email
  return typeof email === 'string' && email.length > 0 ? email : null
}

/**
 * The scope a read was answered under, as the trail records it.
 *
 * The entry's own columns already carry the caller's `tenantId` and `schoolId`, and
 * repeating them here is deliberate rather than redundant: `changes` is the only half
 * of an entry `logger.ts` folds into the chain hash, so it is the only half an
 * auditor can rely on to say what was actually asked for. An entry that named a
 * filter set without naming the school it applied would say "looked at a list" where
 * it should say "looked at *that school's* list".
 */
function readScope(tenantId: string, schoolId: string | null): { tenantId: string; schoolId: string | null } {
  return { tenantId, schoolId }
}

/**
 * The refusal codes this route files, and what each one names.
 *
 * Distinct from `ROW_OUT_OF_SCOPE` (the row is not the caller's) and
 * `PARENT_NOT_OWNED` (the row names a parent that is not the caller's), because
 * each of these is a different check refusing for a different reason, and an operator
 * reading the trail needs to tell them apart:
 *
 * - `PERMISSION_DENIED` — the caller does not hold `config:write`. A repeated rate
 *   of these against one `userId` is permission probing, which is the signal the
 *   refusal is recorded for: the 403 itself tells the caller nothing and leaves the
 *   attempt nowhere else.
 * - `VALIDATION_FAILED` — the request cannot be served as written, whether because
 *   zod refused the body or because a cross-row rule found the row it would leave
 *   behind ambiguous. The `description` says which of the two, because the reason code
 *   deliberately cannot: a body the caller never sent and a scale conflict they never
 *   saw are the same statement about the request.
 *
 * `SYSTEM` for the action, for the reason the sibling refusals give: `AuditLogAction`
 * has no denied member and adding one is a change to the shared enum rather than to
 * this route. `refused: true` inside the hashed `changes` is what makes the entry
 * impossible to misread as a write — and `successRows()` in
 * `tests/config-write-audit.test.ts` treats any entry that is not
 * `SYSTEM` + `refused: true` as a claim of success, so a refusal filed any other way
 * fails that suite.
 */
async function auditRefusedWrite(params: {
  userId: string
  tenantId: string
  schoolId: string | null
  actorEmail: string | null
  entityType: string
  description: string
  reason: 'PERMISSION_DENIED' | 'VALIDATION_FAILED'
}): Promise<void> {
  await logAuditEvent({
    userId: params.userId,
    tenantId: params.tenantId,
    schoolId: params.schoolId ?? undefined,
    action: AuditLogAction.SYSTEM,
    entity: params.entityType,
    // No `entityId`: there is no row, on a create. The only id in the request is the
    // one a body claimed, which is the caller's own claim rather than a row's id.
    description: params.description,
    changes: { actorEmail: params.actorEmail, refused: true, reason: params.reason },
  })
}

/**
 * Audit of a config read, and the policy that decides which reads get a row.
 *
 * ## The policy, and the volume argument behind it
 *
 * A single-row read is ALWAYS recorded. It answers with one identifiable person and
 * everything this table holds about them — a date of birth, a gender, an admission
 * number, a hire date — and there is no volume problem: one entry per navigation to
 * one record is a row count a school can read.
 *
 * A collection read is recorded ONLY when the caller supplied a `search` term. An
 * unfiltered list read is the one read with no evidentiary value in it: the caller
 * holds `config:read`, they are entitled to the whole page, and the entry would say
 * only "someone with config:read opened the student list" — twenty times a day per
 * administrator, which is how the rows that *do* mean something (a write, a refusal,
 * a probe for a named child) get buried in the trail. A search term is the caller
 * naming a person, and that naming is the identifying act worth a row.
 *
 * The term is recorded even where it does not narrow: `buildWhere` adds no search
 * clause for the eleven registry entries with neither a `name` nor a `code`
 * column — `student`, `staff` and `parent` among them — so a search on the pupil
 * register returns the whole register with a 200. The entry is *more* valuable in
 * that case, not less, because it records a probe that reached every child while
 * the caller believed they had searched.
 *
 * The term goes in `changes` and NOT in `description`, for the reason the actor email
 * does: `description` is not hashed into the chain, so a value written there can be
 * rewritten in the database afterwards without breaking the chain.
 *
 * ## The action
 *
 * `AuditLogAction.READ`. This entry used to be filed as `SYSTEM_UPDATE`, which asserted
 * a write that had not happened: a reader filtering `action = SYSTEM_UPDATE` to find
 * what changed a student saw every read of one in the answer. `SYSTEM` was never
 * available either — the routes and their suite give it one meaning, "this row is a
 * refusal, and `changes.refused` says which check refused it", which is exactly what
 * `successRows()` in `tests/config-write-audit.test.ts` classifies on — so a read
 * filed as `SYSTEM` would make "is this SYSTEM row a refusal?" unanswerable without
 * reading the payload.
 *
 * `changes.read === true` stays, and is not a compensator for a wrong action any more:
 * `changes` is the half `logger.ts` folds into the chain hash while `description` is
 * not, and it is the payload a reader filtering `newData->>'read'` already uses on the
 * entries filed before this change. Dropping it would split the trail's own history in
 * two — old reads findable one way, new ones another — to remove a word.
 */
async function auditConfigRead(params: {
  userId: string
  tenantId: string
  schoolId: string | null
  actorEmail: string | null
  entityType: string
  /** The id read, for a single-row read. Undefined for a collection. */
  entityId?: string
  description: string
  changes: Record<string, unknown>
}): Promise<void> {
  await logAuditEvent({
    userId: params.userId,
    tenantId: params.tenantId,
    schoolId: params.schoolId ?? undefined,
    action: AuditLogAction.READ,
    entity: params.entityType,
    entityId: params.entityId,
    description: params.description,
    changes: { actorEmail: params.actorEmail, read: true, ...params.changes },
  })
}

function buildWhere(tenantId: string, schoolId: string | null, schoolScoped: boolean, search: string | undefined, fields: string[]) {
  const where: Record<string, unknown> = {}
  if (tenantId) where.tenantId = tenantId
  // Only include schoolId for models that have a schoolId column
  if (schoolScoped && schoolId) where.schoolId = schoolId
  if (search) {
    if (fields.includes('name')) {
      where.name = { contains: search, mode: 'insensitive' }
    } else if (fields.includes('code')) {
      where.code = { contains: search, mode: 'insensitive' }
    }
  }
  return where
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entityType: string }> }
) {
  try {
    const { entityType } = await params
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

    // Fail closed: school-scoped entities require a schoolId.
    // Tenant-only models (grading_level, subject_level, fee_line_item)
    // are tenant-scoped and should not have schoolId in the query.
    const schoolScoped = entityConfig.schoolScoped
    if (schoolScoped && !schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const parsed = paginationSchema.safeParse(Object.fromEntries(searchParams))

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid pagination params' }, { status: 400 })
    }

    const { page, limit, sort, order, search } = parsed.data
    const skip = (page - 1) * limit

    const model = prisma[entityConfig.model as keyof typeof prisma] as unknown as {
      findMany: (args: unknown) => Promise<unknown[]>
      count: (args: unknown) => Promise<number>
      create: (args: unknown) => Promise<unknown>
    }

    const orderBy = sort && entityConfig.allowedSortFields.includes(sort)
      ? { [sort]: order }
      : { createdAt: 'desc' }

    const where = buildWhere(tenantId, schoolId, schoolScoped, search, entityConfig.fields)
    const [data, total] = await Promise.all([
      model.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      model.count({ where }),
    ])

    // After the read and before the answer, and only for a search: see the policy in
    // `auditConfigRead`. An unfiltered list read files nothing, deliberately. The test
    // is truthiness rather than `!== undefined` on purpose: `?search=` is what a
    // browser sends for a cleared search box, it names nobody, and it shaped nothing.
    if (search) {
      const [sortBy, sortOrder] = Object.entries(orderBy)[0] ?? ['createdAt', 'desc']
      await auditConfigRead({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        description: `Read ${entityType} list: ${data.length} of ${total} rows, search applied`,
        changes: {
          // The rows this page returned and the rows the search matched, which are
          // different numbers on every page but the last. A trail that recorded only
          // one of them could not distinguish "searched and found one" from "searched
          // a list of two hundred and saw twenty".
          rowCount: data.length,
          totalMatched: total,
          scope: readScope(tenantId, schoolId),
          // The EFFECTIVE sort, not the requested one: `sort` is a caller-supplied
          // string that `allowedSortFields` may have rejected in favour of
          // `createdAt`, and recording the request would say a sort was applied that
          // was not.
          filters: { search, page, limit, sortBy, sortOrder },
        },
      })
    }

    return NextResponse.json({
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    })
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
    return NextResponse.json({ error: 'Failed to fetch entities' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entityType: string }> }
) {
  try {
    const { entityType } = await params
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
        description: `Refused to create ${entityType}: the caller does not hold config:write`,
        reason: 'PERMISSION_DENIED',
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const schoolScoped = entityConfig.schoolScoped
    if (schoolScoped && !schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const body = await req.json()

    const validated = entityConfig.createSchema.safeParse(body)

    if (!validated.success) {
      await auditRefusedWrite({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        description: `Refused to create ${entityType}: the body does not match the create schema`,
        reason: 'VALIDATION_FAILED',
      })
      return NextResponse.json({ error: 'Validation failed', issues: validated.error.format() }, { status: 400 })
    }

    const validatedData = validated.data as Record<string, unknown>

    // Both reads are bound to this caller, not to the module: the row about to be
    // written and the row it would hang from are each checked against the same
    // tenant and school the request arrived with.
    const scope: CallerScope = { tenantId, schoolId }
    const reads = crossRowReads(entityConfig, scope)

    // Ownership before validation, and before the write. The row being written is
    // already proved to be the caller's; the row it attaches to is not, and
    // nothing further down this handler would look.
    const parentRefusal = await parentWriteRefusal(
      entityConfig,
      { operation: 'create', write: validatedData, existing: null },
      reads,
      scope,
    )
    if (parentRefusal) {
      // A refused create is not a create: no row was written, and the success entry
      // below never runs. What is recorded here is the attempt, because a caller
      // who holds `config:write` and aims at another school's or another tenant's
      // row is the highest-value thing this table exists to surface, and it leaves
      // no trace anywhere else — the answer is deliberately the same 404 a missing
      // parent gets, so the response cannot even be used to detect it.
      //
      // `SYSTEM` because `AuditLogAction` has no denied member and adding one is a
      // change to the shared enum rather than to this route; `refused: true` inside
      // the hashed `changes` is what makes the entry impossible to misread as a
      // write. No `entityId`: there is no row, and the only id in the request is the
      // foreign parent's, which belongs in another tenant's audit trail, not here.
      //
      // Deliberately unrecorded, because a row per attempt would bury the rows that
      // mean something: a 403 (a caller who can write nothing anywhere), a schema
      // 400, and a sibling-validation 400. Those say the request was malformed.
      await logAuditEvent({
        userId,
        tenantId,
        schoolId: schoolId ?? undefined,
        action: AuditLogAction.SYSTEM,
        entity: entityType,
        description: `Refused to create ${entityType}: it names a parent this caller does not own`,
        changes: { actorEmail, refused: true, reason: 'PARENT_NOT_OWNED' },
      })
      return parentRefusal
    }

    // Before the write, not after: a row that can only be valid beside its
    // siblings is checked against the scale it would join, so the school never
    // ends up holding a scale that mis-grades a child.
    const siblingProblems = await crossRowWriteProblems(
      entityConfig,
      {
        operation: 'create',
        write: validatedData,
        existing: null,
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
        description: `Refused to create ${entityType}: it conflicts with the rows it must sit beside`,
        reason: 'VALIDATION_FAILED',
      })
      return NextResponse.json({ error: 'Validation failed', issues: siblingProblems }, { status: 400 })
    }

    // And the other kind of sibling: this row against others of its OWN kind, which
    // is the question a grading scale's applicability asks.
    const ownKindProblems = await siblingWriteProblems(
      entityConfig,
      { operation: 'create', write: validatedData, existing: null },
      scope,
    )
    if (ownKindProblems.length > 0) {
      await auditRefusedWrite({
        userId,
        tenantId,
        schoolId,
        actorEmail,
        entityType,
        description: `Refused to create ${entityType}: it overlaps a sibling row of its own kind`,
        reason: 'VALIDATION_FAILED',
      })
      return NextResponse.json({ error: 'Validation failed', issues: ownKindProblems }, { status: 400 })
    }

    // entityConfig.model is keyof typeof prisma; use typed delegate to avoid `as any`
    const model = (prisma as unknown as Record<string, { create: (args: { data: Record<string, unknown> }) => Promise<unknown> }>)[entityConfig.model]
    const created = await model.create({
      data: {
        ...validatedData,
        tenantId,
        // Only include schoolId when the model has a schoolId column
        ...(schoolScoped ? { schoolId } : {}),
      },
    })

    // After the write and after every refusal above it, so this entry can only ever
    // describe a row that exists. The tenant and school are the caller's own, the
    // same pair the row was scoped with — the chain in `logger.ts` is keyed by
    // tenant, so passing them keeps this school's chain its own.
    const createdId = (created as { id?: unknown } | null)?.id
    await logAuditEvent({
      userId,
      tenantId,
      schoolId: schoolId ?? undefined,
      action: AuditLogAction.CREATE,
      entity: entityType,
      // The id the database gave the row. `undefined` rather than a cast of
      // something else if a driver ever returns no id: an entry with no entityId is
      // honest about not knowing, and the row's tenant, school and fields are still
      // recorded. `entity` names the registry key, so `entityId` is that row's id
      // and not a model's primary key in the abstract.
      entityId: typeof createdId === 'string' ? createdId : undefined,
      description: `Created ${entityType}`,
      // The fields the create carried, each with `before: null`: nothing held this
      // row before the write, which is what separates a create from an update in
      // the log besides the action itself.
      changes: { actorEmail, fields: auditFields(validatedData) },
    })

    return NextResponse.json(created, { status: 201 })
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
    // Before the generic 500: a duplicate is a client error, and the catch-all
    // would otherwise report it as an outage.
    if (isUniqueConstraintViolation(error)) return duplicateResponse()
    logError('ConfigEntity', error)
    return NextResponse.json({ error: 'Failed to create entity' }, { status: 500 })
  }
}