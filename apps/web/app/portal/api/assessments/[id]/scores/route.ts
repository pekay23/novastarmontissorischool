import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  assessmentVisibilityWhere,
  studentVisibilityWhere,
  visibilityDeniesAll,
} from '@/lib/visibility'
import {
  calculatePercentage,
  determineGrade,
  resolveApplicableGradingScale,
} from '@novastar/shared-utils'
import { z } from 'zod'
import { logError } from '@/lib/logger'

// GET /api/assessments/[id]/scores — List all scores for an assessment
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    // Row scope. Same discipline as the list route: `assessment:read` is held
    // by a classroom teacher at `class` scope, so school scope alone is not a
    // narrowing of it.
    const visibility = await resolveVisibility(ctx, 'assessment:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: assessmentId } = await params

    // Verify the assessment belongs to this school/tenant AND to a class the
    // caller may read. Both clauses go under `AND` rather than being merged,
    // so the visibility filter cannot be dropped by a later assignment.
    const assessmentScope = assessmentVisibilityWhere(visibility)
    const assessment = await prisma.assessment.findFirst({
      where: {
        id: assessmentId,
        schoolId,
        tenantId,
        ...(Object.keys(assessmentScope).length > 0 ? { AND: [assessmentScope] } : {}),
      },
      select: { id: true, name: true, maxScore: true, isPublished: true },
    })
    if (!assessment) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
    }

    // `Score` has no `schoolId` and no `classId`: it reaches a school through
    // its `student`, and it reaches a class only through that student's
    // enrolments. So `assessmentId` + `tenantId` alone returned EVERY score
    // on the assessment — names and marks for students in classes the caller
    // does not teach. Narrow to the students the caller may see with the
    // shared `studentVisibilityWhere`, which already encodes the `own` and
    // `class` branches, and compose it under `AND` with the school filter so
    // neither can overwrite the other.
    const clauses: Prisma.ScoreWhereInput[] = [{ student: { schoolId } }]
    const studentScope = studentVisibilityWhere(visibility)
    if (Object.keys(studentScope).length > 0) clauses.push({ student: studentScope })

    const scores = await prisma.score.findMany({
      where: { assessmentId, tenantId, AND: clauses },
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
  // Deliberately unbounded above, and finite: the ceiling is this assessment's
  // own `maxScore`, resolved from the database below, because nothing in the
  // request body knows what this particular assessment is out of. The magic 9999
  // this replaces could only ever have been a guess at that ceiling, and it was
  // loose enough that 9999 against a maxScore of 1 became a 500 from a
  // `Decimal(5,2)` overflow rather than a message to the teacher. `finite` is
  // stated rather than assumed: it is what rejects NaN and Infinity before they
  // can reach the database.
  rawScore: z.number().finite().min(0),
  notes: z.string().optional(),
})

/**
 * The mark bounded by the assessment's own maximum, rebuilt per request.
 *
 * A client-supplied `maxScore` is never read: it would let the caller choose the
 * denominator that makes their own mark correct, and `Score.percentage` is what
 * the gradebook and the report both trust afterwards.
 *
 * An assessment whose stored maximum is unusable admits no mark at all rather
 * than every mark, so a mark outside the range cannot reach the write even when
 * the maximum itself is the thing that is wrong.
 *
 * An object rather than a bare number so the refusal carries the same
 * `path: ['rawScore']` the rest of this handler's validation errors do, and a
 * client can point at the offending field without knowing which rule fired.
 */
function rawScoreWithinAssessment(maxScore: number) {
  const ceiling = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 0
  return z.object({ rawScore: z.number().finite().min(0).max(ceiling) })
}

// POST /api/assessments/[id]/scores — Upsert a score for a student
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'assessment:grade', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope. `assessment:grade` is held by `CLASSROOM_TEACHER` at `class`
    // scope, and the check below that the student is enrolled in the assessment's
    // class only bounds the student relative to the assessment -- it says nothing
    // about whether the caller may touch that assessment. Without this, any
    // teacher could write a mark into any assessment in the school.
    const visibility = await resolveVisibility(ctx, 'assessment:grade')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: assessmentId } = await params

    // Verify the assessment belongs to this school/tenant AND to a class the
    // caller may grade in, composed under `AND` so the scope cannot be dropped.
    // The class's level comes with the same join the student check already
    // needs, so the grading-scale lookup below does not re-query the assessment.
    const assessmentScope = assessmentVisibilityWhere(visibility)
    const assessment = await prisma.assessment.findFirst({
      where: {
        id: assessmentId,
        schoolId,
        tenantId,
        ...(Object.keys(assessmentScope).length > 0 ? { AND: [assessmentScope] } : {}),
      },
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

    // `Assessment.isPublished` is the lock on this assessment, and it is the one
    // bound the write path was missing entirely. Publishing is what puts marks on
    // the report card — `reports/academic/[studentId]` reads scores through
    // `isPublished: true` — so a mark entered or changed after publication lands
    // on a report the school may already have circulated to parents, with nothing
    // recording that it moved. This route previously accepted the write.
    //
    // Refused rather than silently accepted, and before the mark is parsed, so the
    // refusal cannot be mistaken for a complaint about the number.
    if (!assessment.isPublished) {
      return NextResponse.json(
        {
          error:
            'This assessment is not published, so marks cannot be entered. Publish the assessment first.',
        },
        { status: 409 },
      )
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

    // The bound that a per-field schema cannot express: this assessment's own
    // maximum, read from the row the write will land on. Refused, never clamped —
    // clamping would store a mark other than the one the teacher entered, and the
    // entered one is what they will read back.
    const maxScore = Number(assessment.maxScore)
    const bounded = rawScoreWithinAssessment(maxScore).safeParse({ rawScore })
    if (!bounded.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: bounded.error.issues },
        { status: 400 },
      )
    }

    // Shared helper so rounding is consistent everywhere a score is stored, and
    // so a ratio that cannot be a percentage is refused here rather than stored.
    // Unreachable for a mark already inside [0, maxScore], and checked anyway
    // because `Score.percentage` is `Decimal(5,2)`: past 999.99 the failure
    // surfaces as a 500 from the database, which tells a teacher nothing about
    // the mark they typed.
    const percentage = calculatePercentage(rawScore, maxScore)
    if (percentage === null) {
      return NextResponse.json(
        {
          error: `A score of ${rawScore} is not a percentage of this assessment's maximum of ${maxScore}`,
        },
        { status: 400 },
      )
    }

    // Resolve the grading scale that applies to the class's level: prefer a
    // scale whose `appliesToLevels` names the level, then the tenant's
    // default. The seed stores level *codes* in `appliesToLevels` (e.g.
    // 'B1'..'B9'), so the code is matched first and the name second. With
    // no matching scale and no default the write still succeeds — the
    // grade simply stays null rather than failing a save over configuration.
    //
    // `resolveApplicableGradingScale` is the one implementation of that rule and
    // this used to be a second copy of it. Two copies is how the report and the
    // gradebook end up grading the same work against different bands, and the
    // `orderBy` matters as much as the call: without it the rows arrive in
    // whatever order the database chooses, so two scales claiming one level let
    // `Score.grade` — the audit record of what the gradebook decided — depend on
    // that order. `GRADING_SCALE_RESOLUTION_ORDER` names the ordering it assumes.
    const level = assessment.classSubject.class.level
    const levelKeys = level ? [level.code, level.name] : []
    const scales = await prisma.gradingScale.findMany({
      where: { tenantId, OR: [{ schoolId }, { schoolId: null }] },
      include: { levels: { orderBy: { order: 'asc' } } },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    })
    const scale = resolveApplicableGradingScale(scales, levelKeys)

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

    // Approval attests to the mark, so changing the mark withdraws it. The
    // STORED mark is read to decide that, rather than assumed: saving a note or
    // re-saving the identical number must not withdraw an approval, and a blind
    // "clear approval on every write" would do exactly that — silently
    // unapproving work nobody touched, and leaving the approver's name on a
    // report that no longer reflects what they signed.
    const existingScore = await prisma.score.findFirst({
      where: { tenantId, assessmentId, studentId },
      select: { rawScore: true, isApproved: true },
    })
    const markChanged =
      existingScore !== null && Number(existingScore.rawScore) !== rawScore
    const withdrawal = existingScore?.isApproved && markChanged
      ? { isApproved: false, approvedById: null, approvedAt: null }
      : {}

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
        ...withdrawal,
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
