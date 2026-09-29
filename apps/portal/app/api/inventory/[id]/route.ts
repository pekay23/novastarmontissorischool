import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'
import { InventoryStatus } from '@novastar/database'

const UpdateInventoryItemSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  quantity: z.number().int().min(0).optional(),
  minQuantity: z.number().int().min(0).optional(),
  unit: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  purchasePrice: z.number().min(0).nullable().optional(),
  supplier: z.string().nullable().optional(),
  status: z.nativeEnum(InventoryStatus).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('inventory:item:edit')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const { id } = await params
    const existing = await prisma.inventoryItem.findFirst({
      where: { id, schoolId, tenantId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    const body = await req.json()
    const parseResult = UpdateInventoryItemSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.description !== undefined) updateData.description = data.description
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId
    if (data.quantity !== undefined) {
      updateData.quantity = data.quantity
      if (data.quantity === 0) {
        updateData.status = 'OUT_OF_STOCK'
      } else if (data.minQuantity !== undefined && data.quantity <= data.minQuantity) {
        updateData.status = 'LOW_STOCK'
      } else {
        updateData.status = 'IN_STOCK'
      }
      if (data.quantity !== existing.quantity) {
        const diff = data.quantity - existing.quantity
        updateData.transactions = {
          create: [{
            tenantId,
            type: 'INBOUND' as const,
            quantity: diff > 0 ? diff : 0,
            reference: 'Stock adjustment',
          }],
        }
        if (diff < 0) {
          updateData.transactions = {
            create: [{
              tenantId,
              type: 'OUTBOUND' as const,
              quantity: Math.abs(diff),
              reference: 'Stock adjustment',
            }],
          }
        }
      }
    }
    if (data.minQuantity !== undefined) updateData.minQuantity = data.minQuantity
    if (data.unit !== undefined) updateData.unit = data.unit
    if (data.location !== undefined) updateData.location = data.location
    if (data.purchasePrice !== undefined) updateData.purchasePrice = data.purchasePrice ? Number(data.purchasePrice) : null
    if (data.supplier !== undefined) updateData.supplier = data.supplier
    if (data.status !== undefined) updateData.status = data.status

    const updated = await prisma.inventoryItem.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ success: true, item: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Inventory item PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('inventory:item:delete')
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    const { id } = await params
    const existing = await prisma.inventoryItem.findFirst({
      where: { id, schoolId, tenantId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    await prisma.inventoryItem.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Inventory item DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
  }
}
