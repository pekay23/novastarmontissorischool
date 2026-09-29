import { NextResponse } from 'next/server'
import { DEFAULT_ENTITY_REGISTRY } from '@novastar/shared-types'
import { requirePermission } from '@/lib/tenant'

// GET /api/config — List all entity types with their definitions (requires auth)
export async function GET() {
  try {
    await requirePermission('config:read')

    return NextResponse.json({
      entityTypes: DEFAULT_ENTITY_REGISTRY.map(e => ({
        type: e.type,
        name: e.name,
        namePlural: e.namePlural,
        description: e.description,
        icon: e.icon,
        color: e.color,
        allowAdd: e.allowAdd,
        allowEdit: e.allowEdit,
        allowDelete: e.allowDelete,
        allowImport: e.allowImport,
        allowExport: e.allowExport,
        hasPermissions: e.hasPermissions,
      }))
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (error instanceof Error && error.name === 'ServerConfigError') {
      console.error('Server config error:', error.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    console.error('Config API error:', error)
    return NextResponse.json({ error: 'Failed to fetch config entity types' }, { status: 500 })
  }
}