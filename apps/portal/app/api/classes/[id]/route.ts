import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  classVisibilityWhere,
  visibilityDeniesAll,
  type Visibility,
} from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

/**
 * The one predicate every handler in this file reads and writes through.
 *
 * `class:edit` resolves to `class` for a classroom teacher, so a mutation
 * handler that only filtered by `{ id, schoolId, tenantId }` would let a teacher
 * rename or resize a class they do not teach. `class:delete` resolves the same
 * way, though no seeded role that is scope-limited currently holds it (see the
 * DELETE handler). The row scope therefore composes under `AND` rather than as a
 * spread, so it cannot be silently overwritten by a later property on the same
 * object.
 *
 * The return type is the unique-where input, so the same object can be handed to
 * `findFirst`, `update` and `delete` — the write carries the scope rather than
 * merely trusting the read that preceded it. This is built once and shared so
 * GET, PATCH and DELETE cannot drift apart, which is how the mutation handlers
 * came to hold a weaker `where` than the read handler in the same file.
 */
function scopedClassWhere(input: {
  id: string
  schoolId: string
  tenantId: string
  visibility: Visibility
}): Prisma.ClassWhereUniqueInput {
  const where: Prisma.ClassWhereUniqueInput = {
    id: input.id,
    schoolId: input.schoolId,
    tenantId: input.tenantId,
  }
  const scope = classVisibilityWhere(input.visibility)
  if (Object.keys(scope).length > 0) where.AND = [scope]
  return where
}

const UpdateClassSchema = z.object({
  name: z.string().min(1).optional(),
  levelId: z.string().optional(),
  stream: z.string().nullable().optional(),
  capacity: z.number().int().positive().optional(),
  classTeacherId: z.string().nullable().optional(),
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
    if (!(await hasPermission(userId, 'class:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'class:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const cls = await prisma.class.findFirst({
      where: scopedClassWhere({ id, schoolId, tenantId, visibility }),
      include: {
        _count: { select: { students: true } },
        level: { select: { name: true } },
        classTeacher: { select: { firstName: true, lastName: true } },
      },
    })
    if (!cls) return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    return NextResponse.json(cls)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Class GET', error)
    return NextResponse.json({ error: 'Failed to fetch class' }, { status: 500 })
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
    if (!(await hasPermission(userId, 'class:edit', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope under the key this write is gated on. `class:edit` resolves to
    // `class` for a classroom teacher, so without this a teacher could edit any
    // class in the school by id.
    const visibility = await resolveVisibility(ctx, 'class:edit')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateClassSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }

    const where = scopedClassWhere({ id, schoolId, tenantId, visibility })
    const existing = await prisma.class.findFirst({ where })
    if (!existing) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

    const data = parseResult.data
    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.levelId !== undefined) updateData.levelId = data.levelId
    if (data.stream !== undefined) updateData.stream = data.stream
    if (data.capacity !== undefined) updateData.capacity = data.capacity
    if (data.classTeacherId !== undefined) updateData.classTeacherId = data.classTeacherId ?? null

    const updated = await prisma.class.update({
      where,
      data: updateData,
    })
    return NextResponse.json({ success: true, class: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Class PATCH', error)
    return NextResponse.json({ error: 'Failed to update class' }, { status: 500 })
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
    if (!(await hasPermission(userId, 'class:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope under the delete key, same reason as PATCH. No seeded role that
    // resolves to a limited scope holds `class:delete`, so this is inert today;
    // it is the gate that would hold if one were, and a mutation handler that
    // resolves no visibility is exactly the shape that made this a class.
    const visibility = await resolveVisibility(ctx, 'class:delete')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const where = scopedClassWhere({ id, schoolId, tenantId, visibility })
    const existing = await prisma.class.findFirst({ where })
    if (!existing) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

    await prisma.class.delete({ where })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Class DELETE', error)
    return NextResponse.json({ error: 'Failed to delete class' }, { status: 500 })
  }
}
