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
 * A band row has no `schoolId` of its own — the model is tenant-scoped — so the
 * school a band belongs to is the school of its scale, and proving the row is the
 * caller's proves nothing about the school that grades a child against it. On an
 * edit the parent is whichever scale this patch names, falling back to the one
 * the stored row already hangs from, which is what closes the second half of the
 * hole: a patch that moves a band onto a sibling school's scale is refused here
 * exactly as a create attaching to one is.
 *
 * 404, and the same 404 whether the scale is missing or simply belongs to another
 * school — telling those apart would confirm that another school's row exists.
 * A patch naming no resolvable parent at all is refused the same way: an unproven
 * parent is a foreign one.
 *
 * Never applied to a delete. The row being deleted is already proved to be the
 * caller's, and refusing to remove a band precisely because its scale turned out
 * to be somebody else's would strand the very rows this hole created.
 */
async function parentWriteRefusal(
  entityConfig: EntityApiConfig,
  context: CrossRowWriteTarget,
  reads: Pick<CrossRowReads, 'readParent'>,
): Promise<NextResponse | null> {
  const kind = entityConfig.writeValidation?.kind
  if (kind === undefined) return null
  const parentId = PARENT_SCOPE_CHECKS[kind].parentId(context)
  if (parentId === null || (await reads.readParent(parentId)) === null) {
    return NextResponse.json({ error: 'Parent not found' }, { status: 404 })
  }
  return null
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

    const { tenantId, schoolId, userId } = await getTenantContext()

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

    const { tenantId, schoolId, userId } = await getTenantContext()

    // RBAC: use @novastar/auth hasPermission (handles delegations + role inheritance)
    if (!(await hasPermission(userId, 'config:write', tenantId, schoolId ?? undefined))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const schoolScoped = entityConfig.schoolScoped
    if (schoolScoped && !schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const body = await req.json()

    // Remove immutable fields
    const { id: _id, tenantId: _tenantId, schoolId: _schoolId, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = body

    const validated = entityConfig.updateSchema.safeParse(data)
    if (!validated.success) {
      return NextResponse.json({ error: 'Validation failed', issues: validated.error.format() }, { status: 400 })
    }

    // Verify entity belongs to tenant/school before update
    const model = getModel(entityConfig.model)
    const scopeWhere = buildScopeWhere(id, tenantId, schoolId, schoolScoped, entityConfig.softDelete)
    const existing = await model.findFirst({ where: scopeWhere })
    if (!existing) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    // Both reads are bound to this caller, not to the module.
    const reads = crossRowReads(entityConfig, { tenantId, schoolId })

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
    )
    if (parentRefusal) {
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
      return NextResponse.json({ error: 'Validation failed', issues: siblingProblems }, { status: 400 })
    }

    const updated = await model.update({
      where: scopeWhere,
      data: validated.data as Record<string, unknown>,
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

    const { tenantId, schoolId, userId } = await getTenantContext()

    // RBAC: use @novastar/auth hasPermission (handles delegations + role inheritance)
    if (!(await hasPermission(userId, 'config:write', tenantId, schoolId ?? undefined))) {
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
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    // Check if system entity (protected)
    const entityRecord = entity as Record<string, unknown>
    const isSystem = 'isSystem' in entityRecord && entityRecord.isSystem === true
    if (isSystem) {
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