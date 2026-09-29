import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'

const StudentSchema = z.object({
  studentId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string(),
  otherNames: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  dateOfBirth: z.string(),
  admissionNumber: z.string().optional(),
  admissionDate: z.string().optional(),
  classId: z.string().optional(),
  parentId: z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const classId = searchParams.get('classId')

    const where: Record<string, unknown> = { schoolId, tenantId }
    if (classId) where.classId = classId

    const students = await prisma.student.findMany({
      where,
      include: {
        class: { select: { name: true, id: true } },
        parent: { select: { firstName: true, lastName: true, phone: true } },
      },
      orderBy: { lastName: 'asc' },
    })
    return NextResponse.json({ data: students })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Students GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch students' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission('student:create')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const body = await req.json()
    const parseResult = StudentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    const student = await prisma.student.create({
      data: {
        tenantId,
        schoolId,
        studentId: data.studentId,
        firstName: data.firstName,
        lastName: data.lastName,
        otherNames: data.otherNames || null,
        gender: data.gender,
        dateOfBirth: new Date(data.dateOfBirth),
        admissionNumber: data.admissionNumber || `ADM-${Date.now()}`,
        admissionDate: data.admissionDate ? new Date(data.admissionDate) : new Date(),
        classId: data.classId || null,
        parentId: data.parentId || null,
      },
      include: {
        class: { select: { name: true } },
      },
    })
    return NextResponse.json(student, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Students POST error:', error)
    return NextResponse.json({ error: 'Failed to create student' }, { status: 500 })
  }
}
