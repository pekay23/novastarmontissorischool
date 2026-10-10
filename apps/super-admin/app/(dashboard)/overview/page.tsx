import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@novastar/shared-ui'
import { requireCapabilityPage } from '@/lib/admin-context'
import { countPlatformTotals, listTenantsAcrossPlatform } from '@/lib/queries'
import { HealthChecks } from '@/components/health-checks'
import { platformHealth } from '@/lib/health'

/**
 * `/overview` — the platform overview.
 *
 * Lives here rather than at `/` because the build plan also specifies
 * `app/page.tsx` as a redirect to `/tenants`, and a route group does not change a
 * path — both would be `/`, and Next.js rejects that. See `app/page.tsx`.
 */
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Overview' }

export default async function OverviewPage() {
  await requireCapabilityPage('platform:read')

  const [totals, tenants, health] = await Promise.all([
    countPlatformTotals(),
    listTenantsAcrossPlatform(),
    platformHealth(),
  ])

  const suspended = tenants.filter((tenant) => !tenant.isActive)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Platform overview</h1>
        <p className="text-sm text-muted-foreground">
          Counts span every tenant. No query on this page is scoped to one, because no session
          tenant exists to scope it to.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Tenants" value={totals.tenants} />
        <Stat label="Active" value={totals.activeTenants} />
        <Stat label="Suspended" value={suspended.length} />
        <Stat label="Schools" value={totals.schools} />
        <Stat label="Users" value={totals.users} />
      </dl>

      {suspended.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Suspended tenants</CardTitle>
            <CardDescription>
              Their rows are intact. Suspending flips one column; it never deletes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {suspended.map((tenant) => (
                <li key={tenant.id}>
                  <Link className="hover:underline" href={`/tenants/${tenant.id}`}>
                    {tenant.name}
                  </Link>{' '}
                  <span className="font-mono text-xs text-muted-foreground">{tenant.code}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Health
        </h2>
        <HealthChecks checks={health.checks} />
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
