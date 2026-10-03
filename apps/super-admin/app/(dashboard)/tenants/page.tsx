import { requireCapabilityPage } from '@/lib/admin-context'
import { listTenantsAcrossPlatform } from '@/lib/queries'
import { TenantTable } from '@/components/tenant-table'

/**
 * `/tenants` — the fleet roster.
 *
 * This is the one page whose query has no tenant predicate, and that is the whole
 * point of it: an operator manages the fleet, not one school. The projection in
 * `listTenantsAcrossPlatform` is what bounds it to nine named fields.
 */
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Tenants' }

export default async function TenantsPage() {
  await requireCapabilityPage('tenant:read')
  const tenants = await listTenantsAcrossPlatform()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Tenants</h1>
        <p className="text-sm text-muted-foreground">
          Every tenant on the platform. Select one above to drill into its schools, users and
          settings.
        </p>
      </div>
      <TenantTable tenants={tenants} />
    </div>
  )
}
