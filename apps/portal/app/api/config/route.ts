import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { DEFAULT_ENTITY_REGISTRY } from '@novastar/shared-types'
import { requirePermission } from '@/lib/tenant'

// GET /api/config — List all entity types with their definitions (requires auth)
export async function GET() {
  try {
    await requirePermission('config:read')

    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
    console.error('Config API error:', error)
    return NextResponse.json({ error: 'Failed to fetch config entity types' }, { status: 500 })
  }
}