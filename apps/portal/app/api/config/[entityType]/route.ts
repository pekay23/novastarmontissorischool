import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { requirePermission } from '@/lib/tenant'
import {
  AcademicYearSchema,
  TermSchema,
  ClassLevelSchema,
  SubjectSchema,
  GradingScaleSchema,
  FeeCategorySchema,
  PaymentMethodConfigSchema,
  RoleSchema,
  AssessmentTypeConfigSchema,
  GradingLevelSchema,
} from '@novastar/shared-types'

// Prisma model delegates are camelCase
const entityModelMap: Record<string, {
  model: keyof typeof prisma
  fields: string[]
  createSchema: z.ZodSchema
  allowedSortFields: string[]
}> = {
  academic_year: {
    model: 'academicYear',
    fields: ['id', 'name', 'startDate', 'endDate', 'isCurrent', 'createdAt', 'updatedAt'],
    createSchema: AcademicYearSchema.omit({ id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true }),
    allowedSortFields: ['name', 'startDate', 'endDate', 'isCurrent', 'createdAt'],
  },
  term: {
    model: 'term',
    fields: ['id', 'name', 'academicYearId', 'startDate', 'endDate', 'isCurrent', 'status', 'weeks', 'createdAt', 'updatedAt'],
    createSchema: TermSchema.omit({ id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true }),
    allowedSortFields: ['name', 'startDate', 'endDate', 'isCurrent', 'status', 'createdAt'],
  },
  class_level: {
    model: 'classLevel',
    fields: ['id', 'code', 'name', 'phase', 'order', 'ageMin', 'ageMax', 'createdAt', 'updatedAt'],
    createSchema: ClassLevelSchema.omit({ id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true }),
    allowedSortFields: ['code', 'name', 'phase', 'order', 'ageMin', 'ageMax', 'createdAt'],
  },
  subject: {
    model: 'subject',
    fields: ['id', 'code', 'name', 'category', 'isCore', 'creditHours', 'description', 'color', 'createdAt', 'updatedAt'],
    createSchema: SubjectSchema.omit({ id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true }),
    allowedSortFields: ['code', 'name', 'category', 'isCore', 'createdAt'],
  },
  grading_scale: {
    model: 'gradingScale',
    fields: ['id', 'name', 'description', 'isDefault', 'appliesToLevels', 'createdAt', 'updatedAt'],
    createSchema: GradingScaleSchema.omit({ id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true }),
    allowedSortFields: ['name', 'isDefault', 'createdAt'],
  },
  fee_category: {
    model: 'feeCategory',
    fields: ['id', 'code', 'name', 'isRecurring', 'defaultMandatory', 'sortOrder', 'createdAt', 'updatedAt'],
    createSchema: FeeCategorySchema.omit({ id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true }),
    allowedSortFields: ['code', 'name', 'sortOrder', 'createdAt'],
  },
  payment_method: {
    model: 'paymentMethodConfig',
    fields: ['id', 'code', 'name', 'instructions', 'isEnabled', 'sortOrder', 'providerConfig', 'createdAt', 'updatedAt'],
    createSchema: PaymentMethodConfigSchema.omit({ id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true }),
    allowedSortFields: ['code', 'name', 'sortOrder', 'isEnabled', 'createdAt'],
  },
  role: {
    model: 'role',
    fields: ['id', 'name', 'description', 'isSystem', 'permissions', 'inheritsFrom', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      description: z.string().nullable().optional(),
    }),
    allowedSortFields: ['name', 'isSystem', 'createdAt'],
  },
  assessment_type: {
    model: 'assessmentTypeConfig',
    fields: ['id', 'code', 'name', 'defaultWeight', 'maxScore', 'isActive', 'appliesToLevels', 'createdAt', 'updatedAt'],
    createSchema: AssessmentTypeConfigSchema.omit({ id: true, tenantId: true, schoolId: true, createdAt: true, updatedAt: true }),
    allowedSortFields: ['code', 'name', 'defaultWeight', 'isActive', 'createdAt'],
  },
  grading_level: {
    model: 'gradingLevel',
    fields: ['id', 'gradingScaleId', 'key', 'label', 'minScore', 'maxScore', 'color', 'order', 'description', 'createdAt', 'updatedAt'],
    createSchema: GradingLevelSchema.pick({
      gradingScaleId: true,
      key: true,
      label: true,
      minScore: true,
      maxScore: true,
      color: true,
      description: true,
      order: true,
    }),
    allowedSortFields: ['order', 'key', 'minScore', 'createdAt'],
  },
  branding: {
    model: 'branding',
    fields: ['id', 'name', 'logoUrl', 'primaryColor', 'secondaryColor', 'accentColor', 'motto', 'phone', 'email', 'address', 'socialLinks', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      logoUrl: z.string().url().nullable().optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      motto: z.string().nullable().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().optional(),
      socialLinks: z.record(z.string(), z.unknown()).optional(),
    }),
    allowedSortFields: ['createdAt'],
  },
  news: {
    model: 'news',
    fields: ['id', 'title', 'bodyEn', 'bodyTw', 'excerptEn', 'excerptTw', 'category', 'featuredImage', 'audience', 'status', 'publishedAt', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      title: z.string().min(1),
      bodyEn: z.string().optional(),
      bodyTw: z.string().optional(),
      excerptEn: z.string().optional(),
      excerptTw: z.string().optional(),
      category: z.string().optional(),
      featuredImage: z.string().url().nullable().optional(),
      audience: z.array(z.string()).optional(),
      status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
      publishedAt: z.date().nullable().optional(),
    }),
    allowedSortFields: ['title', 'publishedAt', 'status', 'createdAt'],
  },
  event: {
    model: 'event',
    fields: ['id', 'title', 'descriptionEn', 'descriptionTw', 'startDate', 'endDate', 'location', 'audience', 'isAllDay', 'recurrence', 'status', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      title: z.string().min(1),
      descriptionEn: z.string().optional(),
      descriptionTw: z.string().optional(),
      startDate: z.date(),
      endDate: z.date(),
      location: z.string().optional(),
      audience: z.array(z.string()).optional(),
      isAllDay: z.boolean().default(false),
      recurrence: z.string().optional(),
      status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED', 'CANCELLED']).default('DRAFT'),
    }),
    allowedSortFields: ['startDate', 'endDate', 'title', 'status', 'createdAt'],
  },
  department: {
    model: 'department',
    fields: ['id', 'name', 'code', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      code: z.string().min(1),
    }),
    allowedSortFields: ['name', 'code', 'createdAt'],
  },
  house: {
    model: 'house',
    fields: ['id', 'name', 'color', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      color: z.string().min(1),
      motto: z.string().optional(),
    }),
    allowedSortFields: ['name', 'createdAt'],
  },
  class: {
    model: 'class',
    fields: ['id', 'name', 'levelId', 'stream', 'capacity', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      levelId: z.string(),
      stream: z.string().optional(),
      capacity: z.number().int().positive().default(35),
    }),
    allowedSortFields: ['name', 'levelId', 'createdAt'],
  },
  subject_level: {
    model: 'subjectLevel',
    fields: ['id', 'subjectId', 'classLevelId', 'isRequired', 'periodsPerWeek', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      subjectId: z.string(),
      classLevelId: z.string(),
      isRequired: z.boolean().default(true),
      periodsPerWeek: z.number().int().positive().default(4),
    }),
    allowedSortFields: ['subjectId', 'classLevelId', 'createdAt'],
  },
  fee_structure: {
    model: 'feeStructure',
    fields: ['id', 'name', 'academicYearId', 'termId', 'classLevelId', 'isActive', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      name: z.string().min(1),
      academicYearId: z.string(),
      termId: z.string(),
      classLevelId: z.string(),
      isActive: z.boolean().default(true),
    }),
    allowedSortFields: ['name', 'academicYearId', 'termId', 'createdAt'],
  },
  fee_line_item: {
    model: 'feeLineItem',
    fields: ['id', 'feeStructureId', 'categoryId', 'amount', 'isMandatory', 'sortOrder', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      feeStructureId: z.string(),
      categoryId: z.string(),
      amount: z.number().nonnegative(),
      isMandatory: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
    }),
    allowedSortFields: ['sortOrder', 'amount', 'createdAt'],
  },
  staff: {
    model: 'staff',
    fields: ['id', 'employeeId', 'firstName', 'lastName', 'gender', 'phone', 'email', 'hireDate', 'status', 'roleId', 'departmentId', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      employeeId: z.string().min(1),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      hireDate: z.date().optional(),
      status: z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED']).default('ACTIVE'),
      roleId: z.string(),
      departmentId: z.string().nullable().optional(),
    }),
    allowedSortFields: ['employeeId', 'firstName', 'lastName', 'status', 'createdAt'],
  },
  student: {
    model: 'student',
    fields: ['id', 'admissionNumber', 'firstName', 'lastName', 'gender', 'dateOfBirth', 'admissionDate', 'status', 'classId', 'houseId', 'parentId', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      admissionNumber: z.string().min(1),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
      dateOfBirth: z.date(),
      admissionDate: z.date(),
      status: z.enum(['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED']).default('ACTIVE'),
      classId: z.string(),
      houseId: z.string().nullable().optional(),
      parentId: z.string().nullable().optional(),
    }),
    allowedSortFields: ['admissionNumber', 'firstName', 'lastName', 'admissionDate', 'status', 'createdAt'],
  },
  parent: {
    model: 'parent',
    fields: ['id', 'firstName', 'lastName', 'phone', 'email', 'address', 'occupation', 'createdAt', 'updatedAt'],
    createSchema: z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      phone: z.string().min(1),
      email: z.string().email().optional(),
      address: z.string().optional(),
      occupation: z.string().optional(),
    }),
    allowedSortFields: ['firstName', 'lastName', 'phone', 'createdAt'],
  },
}

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
})

async function getSessionTenantSchool() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return { tenantId: null, schoolId: null, role: null }
  }
  const user = session.user as { id?: string; role?: string; schoolId?: string; tenantId?: string }
  let tenantId = user.tenantId
  if (!tenantId && user.schoolId) {
    const school = await prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { tenantId: true },
    })
    tenantId = school?.tenantId
    if (!tenantId) {
      return { tenantId: null, schoolId: null, role: null }
    }
  }
  const schoolId = user.schoolId && user.schoolId.length > 0 ? user.schoolId : undefined
  return { tenantId, schoolId, role: user.role ?? null }
}

function buildWhere(tenantId: string, schoolId: string | undefined, search: string | undefined, fields: string[]) {
  const where: Record<string, unknown> = {}
  if (tenantId) where.tenantId = tenantId
  if (schoolId) where.schoolId = schoolId
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
    const entityConfig = entityModelMap[entityType]

    if (!entityConfig) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    await requirePermission('config:read')

    const { tenantId, schoolId } = await getSessionTenantSchool()
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const parsed = paginationSchema.safeParse(Object.fromEntries(searchParams))

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid pagination params' }, { status: 400 })
    }

    const { page, limit, sort, order, search } = parsed.data
    const skip = (page - 1) * limit

    const model = prisma[entityConfig.model] as unknown as {
      findMany: (args: unknown) => Promise<unknown[]>
      count: (args: unknown) => Promise<number>
      create: (args: unknown) => Promise<unknown>
    }
    
    const orderBy = sort && entityConfig.allowedSortFields.includes(sort)
      ? { [sort]: order }
      : { createdAt: 'desc' }

    const where = buildWhere(tenantId, schoolId, search, entityConfig.fields)
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
      console.error('Server config error:', error.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    console.error(`Config entity fetch error:`, error)
    return NextResponse.json({ error: 'Failed to fetch entities' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entityType: string }> }
) {
  try {
    const { entityType } = await params
    const entityConfig = entityModelMap[entityType]

    if (!entityConfig) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    await requirePermission('config:write')

    const { tenantId, schoolId } = await getSessionTenantSchool()
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    const validated = entityConfig.createSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json({ error: 'Validation failed', issues: validated.error.format() }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic Prisma model access
    const model = prisma[entityConfig.model] as any
    const validatedData = validated.data as Record<string, unknown>
    const created = await model.create({
      data: {
        ...validatedData,
        tenantId,
        schoolId,
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
      console.error('Server config error:', error.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    console.error(`Config entity create error:`, error)
    return NextResponse.json({ error: 'Failed to create entity' }, { status: 500 })
  }
}