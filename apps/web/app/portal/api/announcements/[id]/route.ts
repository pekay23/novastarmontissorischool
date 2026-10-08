import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { resolveVisibility, visibilityDeniesAll } from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

/**
 * Reads and writes `Announcement`, the internal staff-notice table. It is not
 * `News`: `apps/public-site/lib/data.ts` renders `News` at build time on
 * nothing but `status: 'PUBLISHED'`, so a PATCH that set `PUBLISHED` on a `News`
 * row put a staff notice on the public homepage. See `../route.ts`.
 */
const UpdateAnnouncementSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  audience: z.array(z.string()).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  publishedAt: z.string().nullable().optional(),
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
    if (!(await hasPermission(userId, 'announcement:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const visibility = await resolveVisibility(ctx, 'announcement:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    // The same audience rule as the list route, in the query rather than after
    // it. A notice addressed to other roles must be indistinguishable from one
    // that does not exist, so this narrows to a 404 and never a 403 -- a 403
    // would confirm the id is real, which is itself a disclosure.
    const audienceFilter: Prisma.AnnouncementWhereInput = ctx.role
      ? { OR: [{ audience: { isEmpty: true } }, { audience: { has: ctx.role } }] }
      : { OR: [{ audience: { isEmpty: true } }] }

    const announcement = await prisma.announcement.findFirst({
      where: { id, schoolId, tenantId, ...audienceFilter },
      include: { author: { select: { name: true } } },
    })
    if (!announcement) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
    return NextResponse.json(announcement)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Announcement GET', error)
    return NextResponse.json({ error: 'Failed to fetch announcement' }, { status: 500 })
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
    if (!(await hasPermission(userId, 'announcement:edit', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateAnnouncementSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }

    const existing = await prisma.announcement.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })

    const data = parseResult.data
    const updateData: Record<string, unknown> = {}
    if (data.title !== undefined) updateData.title = data.title
    if (data.body !== undefined) updateData.body = data.body
    if (data.audience !== undefined) updateData.audience = data.audience
    if (data.status !== undefined) {
      updateData.status = data.status
      if (data.status === 'PUBLISHED' && !data.publishedAt) {
        updateData.publishedAt = new Date()
      }
    }
    if (data.publishedAt !== undefined) updateData.publishedAt = data.publishedAt ? new Date(data.publishedAt) : null

    const updated = await prisma.announcement.update({
      where: { id, schoolId, tenantId },
      data: updateData,
    })
    return NextResponse.json({ success: true, announcement: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Announcement PATCH', error)
    return NextResponse.json({ error: 'Failed to update announcement' }, { status: 500 })
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
    if (!(await hasPermission(userId, 'announcement:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.announcement.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })

    await prisma.announcement.delete({ where: { id, schoolId, tenantId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Announcement DELETE', error)
    return NextResponse.json({ error: 'Failed to delete announcement' }, { status: 500 })
  }
}
