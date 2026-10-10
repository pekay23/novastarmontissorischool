import { Suspense } from 'react'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { isUserSecurityAdmin } from '@/lib/constants/platform-roles'
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Badge, Skeleton } from '@novastar/shared-ui'
import { Search, Filter, RefreshCw } from 'lucide-react'

interface AuditLog {
  id: string
  userId: string | null
  user: { id: string; name: string | null; email: string | null; role: { name: string } | null } | null
  action: string
  entity: string
  entityId: string | null
  description: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  previousHash: string | null
  hash: string | null
}

async function fetchAuditLogs(
  tenantId: string,
  searchParams: {
    limit?: string
    offset?: string
    action?: string
    entity?: string
    userId?: string
  }
): Promise<{ logs: AuditLog[]; total: number }> {
  // Clamped: an unclamped `?offset=-5` reaches Prisma `skip` and surfaces as
  // a 500 on the administrator's own page.
  const limit = Math.min(Math.max(Number(searchParams.limit) || 50, 1), 200)
  const offset = Math.max(Number(searchParams.offset) || 0, 0)

  const where: Prisma.AuditLogWhereInput = {
    // Tenant scope is not optional here — this is a server component querying
    // Prisma directly, so the API route's scoping does not cover it.
    tenantId,
    ...(searchParams.action && { action: searchParams.action }),
    ...(searchParams.entity && { entity: searchParams.entity }),
    ...(searchParams.userId && { userId: searchParams.userId }),
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, role: { select: { name: true } } } },
      },
    }),
    prisma.auditLog.count({ where }),
  ])

  return {
    logs: logs.map((log) => ({
      id: log.id,
      userId: log.userId,
      user: log.user
        ? {
            id: log.user.id,
            name: log.user.name,
            email: log.user.email,
            role: log.user.role,
          }
        : null,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      description: log.description,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt.toISOString(),
      previousHash: log.previousHash,
      hash: log.hash,
    })),
    total,
  }
}

// Distinct actions for filter dropdown
const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'PASSWORD_CHANGED',
  'PASSKEY_REGISTERED',
  'PASSKEY_LOGIN',
  'TWO_FACTOR_ENABLED',
  'TWO_FACTOR_DISABLED',
  'CREATE',
  'UPDATE',
  'DELETE',
  'PAYMENT_APPROVE',
  'PAYMENT_REJECT',
  'USER_ROLE_CHANGED',
  'USER_SUSPENDED',
  'USER_REACTIVATED',
]

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const resolvedParams = await searchParams
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(resolvedParams)) {
    if (typeof value === 'string') params[key] = value
  }

  // Resolves the session against the database rather than trusting the JWT,
  // and yields the tenantId that scopes the query below.
  const ctx = await getCachedSessionAndTenant()

  if (!isUserSecurityAdmin(ctx.role)) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground mt-2">
          You do not have permission to view audit logs.
        </p>
      </div>
    )
  }

  const { logs, total } = await fetchAuditLogs(ctx.tenantId, params)
  const limit = Math.min(Math.max(Number(resolvedParams.limit) || 50, 1), 200)
  const offset = Math.max(Number(resolvedParams.offset) || 0, 0)
  const hasMore = offset + limit < total

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Audit Logs</h1>
          <p className="text-muted-foreground">
            {total} entries — showing {limit} per page
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="/portal/settings/audit-logs"><RefreshCw className="h-4 w-4 mr-2" />Refresh</a>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium mb-1">Search by User ID</label>
          <Input
            type="text"
            name="userId"
            placeholder="User ID..."
            defaultValue={params.userId}
          />
        </div>
        <Select name="action" defaultValue={params.action || ''}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All actions</SelectItem>
            {AUDIT_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" form="audit-filters" size="sm">
          <Search className="h-4 w-4 mr-2" />Apply
        </Button>
        {params.action && (
          <Button asChild variant="ghost" size="sm">
            <a href="/portal/settings/audit-logs">
              <Filter className="h-4 w-4 mr-2" />Clear
            </a>
          </Button>
        )}
      </div>

      <Suspense key={JSON.stringify(params)} fallback={<Skeleton className="h-[400px] w-full" />}>
        <AuditLogTable logs={logs} />
      </Suspense>

      {/* Pagination */}
      {(hasMore || offset > 0) && (
        <div className="flex justify-center gap-2">
          {offset > 0 && (
            <Button asChild variant="outline" size="sm">
              <a href={`/settings/audit-logs?limit=${limit}&offset=${Math.max(0, offset - limit)}`}>
                Previous
              </a>
            </Button>
          )}
          {hasMore && (
            <Button asChild variant="outline" size="sm">
              <a href={`/settings/audit-logs?limit=${limit}&offset=${offset + limit}`}>
                Next
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

async function AuditLogTable({ logs }: { logs: AuditLog[] }) {
  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No audit log entries found.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-3 text-sm font-medium">Timestamp</th>
            <th className="text-left py-2 px-3 text-sm font-medium">Action</th>
            <th className="text-left py-2 px-3 text-sm font-medium">Entity</th>
            <th className="text-left py-2 px-3 text-sm font-medium">User</th>
            <th className="text-left py-2 px-3 text-sm font-medium">Description</th>
            <th className="text-left py-2 px-3 text-sm font-medium">IP</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b">
              <td className="py-2 px-3 text-sm text-muted-foreground">
                {new Date(log.createdAt).toLocaleString()}
              </td>
              <td className="py-2 px-3">
                <Badge variant="secondary">{log.action}</Badge>
              </td>
              <td className="py-2 px-3 text-sm">{log.entity}</td>
              <td className="py-2 px-3 text-sm">
                {log.user ? `${log.user.name || log.user.email || 'Unknown'} (${log.user.role?.name || '?'})` : '—'}
              </td>
              <td className="py-2 px-3 text-sm">{log.description || '—'}</td>
              <td className="py-2 px-3 text-sm font-mono">{log.ipAddress || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
