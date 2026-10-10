import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@novastar/shared-ui'
import type { AuditEntrySummary } from '@/types/admin'

/**
 * A page of audit entries.
 *
 * Shows the tenant column, because a cross-tenant trail without it is unreadable —
 * but shows the id, not the tenant's name, because resolving each row's tenant
 * would mean a lookup per entry and this table can hold 100 of them. The tenant
 * detail page is one click away.
 *
 * The operator column is the same trade one level up: the id, not a joined name.
 * Every entry this console writes carries one, so a row showing `—` is either a
 * tenant action or an entry written before per-operator accounts existed — and an
 * auditor can tell those two apart by whether the tenant column says `platform`.
 *
 * `description` is rendered as text. It is a `String` column, so there is nothing
 * to inject, but the component deliberately does not use `dangerouslySetInnerHTML`
 * and a future caller must not add it.
 */
export function AuditLogTable({
  entries,
  total,
  showTenant,
}: {
  entries: readonly AuditEntrySummary[]
  total: number
  showTenant: boolean
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No audit entries match this window.
      </p>
    )
  }

  return (
    <Table>
      <TableCaption>
        {entries.length} of {total} {total === 1 ? 'entry' : 'entries'}, newest first.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          {showTenant ? <TableHead>Tenant</TableHead> : null}
          <TableHead>Operator</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Entity</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="whitespace-nowrap text-xs tabular-nums">
              {entry.createdAt.replace('T', ' ').slice(0, 19)}
            </TableCell>
            {showTenant ? (
              <TableCell className="font-mono text-xs">{entry.tenantId}</TableCell>
            ) : null}
            <TableCell className="font-mono text-xs">{entry.operatorId ?? '—'}</TableCell>
            <TableCell className="font-mono text-xs">{entry.action}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {entry.entity}
              {entry.entityId ? ` · ${entry.entityId}` : ''}
            </TableCell>
            <TableCell className="text-xs">{entry.description ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
