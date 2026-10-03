import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ENTITY_CONFIG_MAP } from '@novastar/shared-types'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { logError } from '@/lib/logger'

/**
 * Prisma `P2002` is a unique-constraint violation.
 *
 * A PATCH that moves a record onto a value another record already holds is an
 * expected client outcome for the entities behind this generic route with real
 * unique constraints — `timetable_entry`, `attendance_taker`, `timetable`,
 * `syllabus`. See the identical helper and rationale in
 * `config/[entityType]/route.ts`, which this file deliberately duplicates rather
 * than sharing across a new module.
 */
function isUniqueConstraintViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
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
      return NextResponse.json(
        { error: 'A record with these values already exists' },
        { status: 409 },
      )
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