import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  assessmentVisibilityWhere,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

// List all assessments for the current school/tenant
export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'assessment:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope. The permission gate above answers "may they read assessments
    // at all"; this answers "which assessments". `CLASSROOM_TEACHER` holds
    // `assessment:read` at `class` scope, so without this the school/tenant
    // filter alone handed every teacher every assessment in the school.
    const visibility = await resolveVisibility(ctx, 'assessment:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const classId = searchParams.get('classId')
    const termId = searchParams.get('termId')

    // Every clause goes under `AND`. Both the visibility filter and
    // `?classId=` address the assessment through `classSubject`, so a shallow
    // merge would let one silently overwrite the other: `?classId=` must
    // NARROW the visible class set, never replace it. Under `AND` a class the
    // caller cannot see yields an unsatisfiable predicate and zero rows.
    const clauses: Prisma.AssessmentWhereInput[] = []
    const scope = assessmentVisibilityWhere(visibility)
    if (Object.keys(scope).length > 0) clauses.push(scope)
    if (classId) clauses.push({ classSubject: { classId } })

    const where: Prisma.AssessmentWhereInput = { schoolId, tenantId }
    if (clauses.length > 0) where.AND = clauses
    if (termId) where.termId = termId

    const assessments = await prisma.assessment.findMany({
      where,
      include: {
        classSubject: {
          include: {
            subject: { select: { name: true, code: true } },
            class: { select: { name: true } },
          },
        },
        type: { select: { name: true, code: true } },
        createdBy: { select: { name: true } },
        _count: { select: { scores: true } },
      },
      orderBy: { assessmentDate: 'desc' },
    })

    return NextResponse.json({ data: assessments })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Assessments GET', error)
    return NextResponse.json({ error: 'Failed to fetch assessments' }, { status: 500 })
  }
}

const CreateAssessmentSchema = z.object({
  classSubjectId: z.string(),
  termId: z.string(),
  typeId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  maxScore: z.number().int().positive().default(100),
  assessmentDate: z.string(),
  dueDate: z.string().optional(),
})

// Create a new assessment
export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'assessment:create', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope. `CLASSROOM_TEACHER` holds `assessment:create` at `class` scope,
    // so the permission gate alone let any teacher create an assessment against
    // any `classSubjectId` in the tenant. `visibilityDeniesAll` first, so a
    // teacher with no classes is refused rather than silently creating nothing.
    const visibility = await resolveVisibility(ctx, 'assessment:create')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = CreateAssessmentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { classSubjectId, termId, typeId, name, description, maxScore, assessmentDate, dueDate } = parseResult.data

    // Verify the classSubject belongs to this school/tenant AND to a class the
    // caller may create assessments in. `ClassSubject` has no `schoolId` column,
    // so school scope arrives through the `class` relation. The class filter is
    // assigned, not spread, and onto a key the base object does not carry, so it
    // cannot overwrite the identity or school columns.
    const classSubjectWhere: Prisma.ClassSubjectWhereInput = {
      id: classSubjectId,
      tenantId,
      class: { schoolId },
    }
    if (visibility.classIds) classSubjectWhere.classId = { in: visibility.classIds }

    const classSubject = await prisma.classSubject.findFirst({
      where: classSubjectWhere,
      include: { subject: { select: { name: true, code: true } } },
    })
    if (!classSubject) {
      return NextResponse.json({ error: 'ClassSubject not found' }, { status: 404 })
    }

    // The assessment type is checked to belong to this school/tenant, and that is
    // all it is used for. Its `defaultWeight` is deliberately NOT copied onto the
    // row: an assessment that carries its own weight outranks its type's, so the
    // copy made every API-created assessment report `weightSource: 'assessment'`,
    // made the report tooltip claim a weight the teacher set on the assessment, and
    // made every later retune of the type (`0.30` to `0.40`) inert for rows nobody
    // had pinned. NULL is the value that means "this assessment has no weight of its
    // own", and it is what lets the school's configured weight apply and keep
    // applying. See `resolveAssessmentWeight`.
    const typeConfig = await prisma.assessmentTypeConfig.findFirst({
      where: { id: typeId, tenantId, schoolId },
    })
    if (!typeConfig) {
      return NextResponse.json({ error: 'Assessment type not found' }, { status: 404 })
    }

    // Verify term belongs to this school/tenant
    const term = await prisma.term.findFirst({
      where: { id: termId, tenantId, schoolId },
    })
    if (!term) {
      return NextResponse.json({ error: 'Term not found' }, { status: 404 })
    }

    const assessment = await prisma.assessment.create({
      data: {
        tenantId,
        schoolId,
        classSubjectId,
        termId,
        typeId,
        name,
        description: description || undefined,
        maxScore,
        assessmentDate: new Date(assessmentDate),
        dueDate: dueDate ? new Date(dueDate) : undefined,
        createdById: userId,
      },
    })

    return NextResponse.json(assessment, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Assessments POST', error)
    return NextResponse.json({ error: 'Failed to create assessment' }, { status: 500 })
  }
}

