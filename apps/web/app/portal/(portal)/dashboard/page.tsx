import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@novastar/shared-ui'
import { Users, GraduationCap, CreditCard, ArrowRight } from 'lucide-react'
import { getTenantContext } from '@/lib/tenant'
import { getDashboardCards } from '@/lib/queries/dashboard'
import { reachableNavigation } from '@/lib/portal-sections'

export const metadata = { title: 'Dashboard - Novastar Portal' }
const actions = [
  { name: 'Student directory', href: '/portal/students' },
  { name: 'Mark attendance', href: '/portal/attendance' },
  { name: 'Assessments and scores', href: '/portal/grades' },
  { name: 'Invoices and payments', href: '/portal/fees' },
  { name: 'My teaching workspace', href: '/portal/teachers/me' },
] as const
const icons = { students: Users, teachers: GraduationCap, fees: CreditCard }

export default async function DashboardPage() {
  const context = await getTenantContext()
  if (!context.schoolId)
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Welcome</h1>
        <p>No school is assigned to your account.</p>
      </div>
    )
  const cards = await getDashboardCards(context)
  const visibleActions = reachableNavigation(context.role, actions)
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          Welcome back{context.user.name ? ', ' + context.user.name : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your school workspace, with records and actions available to your
          account.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = icons[card.kind]
          return (
            <Card key={card.kind}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  <Link
                    href={card.href}
                    className="underline-offset-4 hover:underline"
                  >
                    {card.name}
                  </Link>
                </CardTitle>
                <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tabular-nums">
                  {card.value}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>
      {cards.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No summary records are available for your current assignments.
        </p>
      )}
      {visibleActions.length > 0 && (
        <section className="space-y-3" aria-labelledby="dashboard-actions">
          <h2 id="dashboard-actions" className="text-lg font-semibold">
            Quick actions
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex min-h-12 items-center justify-between gap-3 rounded-lg border bg-card p-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {action.name}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
