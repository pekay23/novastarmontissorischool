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
// Imported after the local modules on purpose. `@novastar/auth` reaches the same
// Prisma singleton as `@/lib/prisma`, and the database connection string is
// aliased by a side effect in that module; ES module initialisation runs imports in
// declaration order, so the alias has to be established first.
import { getEffectivePermissions } from '@novastar/auth'
import { PLATFORM_ROLE_NAMES } from '@novastar/shared-types'
import { CreateUserForm } from '@/components/create-user-form'
import { operatorCan, requireCapabilityPage, requireTenantScope } from '@/lib/admin-context'
import { listSchoolsForTenant, listUsersForTenant } from '@/lib/queries'
import type { TenantUserSummary } from '@/types/admin'

/**
 * `/tenants/:tenantId/users` — this tenant's user directory, and the only place in
 * the console an account can be created.
 *
 * The projection in `TENANT_USER_SELECT` is the boundary that matters here: it
 * does not contain `passwordHash`, `twoFactorSecret`, `passkeyBridgeToken` or
 * `verifyToken`, so no code path from this page can put a credential in a
 * response. A control plane needs to see who holds which role and can switch an
 * account off; it has no reason to read a secret, and the more it returns the more
 * a single injection here costs.
 *
 * `tenant:user:read` opens the page; `tenant:user:create` is what the form needs, and
 * the two are separate so the form's absence does not also hide the directory.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: 'Users' }
}

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
  const tenant = await requireTenantScope(tenantId)
  const users = await listUsersForTenant(tenant.id)

  // The form needs two lists the directory does not carry: the schools an account can
  // be attached to, and the role names a request may ask for. Both are tenant-scoped
  // reads, and the schools one only runs when the operator may actually create
  // something.
  const canCreate = operatorCan(context, 'tenant:user:create')
  const schools = canCreate ? await listSchoolsForTenant(tenant.id) : []

  // `getEffectivePermissions` scopes itself on `{ id: userId, tenantId }`, so a
  // `userId` belonging to another tenant resolves to an empty set rather than to
  // that tenant's grants. Passing `tenant.id` — never a tenant read from the URL
  // or the query string — is what makes that hold.
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create an account</CardTitle>
          <CardDescription>
            For someone joining a school in this tenant. The account is created with no password and
            a one-time setup link, which expires in 24 hours and can be used once. No password is
            ever typed here, generated or emailed.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {selected ? (
        <EffectivePermissionsCard user={selected} granted={effective ? [...effective] : null} />
      ) : null}

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
                <a
                  className="text-xs hover:underline"
                  href={`/tenants/${tenant.id}/users?userId=${user.id}`}
                >
                  Effective permissions
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * A tenant user's effective grants, from `@novastar/auth`.
 *
 * `null` means "not computed", which is a different state from "computed and
 * empty": a user with no school is not in a delegation's scope, so their grants are
 * genuinely unknown rather than none, and rendering them as an empty list would
 * tell an operator their account has no permissions when nobody checked.
 */
function EffectivePermissionsCard({
  user,
  granted,
}: {
  user: TenantUserSummary
  granted: string[] | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Effective permissions for {user.email}</CardTitle>
        <CardDescription>
          Resolved by <code className="font-mono">getEffectivePermissions</code> from
          <code className="font-mono"> @novastar/auth</code> — this user&rsquo;s role plus any
          active delegation, matched with wildcard rules. Scoped to this tenant, so a user id from
          another tenant resolves to nothing.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  )
}
