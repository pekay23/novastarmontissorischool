import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { requirePermission } from '@/lib/tenant'

// Prisma model delegates are camelCase - use string keys to avoid union type issues
const entityModelMap: Record<string, string> = {
  academic_year: 'academicYear',
  term: 'term',
  class_level: 'classLevel',
  subject: 'subject',
  grading_scale: 'gradingScale',
  fee_category: 'feeCategory',
  payment_method: 'paymentMethodConfig',
  role: 'role',
  assessment_type: 'assessmentTypeConfig',
  grading_level: 'gradingLevel',
  branding: 'branding',
  news: 'news',
  event: 'event',
  department: 'department',
  house: 'house',
  class: 'class',
  subject_level: 'subjectLevel',
  fee_structure: 'feeStructure',
  fee_line_item: 'feeLineItem',
  staff: 'staff',
  student: 'student',
  parent: 'parent',
}

// Per-entity update schemas (omitting immutable fields)
const entityUpdateSchemas: Record<string, z.ZodSchema> = {
  academic_year: z.object({
    name: z.string().optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    isCurrent: z.boolean().optional(),
  }),
  term: z.object({
    name: z.string().optional(),
    academicYearId: z.string().optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    isCurrent: z.boolean().optional(),
    status: z.enum(['PLANNING', 'ACTIVE', 'ASSESSMENT', 'REPORTING', 'CLOSED']).optional(),
    weeks: z.number().int().positive().optional(),
  }),
  class_level: z.object({
    code: z.string().optional(),
    name: z.string().optional(),
    phase: z.enum(['KINDERGARTEN', 'PRIMARY', 'JHS', 'SHS']).optional(),
    order: z.number().int().positive().optional(),
    ageMin: z.number().int().positive().optional(),
    ageMax: z.number().int().positive().optional(),
  }),
  subject: z.object({
    code: z.string().optional(),
    name: z.string().optional(),
    category: z.enum(['LANGUAGE', 'MATHEMATICS', 'SCIENCE', 'SOCIAL_STUDIES', 'CREATIVE_ARTS', 'PHYSICAL_EDUCATION', 'ICT', 'RELIGIOUS_MORAL', 'MONTESSORI_PRACTICAL', 'MONTESSORI_SENSORIAL', 'MONTESSORI_LANGUAGE', 'MONTESSORI_MATHEMATICS', 'MONTESSORI_CULTURAL', 'OTHER']).optional(),
    isCore: z.boolean().optional(),
    creditHours: z.number().int().positive().optional(),
    description: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
  }),
  grading_scale: z.object({
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    isDefault: z.boolean().optional(),
    appliesToLevels: z.array(z.string()).optional(),
  }),
  fee_category: z.object({
    code: z.string().optional(),
    name: z.string().optional(),
    isRecurring: z.boolean().optional(),
    defaultMandatory: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }),
  payment_method: z.object({
    code: z.string().optional(),
    name: z.string().optional(),
    instructions: z.string().nullable().optional(),
    isEnabled: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    providerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
    // Privilege-management fields (permissions, inheritsFrom, isSystem) are
    // intentionally excluded from both create and update — they cannot be
    // edited via the generic config endpoints. Use a dedicated admin endpoint.
    role: z.object({
     name: z.string().optional(),
     description: z.string().nullable().optional(),
   }),
  assessment_type: z.object({
    code: z.string().optional(),
    name: z.string().optional(),
    defaultWeight: z.number().min(0).max(1).optional(),
    maxScore: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
    appliesToLevels: z.array(z.string()).optional(),
  }),
  grading_level: z.object({
    gradingScaleId: z.string().optional(),
    key: z.string().optional(),
    label: z.string().optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    maxScore: z.number().int().min(0).max(100).optional(),
    color: z.string().optional(),
    order: z.number().int().optional(),
    description: z.string().nullable().optional(),
  }),
  branding: z.object({
    name: z.string().optional(),
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
  news: z.object({
    title: z.string().optional(),
    bodyEn: z.string().optional(),
    bodyTw: z.string().optional(),
    excerptEn: z.string().optional(),
    excerptTw: z.string().optional(),
    category: z.string().optional(),
    featuredImage: z.string().url().nullable().optional(),
    audience: z.array(z.string()).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
    publishedAt: z.date().nullable().optional(),
  }),
  event: z.object({
    title: z.string().optional(),
    descriptionEn: z.string().optional(),
    descriptionTw: z.string().optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    location: z.string().optional(),
    audience: z.array(z.string()).optional(),
    isAllDay: z.boolean().optional(),
    recurrence: z.string().optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED', 'CANCELLED']).optional(),
  }),
  department: z.object({
    name: z.string().optional(),
    code: z.string().optional(),
  }),
  house: z.object({
    name: z.string().optional(),
    color: z.string().optional(),
    motto: z.string().optional(),
  }),
  class: z.object({
    name: z.string().optional(),
    levelId: z.string().optional(),
    stream: z.string().optional(),
    capacity: z.number().int().positive().optional(),
  }),
  subject_level: z.object({
    subjectId: z.string().optional(),
    classLevelId: z.string().optional(),
    isRequired: z.boolean().optional(),
    periodsPerWeek: z.number().int().positive().optional(),
  }),
  fee_structure: z.object({
    name: z.string().optional(),
    academicYearId: z.string().optional(),
    termId: z.string().optional(),
    classLevelId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
  fee_line_item: z.object({
    feeStructureId: z.string().optional(),
    categoryId: z.string().optional(),
    amount: z.number().nonnegative().optional(),
    isMandatory: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }),
  staff: z.object({
    employeeId: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    hireDate: z.date().optional(),
    status: z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED']).optional(),
    roleId: z.string().optional(),
    departmentId: z.string().nullable().optional(),
  }),
  student: z.object({
    admissionNumber: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    dateOfBirth: z.date().optional(),
    admissionDate: z.date().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED']).optional(),
    classId: z.string().optional(),
    houseId: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),
  }),
  parent: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    address: z.string().optional(),
    occupation: z.string().optional(),
  }),
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic Prisma model access
const getModel = (modelName: string) => (prisma as any)[modelName]

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entityType: string; id: string }> }
) {
  try {
    const { entityType, id } = await params
    const modelName = entityModelMap[entityType]

    if (!modelName) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    await requirePermission('config:read')

    const { tenantId, schoolId } = await getSessionTenantSchool()
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const model = getModel(modelName)
    const entity = await model.findFirst({
      where: { id, tenantId, schoolId },
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
      console.error('Server config error:', error.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    console.error(`Config entity fetch error:`, error)
    return NextResponse.json({ error: 'Failed to fetch entity' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entityType: string; id: string }> }
) {
  try {
    const { entityType, id } = await params
    const modelName = entityModelMap[entityType]
    const updateSchema = entityUpdateSchemas[entityType]

    if (!modelName) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    if (!updateSchema) {
      return NextResponse.json({ error: 'No update schema for this entity type' }, { status: 500 })
    }

    await requirePermission('config:write')

    const { tenantId, schoolId } = await getSessionTenantSchool()
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    // Remove immutable fields
    const { id: _id, tenantId: _tenantId, schoolId: _schoolId, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = body

    const validated = updateSchema.safeParse(data)
    if (!validated.success) {
      return NextResponse.json({ error: 'Validation failed', issues: validated.error.format() }, { status: 400 })
    }

    // Verify entity belongs to tenant/school before update
    const model = getModel(modelName)
    const existing = await model.findFirst({ where: { id, tenantId, schoolId } })
    if (!existing) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    const updated = await model.update({
      where: { id },
      data: validated.data,
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
      console.error('Server config error:', error.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    console.error(`Config entity update error:`, error)
    return NextResponse.json({ error: 'Failed to update entity' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ entityType: string; id: string }> }
) {
  try {
    const { entityType, id } = await params
    const modelName = entityModelMap[entityType]

    if (!modelName) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    await requirePermission('config:write')

    const { tenantId, schoolId } = await getSessionTenantSchool()
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if entity exists and belongs to tenant/school
    const model = getModel(modelName)
    const entity = await model.findFirst({ where: { id, tenantId, schoolId } })
    if (!entity) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    // Check if system entity (protected)
    const isSystem = 'isSystem' in entity && entity.isSystem === true
    if (isSystem) {
      return NextResponse.json({ error: 'System entities cannot be deleted' }, { status: 403 })
    }

    await model.delete({ where: { id } })

    return NextResponse.json({ success: true })
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
    console.error(`Config entity delete error:`, error)
    return NextResponse.json({ error: 'Failed to delete entity' }, { status: 500 })
  }
}