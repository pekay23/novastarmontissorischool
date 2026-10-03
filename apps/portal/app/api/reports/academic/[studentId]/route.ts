import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { calculateAttendancePercentage } from '@novastar/shared-utils'
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

    // Fetch the student
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId, tenantId },
      include: {
        class: { select: { name: true, level: { select: { name: true } } } },
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
    if (term) {
      const enrollment = await prisma.enrollment.findFirst({
        where: { tenantId, studentId, termId: term.id, isActive: true },
        select: {
          classId: true,
          class: { select: { name: true, level: { select: { name: true } } } },
        },
      })
      classId = enrollment?.classId ?? null
      if (enrollment?.class) {
        reportClass = {
          name: enrollment.class.name,
          levelName: enrollment.class.level.name,
        }
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

    // Fetch all published assessments for the student's class
    const assessments = await prisma.assessment.findMany({
      where: assessmentWhere,
      include: {
        classSubject: {
          include: {
            subject: { select: { name: true, code: true } },
          },
        },
        type: { select: { name: true, code: true, defaultWeight: true } },
        term: { select: { name: true, academicYear: { select: { name: true } } } },
        scores: {
          where: { studentId },
          include: {
            gradingScale: { select: { levels: true } },
          },
        },
      },
      orderBy: { assessmentDate: 'desc' },
    })

    // Build report data
    const reportAssessments = assessments.map((a) => {
      const score = a.scores[0]
      const maxScore = Number(a.maxScore)
      const rawScore = score ? Number(score.rawScore) : null
      const percentage = score ? Number(score.percentage) : null
      const hasScore = rawScore !== null && maxScore > 0

      return {
        id: a.id,
        name: a.name,
        subject: a.classSubject?.subject?.name || 'N/A',
        subjectCode: a.classSubject?.subject?.code || null,
        assessmentType: a.type?.name || 'N/A',
        weight: Number(a.weight),
        maxScore,
        score: rawScore,
        percentage,
        grade: score?.grade || null,
        isGraded: hasScore,
        assessmentDate: a.assessmentDate,
        term: a.term?.name || null,
        academicYear: a.term?.academicYear?.name || null,
      }
    })

    // Calculate GPA (weighted average of all graded assessments)
    const graded = reportAssessments.filter((a) => a.isGraded)
    const totalWeight = graded.reduce((sum, a) => sum + a.weight, 0)
    const weightedSum = graded.reduce((sum, a) => sum + (a.percentage! * a.weight), 0)
    const gpa = totalWeight > 0 ? weightedSum / totalWeight : null

    // Overall percentage
    const overallPercentage = graded.length > 0
      ? graded.reduce((sum, a) => sum + a.percentage!, 0) / graded.length
      : null

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
    const attendanceRecords = await prisma.attendanceStudent.findMany({
      where: attendanceWhere,
    })
    const totalDays = attendanceRecords.length
    const presentDays = attendanceRecords.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length
    // "no data" is a different answer from 0%: an unmarked period must
    // not render as a zero.
    const hasAttendanceData = totalDays > 0
    const attendance = calculateAttendancePercentage(presentDays, totalDays)

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
      summary: {
        totalAssessments: reportAssessments.length,
        gradedAssessments: graded.length,
        gpa: gpa ? Number(gpa.toFixed(2)) : null,
        overallPercentage: overallPercentage ? Number(overallPercentage.toFixed(2)) : null,
        hasAttendanceData,
        attendanceRate: hasAttendanceData ? attendance.percentage : null,
        totalAttendanceDays: totalDays,
        presentDays,
      },
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
