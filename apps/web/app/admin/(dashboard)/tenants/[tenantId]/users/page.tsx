import { getEffectivePermissions } from '@novastar/auth'
import { PLATFORM_ROLE_NAMES } from '@novastar/shared-types'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@novastar/shared-ui'
import { requireCapabilityPage, requireExistingTenant } from '@/lib/admin-context'
import { hasOperatorCapability } from '@/lib/permissions'
import { listSchoolsForTenant, listUsersForTenant } from '@/lib/queries'
import { CreateUserForm } from '@/components/create-user-form'
import { UserActions } from '@/components/user-actions'
import { TenantSuspendedNotice } from '@/components/tenant-suspended-notice'
import type { TenantUserSummary } from '@/types/admin'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Users' }

export default async function TenantUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>
  searchParams: Promise<{ userId?: string }>
}) {
  const context = await requireCapabilityPage('tenant:user:read')
  const { tenantId } = await params
  const { userId } = await searchParams
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
  const users = await listUsersForTenant(tenant.id)

  const canCreate = context.operator.capabilities.some((c) => c === 'tenant:user:create')
  const canUpdate = context.operator.capabilities.some((c) => c === 'tenant:user:update')
  const schools = canCreate ? await listSchoolsForTenant(tenant.id) : []

  const selected = userId ? users.find((user) => user.id === userId) : undefined
  const effective =
    selected && selected.schoolId
      ? await getEffectivePermissions(selected.id, tenant.id, selected.schoolId)
      : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Users in {tenant.name}</h1>
        <p className="text-sm text-muted-foreground">
          Scoped to <code className="font-mono">{tenant.code}</code>. Credentials are never selected
          into this page.
        </p>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="text-sm font-medium">Create an account</h2>
        <p className="text-sm text-muted-foreground">
          For someone joining a school in this tenant. The account is created with no password and
          a one-time setup link, which expires in 24 hours and can be used once. No password is
          ever typed here, generated or emailed.
        </p>
        <CreateUserForm
          tenantId={tenant.id}
          schools={schools.map((school) => ({ id: school.id, name: school.name }))}
          roleNames={PLATFORM_ROLE_NAMES}
          disabledReason={
            canCreate
              ? undefined
              : 'This operator cannot create accounts in a tenant. It needs tenant:user:create.'
          }
        />
      </div>

      {selected ? (
        <EffectivePermissionsCard user={selected} granted={effective ? [...effective] : null} />
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-mono text-xs">{user.email}</TableCell>
                <TableCell>{user.name ?? '—'}</TableCell>
                <TableCell className="text-xs">{user.roleName ?? '—'}</TableCell>
                <TableCell className="text-xs">
                  {user.status}
                  {user.mustChangePassword ? ' · must change password' : ''}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {user.lastLoginAt ? user.lastLoginAt.replace('T', ' ').slice(0, 16) : 'never'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <a
                      className="text-xs hover:underline"
                      href={`/tenants/${tenant.id}/users?userId=${user.id}`}
                    >
                      Effective permissions
                    </a>
                    {canUpdate ? (
                      <UserActions user={user} tenantId={tenant.id} schools={schools.map((school) => ({ id: school.id, name: school.name }))} />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function EffectivePermissionsCard({
  user,
  granted,
}: {
  user: TenantUserSummary
  granted: string[] | null
}) {
  return (
    <div className="rounded-md border p-4">
      <h3 className="text-sm font-medium">Effective permissions for {user.email}</h3>
      <p className="text-sm text-muted-foreground">
        Resolved by <code className="font-mono">getEffectivePermissions</code> from
        <code className="font-mono"> @novastar/auth</code> — this user&rsquo;s role plus any
        active delegation, matched with wildcard rules. Scoped to this tenant, so a user id from
        another tenant resolves to nothing.
      </p>
      <div className="mt-2">
        {granted === null ? (
          <p className="text-sm text-muted-foreground">
            This user has no school, so their permissions cannot be resolved. Grants are only
            computed within a school scope.
          </p>
        ) : granted.length === 0 ? (
          <p className="text-sm text-muted-foreground">This user holds no permissions.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {granted.map((key) => (
              <li
                key={key}
                className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px]"
              >
                {key}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
