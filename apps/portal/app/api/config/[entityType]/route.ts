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
 * A band row has no `schoolId` of its own — the model is tenant-scoped — so the
 * school a band belongs to is the school of its scale, and proving the band is
 * the caller's proves nothing about the school that will grade a child against
 * it. Without this check a headmaster posts a band into a sibling school's scale
 * and the row persists with the caller's own `tenantId`: that school's reports
 * and gradebooks then grade children against it, while the school that owns the
 * scale cannot see the row to correct it and the caller has no way to undo it.
 *
 * 404, and the same 404 whether the scale is missing or simply belongs to
 * another school — telling those apart would confirm that another school's row
 * exists. A write naming no resolvable parent at all is refused the same way:
 * an unproven parent is a foreign one.
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

    // Both reads are bound to this caller, not to the module: the row about to be
    // written and the row it would hang from are each checked against the same
    // tenant and school the request arrived with.
    const reads = crossRowReads(entityConfig, { tenantId, schoolId })

    // Ownership before validation, and before the write. The row being written is
    // already proved to be the caller's; the row it attaches to is not, and
    // nothing further down this handler would look.
    const parentRefusal = await parentWriteRefusal(
      entityConfig,
      { operation: 'create', write: validatedData, existing: null },
      reads,
    )
    if (parentRefusal) {
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