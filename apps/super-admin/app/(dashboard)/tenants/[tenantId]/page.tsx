import { requireCapabilityPage, requireExistingTenant } from '@/lib/admin-context'
import { hasOperatorCapability } from '@/lib/permissions'
import { listSchoolsForTenant } from '@/lib/queries'
import { parsePagination } from '@/lib/http'
import { AuditLogTable } from '@/components/audit-log-table'
import { TenantActions } from '@/components/tenant-actions'
import { TenantStatusBadge } from '@/components/tenant-status-badge'
import { TenantSuspendedNotice } from '@/components/tenant-suspended-notice'
import { TenantEditSection } from '@/components/tenant-edit-section'
import { auditForTenant } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params
  return { title: `Tenant ${tenantId}` }
}

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const context = await requireCapabilityPage('tenant:read')
  const { tenantId } = await params
  const resolved = await requireExistingTenant(tenantId)
  const canUpdate = hasOperatorCapability(context.operator.capabilities, 'tenant:update')

  if (resolved.status === 'suspended') {
    return (
      <TenantSuspendedNotice
        tenantId={resolved.identity.id}
        tenantCode={resolved.identity.code}
        canUpdate={canUpdate}
      />
    )
  }

  const { tenant } = resolved
  const [schools, audit] = await Promise.all([
    listSchoolsForTenant(tenant.id),
    auditForTenant(tenant.id, parsePagination('http://internal/?take=10')),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold">
            {tenant.name}
            <TenantStatusBadge isActive={tenant.isActive} />
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            {tenant.code} · {tenant.id}
          </p>
        </div>
        <TenantActions
          tenantId={tenant.id}
          tenantCode={tenant.code}
          isActive={tenant.isActive}
          canUpdate={canUpdate}
        />
      </div>

      {canUpdate ? (
        <TenantEditSection tenant={tenant} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-medium">Routing</h3>
          <p className="text-sm text-muted-foreground">How requests reach this tenant.</p>
          <div className="mt-2 space-y-1 text-sm">
            <p><span className="text-muted-foreground">Subdomain code: </span><span className="font-mono">{tenant.code}</span></p>
            <p><span className="text-muted-foreground">Custom domain: </span><span className="font-mono">{tenant.domain ?? 'none'}</span></p>
          </div>
        </div>

        <div className="rounded-md border p-4">
          <h3 className="text-sm font-medium">Size</h3>
          <p className="text-sm text-muted-foreground">Scoped to this tenant only.</p>
          <div className="mt-2 space-y-1 text-sm">
            <p><span className="text-muted-foreground">Schools: </span><span className="tabular-nums">{schools.length}</span></p>
            <p><span className="text-muted-foreground">Users: </span><span className="tabular-nums">{tenant.userCount}</span></p>
            <p><span className="text-muted-foreground">Created: </span><span className="tabular-nums">{tenant.createdAt.slice(0, 10)}</span></p>
          </div>
        </div>

        <div className="rounded-md border p-4">
          <h3 className="text-sm font-medium">Provisioning</h3>
          <p className="text-sm text-muted-foreground">The shared function this console calls.</p>
          <div className="mt-2 space-y-2 text-sm">
            <p className="text-muted-foreground">
              <code className="font-mono">provisionTenant</code> from
              <code className="font-mono"> @novastar/tenant-cli</code> is the only writer of a
              tenant, this school and its first administrator.
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              POST /api/tenants/{tenant.id}/provision
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent activity in this tenant
        </h2>
        <AuditLogTable entries={audit.data} total={audit.meta.total} showTenant={false} />
      </section>
    </div>
  )
}
