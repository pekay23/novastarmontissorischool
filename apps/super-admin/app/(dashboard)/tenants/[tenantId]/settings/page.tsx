import { requireCapabilityPage, requireTenantScope } from '@/lib/admin-context'
import { hasOperatorCapability } from '@/lib/permissions'
import { SettingsEditor } from '@/components/settings-editor'

/**
 * `/tenants/:tenantId/settings` — mutable tenant fields and the settings document.
 *
 * This is where `Tenant.settings` belongs: on the page for the tenant it describes,
 * for an operator who has already selected that tenant. It is not on the roster,
 * because a fleet-wide list is not the place to read a school's configuration.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: 'Tenant settings' }
}

export default async function TenantSettingsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const context = await requireCapabilityPage('tenant:config')
  const { tenantId } = await params
  const tenant = await requireTenantScope(tenantId)
  const canWrite = hasOperatorCapability(context.operator.capabilities, 'tenant:config')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings for {tenant.name}</h1>
        <p className="text-sm text-muted-foreground">
          Scoped to <code className="font-mono">{tenant.code}</code>. Writes are merged into the
          stored document and audited.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Routing
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border bg-card p-4">
            <dt className="text-xs text-muted-foreground">Code</dt>
            <dd className="mt-1 font-mono text-sm">{tenant.code}</dd>
            <p className="mt-1 text-xs text-muted-foreground">
              The subdomain. Set once at provisioning and not editable — changing it would move a
              live tenant.
            </p>
          </div>
          <div className="rounded-md border border-border bg-card p-4">
            <dt className="text-xs text-muted-foreground">Domain</dt>
            <dd className="mt-1 font-mono text-sm">{tenant.domain ?? 'none'}</dd>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional custom domain. <code className="font-mono">PATCH</code> accepts a value or{' '}
              <code className="font-mono">null</code>.
            </p>
          </div>
          <div className="rounded-md border border-border bg-card p-4">
            <dt className="text-xs text-muted-foreground">Name</dt>
            <dd className="mt-1 text-sm">{tenant.name}</dd>
            <p className="mt-1 text-xs text-muted-foreground">Shown in the roster and in the portal.</p>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Settings document
        </h2>
        <SettingsEditor tenantId={tenant.id} settings={tenant.settings} canWrite={canWrite} />
      </section>
    </div>
  )
}
