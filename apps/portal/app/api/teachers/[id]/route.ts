import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  staffVisibilityWhere,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

const UpdateStaffSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional(),
  otherNames: z.string().nullable().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().nullable().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'teacher:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'teacher:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    // Visibility is part of the lookup, not a check after it: a 403 for a
    // colleague outside the caller's reach would confirm the record exists.
    const where: Prisma.StaffWhereInput = {
      id,
      schoolId,
      tenantId,
      ...(await staffVisibilityWhere(tenantId, visibility)),
    }
    const staff = await prisma.staff.findFirst({
      where,
      include: {
        user: { select: { name: true, email: true } },
        department: { select: { name: true } },
      },
    })
    if (!staff) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
    return NextResponse.json(staff)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Staff GET', error)
    return NextResponse.json({ error: 'Failed to fetch staff member' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'teacher:edit', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateStaffSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }

    const existing = await prisma.staff.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })

    const data = parseResult.data
    const updateData: Record<string, unknown> = {}
    if (data.firstName !== undefined) updateData.firstName = data.firstName
    if (data.lastName !== undefined) updateData.lastName = data.lastName
    if (data.otherNames !== undefined) updateData.otherNames = data.otherNames
    if (data.phone !== undefined) updateData.phone = data.phone
    if (data.email !== undefined) updateData.email = data.email
    if (data.address !== undefined) updateData.address = data.address

    const updated = await prisma.staff.update({
      where: { id, schoolId, tenantId },
      data: updateData,
    })
    return NextResponse.json({ success: true, staff: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Staff PATCH', error)
    return NextResponse.json({ error: 'Failed to update staff member' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'teacher:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.staff.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })

    await prisma.staff.delete({ where: { id, schoolId, tenantId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Staff DELETE', error)
    return NextResponse.json({ error: 'Failed to delete staff member' }, { status: 500 })
  }
}
