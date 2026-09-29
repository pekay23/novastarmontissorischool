import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'
import { logError } from '@/lib/logger'

const StaffSchema = z.object({
  userId: z.string(),
  employeeId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string(),
  otherNames: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  phone: z.string(),
  email: z.string().email(),
  address: z.string().optional(),
  hireDate: z.string(),
})

export async function GET(_req: NextRequest) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const staff = await prisma.staff.findMany({
      where: { schoolId, tenantId },
      include: {
        user: { select: { name: true, email: true } },
        department: { select: { name: true } },
      },
      orderBy: { lastName: 'asc' },
    })
    return NextResponse.json({ data: staff })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logError('Staff GET', error)
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission('teacher:create')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const body = await req.json()
    const parseResult = StaffSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    const staff = await prisma.staff.create({
      data: {
        tenantId,
        schoolId,
        employeeId: data.employeeId,
        firstName: data.firstName,
        lastName: data.lastName,
        otherNames: data.otherNames || null,
        gender: data.gender,
        phone: data.phone,
        email: data.email,
        address: data.address || null,
        hireDate: new Date(data.hireDate),
        userId: data.userId,
      },
    })
    return NextResponse.json(staff, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Staff POST', error)
    return NextResponse.json({ error: 'Failed to create staff member' }, { status: 500 })
  }
}

