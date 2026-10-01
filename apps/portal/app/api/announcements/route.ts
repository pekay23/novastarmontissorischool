import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { z } from 'zod'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    const where: Record<string, unknown> = { schoolId, tenantId }
    if (status) where.status = status

    const announcements = await prisma.news.findMany({
      where,
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ data: announcements })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logError('Announcements GET', error)
    return NextResponse.json({ error: 'Failed to fetch announcements' }, { status: 500 })
  }
}

const CreateAnnouncementSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  bodyEn: z.string().min(1),
  bodyTw: z.string().optional(),
  excerptEn: z.string().optional(),
  excerptTw: z.string().optional(),
  category: z.string().optional(),
  featuredImage: z.string().optional(),
  audience: z.array(z.string()).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  publishedAt: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'announcement:create', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = CreateAnnouncementSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    const announcement = await prisma.news.create({
      data: {
        tenantId,
        schoolId,
        title: data.title,
        slug: data.slug,
        bodyEn: data.bodyEn,
        bodyTw: data.bodyTw || null,
        excerptEn: data.excerptEn || null,
        excerptTw: data.excerptTw || null,
        category: data.category || null,
        featuredImage: data.featuredImage || null,
        audience: data.audience || ['ALL'],
        status: data.status || 'DRAFT',
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : (data.status === 'PUBLISHED' ? new Date() : null),
        authorId: userId,
      },
    })
    return NextResponse.json(announcement, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Announcement POST', error)
    return NextResponse.json({ error: 'Failed to create announcement' }, { status: 500 })
  }
}

