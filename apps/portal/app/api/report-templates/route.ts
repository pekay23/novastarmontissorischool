import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { ReportType } from '@novastar/database'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC: use @novastar/auth hasPermission (handles delegations + role inheritance)
    if (!(await hasPermission(userId, 'config:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') as ReportType | null

    const where: Record<string, unknown> = { tenantId, schoolId }
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

