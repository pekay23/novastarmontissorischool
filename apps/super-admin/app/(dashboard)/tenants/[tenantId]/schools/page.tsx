import { requireCapabilityPage, requireTenantScope } from '@/lib/admin-context'
import { listSchoolsForTenant } from '@/lib/queries'
import { SchoolList } from '@/components/school-list'

/**
 * `/tenants/:tenantId/schools` — this tenant's schools.
 *
 * One query, `where: { tenantId }`. There is no way for the URL's tenant and the
 * query's tenant to disagree, because the query's tenant *is* the URL's tenant,
 * re-read from the database.
 */
export const dynamic = 'force-dynamic'

// No tenant in the title. Resolving the code needs the scoped read that belongs
// to the page below, and a raw cuid in a tab title tells an operator nothing.
export async function generateMetadata() {
  return { title: 'Schools' }
}

export default async function TenantSchoolsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  await requireCapabilityPage('tenant:read')
  const { tenantId } = await params
  const tenant = await requireTenantScope(tenantId)
  const schools = await listSchoolsForTenant(tenant.id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Schools in {tenant.name}</h1>
        <p className="text-sm text-muted-foreground">
          Scoped to <code className="font-mono">{tenant.code}</code>. A school belonging to another
          tenant cannot appear here.
        </p>
      </div>
      <SchoolList schools={schools} />
    </div>
  )
}
