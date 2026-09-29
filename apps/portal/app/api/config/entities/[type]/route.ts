import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, TENANT_ID } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DEFAULT_ENTITY_REGISTRY, type EntityDefinition } from '@novastar/shared-types'
import { requirePermission } from '@/lib/tenant'

// GET /api/config/entities/[type] — Get a single entity definition
// Returns admin-overridden definition if it exists, otherwise the default
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  try {
    await requirePermission('config:read')
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { type } = await params

    const defaultDef = DEFAULT_ENTITY_REGISTRY.find(e => e.type === type)
    if (!defaultDef) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    const tenantId = TENANT_ID
    if (!tenantId) {
      return NextResponse.json({ error: 'Server misconfigured: TENANT_ID not set' }, { status: 500 })
    }

    // Fetch from DB (ConfigEntity stores full EntityDefinition as JSON)
    const configEntity = await prisma.configEntity.findFirst({
      where: { type, tenantId, isSystem: false },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })

    if (configEntity) {
      const dbDef: EntityDefinition = JSON.parse(configEntity.definition as string)
      return NextResponse.json({ ...dbDef, _id: configEntity.id, _isOverridden: true })
    }

    return NextResponse.json({ ...defaultDef, _isOverridden: false })
  } catch (error) {
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Config entity fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch entity definition' }, { status: 500 })
  }
}

// PATCH /api/config/entities/[type] — Override an entity definition
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    await requirePermission('config:write')
    const { type } = await params

    const defaultDef = DEFAULT_ENTITY_REGISTRY.find(e => e.type === type)
    if (!defaultDef) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    const body = (await req.json()) as {
      name?: string
      namePlural?: string
      description?: string | null
      icon?: string | null
      color?: string | null
      isActive?: boolean
      [key: string]: unknown
    }

    // Ensure type matches
    body.type = type

    // Tenant guard — TENANT_ID must be set (no hardcoded fallback)
    const tenantId = TENANT_ID
    if (!tenantId) {
      return NextResponse.json({ error: 'Server misconfigured: TENANT_ID not set' }, { status: 500 })
    }

    // Upsert into ConfigEntity table
    const upserted = await prisma.configEntity.upsert({
      where: { tenantId_type: { tenantId, type } },
      update: {
        name: body.name,
        namePlural: body.namePlural,
        description: body.description,
        icon: body.icon,
        color: body.color,
        definition: JSON.stringify(body),
        isActive: body.isActive ?? true,
      },
      create: {
        tenantId,
        type,
        name: body.name as string,
        namePlural: body.namePlural as string,
        description: body.description,
        icon: body.icon,
        color: body.color,
        definition: JSON.stringify(body),
        isSystem: false,
        isActive: body.isActive ?? true,
      },
    })

    return NextResponse.json({ success: true, id: upserted.id })
  } catch (error) {
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Config entity update error:', error)
    return NextResponse.json({ error: 'Failed to update entity definition' }, { status: 500 })
  }
}

// DELETE /api/config/entities/[type] — Remove an entity definition override
// (restores default registry definition)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    await requirePermission('config:write')
    const { type } = await params

    const defaultDef = DEFAULT_ENTITY_REGISTRY.find(e => e.type === type)
    if (!defaultDef) {
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 404 })
    }

    const tenantId = TENANT_ID
    if (!tenantId) {
      return NextResponse.json({ error: 'Server misconfigured: TENANT_ID not set' }, { status: 500 })
    }

    const existing = await prisma.configEntity.findUnique({
      where: { tenantId_type: { tenantId, type } },
    })

    if (existing?.isSystem) {
      return NextResponse.json({ error: 'System entity definitions cannot be deleted' }, { status: 403 })
    }

    if (existing) {
      await prisma.configEntity.delete({
        where: { tenantId_type: { tenantId, type } },
      })
    }

    return NextResponse.json({ success: true, restored: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Config entity delete error:', error)
    return NextResponse.json({ error: 'Failed to delete entity definition' }, { status: 500 })
  }
}
