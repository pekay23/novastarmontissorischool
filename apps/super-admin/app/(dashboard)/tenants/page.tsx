import { requireCapabilityPage } from '@/lib/admin-context'
import { listTenantsAcrossPlatform } from '@/lib/queries'
import { TenantTable } from '@/components/tenant-table'
import { TenantFormClient } from '@/components/tenant-form-client'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Tenants' }

export default async function TenantsPage() {
  const context = await requireCapabilityPage('tenant:read')
  const tenants = await listTenantsAcrossPlatform()
  const canProvision = context.operator.capabilities.some((c) => c === 'tenant:provision' || c === 'tenant:school:create')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Tenants</h1>
        <p className="text-sm text-muted-foreground">
          Every tenant on the platform. Select one above to drill into its schools, users and
          settings.
        </p>
      </div>
      {canProvision ? <TenantFormClient /> : null}
      <TenantTable tenants={tenants} />
    </div>
  )
}
