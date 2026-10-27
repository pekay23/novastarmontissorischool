import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hasPermission } from '@novastar/auth'
import { ENTITY_CONFIG_MAP } from '@novastar/shared-types'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { amendmentEntityName } from '@/lib/amendments'
import { resolveVisibility, studentVisibilityWhere, visibilityDeniesAll } from '@/lib/visibility'
import { logError } from '@/lib/logger'

const querySchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(200),
  take: z.coerce.number().int().min(1).max(50).default(20),
  skip: z.coerce.number().int().min(0).max(10000).default(0),
})

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { tenantId, schoolId, userId } = ctx
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid history query' }, { status: 400 })
    const { entityType, entityId, take, skip } = parsed.data
    if (!Object.hasOwn(ENTITY_CONFIG_MAP, entityType)) return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    const config = ENTITY_CONFIG_MAP[entityType]
    if (config.schoolScoped && !schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const configReader = await hasPermission(userId, 'config:read', tenantId, schoolId ?? undefined)
    if (!configReader) {
      if (config.model !== 'student' || !schoolId || !(await hasPermission(userId, 'student:read', tenantId, schoolId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const visibility = await resolveVisibility(ctx, 'student:read')
      if (visibilityDeniesAll(visibility)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const student = await prisma.student.findFirst({
        where: { id: entityId, tenantId, schoolId, ...studentVisibilityWhere(visibility) },
        select: { id: true },
      })
      if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 })
    }

    const where = { tenantId, schoolId, entity: amendmentEntityName(config.model), entityId }
    // Page whole edit groups, then load their fields. A row-based limit would
    // split a correction and make a single decision appear incomplete.
    const groups = await prisma.recordAmendment.groupBy({
      by: ['groupId'], where, _max: { createdAt: true },
      orderBy: [{ _max: { createdAt: 'desc' } }, { groupId: 'asc' }],
      take: take + 1, skip,
    })
    const groupIds = groups.slice(0, take).map((group) => group.groupId)
    const data = groupIds.length === 0 ? [] : await prisma.recordAmendment.findMany({
      where: { ...where, groupId: { in: groupIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    })
    return NextResponse.json({ data, nextOffset: groups.length > take ? skip + take : null }, {
      headers: { 'cache-control': 'private, no-store' },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (error instanceof Error && error.name === 'ForbiddenError') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    logError('Amendment history GET', error)
    return NextResponse.json({ error: 'Failed to fetch amendment history' }, { status: 500 })
  }
}
