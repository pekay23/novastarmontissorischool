import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { calculatePercentage, determineGrade } from '@novastar/shared-utils'
import { z } from 'zod'
import { logError } from '@/lib/logger'

// GET /api/assessments/[id]/scores — List all scores for an assessment
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'assessment:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'assessment:grade', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: assessmentId } = await params

    // Verify assessment belongs to this school/tenant. The class's level
    // comes with the same join the student check already needs, so the
    // grading-scale lookup below does not re-query the assessment.
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, tenantId },
      include: {
        classSubject: {
          include: {
            class: {
              include: {
                students: { select: { id: true } },
                level: { select: { name: true, code: true } },
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

    // Shared helper so rounding is consistent everywhere a score is stored.
    const maxScore = Number(assessment.maxScore)
    const percentage = calculatePercentage(rawScore, maxScore)

    // Resolve the grading scale that applies to the class's level: prefer a
    // scale whose `appliesToLevels` names the level, then the tenant's
    // default. The seed stores level *codes* in `appliesToLevels` (e.g.
    // 'B1'..'B9'), so the code is matched first and the name second. With
    // no matching scale and no default the write still succeeds — the
    // grade simply stays null rather than failing a save over configuration.
    const level = assessment.classSubject.class.level
    const levelKeys = level ? [level.code, level.name] : []
    const scales = await prisma.gradingScale.findMany({
      where: { tenantId, OR: [{ schoolId }, { schoolId: null }] },
      include: { levels: { orderBy: { order: 'asc' } } },
    })
    const scale =
      scales.find((s) => levelKeys.some((key) => s.appliesToLevels.includes(key))) ??
      scales.find((s) => s.isDefault) ??
      null

    // Deliberately the band's `key`, not its `label`: `determineGrade`
    // returns the label in all three of `grade`, `key` and `label`, and
    // the UI colour maps in `grades/[id]/scores` and
    // `reports/[studentId]` are keyed on the bare letter ('A'..'F').
    // Storing the label would render those badges grey.
    const grade = scale
      ? determineGrade(
          percentage,
          scale.levels.map((l) => ({
            minScore: l.minScore,
            maxScore: l.maxScore,
            key: l.key,
            label: l.label,
          })),
        )?.key ?? null
      : null
    const gradingScaleId = scale?.id ?? null

    // Upsert the score. `grade` and `gradingScaleId` are set on BOTH
    // branches: the update branch previously hardcoded `grade: null`,
    // which blanked any stored grade on every save.
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
        grade,
        gradingScaleId,
        notes: notes || undefined,
      },
      create: {
        tenantId,
        assessmentId,
        studentId,
        rawScore,
        percentage,
        grade,
        gradingScaleId,
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
