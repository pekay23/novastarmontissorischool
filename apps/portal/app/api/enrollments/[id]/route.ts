import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { logError } from '@/lib/logger'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { tenantId, userId, schoolId } = await getTenantContext()

    // RBAC
    if (!(await hasPermission(userId, 'enrollment:delete', tenantId, schoolId ?? undefined))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.enrollment.findFirst({
      where: { id, tenantId },
      include: { student: { select: { firstName: true, lastName: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 })

    await prisma.enrollment.delete({ where: { id, tenantId } })
    return NextResponse.json({ success: true, message: `Removed ${existing.student.firstName} ${existing.student.lastName} from class` })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Enrollment DELETE', error)
    return NextResponse.json({ error: 'Failed to delete enrollment' }, { status: 500 })
  }
}
