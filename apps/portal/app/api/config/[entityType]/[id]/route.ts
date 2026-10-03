import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ENTITY_CONFIG_MAP, type EntityApiConfig } from '@novastar/shared-types'
import {
  gradingScaleBandWriteRule,
  type CrossRowWriteRule,
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
 * The one database read a cross-row rule needs: every band stored for a scale.
 * Supplied here so the rule stays a pure function in @novastar/shared-utils,
 * beside the validator the seed calls.
 */
const readScaleBands: Parameters<CrossRowWriteRule>[0]['readScaleBands'] =
  async (gradingScaleId) =>
    prisma.gradingLevel.findMany({
      where: { gradingScaleId },
      select: { id: true, key: true, minScore: true, maxScore: true },
    })

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
): Promise<string[]> {
  const kind = entityConfig.writeValidation?.kind
  if (kind === undefined) return []
  const rule = CROSS_ROW_WRITE_RULES[kind]
  if (rule === undefined) {
    throw new Error(`No cross-row write rule is registered for "${kind}"`)
  }
  return rule({ ...context, readScaleBands })
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

    // Judged against the row as it would be stored — the patch merged over what
    // is there now — so a partial patch that leaves this row's siblings unable to
    // grade between them is refused instead of persisted.
    const siblingProblems = await crossRowWriteProblems(entityConfig, {
      operation: 'update',
      write: validated.data as Record<string, unknown>,
      existing: existing as Record<string, unknown>,
    })
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
    // admin widens a neighbour first.
    const siblingProblems = await crossRowWriteProblems(entityConfig, {
      operation: 'delete',
      write: {},
      existing: entityRecord,
    })
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