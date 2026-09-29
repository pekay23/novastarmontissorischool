import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const current = searchParams.get('current') === 'true'

    const where: Record<string, unknown> = { schoolId, tenantId }
    if (current) {
      where.isCurrent = true
    }

    const terms = await prisma.term.findMany({
      where,
      include: {
        academicYear: { select: { id: true, name: true, startDate: true, endDate: true } },
      },
      orderBy: { startDate: 'desc' },
    })

    return NextResponse.json({ data: terms })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logError('Terms GET', error)
    return NextResponse.json({ error: 'Failed to fetch terms' }, { status: 500 })
  }
}

