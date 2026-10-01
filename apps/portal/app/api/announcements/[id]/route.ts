import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { z } from 'zod'
import { logError } from '@/lib/logger'

const UpdateAnnouncementSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  bodyEn: z.string().min(1).optional(),
  bodyTw: z.string().nullable().optional(),
  excerptEn: z.string().nullable().optional(),
  excerptTw: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  featuredImage: z.string().nullable().optional(),
  audience: z.array(z.string()).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  publishedAt: z.string().nullable().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { id } = await params
    const announcement = await prisma.news.findFirst({
      where: { id, schoolId, tenantId },
      include: { author: { select: { name: true } } },
    })
    if (!announcement) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
    return NextResponse.json(announcement)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    const existing = await prisma.news.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })

    const data = parseResult.data
    const updateData: Record<string, unknown> = {}
    if (data.title !== undefined) updateData.title = data.title
    if (data.slug !== undefined) updateData.slug = data.slug
    if (data.bodyEn !== undefined) updateData.bodyEn = data.bodyEn
    if (data.bodyTw !== undefined) updateData.bodyTw = data.bodyTw
    if (data.excerptEn !== undefined) updateData.excerptEn = data.excerptEn
    if (data.excerptTw !== undefined) updateData.excerptTw = data.excerptTw
    if (data.category !== undefined) updateData.category = data.category
    if (data.featuredImage !== undefined) updateData.featuredImage = data.featuredImage
    if (data.audience !== undefined) updateData.audience = data.audience
    if (data.status !== undefined) {
      updateData.status = data.status
      if (data.status === 'PUBLISHED' && !data.publishedAt) {
        updateData.publishedAt = new Date()
      }
    }
    if (data.publishedAt !== undefined) updateData.publishedAt = data.publishedAt ? new Date(data.publishedAt) : null

    const updated = await prisma.news.update({
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
    const existing = await prisma.news.findFirst({ where: { id, schoolId, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })

    await prisma.news.delete({ where: { id, schoolId, tenantId } })
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
