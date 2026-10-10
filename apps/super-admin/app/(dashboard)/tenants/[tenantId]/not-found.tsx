import Link from 'next/link'

/**
 * The 404 for this group.
 *
 * Says "no such tenant" rather than "not found", because the overwhelmingly common
 * cause is a stale tenant id and an operator needs to know which of the two it is:
 * a typo in a URL, or a tenant that no longer exists.
 */
export default function NotFound() {
  return (
    <div className="rounded-md border border-border bg-card p-8">
      <h1 className="text-lg font-semibold">No such tenant</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Nothing on this platform has that id. The roster lists every tenant that does.
      </p>
      <Link
        href="/tenants"
        className="mt-4 inline-block rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        Back to tenants
      </Link>
    </div>
  )
}
