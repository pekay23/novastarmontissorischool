import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DEFAULT_ENTITY_REGISTRY } from '@novastar/shared-types'
import { requirePermission } from '@/lib/tenant'

// GET /api/config/entities — List all entity definitions
// Merges DEFAULT_ENTITY_REGISTRY with any admin overrides stored in ConfigEntity table
export async function GET() {
  try {
    await requirePermission('config:read')

    // Fetch all admin overrides from DB
    const overrides = await prisma.configEntity.findMany({
      where: { isSystem: false },
    })

    // Build a lookup map of overrides
    const overrideMap = new Map<string, Record<string, unknown>>()
    for (const override of overrides) {
      const def = JSON.parse(override.definition as string)
      overrideMap.set(override.type, { ...def, _isOverridden: true, _id: override.id })
    }

    // Merge: start with defaults, apply overrides on top
    const registry = DEFAULT_ENTITY_REGISTRY.map(entity => {
      const override = overrideMap.get(entity.type)
      return override
        ? { ...entity, ...override, _isOverridden: true, _id: override._id }
        : { ...entity, _isOverridden: false }
    })

    return NextResponse.json({ entityTypes: registry })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Config entities list error:', error)
    // Fallback to defaults if DB unavailable
    return NextResponse.json({
      entityTypes: DEFAULT_ENTITY_REGISTRY.map(e => ({ ...e, _isOverridden: false })),
    })
  }
}
