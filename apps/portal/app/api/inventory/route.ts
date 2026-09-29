import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'
import { InventoryStatus } from '@novastar/database'

const InventoryItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  quantity: z.number().int().min(0).default(0),
  minQuantity: z.number().int().min(0).default(0),
  unit: z.string().optional(),
  location: z.string().optional(),
  purchasePrice: z.number().min(0).optional(),
  supplier: z.string().optional(),
  status: z.nativeEnum(InventoryStatus).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')
    const categoryId = searchParams.get('categoryId')
    const lowStock = searchParams.get('lowStock') === 'true'

    const where: Record<string, unknown> = { schoolId, tenantId }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { supplier: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (categoryId) where.categoryId = categoryId
    if (lowStock) {
      where.quantity = { lte: 0 }
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      include: { category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ data: items })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Inventory GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch inventory' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission('inventory:item:create')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const body = await req.json()
    const parseResult = InventoryItemSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    const item = await prisma.$transaction(async (tx) => {
      const newItem = await tx.inventoryItem.create({
        data: {
          tenantId,
          schoolId,
          name: data.name,
          description: data.description || null,
          categoryId: data.categoryId || null,
          quantity: data.quantity,
          minQuantity: data.minQuantity,
          unit: data.unit || null,
          location: data.location || null,
          purchasePrice: data.purchasePrice ? Number(data.purchasePrice) : null,
          supplier: data.supplier || null,
          status: data.status || 'IN_STOCK',
        },
      })

      // Record initial stock-in transaction
      await tx.inventoryTransaction.create({
        data: {
          tenantId,
          itemId: newItem.id,
          type: 'INBOUND',
          quantity: data.quantity,
          reference: 'Initial stock',
        },
      })

      return newItem
    })

    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Inventory POST error:', error)
    return NextResponse.json({ error: 'Failed to create inventory item' }, { status: 500 })
  }
}
