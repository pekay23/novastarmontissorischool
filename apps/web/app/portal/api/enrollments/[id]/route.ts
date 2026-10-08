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
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'enrollment:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    // `Enrollment` has no `schoolId` column, so school scope arrives through
    // its required `student` relation — the same idiom `enrollments/route.ts`
    // already uses for the list read. Without it this handler was scoped to a
    // tenant only, and in a multi-school tenant a caller authorised in school A
    // could delete school B's enrollment by id. Both the existence check and
    // the delete carry the filter, so the write cannot land on a row the read
    // did not.
    const scope = { id, tenantId, student: { schoolId } }

    const existing = await prisma.enrollment.findFirst({
      where: scope,
      include: { student: { select: { firstName: true, lastName: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 })

    await prisma.enrollment.delete({ where: scope })
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
