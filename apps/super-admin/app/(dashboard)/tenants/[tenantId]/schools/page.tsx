import { requireCapabilityPage, requireExistingTenant } from '@/lib/admin-context'
import { hasOperatorCapability } from '@/lib/permissions'
import { listSchoolsForTenant } from '@/lib/queries'
import { SchoolList } from '@/components/school-list'
import { SchoolForm } from '@/components/school-form'
import { TenantSuspendedNotice } from '@/components/tenant-suspended-notice'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: 'Schools' }
}

export default async function TenantSchoolsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const context = await requireCapabilityPage('tenant:read')
  const { tenantId } = await params
  const resolved = await requireExistingTenant(tenantId)

  if (resolved.status === 'suspended') {
    return (
      <TenantSuspendedNotice
        tenantId={resolved.identity.id}
        tenantCode={resolved.identity.code}
        canUpdate={hasOperatorCapability(context.operator.capabilities, 'tenant:update')}
      />
    )
  }

  const { tenant } = resolved
  const schools = await listSchoolsForTenant(tenant.id)
  const canCreate = hasOperatorCapability(context.operator.capabilities, 'tenant:school:create')
  const canUpdate = hasOperatorCapability(context.operator.capabilities, 'tenant:school:update')
  const canDelete = hasOperatorCapability(context.operator.capabilities, 'tenant:school:delete')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Schools in {tenant.name}</h1>
        <p className="text-sm text-muted-foreground">
          Scoped to <code className="font-mono">{tenant.code}</code>. A school belonging to another
          tenant cannot appear here.
        </p>
      </div>
      <SchoolList
        schools={schools}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        tenantId={tenant.id}
      />
    </div>
  )
}
