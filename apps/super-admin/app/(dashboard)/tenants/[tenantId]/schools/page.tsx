import { requireCapabilityPage, requireExistingTenant } from '@/lib/admin-context'
import { hasOperatorCapability } from '@/lib/permissions'
import { listSchoolsForTenant } from '@/lib/queries'
import { SchoolList } from '@/components/school-list'
import { TenantSuspendedNotice } from '@/components/tenant-suspended-notice'

/**
 * `/tenants/:tenantId/schools` — this tenant's schools.
 *
 * One query, `where: { tenantId }`. There is no way for the URL's tenant and the
 * query's tenant to disagree, because the query's tenant *is* the URL's tenant,
 * re-read from the database.
 *
 * A suspended tenant renders `TenantSuspendedNotice` and the branch returns before
 * `listSchoolsForTenant` runs, so no school row is fetched. That query refuses a
 * suspended tenant as well — the page check is what lets the refusal read as an
 * answer rather than as the console's generic fault page.
 *
 * The check is not a convention here. `requireExistingTenant` returns a
 * discriminated union whose suspended arm carries only `identity` (id and code), so
 * `resolved.tenant` does not typecheck until `status === 'suspended'` has been
 * answered, and the identifier `listSchoolsForTenant` needs is not in scope until
 * then either. Deleting the branch below is a compile error, not a leak.
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
