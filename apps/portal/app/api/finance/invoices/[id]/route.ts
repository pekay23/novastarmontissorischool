import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { logError } from '@/lib/logger'

// Delete a fee invoice (only if no payments recorded)
export async function DELETE(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC: use @novastar/auth hasPermission
    if (!(await hasPermission(userId, 'finance:invoice:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { pathname } = new URL(req.url)
    const id = pathname.split('/').pop()
    if (!id) {
      return NextResponse.json({ error: 'Invoice ID required' }, { status: 400 })
    }

    const invoice = await prisma.feeInvoice.findFirst({
      where: { id, schoolId, tenantId },
      include: { payments: { select: { id: true } } },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (invoice.payments.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete invoice with recorded payments' },
        { status: 409 },
      )
    }

    await prisma.feeInvoice.delete({
      where: { id, schoolId, tenantId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Finance invoice DELETE', error)
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 })
  }
}
