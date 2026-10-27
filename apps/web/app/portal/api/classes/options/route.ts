import { NextResponse } from 'next/server'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import { toErrorResponse } from '@/lib/api-response'

export async function GET() {
  try {
    const { userId, tenantId, schoolId } = await getTenantContext()
    if (!schoolId)
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    const [canCreate, canEdit, canAssignTeacher] = await Promise.all(
      ['class:create', 'class:edit', 'teacher:read'].map((permission) =>
        hasPermission(userId, permission, tenantId, schoolId),
      ),
    )
    if (!canCreate && !canEdit)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const [levels, teachers] = await Promise.all([
      prisma.classLevel.findMany({
        where: { tenantId, schoolId },
        select: { id: true, name: true },
        orderBy: { order: 'asc' },
      }),
      canAssignTeacher
        ? prisma.staff.findMany({
            where: { tenantId, schoolId },
            select: { id: true, firstName: true, lastName: true },
            orderBy: { lastName: 'asc' },
          })
        : [],
    ])
    return NextResponse.json({ levels, teachers, canAssignTeacher })
  } catch (error) {
    return toErrorResponse('Class options GET', error)
  }
}
