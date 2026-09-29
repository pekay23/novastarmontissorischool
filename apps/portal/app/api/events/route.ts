import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const upcoming = searchParams.get('upcoming') === 'true'

    const where: Record<string, unknown> = { schoolId, tenantId }
    if (upcoming) {
      where.startDate = { gte: new Date() }
    } else if (date) {
      const start = new Date(date)
      start.setHours(0, 0, 0, 0)
      const end = new Date(date)
      end.setHours(23, 59, 59, 999)
      where.AND = [
        { startDate: { lte: end } },
        { endDate: { gte: start } },
      ]
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { startDate: 'asc' },
    })
    return NextResponse.json({ data: events })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logError('Events GET', error)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }
}

const CreateEventSchema = z.object({
  title: z.string().min(1),
  descriptionEn: z.string().min(1),
  descriptionTw: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string().optional(),
  audience: z.array(z.string()).optional(),
  isAllDay: z.boolean().default(false),
  recurrence: z.string().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
})

export async function POST(req: NextRequest) {
  try {
    await requirePermission('event:create')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const body = await req.json()
    const parseResult = CreateEventSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    const event = await prisma.event.create({
      data: {
        tenantId,
        schoolId,
        title: data.title,
        descriptionEn: data.descriptionEn,
        descriptionTw: data.descriptionTw || null,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        location: data.location || null,
        audience: data.audience || ['ALL'],
        isAllDay: data.isAllDay,
        recurrence: data.recurrence || null,
        status: data.status || 'DRAFT',
      },
    })
    return NextResponse.json(event, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Event POST', error)
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 })
  }
}

