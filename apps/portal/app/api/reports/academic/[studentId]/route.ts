import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  computeAcademicSummary,
  resolveApplicableGradingScale,
  resolveAssessmentWeight,
  resolveGradeBand,
  summariseAttendance,
  type GradeBand,
} from '@novastar/shared-utils'
import { logError } from '@/lib/logger'

// GET /api/reports/academic/[studentId] — Generate a student academic report card
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'report:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { studentId } = await params

    // Fetch the student. The level is selected with its `code` as well as its
    // `name` because the grading-scale lookup below matches on either, and the
    // seed stores level codes.
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId, tenantId },
      include: {
        class: { select: { name: true, level: { select: { name: true, code: true } } } },
      },
    })
    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 })
    }

    // Get query params for term/year filtering
    const { searchParams } = new URL(req.url)
    const termId = searchParams.get('termId')

    // Resolve the term the report covers: an explicit `termId`, or the
    // school's current term for the default view.
    let term: { id: string; startDate: Date; endDate: Date } | null = null
    if (termId) {
      term = await prisma.term.findFirst({
        where: { id: termId, tenantId, schoolId },
        select: { id: true, startDate: true, endDate: true },
      })
      if (!term) {
        return NextResponse.json({ error: 'Term not found' }, { status: 404 })
      }
    } else {
      term = await prisma.term.findFirst({
        where: { tenantId, schoolId, isCurrent: true },
        select: { id: true, startDate: true, endDate: true },
      })
    }

    // The term-scoped class assignment is `Enrollment` — unique on
    // (tenantId, studentId, termId) — not `Student.classId`, which
    // points only at the student's *current* class: after a promotion
    // the prior term's assessments vanished from the report.
    let classId: string | null = null
    let reportClass: { name: string; levelName: string | null } | null = null
    // The level of whichever class the report ended up resolving. Kept
    // separately from `reportClass` because the grading scale is chosen from
    // the level, and the fallback class below resolves one from the student's
    // current pointer rather than from the enrollment.
    let reportLevel: { name: string; code: string } | null = null
    if (term) {
      const enrollment = await prisma.enrollment.findFirst({
        where: { tenantId, studentId, termId: term.id, isActive: true },
        select: {
          classId: true,
          class: {
            select: { name: true, level: { select: { name: true, code: true } } },
          },
        },
      })
      classId = enrollment?.classId ?? null
      if (enrollment?.class) {
        reportClass = {
          name: enrollment.class.name,
          levelName: enrollment.class.level.name,
        }
        reportLevel = enrollment.class.level
      }
    }

    if (!classId) {
      if (termId) {
        // An explicit term with no active enrollment is a rejection, not
        // a silent fall-back to the current class: the caller asked for
        // a term the student was not enrolled in.
        return NextResponse.json(
          { error: 'Student has no active enrollment for this term' },
          { status: 400 },
        )
      }
      // Default view with no current-term enrollment (e.g. terms not yet
      // configured): fall back to the student's current class pointer so
      // the report still renders.
      classId = student.classId
      reportLevel = student.class?.level ?? null
    }

    if (!classId) {
      // An unassigned student has no class to report on. The previous
      // `classId: student.classId || ''` silently matched nothing and
      // rendered as an empty report instead of saying why.
      return NextResponse.json(
        { error: 'Student has no class assignment for this term' },
        { status: 400 },
      )
    }

    // Build where clause for assessments
    const assessmentWhere: Prisma.AssessmentWhereInput = {
      tenantId,
      schoolId,
      isPublished: true,
      classSubject: { classId },
    }
    if (term) assessmentWhere.termId = term.id

    // Fetch all published assessments for the student's class. The subject
    // `id` is selected because the summary groups assessments by subject
    // identity: a display name can be shared and can be renamed mid-term.
    const assessments = await prisma.assessment.findMany({
      where: assessmentWhere,
      include: {
        classSubject: {
          include: {
            subject: { select: { id: true, name: true, code: true } },
          },
        },
        type: { select: { name: true, code: true, defaultWeight: true } },
        term: { select: { name: true, academicYear: { select: { name: true } } } },
        scores: { where: { studentId } },
      },
      orderBy: { assessmentDate: 'desc' },
    })

    // Grading scales, loaded once for the whole request: the bands a percentage
    // is labelled under come from the school's own scale, and reading them per
    // assessment would be one round trip per row on the Neon adapter, which
    // speaks SQL over HTTP.
    const gradingScales = await prisma.gradingScale.findMany({
      where: { tenantId, OR: [{ schoolId }, { schoolId: null }] },
      include: { levels: { orderBy: { order: 'asc' } } },
    })

    // The scale that applies to this class: one naming the level in
    // `appliesToLevels`, else the tenant default — the same rule
    // `POST /api/assessments/[id]/scores` applies when it writes a band. Nothing
    // here branches on Phase: which scale a class is graded against is entirely
    // the school's configuration.
    const applicableScale = resolveApplicableGradingScale(gradingScales, [
      reportLevel?.code,
      reportLevel?.name,
    ])
    const bands: GradeBand[] = applicableScale?.levels ?? []

    // Build report data
    const reportAssessments = assessments.map((a) => {
      const score = a.scores[0]
      const maxScore = Number(a.maxScore)
      const rawScore = score ? Number(score.rawScore) : null
      const percentage = score ? Number(score.percentage) : null
      const hasScore = rawScore !== null && maxScore > 0

      // The weight this assessment actually contributes under, and where it came
      // from: the assessment's own weight, else the weight the school configured
      // for this assessment type, else equal weighting. Resolved by the shared
      // helper so the report, the gradebook and any future consumer cannot
      // disagree about what a terminal percentage is made of.
      const weight = resolveAssessmentWeight({
        // `Assessment.weight` is nullable, and NULL is the one value that means
        // "this assessment carries no weight of its own". Coerce it explicitly:
        // `Number(null)` is 0, and 0 is not a light weight, it is a hole in the
        // average. Letting that through by accident would be indistinguishable
        // from a real zero the moment the semantics changed again.
        weight: a.weight === null ? null : Number(a.weight),
        typeDefaultWeight: a.type ? Number(a.type.defaultWeight) : null,
      })

      return {
        id: a.id,
        name: a.name,
        subject: a.classSubject?.subject?.name || 'N/A',
        subjectCode: a.classSubject?.subject?.code || null,
        subjectId: a.classSubject?.subjectId ?? null,
        assessmentType: a.type?.name || 'N/A',
        assessmentTypeCode: a.type?.code || null,
        weight: weight.weight,
        weightSource: weight.source,
        maxScore,
        score: rawScore,
        percentage,
        // The band `key` recorded when the score was graded — an audit record of
        // what the gradebook decided then. It is NOT what the report displays:
        // the displayed band is resolved below from the percentage against the
        // school's current bands, so a retuned scale is reflected immediately and
        // a key from a since-deleted band degrades to the current bands instead of
        // rendering blank.
        grade: score?.grade || null,
        band: percentage === null ? null : resolveGradeBand(percentage, bands),
        isGraded: hasScore,
        assessmentDate: a.assessmentDate,
        term: a.term?.name || null,
        academicYear: a.term?.academicYear?.name || null,
      }
    })

    // Summary metrics. Pure, and unit-tested without a database in
    // `tests/report-metrics-summary.test.ts`: `computeAcademicSummary` is where
    // the two percentage figures are defined (and why they differ), where each
    // subject's band is resolved, and where the weighting breakdown is built.
    //
    // The resolved weight is passed straight through, which is idempotent: a
    // resolved weight is always strictly positive, so feeding it back through
    // `resolveAssessmentWeight` returns the same number. The summary therefore
    // composes from precisely the figures the payload reports, and no third view
    // of the weighting can drift from these two.
    const summaryMetrics = computeAcademicSummary(
      reportAssessments.map((a) => ({
        subjectId: a.subjectId ?? '',
        percentage: a.percentage,
        weight: a.weight,
        assessmentType: a.assessmentType,
        assessmentTypeCode: a.assessmentTypeCode,
      })),
      bands,
    )

    // Subject display names, for the per-subject block the report card shows.
    // Keyed by the same subject identity the summary groups on.
    const subjectNames = new Map<string, { name: string; code: string | null }>()
    for (const a of reportAssessments) {
      if (a.subjectId && !subjectNames.has(a.subjectId)) {
        subjectNames.set(a.subjectId, { name: a.subject, code: a.subjectCode })
      }
    }
    const subjects = summaryMetrics.subjects.map((subject) => ({
      ...subject,
      subjectName: subjectNames.get(subject.subjectId)?.name ?? 'N/A',
      subjectCode: subjectNames.get(subject.subjectId)?.code ?? null,
    }))

    // Attendance summary. AttendanceStudent has no termId, so a per-term
    // report bounds it by the term's date range; the class filter is
    // dropped — it was both unnecessary and wrong, since a promoted
    // student's earlier records carry the old classId.
    const attendanceWhere: Prisma.AttendanceStudentWhereInput = {
      tenantId,
      studentId,
    }
    if (term) {
      const termEnd = new Date(term.endDate)
      termEnd.setHours(23, 59, 59, 999)
      attendanceWhere.date = { gte: term.startDate, lte: termEnd }
    }
    // `period` is `NOT NULL` with `''` as the whole-day sentinel, so a day
    // marked per period holds one row per period. Only the two columns the day
    // rollup reads are selected: a full row carries tenantId, classId,
    // markedById, notes and two timestamps, and none of them is used here.
    const attendanceRecords = await prisma.attendanceStudent.findMany({
      where: attendanceWhere,
      select: { date: true, status: true },
      orderBy: { date: 'asc' },
    })
    // Counting rows counted periods, not days. `summariseAttendance` groups by
    // UTC calendar day first and credits each day the fraction of its marked
    // sessions the child was credited for, so a four-period register is one
    // day. "no data" stays a different answer from 0%: an unmarked period must
    // not render as a zero.
    const attendanceMetrics = summariseAttendance(attendanceRecords)

    return NextResponse.json({
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        studentId: student.studentId || null,
        // The enrollment's class for the requested term, not the
        // student's current pointer, so a historical report names the
        // class the student actually sat in.
        class: reportClass?.name ?? student.class?.name ?? null,
        classLevel: reportClass?.levelName ?? student.class?.level?.name ?? null,
      },
      // The school's own scale, verbatim. Its `description` is where a school
      // states which direction its bands run — the seeded JHS default says lower
      // is better, the primary default says higher is better — so the UI shows
      // that text and never infers a direction the school did not state. Null
      // when no scale applies, in which case `subjects[].band` is null too.
      grading: applicableScale
        ? {
            scaleId: applicableScale.id,
            name: applicableScale.name,
            description: applicableScale.description ?? null,
            appliesToLevels: applicableScale.appliesToLevels,
          }
        : null,
      summary: {
        totalAssessments: reportAssessments.length,
        gradedAssessments: summaryMetrics.gradedAssessments,
        // 0-100 weighted mean across every graded assessment.
        weightedPercentage: summaryMetrics.weightedPercentage,
        // 0-100 mean of the per-subject percentages, so a subject counts once
        // however many assessments it has.
        overallPercentage: summaryMetrics.overallPercentage,
        // Subjects that contributed at least one graded assessment.
        subjectCount: summaryMetrics.subjectCount,
        // How the weighted mean was composed: each assessment type's weight,
        // its share of the total, and the percentage it carried.
        weighting: summaryMetrics.weighting,
        hasAttendanceData: attendanceMetrics.hasData,
        attendanceRate: attendanceMetrics.attendanceRate,
        totalAttendanceDays: attendanceMetrics.totalAttendanceDays,
        // Credited days, fractional: one HALF_DAY credits 0.5.
        presentDays: attendanceMetrics.presentDays,
        excusedDays: attendanceMetrics.excusedDays,
      },
      subjects,
      assessments: reportAssessments,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Academic report GET', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}
