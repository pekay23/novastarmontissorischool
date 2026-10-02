import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { z } from 'zod'
import { logError } from '@/lib/logger'

// List all assessments for the current school/tenant
export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'assessment:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const classId = searchParams.get('classId')
    const termId = searchParams.get('termId')

    const where: Record<string, unknown> = { schoolId, tenantId }
    if (classId) where.classSubject = { classId }
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
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'assessment:create', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = CreateAssessmentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { classSubjectId, termId, typeId, name, description, maxScore, assessmentDate, dueDate } = parseResult.data

    // Verify classSubject belongs to this school/tenant
    const classSubject = await prisma.classSubject.findFirst({
      where: { id: classSubjectId, tenantId },
      include: { subject: { select: { name: true, code: true } } },
    })
    if (!classSubject) {
      return NextResponse.json({ error: 'ClassSubject not found' }, { status: 404 })
    }

    // Get default weight from the assessment type config
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
        weight: Number(typeConfig.defaultWeight),
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

