import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { logError } from '@/lib/logger'
import { ENTITY_CONFIG_MAP } from '@novastar/shared-types'

/**
 * Prisma `P2002` is a unique-constraint violation.
 *
 * Four entities behind this generic route carry real unique constraints —
 * `timetable_entry` (`@@unique([tenantId, timetableId, dayOfWeek, startTime,
 * classSubjectId])`), `attendance_taker` (`@@unique([tenantId, schoolId,
 * classId, staffId])`), `timetable` and `syllabus` — so a duplicate POST is an
 * expected client outcome, not a server fault. Reported as a 500 it both
 * misreports the fault and buries ordinary use in the error log and on the
 * platform-errors page.
 *
 * Duplicated rather than shared with `config/[entityType]/[id]/route.ts`: the two
 * files already carry byte-identical catch blocks, and a shared helper would be a
 * new module outside this change's ownership. `Prisma.PrismaClientKnownRequestError`
 * is matched by `instanceof` rather than by duck-typing `err.code`, which would
 * also catch an unrelated error object that happens to carry a `code` field.
 */
function isUniqueConstraintViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

/** The 409 body. Same `{ error }` shape as every other response in this file. */
function duplicateResponse() {
  return NextResponse.json(
    { error: 'A record with these values already exists' },
    { status: 409 },
  )
}

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
})

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

    // entityConfig.model is keyof typeof prisma; use typed delegate to avoid `as any`
    const model = (prisma as unknown as Record<string, { create: (args: { data: Record<string, unknown> }) => Promise<unknown> }>)[entityConfig.model]
    const validatedData = validated.data as Record<string, unknown>
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