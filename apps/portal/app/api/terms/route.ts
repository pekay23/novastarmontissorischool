import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { resolveVisibility, visibilityDeniesAll } from '@/lib/visibility'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'term:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // `term:read` is not narrowed for any role, but an unrecognised role
    // resolves to `custom` and must be refused rather than shown the calendar.
    const visibility = await resolveVisibility(ctx, 'term:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const current = searchParams.get('current') === 'true'

    const where: Prisma.TermWhereInput = { schoolId, tenantId }
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
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Terms GET', error)
    return NextResponse.json({ error: 'Failed to fetch terms' }, { status: 500 })
  }
}