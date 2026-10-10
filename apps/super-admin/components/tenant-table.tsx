import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@novastar/shared-ui'
import { TenantStatusBadge } from '@/components/tenant-status-badge'
import type { TenantSummary } from '@/types/admin'

/**
 * The fleet roster.
 *
 * Renders exactly `TenantSummary` and nothing else, so a field cannot appear here
 * by accident — adding one means adding it to the projection in `lib/queries.ts`
 * first, where the query and this table are reviewed together.
 */
export function TenantTable({ tenants }: { tenants: readonly TenantSummary[] }) {
  if (tenants.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No tenants yet. Provision one with <code className="font-mono">POST /api/tenants</code> or
        with <code className="font-mono">novastar-tenant create</code>.
      </p>
    )
  }

  return (
    <Table>
      <TableCaption>
        Every tenant on the platform. {tenants.length} total.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Tenant</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Domain</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Schools</TableHead>
          <TableHead className="text-right">Users</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tenants.map((tenant) => (
          <TableRow key={tenant.id}>
            <TableCell className="font-medium">
              <Link className="hover:underline" href={`/tenants/${tenant.id}`}>
                {tenant.name}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-xs">{tenant.code}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {tenant.domain ?? '—'}
            </TableCell>
            <TableCell>
              <TenantStatusBadge isActive={tenant.isActive} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{tenant.schoolCount}</TableCell>
            <TableCell className="text-right tabular-nums">{tenant.userCount}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {tenant.createdAt.slice(0, 10)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
