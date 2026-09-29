import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('enrollment:delete')
    const { tenantId } = await getTenantContext()

    const { id } = await params
    const existing = await prisma.enrollment.findFirst({
      where: { id, tenantId },
      include: { student: { select: { firstName: true, lastName: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 })

    await prisma.enrollment.delete({ where: { id } })
    return NextResponse.json({ success: true, message: `Removed ${existing.student.firstName} ${existing.student.lastName} from class` })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Enrollment DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete enrollment' }, { status: 500 })
  }
}
