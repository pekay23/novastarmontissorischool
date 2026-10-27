import 'server-only'
import { hasPermission } from '@novastar/auth'
import { prisma } from '@/lib/prisma'
import type { TenantContext } from '@/lib/tenant'
import {
  resolveVisibility,
  visibilityDeniesAll,
  studentVisibilityWhere,
  staffVisibilityWhere,
} from '@/lib/visibility'

export interface DashboardCard {
  name: string
  value: number
  kind: 'students' | 'teachers' | 'fees'
  href: '/portal/students' | '/portal/teachers' | '/portal/fees'
}

export async function getDashboardCards(
  context: TenantContext,
): Promise<DashboardCard[]> {
  const { userId, tenantId } = context
  if (!context.schoolId) return []
  const schoolId = context.schoolId

  async function studentCard(): Promise<DashboardCard | null> {
    if (!(await hasPermission(userId, 'student:read', tenantId, schoolId)))
      return null
    const visibility = await resolveVisibility(context, 'student:read')
    if (visibilityDeniesAll(visibility)) return null
    const value = await prisma.student.count({
      where: { tenantId, schoolId, ...studentVisibilityWhere(visibility) },
    })
    return {
      name:
        visibility.scope === 'own'
          ? 'Your children'
          : visibility.scope === 'all'
            ? 'Students'
            : 'Students in your classes',
      value,
      kind: 'students',
      href: '/portal/students',
    }
  }

  async function teacherCard(): Promise<DashboardCard | null> {
    if (!(await hasPermission(userId, 'teacher:read', tenantId, schoolId)))
      return null
    const visibility = await resolveVisibility(context, 'teacher:read')
    if (visibilityDeniesAll(visibility)) return null
    const scope =
      visibility.scope === 'own'
        ? { id: visibility.staffId ?? '__no-staff__' }
        : await staffVisibilityWhere(tenantId, visibility)
    const value = await prisma.staff.count({
      where: { tenantId, schoolId, ...scope },
    })
    return {
      name:
        visibility.scope === 'all' ? 'Staff members' : 'Staff in your classes',
      value,
      kind: 'teachers',
      href: '/portal/teachers',
    }
  }

  async function feeCard(): Promise<DashboardCard | null> {
    if (!(await hasPermission(userId, 'finance:read', tenantId, schoolId)))
      return null
    const visibility = await resolveVisibility(context, 'finance:read')
    if (visibilityDeniesAll(visibility)) return null
    const value = await prisma.feeInvoice.count({
      where: {
        tenantId,
        schoolId,
        status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
        student: { tenantId, schoolId, ...studentVisibilityWhere(visibility) },
      },
    })
    return {
      name: 'Unpaid invoices',
      value,
      kind: 'fees',
      href: '/portal/fees',
    }
  }

  const cards = await Promise.all([studentCard(), teacherCard(), feeCard()])
  return cards.filter((card): card is DashboardCard => card !== null)
}
