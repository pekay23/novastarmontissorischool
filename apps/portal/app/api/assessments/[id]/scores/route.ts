import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'
import { logError } from '@/lib/logger'

// GET /api/assessments/[id]/scores — List all scores for an assessment
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    await requirePermission('assessment:read')

    const { id: assessmentId } = await params

    // Verify assessment belongs to this school/tenant
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, tenantId },
      select: { id: true, name: true, maxScore: true, isPublished: true },
    })
    if (!assessment) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
    }

    const scores = await prisma.score.findMany({
      where: { assessmentId: assessmentId, tenantId },
      include: {
        student: { select: { firstName: true, lastName: true, studentId: true } },
        approvedBy: { select: { name: true } },
      },
      orderBy: { student: { lastName: 'asc' } },
    })

    return NextResponse.json({
      assessment,
      scores,
      meta: {
        total: scores.length,
        graded: scores.filter((s) => s.rawScore !== null).length,
        approved: scores.filter((s) => s.isApproved).length,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Scores GET', error)
    return NextResponse.json({ error: 'Failed to fetch scores' }, { status: 500 })
  }
}

const SaveScoreSchema = z.object({
  studentId: z.string(),
  rawScore: z.number().min(0).max(9999),
  notes: z.string().optional(),
})

// POST /api/assessments/[id]/scores — Upsert a score for a student
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId, userId: _userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    await requirePermission('assessment:grade')

    const { id: assessmentId } = await params

    // Verify assessment belongs to this school/tenant
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, tenantId },
      include: {
        classSubject: {
          include: {
            class: {
              include: {
                students: { select: { id: true } },
              },
            },
          },
        },
        type: { select: { name: true } },
      },
    })
    if (!assessment) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
    }

    const body = await req.json()
    const parseResult = SaveScoreSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { studentId, rawScore, notes } = parseResult.data

    // Verify student is in the class being assessed
    const studentIds = assessment.classSubject.class.students.map((s) => s.id)
    if (!studentIds.includes(studentId)) {
      return NextResponse.json({ error: 'Student is not enrolled in this class' }, { status: 403 })
    }

    // Calculate percentage
    const maxScore = Number(assessment.maxScore)
    const percentage = (rawScore / maxScore) * 100

    // Upsert the score
    const score = await prisma.score.upsert({
      where: {
        tenantId_assessmentId_studentId: {
          tenantId,
          assessmentId,
          studentId,
        },
      },
      update: {
        rawScore,
        percentage,
        grade: null,
        notes: notes || undefined,
      },
      create: {
        tenantId,
        assessmentId,
        studentId,
        rawScore,
        percentage,
        grade: null,
        notes: notes || undefined,
      },
    })

    return NextResponse.json({ success: true, score })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Score POST', error)
    return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
  }
}
