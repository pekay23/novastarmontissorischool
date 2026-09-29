import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { logError } from '@/lib/logger'

// GET /api/reports/academic/[studentId] — Generate a student academic report card
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  try {
    await requirePermission('report:read')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
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

    // Build where clause for assessments
    const assessmentWhere: Record<string, unknown> = {
      tenantId,
      schoolId,
      isPublished: true,
      classSubject: { classId: student.classId || '' },
    }
    if (termId) assessmentWhere.termId = termId

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

    // Attendance summary
    const attendanceRecords = await prisma.attendanceStudent.findMany({
      where: {
        tenantId,
        studentId,
        classId: student.classId || '',
      },
    })
    const totalDays = attendanceRecords.length
    const presentDays = attendanceRecords.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length
    const attendanceRate = totalDays > 0 ? (presentDays / totalDays) * 100 : null

    return NextResponse.json({
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        studentId: student.studentId || null,
        class: student.class?.name || null,
        classLevel: student.class?.level?.name || null,
      },
      summary: {
        totalAssessments: reportAssessments.length,
        gradedAssessments: graded.length,
        gpa: gpa ? Number(gpa.toFixed(2)) : null,
        overallPercentage: overallPercentage ? Number(overallPercentage.toFixed(2)) : null,
        attendanceRate: attendanceRate ? Number(attendanceRate.toFixed(1)) : null,
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
