import { Card, CardContent, CardHeader, CardTitle } from '@novastar/shared-ui'
import { Users, GraduationCap, CreditCard } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'

export const metadata = { title: 'Dashboard - Novastar Portal' }

async function getDashboardStats(schoolId: string) {
  'use server'
  const [studentCount, teacherCount, feeCount] = await Promise.all([
    prisma.student.count({ where: { schoolId } }),
    prisma.staff.count({ where: { schoolId } }),
    prisma.feeInvoice.count({ where: { schoolId, status: 'PENDING' } }),
  ])
  return { studentCount, teacherCount, feeCount }
}

export default async function DashboardPage() {
  const ctx = await getTenantContext()
  const schoolId = ctx.schoolId
  if (!schoolId) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Welcome!</h2>
        <p className="text-muted-foreground">No school assigned to your account.</p>
      </div>
    )
  }
  const stats = await getDashboardStats(schoolId)

  const statCards = [
    { name: 'Students', value: stats.studentCount.toString(), icon: Users, color: 'text-blue-600' },
    { name: 'Teachers', value: stats.teacherCount.toString(), icon: GraduationCap, color: 'text-green-600' },
    { name: 'Pending Fees', value: stats.feeCount.toString(), icon: CreditCard, color: 'text-orange-600' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold">Welcome back!</h2>
        <p className="text-muted-foreground">
          Here's a summary of your school at a glance.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.name}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.name}</CardTitle>
                <Icon className={`h-4 w-4 ${card.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No recent activity to display. Check back later.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
