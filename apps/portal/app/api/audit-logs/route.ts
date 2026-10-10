/**
 * API route to fetch audit logs with filtering and pagination.
 * Requires admin permission.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { isUserSecurityAdmin } from '@/lib/constants/platform-roles'

export async function GET(req: NextRequest) {
  try {
    // Require an administrative role
    const ctx = await getCachedSessionAndTenant()
    if (!isUserSecurityAdmin(ctx.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const url = new URL(req.url)
    const searchParams = url.searchParams

    // Clamp both bounds so a negative or oversized page size cannot reach
    // Prisma `take`/`skip` and surface as a 500.
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200)
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)
    const action = searchParams.get('action') || undefined
    const entity = searchParams.get('entity') || undefined
    const userId = searchParams.get('userId') || undefined
    const startDate = searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined
    const endDate = searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined

    const where: Prisma.AuditLogWhereInput = {
      tenantId: ctx.tenantId,
      ...(action && { action }),
      ...(entity && { entity }),
      ...(userId && { userId }),
      ...(startDate && endDate && {
        createdAt: { gte: startDate, lte: endDate },
      }),
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true, role: { select: { name: true } } } } },
      }),
      prisma.auditLog.count({ where }),
    ])

    return NextResponse.json({ logs, total, limit, offset })
  } catch (error) {
    console.error('[AUDIT_LOGS_API]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}
