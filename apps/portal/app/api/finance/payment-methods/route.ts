import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { logError } from '@/lib/logger'

// List enabled payment methods for the current school/tenant
export async function GET() {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC: use @novastar/auth hasPermission
    if (!(await hasPermission(userId, 'finance:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const paymentMethods = await prisma.paymentMethodConfig.findMany({
      where: { schoolId, tenantId, isEnabled: true },
      select: { code: true, name: true, instructions: true },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({ data: paymentMethods })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ServerConfigError') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Finance payment methods GET', error)
    return NextResponse.json({ error: 'Failed to fetch payment methods' }, { status: 500 })
  }
}

