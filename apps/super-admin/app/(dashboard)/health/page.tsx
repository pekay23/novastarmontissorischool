import { requireCapabilityPage } from '@/lib/admin-context'
import { platformHealth } from '@/lib/health'
import { HealthChecks } from '@/components/health-checks'

/**
 * `/health` — migration status, database reachability, replica configuration and
 * audit volume.
 *
 * Behind `platform:read`. A public health URL on a fleet-wide console is an
 * information leak dressed as an operations convenience: it tells an unauthenticated
 * caller whether the platform has been provisioned and whether its database is up.
 */
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Health' }

export default async function HealthPage() {
  await requireCapabilityPage('platform:read')
  const health = await platformHealth()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Platform health</h1>
        <p className="text-sm text-muted-foreground">
          Generated {health.generatedAt.replace('T', ' ').slice(0, 19)} UTC. Connection strings are
          reported by variable name only.
        </p>
      </div>

      <HealthChecks checks={health.checks} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Totals
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Tenants" value={health.totals.tenants} />
          <Stat label="Active" value={health.totals.activeTenants} />
          <Stat label="Schools" value={health.totals.schools} />
          <Stat label="Users" value={health.totals.users} />
          <Stat label="Audit entries" value={health.totals.auditEntries} />
        </dl>
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
