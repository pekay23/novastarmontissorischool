import Link from 'next/link'
import { requireCapabilityPage } from '@/lib/admin-context'
import { parsePagination } from '@/lib/http'
import { auditAcrossPlatform } from '@/lib/queries'
import { AuditLogTable } from '@/components/audit-log-table'

/**
 * `/audit` — the cross-tenant audit trail.
 *
 * Behind `platform:audit`, and its query is one of the four deliberate
 * cross-tenant reads: a platform audit page whose point is to span tenants cannot
 * be scoped to one. The scoped counterpart is the "Recent activity" table on a
 * tenant's own page.
 *
 * A suspended tenant's entries are withheld, so the heading above cannot claim to
 * show "every entry" — and the page says how many it left out rather than letting
 * the gap read as an absence of activity.
 */
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Audit' }

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ take?: string; skip?: string }>
}) {
  await requireCapabilityPage('platform:audit')
  const { take, skip } = await searchParams
  // Rebuilt rather than read off the incoming request so the values go through
  // exactly the same schema the API route uses. A hand-typed `?take=999999` is the
  // default page, not an error page and not a full table scan.
  const query = parsePagination(
    `http://internal/audit?take=${encodeURIComponent(take ?? '')}&skip=${encodeURIComponent(skip ?? '')}`,
  )

  const audit = await auditAcrossPlatform(query)
  const withheld = audit.meta.excludedSuspendedEntries
  const page = Math.floor(query.skip / query.take) + 1
  const pages = Math.max(1, Math.ceil(audit.meta.total / query.take))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Platform audit trail</h1>
        <p className="text-sm text-muted-foreground">
          Every entry on the platform whose tenant is switched on, newest first. Entries are
          hash-chained: each one hashes its predecessor, so a deleted or edited row breaks the
          chain.
        </p>
      </div>

      {withheld > 0 ? (
        // Stated rather than implied. An operator who cannot see a suspended school's
        // entries has to be told they were withheld, or the gap reads as "nothing
        // happened" — which is the one conclusion the audit trail must never support.
        <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          {withheld} {withheld === 1 ? 'entry is' : 'entries are'} withheld because{' '}
          {withheld === 1 ? 'a tenant is' : 'tenants are'} suspended. Nothing was deleted —
          they return as soon as the tenant is reactivated. The tenant list shows which.
        </p>
      ) : null}

      <AuditLogTable entries={audit.data} total={audit.meta.total} showTenant />

      <nav className="flex items-center gap-3 text-xs">
        {page > 1 ? (
          <Link
            className="rounded border border-border px-2 py-1 hover:bg-accent"
            href={`/audit?take=${query.take}&skip=${query.skip - query.take}`}
          >
            Newer
          </Link>
        ) : null}
        <span className="tabular-nums text-muted-foreground">
          Page {page} of {pages}
        </span>
        {audit.meta.hasMore ? (
          <Link
            className="rounded border border-border px-2 py-1 hover:bg-accent"
            href={`/audit?take=${query.take}&skip=${query.skip + query.take}`}
          >
            Older
          </Link>
        ) : null}
      </nav>
    </div>
  )
}
