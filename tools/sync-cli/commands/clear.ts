/**
 * `clear` — deletes a tenant's queued changes.
 *
 * This destroys unsynced local work. There is no undo and no copy, so it is
 * guarded three ways:
 *   - the tenant must be named explicitly with `--tenant`; `TENANT_ID` is not a
 *     fallback, because the whole point is to name what you are about to lose;
 *   - the row count, and how many of those rows are unsynced, is printed before
 *     anything is asked, on stderr, so it survives `--quiet`;
 *   - nothing is deleted without `--yes`.
 */
import {
  flagBoolean,
  flagString,
  redact,
  requireTenantIdFlag,
  resolveDatabaseUrl,
  type CommandContext,
} from '../config'

export async function run(ctx: CommandContext): Promise<number> {
  // Resolved first so a missing DATABASE_URL fails before anything says a word
  // about deleting rows.
  const databaseUrl = redact(resolveDatabaseUrl(ctx.env))
  const tenantId = requireTenantIdFlag(flagString(ctx.flags, 'tenant'), '--tenant')

  const store = await ctx.createStore(tenantId)
  const rows = await store.count(tenantId)
  const pending = await store.count(tenantId, 'pending')
  const oldest = await store.oldestPendingAt(tenantId)

  // Stated before the question, on stderr, so --quiet cannot hide it.
  ctx.out.warn(
    `About to permanently delete ${rows} sync-queue row(s) for tenant ${tenantId}, ` +
      `including ${pending} unsynced change(s)` +
      (oldest ? `, oldest queued ${oldest.toISOString()}` : '') +
      '. This cannot be undone.',
  )

  if (!flagBoolean(ctx.flags, 'yes')) {
    ctx.out.error(`Refusing to clear ${rows} row(s) for ${tenantId} without --yes. Nothing was deleted.`)
    return 1
  }

  await store.clear(tenantId)
  const remaining = await store.count(tenantId)
  ctx.out.data({ tenantId, deleted: rows, remaining, databaseUrl })
  ctx.out.finish()
  return remaining === 0 ? 0 : 1
}