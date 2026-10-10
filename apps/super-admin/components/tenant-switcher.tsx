'use client'

import { useRouter } from 'next/navigation'

/**
 * Picks the tenant every page below it is about.
 *
 * Writes the `super_admin_tenant` cookie, which is `httpOnly: false` on purpose —
 * a server component cannot set a cookie, so a client component is the only place
 * this can happen without adding an API route that exists solely to set a
 * preference.
 *
 * That is safe because the cookie is a hint and nothing more. It is never used to
 * widen a query: `requireTenantScope` re-reads the tenant by id and 404s on a
 * miss, so the worst a forged value achieves is a page saying "no such tenant".
 * The cookie is therefore not a credential and is not treated as one — see
 * `adminTenantCookieOptions`.
 */
export function TenantSwitcher({
  tenants,
  selectedTenantId,
}: {
  tenants: ReadonlyArray<{ id: string; name: string; code: string }>
  selectedTenantId: string | null
}) {
  const router = useRouter()

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value
    if (next === '') {
      document.cookie = 'super_admin_tenant=; Path=/admin; Max-Age=0; SameSite=Lax'
      router.push('/tenants')
      router.refresh()
      return
    }
    document.cookie =
      `super_admin_tenant=${encodeURIComponent(next)}; Path=/admin; Max-Age=86400; SameSite=Lax` +
      (window.location.protocol === 'https:' ? '; Secure' : '')
    router.push(`/tenants/${encodeURIComponent(next)}`)
    router.refresh()
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium">Tenant</span>
      <select
        value={selectedTenantId ?? ''}
        onChange={onChange}
        className="h-9 min-w-56 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">All tenants</option>
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name} ({tenant.code})
          </option>
        ))}
      </select>
    </label>
  )
}
