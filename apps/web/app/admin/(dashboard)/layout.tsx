import type { ReactNode } from 'react'
import Link from 'next/link'
import { Alert, AlertDescription, AlertTitle, Badge } from '@novastar/shared-ui'
import { requireOperatorPage } from '@/lib/admin-context'
import { PLATFORM_NAV, tenantTabs, visibleNav } from '@/lib/admin-navigation'
import { hasOperatorCapability } from '@/lib/permissions'
import { listTenantsAcrossPlatform } from '@/lib/queries'
import { SignOutButton } from '@/components/sign-out-button'
import { TenantSwitcher } from '@/components/tenant-switcher'

/**
 * The operator shell, and the gate for everything under it.
 *
 * `requireOperatorPage()` runs here rather than in each page, so a new page added
 * under this group is protected by construction: it is inside the layout, and there
 * is no way to render it without passing through. Each page still asserts the
 * capability it needs, because the layout proves *who* the caller is and the page
 * decides *what they may do* — a shell that authenticated everyone would render
 * nav for a read-only operator that links to pages returning 403.
 */
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const context = await requireOperatorPage()
  const granted = context.operator.capabilities

  // The switcher lists every tenant, so this is one of the four cross-tenant
  // reads. It is here rather than passed down because every drill-down page wants
  // it and none of them should query for it again.
  const tenants = hasOperatorCapability(granted, 'tenant:read')
    ? await listTenantsAcrossPlatform()
    : []

  const selected = context.selectedTenantId
  // The CLI sets this on every account it creates. There is no in-console page that
  // changes it yet, so the banner is the only thing that can act on it — announcing
  // it beats carrying the flag silently and rendering a console that looks ready.
  const mustChangePassword = context.operator.mustChangePassword

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <Link href="/admin/" className="text-sm font-semibold">
              Novastar Platform Console
            </Link>
            <Badge variant="outline" className="font-normal">
              cross-tenant
            </Badge>
          </div>
          <TenantSwitcher tenants={tenants} selectedTenantId={selected} />
          <div className="flex items-center gap-3">
            {/* Username, not address: an operator recognises a short stable handle as their own,
                and the address is what the CLI keys the account on, not what they
                read their own header to check. */}
            <span className="text-xs text-muted-foreground">{context.operator.username}</span>
            <SignOutButton />
          </div>
        </div>

        <nav className="mx-auto max-w-7xl px-6">
          <ul className="flex gap-1 pb-2">
            {visibleNav(PLATFORM_NAV, granted, hasOperatorCapability).map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={item.description}
                  className="rounded-t-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {mustChangePassword ? (
          <Alert variant="destructive">
            <AlertTitle>Password change required</AlertTitle>
            <AlertDescription>
              This account was created with a password someone else chose. Change it with
              {' '}
              <code>novastar-tenant operator --rotate --username {context.operator.username}</code>{' '}
              before treating anything on this console as final.
            </AlertDescription>
          </Alert>
        ) : null}
        {selected ? (
          <nav aria-label="This tenant">
            <ul className="flex flex-wrap gap-1 rounded-md border border-border bg-card px-2 py-1.5">
              {visibleNav(tenantTabs(selected), granted, hasOperatorCapability).map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={item.description}
                    className="rounded px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {children}
      </main>

      <footer className="mx-auto max-w-7xl px-6 pb-8 text-xs text-muted-foreground">
        Session expires {new Date(context.operator.expiresAt * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC.
        Every action on this console is recorded against the platform audit trail.
      </footer>
    </div>
  )
}
