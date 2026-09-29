import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { ReportType } from '@novastar/database'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const { schoolId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') as ReportType | null

    const where: Record<string, unknown> = { schoolId }
    if (type) where.type = type

    const templates = await prisma.reportTemplate.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ data: templates })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logError('Report templates GET', error)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

