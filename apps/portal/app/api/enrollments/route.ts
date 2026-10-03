import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  enrollmentVisibilityWhere,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

const CreateEnrollmentSchema = z.object({
  studentId: z.string().min(1),
  classId: z.string().min(1),
  termId: z.string().min(1),
})

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'enrollment:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'enrollment:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const termId = searchParams.get('termId')
    const classId = searchParams.get('classId')
    const studentId = searchParams.get('studentId')
    const active = searchParams.get('active')

    // `Enrollment` has no `schoolId` column, so school scope arrives through
    // its required `student` relation. The visibility filter also constrains
    // `student` for an `own`-scoped caller, so the two are composed with `AND`
    // rather than spread — a shallow merge would let the school filter drop
    // the parent filter.
    const where: Prisma.EnrollmentWhereInput = {
      tenantId,
      AND: [{ student: { schoolId } }, enrollmentVisibilityWhere(visibility)],
    }
    if (termId) where.termId = termId
    if (classId) where.classId = classId
    if (studentId) where.studentId = studentId
    if (active !== null) where.isActive = active !== 'false'

    const enrollments = await prisma.enrollment.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            studentId: true,
            admissionNumber: true,
          },
        },
        class: { select: { name: true, level: { select: { name: true } } } },
        term: {
          select: {
            id: true,
            name: true,
            academicYear: { select: { name: true } },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    })

    return NextResponse.json({ data: enrollments })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Enrollments GET', error)
    return NextResponse.json({ error: 'Failed to fetch enrollments' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'enrollment:create', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = CreateEnrollmentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { studentId, classId, termId } = parseResult.data

    // Verify student exists in this school
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId, tenantId },
    })
    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 })
    }

    // Verify class exists in this school
    const cls = await prisma.class.findFirst({
      where: { id: classId, schoolId, tenantId },
    })
    if (!cls) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    // Verify term exists
    const term = await prisma.term.findFirst({
      where: { id: termId, schoolId, tenantId },
    })
    if (!term) {
      return NextResponse.json({ error: 'Term not found' }, { status: 404 })
    }

    const enrollment = await prisma.enrollment.create({
      data: {
        tenantId,
        studentId,
        classId,
        termId,
      },
      include: {
        student: { select: { firstName: true, lastName: true, studentId: true } },
        class: { select: { name: true, level: { select: { name: true } } } },
        term: { select: { name: true, academicYear: { select: { name: true } } } },
      },
    })

    return NextResponse.json(enrollment, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Unique constraint violation
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Student is already enrolled in this term' }, { status: 409 })
    }
    logError('Enrollment POST', error)
    return NextResponse.json({ error: 'Failed to create enrollment' }, { status: 500 })
  }
}

