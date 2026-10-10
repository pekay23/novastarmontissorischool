import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

const UpdateEventSchema = z.object({
  title: z.string().min(1).optional(),
  descriptionEn: z.string().min(1).optional(),
  descriptionTw: z.string().nullable().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  location: z.string().nullable().optional(),
  audience: z.array(z.string()).optional(),
  isAllDay: z.boolean().optional(),
  recurrence: z.string().nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
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
    if (!(await hasPermission(userId, 'event:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'event:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const event = await prisma.event.findFirst({
      where: { id, schoolId, tenantId },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    return NextResponse.json(event)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Event GET', error)
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 })
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
    if (!(await hasPermission(userId, 'event:edit', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope under the key this write is gated on. `Event` has no class
    // relation, so there is no row clause to compose and the fail-closed check
    // is the whole of what the visibility layer can enforce here: a caller whose
    // reach resolves to nothing is refused rather than allowed to fall through
    // to school-wide.
    //
    // `ROLE_READ_SCOPE.CLASSROOM_TEACHER` maps `event:read` to `all` explicitly
    // but leaves `event:edit` unmapped, so `event:edit` inherits the role
    // default `class` — a scope the model has no column for. Closing that
    // properly is a one-line addition of `'event:edit': 'all'` (and
    // `'event:create': 'all'`) beside the other communication keys in
    // `packages/shared-types/permission-keys.ts`, which is outside this
    // handler's ownership. Until then this guard is the narrowest true answer.
    const visibility = await resolveVisibility(ctx, 'event:edit')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateEventSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }

    const existing = await prisma.event.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const data = parseResult.data
    const updateData: Record<string, unknown> = {}
    if (data.title !== undefined) updateData.title = data.title
    if (data.descriptionEn !== undefined) updateData.descriptionEn = data.descriptionEn
    if (data.descriptionTw !== undefined) updateData.descriptionTw = data.descriptionTw
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate)
    if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate)
    if (data.location !== undefined) updateData.location = data.location
    if (data.audience !== undefined) updateData.audience = data.audience
    if (data.isAllDay !== undefined) updateData.isAllDay = data.isAllDay
    if (data.recurrence !== undefined) updateData.recurrence = data.recurrence
    if (data.status !== undefined) updateData.status = data.status

    const updated = await prisma.event.update({
      where: { id, schoolId, tenantId },
      data: updateData,
    })
    return NextResponse.json({ success: true, event: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Event PATCH', error)
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 })
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
    if (!(await hasPermission(userId, 'event:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.event.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    await prisma.event.delete({ where: { id, schoolId, tenantId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Event DELETE', error)
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 })
  }
}
