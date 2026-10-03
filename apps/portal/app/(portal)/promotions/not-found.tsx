import Link from 'next/link'

/**
 * Reached when the promotions route is addressed with a segment that is not
 * this screen — there is no per-promotion detail view, because a promotion
 * is a command, not a record: its history lives in `Enrollment`, one row per
 * student per term.
 */
export default function PromotionsNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md text-center">
        <p className="mb-2 text-xs font-black uppercase tracking-widest text-primary">
          404 · Promotions
        </p>
        <h2 className="mb-2 text-2xl font-black text-foreground">Page not found</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          The promotions page you tried to access does not exist.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-md bg-primary px-6 py-3 text-xs font-bold uppercase text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}