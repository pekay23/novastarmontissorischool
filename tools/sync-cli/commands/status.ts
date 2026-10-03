/**
 * `status` — the only command considered safe for CI, and the only one that
 * issues no writes at all. Every statement it runs is a `SELECT`.
 */
import { resolveConfig, type CommandContext } from '../config'

export interface StatusSummary {
  tenantId: string
  schoolId: string | null
  databaseUrl: string
  total: number
  pending: number
  failed: number
  conflicts: number
  synced: number
  oldestPendingAt: string | null
  lastSyncedAt: string | null
  checkedAt: string
}

export async function run(ctx: CommandContext): Promise<number> {
  const config = resolveConfig(ctx.flags, ctx.env)
  const store = await ctx.createStore(config.tenantId)
  const tenantId = config.tenantId

  const summary: StatusSummary = {
    tenantId,
    schoolId: config.schoolId ?? null,
    databaseUrl: config.databaseUrlRedacted,
    total: await store.count(tenantId),
    pending: await store.count(tenantId, 'pending'),
    failed: await store.count(tenantId, 'failed'),
    conflicts: await store.count(tenantId, 'conflict'),
    synced: await store.count(tenantId, 'synced'),
    oldestPendingAt: (await store.oldestPendingAt(tenantId))?.toISOString() ?? null,
    lastSyncedAt: (await store.lastSyncedAt(tenantId))?.toISOString() ?? null,
    checkedAt: ctx.clock().toISOString(),
  }

  ctx.out.data(summary)
  ctx.out.note(
    summary.pending === 0
      ? `Queue is empty for ${tenantId}.`
      : `${summary.pending} pending, ${summary.conflicts} conflicting, ${summary.failed} failed for ${tenantId}.`,
  )
  ctx.out.finish()
  return 0
}