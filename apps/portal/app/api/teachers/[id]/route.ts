import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  staffVisibilityWhere,
  visibilityDeniesAll,
  type Visibility,
} from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

/**
 * The one predicate every handler in this file reads and writes through.
 *
 * `staffVisibilityWhere` emits an `id` key in every `class`/`department`
 * branch -- `{ id: { in: [...] } }` -- so spreading it beside the path `id`
 * let it overwrite the id that was asked for. The route then answered a
 * different question than the one in the URL: `GET /api/teachers/<any-id>`
 * answered 200 with an arbitrary colleague the caller was allowed to see,
 * `user.email` included, rather than 404. No cross-scope read occurred, because
 * the in-list was still enforced; the defect was that the id was discarded.
 *
 * Composing under `AND` rather than as a spread makes an id outside the
 * visible set match nothing, so the route can only ever return the row that was
 * requested or 404. Built once and shared by GET, PATCH and DELETE so the three
 * cannot drift, which is how the mutation handlers came to hold a weaker
 * `where` than the read handler in the same file. Typed as the unique-where
 * input, so a write carries the scope rather than trusting the read that
 * preceded it.
 */
async function scopedStaffWhere(input: {
  id: string
  schoolId: string
  tenantId: string
  visibility: Visibility
}): Promise<Prisma.StaffWhereUniqueInput> {
  const where: Prisma.StaffWhereUniqueInput = {
    id: input.id,
    schoolId: input.schoolId,
    tenantId: input.tenantId,
  }
  const scope = await staffVisibilityWhere(input.tenantId, input.visibility)
  if (Object.keys(scope).length > 0) where.AND = [scope]
  return where
}

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
    const where = await scopedStaffWhere({ id, schoolId, tenantId, visibility })
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
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'teacher:edit', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope under the key this write is gated on, so the mutation cannot
    // reach a colleague the read handler would have refused. No seeded role that
    // resolves to a limited scope holds `teacher:edit`, so this is inert today;
    // it is the gate that would hold if one were.
    const visibility = await resolveVisibility(ctx, 'teacher:edit')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateStaffSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }

    const where = await scopedStaffWhere({ id, schoolId, tenantId, visibility })
    const existing = await prisma.staff.findFirst({ where })
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
      where,
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
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'teacher:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope under the delete key, same reason as PATCH.
    const visibility = await resolveVisibility(ctx, 'teacher:delete')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const where = await scopedStaffWhere({ id, schoolId, tenantId, visibility })
    const existing = await prisma.staff.findFirst({ where })
    if (!existing) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })

    await prisma.staff.delete({ where })
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
