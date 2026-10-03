import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { logError } from '@/lib/logger'
import { ENTITY_CONFIG_MAP, type EntityApiConfig } from '@novastar/shared-types'
import {
  gradingScaleBandWriteRule,
  type CrossRowWriteRule,
} from '@novastar/shared-utils'
import { isUniqueConstraintViolation, duplicateResponse } from '@/lib/prisma-conflict'

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
 * The one database read a cross-row rule needs: every band stored for a scale.
 *
 * Supplied here rather than imported into the rule so the rule stays a pure
 * function in @novastar/shared-utils, which also owns the validator the seed
 * calls — one implementation of "a valid scale", not two.
 */
const readScaleBands: Parameters<CrossRowWriteRule>[0]['readScaleBands'] =
  async (gradingScaleId) =>
    prisma.gradingLevel.findMany({
      where: { gradingScaleId },
      select: { id: true, key: true, minScore: true, maxScore: true },
    })

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
): Promise<string[]> {
  const kind = entityConfig.writeValidation?.kind
  if (kind === undefined) return []
  const rule = CROSS_ROW_WRITE_RULES[kind]
  if (rule === undefined) {
    throw new Error(`No cross-row write rule is registered for "${kind}"`)
  }
  return rule({ ...context, readScaleBands })
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

    const { tenantId, schoolId, userId } = await getTenantContext()

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

    const validated = entityConfig.createSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json({ error: 'Validation failed', issues: validated.error.format() }, { status: 400 })
    }

    const validatedData = validated.data as Record<string, unknown>

    // Before the write, not after: a row that can only be valid beside its
    // siblings is checked against the scale it would join, so the school never
    // ends up holding a scale that mis-grades a child.
    const siblingProblems = await crossRowWriteProblems(entityConfig, {
      operation: 'create',
      write: validatedData,
      existing: null,
    })
    if (siblingProblems.length > 0) {
      return NextResponse.json({ error: 'Validation failed', issues: siblingProblems }, { status: 400 })
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