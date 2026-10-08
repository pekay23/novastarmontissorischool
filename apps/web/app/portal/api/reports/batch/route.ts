import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  visibilityDeniesAll,
  type Visibility,
} from '@/lib/visibility'
import { logError } from '@/lib/logger'
import { logAuditEvent } from '@/lib/audit/logger'
import { toErrorResponse } from '@/lib/api-response'
import { sendEmail, type EmailFailureReason } from '@novastar/notifications'
import {
  GRADING_SCALE_RESOLUTION_ORDER,
  computeAcademicSummary,
  resolveApplicableGradingScale,
  resolveAssessmentWeight,
  resolveGradeBand,
  summariseAttendance,
  rankStudents,
  type AttendanceMark,
  type BandStatus,
  type GradeBand,
} from '@novastar/shared-utils'

/**
 * `POST /api/reports/batch` — build and email one report card per child in a
 * class for a term, from that child's own rows only.
 *
 * The one property this route exists to hold: a child never receives another
 * child's marks. It is enforced in exactly one place — `ownRowsFor`, which
 * selects only the score rows whose `studentId` is the child being built — and it
 * is enforced in the QUERY as well, because the assessment read already narrows
 * `scores` to the batch's student ids. Those are two independent narrowings of
 * the same rule rather than one rule written twice, so neither can be defeated
 * by the other being wrong.
 *
 * Every read is scoped by `tenantId` and `schoolId` in its `where` clause. There
 * is no post-fetch comparison anywhere in this file: a row from another tenant
 * is never fetched, so it can never be attached to a child here.
 *
 * Number of queries is fixed at seven regardless of class size: class, term,
 * enrollments (with each child's parent and the parent's linked user),
 * assessments (with every batch child's scores in one join), grading scales,
 * attendance, and one audit write. The per-child work is grouping in memory.
 */

/**
 * The delivery permission.
 *
 * `report:export` — "Export report data" — is the key that covers releasing
 * report data OUTSIDE the portal, which is what emailing a card to a parent is.
 * `report:read` would be the wrong gate: `ROLE_GRANT_RULES` grants it to PARENT,
 * and a parent holding it could then mail a whole class's report cards to
 * arbitrary addresses. `report:export` is withheld from PARENT, HEAD_TEACHER,
 * CLASSROOM_TEACHER and ADMIN_STAFF, so this route is reachable only by the
 * roles that may already see the whole school.
 *
 * See the report: a purpose-named `report:deliver` key would be more honest, but
 * `packages/shared-types/permission-keys.ts` is out of this task's scope.
 */
const DELIVERY_PERMISSION = 'report:export'

const BatchReportRequestSchema = z.object({
  classId: z.string().min(1),
  /** Defaults to the school's current term. */
  termId: z.string().min(1).optional(),
  /**
   * The assessment scope. Both omitted means "every published assessment of this
   * class for this term", which is the same default `GET
   * /api/reports/academic/[studentId]` uses. An empty array is rejected rather
   * than read as "no filter": `[]` and "absent" would then mean opposite things.
   */
  assessmentIds: z.array(z.string().min(1)).min(1).max(500).optional(),
  subjectIds: z.array(z.string().min(1)).min(1).max(100).optional(),
})

type BatchAssessmentRow = Prisma.AssessmentGetPayload<{
  include: {
    classSubject: { include: { subject: { select: { id: true; name: true; code: true } } } }
    type: { select: { name: true; code: true; defaultWeight: true } }
    scores: {
      select: {
        id: true
        studentId: true
        rawScore: true
        percentage: true
        grade: true
      }
    }
  }
}>

/** What happened to one child's card. Closed, because an administrator reads it. */
type ChildOutcome =
  | 'delivered'
  | 'skipped-unpublished'
  // Published and scored, but no mark approved yet. Distinct from
  // `skipped-unpublished` because the remedy differs: this one is waiting on an
  // approver, not on a teacher.
  | 'pending-approval'
  | 'undeliverable-no-parent'
  | 'failed-delivery'

interface MailFailure {
  reason: EmailFailureReason
  message: string
}

/**
 * Read the two failure classes off a thrown value.
 *
 * Keyed on the documented `name`/`reason` pair rather than `instanceof` on
 * purpose: this error crosses a package boundary, and a re-bundled or otherwise
 * duplicated copy of `@novastar/notifications` in the module graph would report
 * every delivery failure as an unknown error, which is the one answer the caller
 * must never get. The `name` check still refuses to read an unrelated error as a
 * delivery failure.
 */
function readMailFailure(error: unknown): MailFailure | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as { name?: unknown; reason?: unknown; message?: unknown }
  if (candidate.name !== 'EmailDeliveryError') return null
  if (candidate.reason !== 'not-configured' && candidate.reason !== 'provider-rejected') {
    return null
  }
  return {
    reason: candidate.reason,
    message: typeof candidate.message === 'string' ? candidate.message : 'Email delivery failed',
  }
}

/**
 * English ordinal suffix: 1st, 2nd, 3rd, 4th... 11th, 12th, 13th, 21st...
 */
function ordinalSuffix(n: number): string {
  const s = n % 100
  if (s >= 11 && s <= 13) return 'th'
  switch (n % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

/**
 * Whether the caller may act anywhere in this class.
 *
 * A cheap pre-check, so a class-scoped caller naming somebody else's class is
 * refused before a single child row is read. Deliberately narrower than
 * `callerMayActForChild`: an `own`-scoped caller's `classIds` is `[]` because the
 * scope does not restrict by class at all, and reading that as "no classes" would
 * refuse a parent asking for their own child's card. Ownership is decided per
 * child, by the function below.
 */
function callerMayActInClass(visibility: Visibility, classId: string): boolean {
  if (visibility.scope !== 'class' && visibility.scope !== 'department') return true
  return (visibility.classIds ?? []).includes(classId)
}

/**
 * Whether the caller may act for ONE child.
 *
 * `hasPermission` answers "may this caller perform this action at all"; it does
 * not answer "for whom". A bulk action needs the second question answered per
 * child rather than per class, because a class-scoped caller (a class teacher)
 * passes a class-level check for their own class and would pass the same check
 * for any class id they named if the id were the only thing checked.
 *
 * `custom` is denied rather than allowed: `resolveVisibility` resolves a scope it
 * has no policy for to an empty reach, and a rule that treated "no policy" as
 * "unrestricted" would invert that.
 */
function callerMayActForChild(
  visibility: Visibility,
  studentParentId: string | null,
  classId: string,
): boolean {
  switch (visibility.scope) {
    case 'all':
      return true
    case 'own':
      return studentParentId !== null && studentParentId === visibility.parentId
    case 'class':
    case 'department':
      return (visibility.classIds ?? []).includes(classId)
    default:
      return false
  }
}

/**
 * The band state of ONE row, derived from that row alone.
 *
 * `computeAcademicSummary` is already the classifier (`classifyBand` and
 * `bandProblemFor` are internal to `shared-utils`), so a row's state is the
 * subject summary computed over that one row. Identical to how
 * `GET /api/reports/academic/[studentId]` derives it, and derived the same way
 * so the two surfaces cannot report different verdicts for the same mark.
 */
function rowBandState(
  percentage: number | null,
  weight: number,
  bands: readonly GradeBand[],
): { bandStatus: BandStatus; bandProblem: string | null } {
  if (percentage === null || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    return { bandStatus: 'no-percentage', bandProblem: null }
  }
  const row = computeAcademicSummary([{ subjectId: 'row', percentage, weight }], bands).subjects[0]
  return {
    bandStatus: row?.bandStatus ?? 'no-percentage',
    bandProblem: row?.bandProblem ?? null,
  }
}

/** `Score.percentage` as a readable 0-100 mark, or null when it is not one. */
function readablePercentage(stored: unknown): number | null {
  if (stored === null || stored === undefined) return null
  const percentage = Number(stored)
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null
  return percentage
}

type BatchParent = {
  id: string
  userId: string | null
  firstName: string
  user: { id: string; email: string; isActive: boolean } | null
}

/** A parent whose linked account can actually receive the card. */
type DeliveredParent = BatchParent & {
  user: { id: string; email: string; isActive: boolean }
}

type ParentResolution =
  | { deliverable: true; parent: DeliveredParent }
  | { deliverable: false; reason: string }

/**
 * Whether this child's card can reach anyone, and if not, why.
 *
 * Delivery identity is `Student.parentId` → `Parent.userId` → the linked
 * `User.email`, and every link in that chain is checked rather than assumed: a
 * `Parent` row exists in the seed for almost nobody, and a school cannot fix "no
 * card arrived" if the only answer it gets is "no". Each refusal is therefore
 * reported as `undeliverable-no-parent` with its own reason.
 *
 * Resolved as a discriminated union rather than a reason string plus a separate
 * truthiness check, so "cannot deliver" and "which parent" cannot disagree.
 */
function resolveParent(parent: BatchParent | null): ParentResolution {
  if (!parent) {
    return { deliverable: false, reason: 'No parent is linked to this child' }
  }
  if (!parent.userId) {
    return { deliverable: false, reason: 'The linked parent has no portal account' }
  }
  if (!parent.user) {
    return { deliverable: false, reason: 'The linked parent account no longer exists' }
  }
  if (!parent.user.email) {
    return { deliverable: false, reason: 'The linked parent account has no email address' }
  }
  if (!parent.user.isActive) {
    return { deliverable: false, reason: 'The linked parent account is deactivated' }
  }
  return { deliverable: true, parent: parent as DeliveredParent }
}

/**
 * One child's own report rows, and nothing else.
 *
 * The single place the no-cross-child-leak property is decided. Every
 * assessment row that reaches a child carries the score whose `studentId` equals
 * that child, found by `find` on the id rather than by position — so even if the
 * join were widened, a row belonging to another child cannot be picked up by
 * index, and a child with two rows on one assessment (impossible under the
 * unique, but not this function's assumption to make) still yields exactly their
 * own.
 */
function ownRowsFor(studentId: string, assessments: readonly BatchAssessmentRow[]) {
  return assessments.flatMap((assessment) => {
    const score = assessment.scores.find((row) => row.studentId === studentId)
    return score ? [{ assessment, score }] : []
  })
}

interface ChildReport {
  summary: {
    totalAssessments: number
    gradedAssessments: number
    weightedPercentage: number | null
    overallPercentage: number | null
    subjectCount: number
    weighting: ReturnType<typeof computeAcademicSummary>['weighting']
    hasAttendanceData: boolean
    attendanceRate: number | null
    totalAttendanceDays: number
    presentDays: number
    excusedDays: number
    /** Class position (1 = top). `null` when the student has no graded aggregate. */
    position: number | null
  }
  subjects: Array<{
    subjectId: string
    subjectName: string
    subjectCode: string | null
    percentage: number | null
    gradedAssessments: number
    weighting: ReturnType<typeof computeAcademicSummary>['weighting']
    band: GradeBand | null
    bandStatus: BandStatus
    bandProblem: string | null
  }>
  assessments: Array<{
    id: string
    name: string
    subjectId: string | null
    subject: string
    subjectCode: string | null
    assessmentType: string
    assessmentTypeCode: string | null
    weight: number
    weightSource: 'assessment' | 'assessment_type' | 'default'
    maxScore: number
    score: number | null
    percentage: number | null
    grade: string | null
    band: GradeBand | null
    bandStatus: BandStatus
    bandProblem: string | null
    isGraded: boolean
    assessmentDate: Date | null
  }>
  /** How many of the class's published, in-scope assessments this child has a row on. */
  rowsInScope: number
}

function buildChildReport(
  studentId: string,
  assessments: readonly BatchAssessmentRow[],
  attendance: readonly AttendanceMark[],
  bands: readonly GradeBand[],
): ChildReport {
  const ownRows = ownRowsFor(studentId, assessments)

  const rows = ownRows.map(({ assessment, score }) => {
    const maxScore = Number(assessment.maxScore)
    const rawScore = Number(score.rawScore)
    const percentage = readablePercentage(score.percentage)
    const weight = resolveAssessmentWeight({
      // `Assessment.weight` is nullable and NULL means "no weight of its own".
      // `Number(null)` is 0, which is not a light weight but a hole in the mean.
      weight: assessment.weight === null ? null : Number(assessment.weight),
      typeDefaultWeight: assessment.type ? Number(assessment.type.defaultWeight) : null,
    })
    const rowBand = rowBandState(percentage, weight.weight, bands)
    return {
      id: assessment.id,
      name: assessment.name,
      subjectId: assessment.classSubject?.subjectId ?? null,
      subject: assessment.classSubject?.subject?.name || 'N/A',
      subjectCode: assessment.classSubject?.subject?.code || null,
      assessmentType: assessment.type?.name || 'N/A',
      assessmentTypeCode: assessment.type?.code || null,
      weight: weight.weight,
      weightSource: weight.source,
      maxScore,
      score: Number.isFinite(rawScore) ? rawScore : null,
      percentage,
      grade: score.grade || null,
      band: percentage === null ? null : resolveGradeBand(percentage, bands),
      bandStatus: rowBand.bandStatus,
      bandProblem: rowBand.bandProblem,
      isGraded: percentage !== null && maxScore > 0,
      assessmentDate: assessment.assessmentDate ?? null,
    }
  })

  const summaryMetrics = computeAcademicSummary(
    rows.map((row) => ({
      subjectId: row.subjectId ?? '',
      percentage: row.percentage,
      weight: row.weight,
      assessmentType: row.assessmentType,
      assessmentTypeCode: row.assessmentTypeCode,
    })),
    bands,
  )

  // Subject display names, keyed by the same subject identity the summary groups
  // on. A display name can be shared and can be renamed mid-term.
  const subjectNames = new Map<string, { name: string; code: string | null }>()
  for (const row of rows) {
    if (row.subjectId && !subjectNames.has(row.subjectId)) {
      subjectNames.set(row.subjectId, { name: row.subject, code: row.subjectCode })
    }
  }

  const attendanceMetrics = summariseAttendance(attendance)

  return {
    summary: {
      totalAssessments: rows.length,
      gradedAssessments: summaryMetrics.gradedAssessments,
      weightedPercentage: summaryMetrics.weightedPercentage,
      overallPercentage: summaryMetrics.overallPercentage,
      subjectCount: summaryMetrics.subjectCount,
      weighting: summaryMetrics.weighting,
      hasAttendanceData: attendanceMetrics.hasData,
      attendanceRate: attendanceMetrics.attendanceRate,
      totalAttendanceDays: attendanceMetrics.totalAttendanceDays,
      presentDays: attendanceMetrics.presentDays,
      excusedDays: attendanceMetrics.excusedDays,
      position: null,
    },
    subjects: summaryMetrics.subjects.map((subject) => ({
      ...subject,
      subjectName: subjectNames.get(subject.subjectId)?.name ?? 'N/A',
      subjectCode: subjectNames.get(subject.subjectId)?.code ?? null,
    })),
    assessments: rows,
    rowsInScope: rows.length,
  }
}

/**
 * Escape text interpolated into the HTML part.
 *
 * A child's name, a subject name and a school's own grading-scale description are
 * all operator- or user-supplied, and this is the boundary where they cross into
 * a rendered email. `escapeHtml` exists inside `@novastar/notifications` but is
 * not exported, so the guard lives with the one caller that needs it.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The card as an email.
 *
 * The grading scale's own `description` is reproduced verbatim, because that is
 * where a school states which way its bands run — the seeded JHS default runs
 * the other way from the primary default — and this route does not know or infer
 * a direction. Nothing here sorts or re-labels a band.
 */
function renderReportEmail(input: {
  schoolName: string
  parentName: string
  childName: string
  className: string
  termName: string
  academicYearName: string | null
  grading: { name: string; description: string | null } | null
  report: ChildReport
}): { subject: string; html: string; text: string } {
  const { report } = input
  const overall = report.summary.overallPercentage
  const overallText = overall === null ? 'No graded assessment yet' : `${overall.toFixed(2)}%`
  const position = report.summary.position
  const positionText = position === null ? 'Not ranked' : `${position}${ordinalSuffix(position)}`

  const subjectLines = report.subjects.map((subject) => {
    const percentage = subject.percentage === null ? '—' : `${subject.percentage.toFixed(2)}%`
    const band = subject.band ? subject.band.label : '—'
    return `${subject.subjectName}: ${percentage} (${band})`
  })

  const attendanceLine = report.summary.hasAttendanceData
    ? `Attendance: ${report.summary.attendanceRate?.toFixed(2) ?? '—'}% over ${report.summary.totalAttendanceDays} day(s).`
    : null

  const scaleLine = input.grading
    ? `${input.grading.name}${input.grading.description ? ` — ${input.grading.description}` : ''}`
    : null

  const text = [
    `Dear ${input.parentName},`,
    '',
    `Here is ${input.childName}'s report card for ${input.termName}${input.academicYearName ? ` (${input.academicYearName})` : ''}.`,
    `Class: ${input.className}`,
    `Overall: ${overallText}`,
    `Position: ${positionText}`,
    ...(scaleLine ? [`Grading: ${scaleLine}`] : []),
    '',
    ...(subjectLines.length > 0 ? subjectLines : ['No graded subjects in this period.']),
    ...(attendanceLine ? ['', attendanceLine] : []),
    '',
    `${input.schoolName}`,
  ].join('\n')

  const subjectRows = report.subjects
    .map(
      (row) => `<tr>
      <td style="padding:6px 12px 6px 0;border-bottom:1px solid #e5e7eb">${escapeHtml(row.subjectName)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${row.percentage === null ? '—' : `${row.percentage.toFixed(2)}%`}</td>
      <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:right">${escapeHtml(row.band?.label ?? '—')}</td>
    </tr>`,
    )
    .join('\n')

  const html = `<p style="margin:0 0 12px">Dear ${escapeHtml(input.parentName)},</p>
<p style="margin:0 0 12px">Here is ${escapeHtml(input.childName)}'s report card for ${escapeHtml(input.termName)}${input.academicYearName ? ` (${escapeHtml(input.academicYearName)})` : ''}.</p>
<table style="border-collapse:collapse;margin:0 0 16px"><tr><td style="padding:6px 12px 6px 0"><strong>Class</strong></td><td style="padding:6px 0">${escapeHtml(input.className)}</td></tr>
<tr><td style="padding:6px 12px 6px 0"><strong>Overall</strong></td><td style="padding:6px 0">${escapeHtml(overallText)}</td></tr>
<tr><td style="padding:6px 12px 6px 0"><strong>Position</strong></td><td style="padding:6px 0">${escapeHtml(positionText)}</td></tr>
${scaleLine ? `<tr><td style="padding:6px 12px 6px 0"><strong>Grading</strong></td><td style="padding:6px 0">${escapeHtml(scaleLine)}</td></tr>` : ''}
${attendanceLine ? `<tr><td style="padding:6px 12px 6px 0"><strong>Attendance</strong></td><td style="padding:6px 0">${escapeHtml(attendanceLine.replace(/^Attendance: /, ''))}</td></tr>` : ''}</table>
${subjectRows ? `<table style="border-collapse:collapse;margin:0 0 16px;width:100%"><tr><td style="padding:6px 12px 6px 0"><strong>Subject</strong></td><td style="padding:6px 12px;text-align:right"><strong>Score</strong></td><td style="padding:6px 0;text-align:right"><strong>Grade</strong></td></tr>${subjectRows}</table>` : '<p style="margin:0 0 16px">No graded subjects in this period.</p>'}
<p style="margin:0;font-size:12px;color:#6b7280">${escapeHtml(input.schoolName)}</p>`

  return {
    subject: `Report card: ${input.childName} — ${input.termName}`,
    html,
    text,
  }
}

export async function POST(req: NextRequest) {
  // Held outside the try so the error path can attribute a failure that happened
  // after the session was resolved, and so nothing shadows these bindings below.
  let attribution: { tenantId?: string; userId?: string } = {}
  try {
    const ctx = await getTenantContext()
    attribution = { tenantId: ctx.tenantId, userId: ctx.userId }
    const { tenantId, userId, schoolId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    if (!(await hasPermission(userId, DELIVERY_PERMISSION, tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, DELIVERY_PERMISSION)
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = BatchReportRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 },
      )
    }
    const { classId, termId, assessmentIds, subjectIds } = parsed.data

    // The class, tenant- and school-scoped. School scope is on the row itself, so
    // a class id belonging to another school resolves to nothing.
    const klass = await prisma.class.findFirst({
      where: { id: classId, tenantId, schoolId },
      select: { id: true, name: true, level: { select: { name: true, code: true } } },
    })
    if (!klass) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }
    // A class-scoped caller may only batch the classes they teach. Checked before
    // any child is read, so the refusal costs no data access.
    if (!callerMayActInClass(visibility, klass.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const term = await prisma.term.findFirst({
      where: termId
        ? { id: termId, tenantId, schoolId }
        : { tenantId, schoolId, isCurrent: true },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        academicYear: { select: { name: true } },
      },
    })
    if (!term) {
      return NextResponse.json(
        { error: termId ? 'Term not found' : 'No current term for this school' },
        { status: termId ? 404 : 400 },
      )
    }

    const school = await prisma.school.findFirst({
      where: { id: schoolId, tenantId },
      select: { name: true },
    })

    // Children of this class for this term, with the parent and the parent's
    // linked user account — one query for the whole batch. `Enrollment` is the
    // term-scoped class assignment, not `Student.classId`, which points only at
    // the child's CURRENT class.
    const enrollments = await prisma.enrollment.findMany({
      where: { tenantId, classId: klass.id, termId: term.id, isActive: true },
      select: {
        student: {
          select: {
            id: true,
            tenantId: true,
            schoolId: true,
            firstName: true,
            lastName: true,
            studentId: true,
            parentId: true,
            parent: {
              select: {
                id: true,
                userId: true,
                firstName: true,
                user: { select: { id: true, email: true, isActive: true } },
              },
            },
          },
        },
      },
      orderBy: { student: { lastName: 'asc' } },
    })

    if (enrollments.length === 0) {
      return NextResponse.json(
        { error: 'No active enrollments for this class and term' },
        { status: 404 },
      )
    }

    // The children, and the ids every subsequent query is narrowed by.
    const children = enrollments
      .map((enrollment) => enrollment.student)
      // Belt and braces on the tenant/school columns the join did not filter on:
      // an enrollment row that reached this query with a foreign student is not
      // a child of this school, whatever the join said.
      .filter((student) => student.tenantId === tenantId && student.schoolId === schoolId)
    const studentIds = children.map((student) => student.id)

    // Per-child entitlement, over the batch that is about to be emailed. A caller
    // who is not entitled to one child does not get the rest either: a partial
    // bulk send is still a bulk send, and "delivered to 12 of 45" is not a
    // meaningful unit of work to hand back. Names are withheld from the refusal:
    // naming the children the caller may not see is the leak the check exists to
    // prevent.
    const unentitled = children.filter(
      (student) => !callerMayActForChild(visibility, student.parentId, klass.id),
    )
    if (unentitled.length > 0) {
      return NextResponse.json(
        {
          error: 'Forbidden',
          detail: `Not entitled to report on ${unentitled.length} of ${children.length} children in this batch`,
        },
        { status: 403 },
      )
    }

    const assessmentWhere: Prisma.AssessmentWhereInput = {
      tenantId,
      schoolId,
      // Only published work is reportable. An unpublished assessment is a draft:
      // a teacher who has not released it must not have it reach a parent by
      // being folded into a batch.
      isPublished: true,
      termId: term.id,
      classSubject: { classId: klass.id },
    }
    if (assessmentIds) assessmentWhere.id = { in: assessmentIds }
    if (subjectIds) {
      assessmentWhere.classSubject = {
        classId: klass.id,
        subjectId: { in: subjectIds },
      }
    }

    // One assessment read for the whole class, with every batch child's scores in
    // the same join. This is the narrowing that keeps one child's marks out of
    // another's payload even before `ownRowsFor` filters.
    const assessments: BatchAssessmentRow[] = await prisma.assessment.findMany({
      where: assessmentWhere,
      include: {
        classSubject: {
          include: { subject: { select: { id: true, name: true, code: true } } },
        },
        type: { select: { name: true, code: true, defaultWeight: true } },
        scores: {
          // Approved marks only, matching `reports/academic/[studentId]`
          // exactly. These two must agree: a batch that emailed a mark the
          // single-child card hides would send a parent a grade the school
          // cannot show them on request, which is worse than sending nothing.
          // The consequence is the same and equally intended — a class with
          // nothing approved yet yields empty cards rather than provisional ones.
          where: { studentId: { in: studentIds }, isApproved: true },
          select: { id: true, studentId: true, rawScore: true, percentage: true, grade: true },
        },
      },
      orderBy: { assessmentDate: 'desc' },
    })

    // Grading scales, loaded once for the whole request. The ordering is the one
    // `GRADING_SCALE_RESOLUTION_ORDER` describes, so two scales claiming one level
    // resolve the same way they do in the gradebook and in the single-child report.
    const gradingScales = await prisma.gradingScale.findMany({
      where: { tenantId, OR: [{ schoolId }, { schoolId: null }] },
      include: { levels: { orderBy: { order: 'asc' } } },
      orderBy: [...GRADING_SCALE_RESOLUTION_ORDER],
    })
    const applicableScale = resolveApplicableGradingScale(gradingScales, [
      klass.level?.code,
      klass.level?.name,
    ])
    const bands: GradeBand[] = applicableScale?.levels ?? []

    // Attendance for every child in one query, bounded by the term. No class
    // filter: a promoted child's earlier records carry the old classId.
    const termEnd = new Date(term.endDate)
    termEnd.setHours(23, 59, 59, 999)
    const attendanceRows = await prisma.attendanceStudent.findMany({
      where: {
        tenantId,
        studentId: { in: studentIds },
        date: { gte: term.startDate, lte: termEnd },
      },
      select: { studentId: true, date: true, status: true },
    })
    const attendanceByStudent = new Map<string, AttendanceMark[]>()
    for (const row of attendanceRows) {
      const bucket = attendanceByStudent.get(row.studentId)
      if (bucket) bucket.push({ date: row.date, status: row.status })
      else attendanceByStudent.set(row.studentId, [{ date: row.date, status: row.status }])
    }

    // How many marks each child has on the scoped published assessments,
    // APPROVED OR NOT.
    //
    // Needed because the report above reads approved marks only, so a child
    // whose marks are all still pending comes back with `rowsInScope === 0` —
    // indistinguishable from a child with nothing published at all. Those are
    // different situations with different remedies, and reporting the second
    // when the truth is the first would tell a head teacher their published
    // assessment was never scored when in fact nobody has signed the marks off.
    // One grouped query, not one per child.
    const markPresenceRows = await prisma.score.groupBy({
      by: ['studentId'],
      where: {
        tenantId,
        assessmentId: { in: assessments.map((a) => a.id) },
        studentId: { in: studentIds },
      },
      _count: { _all: true },
    })
    const marksPresent = new Map<string, number>(
      markPresenceRows.map((row) => [row.studentId, row._count._all]),
    )

    // Per-child work from here on: grouping in memory, no further queries.
    let delivered = 0
    let skippedUnpublished = 0
    let pendingApproval = 0
    let undeliverable = 0
    let failed = 0
    let emailsSent = 0
    let mailError: MailFailure | null = null

    const results: Array<{
      student: {
        id: string
        firstName: string
        lastName: string
        studentId: string | null
        className: string
      }
      outcome: ChildOutcome
      reason: string | null
      recipients: Array<{ parentId: string; userId: string; email: string; messageId: string }>
      report: ChildReport
    }> = []

    /** One row per child, always — an undeliverable child is never dropped. */
    const record = (input: {
      student: (typeof children)[number]
      outcome: ChildOutcome
      reason: string | null
      recipients?: Array<{ parentId: string; userId: string; email: string; messageId: string }>
      report: ChildReport
    }) => {
      results.push({
        student: {
          id: input.student.id,
          firstName: input.student.firstName,
          lastName: input.student.lastName,
          studentId: input.student.studentId || null,
          className: klass.name,
        },
        outcome: input.outcome,
        reason: input.reason,
        recipients: input.recipients ?? [],
        report: input.report,
      })
    }

    for (const student of children) {
      const childName = `${student.firstName} ${student.lastName}`.trim()
      const report = buildChildReport(
        student.id,
        assessments,
        attendanceByStudent.get(student.id) ?? [],
        bands,
      )

      // Nothing to send, but say which of the two empty cases this is.
      //
      // A parent who was not emailed and an administrator who was not told are
      // the same failure with an extra step in it, so nothing is dropped — but
      // "nothing was published" and "published and scored, nobody has approved
      // the marks yet" call for different actions from the same office, and
      // collapsing them sends the head teacher to the wrong one.
      if (report.rowsInScope === 0) {
        const awaitingApproval = (marksPresent.get(student.id) ?? 0) > 0
        if (awaitingApproval) pendingApproval += 1
        else skippedUnpublished += 1
        record({
          student,
          outcome: awaitingApproval ? 'pending-approval' : 'skipped-unpublished',
          reason: awaitingApproval
            ? 'Marks exist on a published assessment but none are approved yet, so no card was sent'
            : 'No published assessment in this scope has a score for this child',
          report,
        })
        continue
      }

      const resolution = resolveParent(student.parent)
      if (!resolution.deliverable) {
        undeliverable += 1
        record({
          student,
          outcome: 'undeliverable-no-parent',
          reason: resolution.reason,
          report,
        })
        continue
      }
      const parent = resolution.parent

      // A missing API key fails identically for every remaining child, so after
      // the first such failure the send is not attempted again: one configuration
      // fault must not become N identical provider calls. Every child is still
      // reported, with the same reason, rather than the remainder being counted
      // in a total with no entry explaining it.
      if (mailError?.reason === 'not-configured') {
        failed += 1
        record({
          student,
          outcome: 'failed-delivery',
          reason: `${mailError.reason}: ${mailError.message}`,
          report,
        })
        continue
      }

      const email = renderReportEmail({
        schoolName: school?.name ?? 'School',
        parentName: parent.firstName || parent.user.email,
        childName,
        className: klass.name,
        termName: term.name,
        academicYearName: term.academicYear?.name ?? null,
        grading: applicableScale
          ? { name: applicableScale.name, description: applicableScale.description ?? null }
          : null,
        report,
      })

      try {
        const sent = await sendEmail({
          to: parent.user.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
          tags: [
            { name: 'kind', value: 'report-card' },
            { name: 'class', value: klass.id },
          ],
        })
        delivered += 1
        emailsSent += 1
        record({
          student,
          outcome: 'delivered',
          reason: null,
          recipients: [
            {
              parentId: parent.id,
              userId: parent.user.id,
              email: parent.user.email,
              messageId: sent.id,
            },
          ],
          report,
        })
      } catch (error) {
        const failure = readMailFailure(error)
        logError(
          'Batch report cards POST',
          failure
            ? new Error(`Delivery failed (${failure.reason}): ${failure.message}`)
            : error,
        )
        if (failure) mailError = failure
        failed += 1
        record({
          student,
          outcome: 'failed-delivery',
          reason: failure
            ? `${failure.reason}: ${failure.message}`
            : 'The mail transport failed for an unrecognised reason',
          report,
        })

        // Nothing more to try: the transport is unconfigured, and the branch at
        // the top of the next iteration reports each remaining child.
      }
    }

    // Compute class positions over the completed summaries.
    // A student with no graded work (overallPercentage === null) gets position = null
    // and does not occupy a rank slot.
    const ranked = rankStudents(
      results.map((r) => ({
        studentId: r.student.id,
        overallPercentage: r.report.summary.overallPercentage,
        displayName: `${r.student.firstName} ${r.student.lastName}`.trim(),
      })),
    )
    const positionByStudent = new Map(ranked.map((r) => [r.studentId, r.position]))
    for (const result of results) {
      result.report.summary.position = positionByStudent.get(result.student.id) ?? null
    }

    // The audit row is written after the send and never blocks the response:
    // `logAuditEvent` swallows its own failures, and failing this request after
    // the cards are out would invite a retry that mails every parent twice.
    await logAuditEvent({
      userId,
      tenantId,
      schoolId,
      action: 'REPORT_CARD_BATCH_SENT',
      entity: 'Class',
      entityId: klass.id,
      description: `Report cards for ${klass.name}, ${term.name}`,
      details: {
        termId: term.id,
        scope: { assessmentIds: assessmentIds ?? null, subjectIds: subjectIds ?? null },
        children: children.length,
        delivered,
        skippedUnpublished,
        undeliverable,
        failed,
        emailsSent,
        mailError: mailError ? mailError.reason : null,
      },
    })

    const payload = {
      class: {
        id: klass.id,
        name: klass.name,
        levelName: klass.level?.name ?? null,
        levelCode: klass.level?.code ?? null,
      },
      term: {
        id: term.id,
        name: term.name,
        academicYearName: term.academicYear?.name ?? null,
      },
      grading: applicableScale
        ? {
            scaleId: applicableScale.id,
            name: applicableScale.name,
            description: applicableScale.description ?? null,
            appliesToLevels: applicableScale.appliesToLevels,
          }
        : null,
      scope: {
        assessmentIds: assessmentIds ?? null,
        subjectIds: subjectIds ?? null,
        publishedOnly: true,
        matchedAssessments: assessments.length,
      },
      delivery: {
        children: children.length,
        delivered,
        skippedUnpublished,
        // Counted apart from `skippedUnpublished` so an administrator can tell
        // "waiting on an approver" from "nothing was published" without reading
        // every child's reason string.
        pendingApproval,
        undeliverable,
        failed,
        emailsSent,
      },
      mailError,
      children: results,
    }

    // Nothing went out and the reason is this deployment's configuration: that is
    // a server fault, and reporting it as 200 would let a caller read "the batch
    // ran" as "the parents have their cards".
    if (emailsSent === 0 && mailError?.reason === 'not-configured') {
      return NextResponse.json(payload, { status: 503 })
    }
    return NextResponse.json(payload, { status: 200 })
  } catch (error) {
    return toErrorResponse('Batch report cards POST', error, {
      ...attribution,
      endpoint: '/api/reports/batch',
    })
  }
}