/**
 * System error log viewing API.
 *
 * GET  /api/system/errors  — list errors with filtering
 *
 * Only HEADMASTER role can access.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { toErrorResponse } from '@/lib/api-response'
import { isPlatformAdmin } from '@/lib/constants/platform-roles'
import { z } from 'zod'

const VALID_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

export async function GET(req: NextRequest) {
  // Hoisted so the catch block can attribute the failure to a tenant.
  let ctx: { tenantId?: string; userId?: string } = {}
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    if (!isPlatformAdmin(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const url = new URL(req.url)
    // Clamp both bounds: an unclamped `?limit=-1` reaches Prisma `take`/`skip`
    // and surfaces as a 500 instead of a sensible default.
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200)
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)
    const severity = url.searchParams.get('severity') || undefined
    const resolved = url.searchParams.get('resolved')
    const errorType = url.searchParams.get('errorType') || undefined

    const where: Prisma.SystemErrorWhereInput = {
      tenantId: session.tenantId,
    }

    if (severity) {
      const severityResult = z.enum(VALID_SEVERITIES).safeParse(severity)
      if (severityResult.success) {
        where.severity = severityResult.data
      }
    }

    if (resolved === 'true') where.resolved = true
    else if (resolved === 'false') where.resolved = false

    if (errorType) {
      where.errorType = { contains: errorType, mode: 'insensitive' }
    }

    const [errors, total] = await Promise.all([
      prisma.systemError.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          errorType: true,
          message: true,
          endpoint: true,
          severity: true,
          resolved: true,
          resolvedAt: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, name: true } },
          resolvedByUser: { select: { id: true, name: true } },
        },
      }),
      prisma.systemError.count({ where }),
    ])

    return NextResponse.json({
      errors: errors.map((e) => ({
        id: e.id,
        errorType: e.errorType,
        message: e.message,
        // Stack traces can contain file paths, SQL fragments, and internal
        // identifiers. They are never returned in the list view — only the
        // error type and message needed to triage.
        endpoint: e.endpoint,
        severity: e.severity,
        resolved: e.resolved,
        resolvedAt: e.resolvedAt?.toISOString() ?? null,
        // Name only. Email addresses are PII and are not needed to triage
        // an error, so the list view does not carry them.
        user: e.user ? { id: e.user.id, name: e.user.name } : null,
        resolvedByUser: e.resolvedByUser ? { id: e.resolvedByUser.id, name: e.resolvedByUser.name } : null,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    return toErrorResponse('SYSTEM_ERRORS_API', error, {
      ...ctx,
      endpoint: 'GET /api/system/errors',
    })
  }
}
