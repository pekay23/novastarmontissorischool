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
  type BandStatus,
  type GradeBand,
} from '@novastar/shared-utils'
import {
  resolveVisibility,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { logError } from '@/lib/logger'

/**
 * The band state of ONE assessment row, derived from that row and nothing else.
 *
 * `computeAcademicSummary` is already the classifier: `classifyBand` and
 * `bandProblemFor` live inside `shared-utils`, are not exported, and a second
 * copy of either would be a second answer to a question one implementation
 * already owns — and the two answers would be compared on every card. So a row's
 * state is literally the subject summary computed over that row alone: same
 * bands, same code path, one assessment in it. Whatever the subject block says
 * and whatever a row says therefore come from the same classifier and cannot
 * drift, which is the whole point of giving a row its own verdict rather than
 * borrowing its subject's.
 *
 * The one state the summary cannot speak for is `no-percentage`, because an
 * assessment with no readable percentage is not a graded assessment at all — it
 * is filtered out before `subjects` is built, so it contributes to nothing and
 * appears nowhere. That absence is exactly what the row has to report, and it is
 * a fact about the row alone: no scale is at fault, so there is nothing about
 * the scale to quote.
 *
 * The `subjectId` is not a lookup key here. It only has to be stable for the
 * one row being classified, because grouping is what puts that row into a
 * subject bucket for the summary to read its verdict out of.
 */
function rowBandState(
  percentage: number | null,
  weight: number,
  bands: readonly GradeBand[],
): { bandStatus: BandStatus; bandProblem: string | null } {
  if (
    percentage === null ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  ) {
    return { bandStatus: 'no-percentage', bandProblem: null }
  }
  const row = computeAcademicSummary(
    // The resolved weight, so this is the same row shape the whole-report summary
    // is fed. On a single row it cannot change the answer — it is already
    // strictly positive — and passing it keeps the two calls from being asked
    // different questions about the same figure.
    [{ subjectId: 'row', percentage, weight }],
    bands,
  ).subjects[0]
  return {
    bandStatus: row?.bandStatus ?? 'no-percentage',
    bandProblem: row?.bandProblem ?? null,
  }
}

// GET /api/reports/academic/[studentId] — Generate a student academic report card
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'report:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'report:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { studentId } = await params

    // Fetch the student. The level is selected with its `code` as well as its
    // `name` because the grading-scale lookup below matches on either, and the
    // seed stores level codes.
    const studentWhere: Prisma.StudentWhereInput = {
      id: studentId,
      schoolId,
      tenantId,
    }
    if (visibility.scope === 'own') {
      studentWhere.parentId = visibility.parentId ?? '__no-parent__'
    }

    const student = await prisma.student.findFirst({
      where: studentWhere,
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
        // Approved marks only.
        //
        // A report card is what goes to a parent, so it must show what was
        // signed off, not what was typed. `Score.isApproved` is written by
        // `POST /api/assessments/[id]/scores/[scoreId]/approve` and is withdrawn
        // whenever the mark itself changes, so filtering on it here is what stops
        // a card going home with a mark no approver ever saw.
        //
        // The honest consequence, which is not a bug: before anything is
        // approved the card is empty. That is the intended reading — an
        // unapproved mark belongs in the teacher's gradebook, not in a parent's
        // inbox — and it is why this cannot be quietly relaxed to
        // `isApproved: { not: false }` to make a demo look fuller.
        scores: { where: { studentId, isApproved: true } },
      },
      orderBy: { assessmentDate: 'desc' },
    })

    // Grading scales, loaded once for the whole request: the bands a percentage
    // is labelled under come from the school's own scale, and reading them per
    // assessment would be one round trip per row on the Neon adapter, which
    // speaks SQL over HTTP.
    //
    // `orderBy` is not cosmetic. `resolveApplicableGradingScale` takes the first
    // scale that claims the level, so with two scales claiming `B9` the winner was
    // the row order the database returned — and a routine VACUUM was enough to move
    // a cohort of children from one band to another with no error on any card. The
    // ordering is the one `GRADING_SCALE_RESOLUTION_ORDER` in shared-utils describes,
    // which the gradebook's writer now passes too: default first, oldest first, then
    // by id, so a later copy of a scale cannot displace the original.
    const gradingScales = await prisma.gradingScale.findMany({
      where: { tenantId, OR: [{ schoolId }, { schoolId: null }] },
      include: { levels: { orderBy: { order: 'asc' } } },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
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
      // `Score.percentage` is whatever was stored, and the write path refuses to
      // store one outside 0-100 — but a report that printed 150% beside a
      // withheld band would show a mark no child earned, and would feed 150 into
      // the summary's means. So the range is re-applied on read, and a stored
      // percentage that fails it is reported as no percentage at all. The raw
      // score still travels in the payload, so the discrepancy is visible rather
      // than hidden, and `band` below resolves to null through the one shared
      // implementation that refuses an out-of-range value.
      const storedPercentage =
        score && score.percentage !== null ? Number(score.percentage) : null
      const percentage =
        storedPercentage !== null &&
        Number.isFinite(storedPercentage) &&
        storedPercentage >= 0 &&
        storedPercentage <= 100
          ? storedPercentage
          : null
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

      // This row's own band verdict, from this row's own percentage. It used to
      // borrow the subject's, which put a statement about a subject's scale on
      // every row beneath it — and left a row that failed to resolve under a
      // healthy subject with nothing at all to say for itself.
      const rowBand = rowBandState(percentage, weight.weight, bands)

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
        // Which state THIS row's band is in, and what to fix if the scale is at
        // fault for it. Both come from this row's own percentage against the
        // school's current bands — never from the subject summary above, which
        // has already been folded across every assessment of a subject into one
        // number and can only speak about that number.
        bandStatus: rowBand.bandStatus,
        bandProblem: rowBand.bandProblem,
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
