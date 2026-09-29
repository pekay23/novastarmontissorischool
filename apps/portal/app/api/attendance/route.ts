import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const classId = searchParams.get('classId')
    const date = searchParams.get('date')

    const where: Record<string, unknown> = { tenantId }
    if (classId) where.classId = classId
    if (date) {
      const start = new Date(date)
      start.setHours(0, 0, 0, 0)
      const end = new Date(date)
      end.setHours(23, 59, 59, 999)
      where.date = { gte: start, lte: end }
    }

    const records = await prisma.attendanceStudent.findMany({
      where,
      include: {
        student: { select: { firstName: true, lastName: true, studentId: true } },
        class: { select: { name: true } },
        markedBy: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
    })
    return NextResponse.json({ data: records })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Attendance GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch attendance' }, { status: 500 })
  }
}

const MarkAttendanceSchema = z.object({
  studentId: z.string(),
  classId: z.string(),
  date: z.string(),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'HALF_DAY']),
  period: z.string().optional(),
  notes: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    await requirePermission('attendance:mark')
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const body = await req.json()

    // Support both single record and bulk array
    let records: Array<z.infer<typeof MarkAttendanceSchema>>
    if (Array.isArray(body)) {
      const parseResult = z.array(MarkAttendanceSchema).safeParse(body)
      if (!parseResult.success) {
        return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
      }
      records = parseResult.data
    } else {
      const parseResult = MarkAttendanceSchema.safeParse(body)
      if (!parseResult.success) {
        return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
      }
      records = [parseResult.data]
    }

    const date = new Date(records[0].date)
    const dayStart = new Date(date)
    dayStart.setHours(0, 0, 0, 0)

    // Verify all students are in the specified class
    const classId = records[0].classId
    const classCheck = await prisma.class.findFirst({
      where: { id: classId, schoolId, tenantId },
      include: { students: { select: { id: true } } },
    })
    if (!classCheck) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }
    const validStudentIds = new Set(classCheck.students.map((s) => s.id))

    const results = []
    for (const record of records) {
      if (!validStudentIds.has(record.studentId)) {
        results.push({ studentId: record.studentId, error: 'Student not in this class' })
        continue
      }

      const recordDate = new Date(record.date)
      const res = await prisma.attendanceStudent.upsert({
        where: {
          tenantId_studentId_date_period: {
            tenantId,
            studentId: record.studentId,
            date: recordDate,
            period: record.period || '',
          },
        },
        update: {
          classId: record.classId,
          status: record.status,
          period: record.period || null,
          notes: record.notes || null,
          markedById: userId,
        },
        create: {
          tenantId,
          studentId: record.studentId,
          classId: record.classId,
          date: recordDate,
          status: record.status,
          period: record.period || null,
          notes: record.notes || null,
          markedById: userId,
        },
      })
      results.push({ studentId: record.studentId, success: true, attendance: res })
    }

    return NextResponse.json({ success: true, results }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Attendance POST error:', error)
    return NextResponse.json({ error: 'Failed to mark attendance' }, { status: 500 })
  }
}
