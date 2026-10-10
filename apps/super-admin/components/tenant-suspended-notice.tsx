import Link from 'next/link'
import { TenantActions } from '@/components/tenant-actions'

/**
 * What a drill-down page shows when the tenant it names is suspended.
 *
 * WHY A PAGE RENDERS THIS INSTEAD OF REFUSING
 * --------------------------------------------
 * `requireTenantScope` — the gate every drill-down *route* passes through — throws
 * `TenantSuspendedError` for a suspended tenant, and that is the right answer for an
 * API: HTTP 403 with the code `tenant-suspended`. A server component cannot render a
 * 403, and the next thing it would do is throw into `error.tsx`, which answers every
 * fault with the same "Something failed on this page". An operator who suspended a
 * school twenty minutes ago and clicked back into it would be told the console broke.
 *
 * The pages therefore resolve the tenant, refuse to read its data, and render this.
 * Nothing tenant-scoped is fetched: the panel takes the tenant's code and id, both of
 * which the roster already displays, and no school, user, audit row or setting.
 *
 * It also hosts the console's only "Reactivate tenant" control, which is the reason it
 * exists at all. `TenantActions` is rendered here with `isActive={false}`, so a
 * suspended tenant can be brought back from any drill-down page — and since
 * `setTenantActive` is deliberately the one write in `lib/queries.ts` that is not
 * gated on `isActive`, that button is the recovery path rather than another dead end.
 *
 * `canUpdate` is passed rather than derived: the page already holds the operator's
 * capabilities for its own capability check, and `TenantActions` already knows how to
 * say "this operator cannot change tenant state" when it is false.
 */
export function TenantSuspendedNotice({
  tenantId,
  tenantCode,
  canUpdate,
}: {
  tenantId: string
  tenantCode: string
  canUpdate: boolean
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-card p-8">
        <h1 className="text-lg font-semibold">This tenant is suspended</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <code className="font-mono">{tenantCode}</code> has been switched off, so its schools,
          accounts, settings and audit trail are not readable and cannot be changed from
          the console. Nothing was deleted and every row is still there. Reactivate it to
          carry on.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <TenantActions
            tenantId={tenantId}
            tenantCode={tenantCode}
            isActive={false}
            canUpdate={canUpdate}
          />
          <Link
            href="/tenants"
            className="inline-block rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Back to tenants
          </Link>
        </div>
      </div>
    </div>
  )
}
