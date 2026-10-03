/**
 * `replay` — put failed records back on the queue and, unless `--dry-run`,
 * push them. `retryCount` is the record of what failed, so this is the command
 * that answers "did they ever succeed, or were they just dropped?".
 *
 * Writes: this re-queues local changes. It never deletes them.
 */
import {
  buildEngine,
  flagBoolean,
  flagNumber,
  requireStrategy,
  resolveConfig,
  scopeToSchool,
  type CommandContext,
} from '../config'

export async function run(ctx: CommandContext): Promise<number> {
  const config = resolveConfig(ctx.flags, ctx.env)
  const strategy = requireStrategy(ctx.flags, ctx.env)
  const store = await ctx.createStore(config.tenantId)
  const limit = flagNumber(ctx.flags, 'limit') ?? config.batchSize
  const dryRun = flagBoolean(ctx.flags, 'dry-run')
  const resetRetries = flagBoolean(ctx.flags, 'reset-retries')
  const push = flagBoolean(ctx.flags, 'push')

  const failed = scopeToSchool(await store.listByStatus(config.tenantId, 'failed', limit), config.schoolId)
  if (failed.length === 0) {
    ctx.out.data({ tenantId: config.tenantId, replayed: 0, dryRun, pushed: null })
    ctx.out.note(`No failed records for ${config.tenantId}.`)
    ctx.out.finish()
    return 0
  }

  if (dryRun) {
    ctx.out.data({
      tenantId: config.tenantId,
      replayed: failed.length,
      dryRun: true,
      records: failed.map((r) => ({ id: r.id, table: r.table, recordId: r.recordId, attempts: r.retryCount })),
    })
    ctx.out.note(`${failed.length} failed record(s) would be re-queued for ${config.tenantId}.`)
    ctx.out.finish()
    return 0
  }

  for (const record of failed) {
    await store.put({
      ...record,
      syncStatus: 'pending',
      retryCount: resetRetries ? 0 : record.retryCount,
    })
  }
  ctx.out.note(`Re-queued ${failed.length} failed record(s) for ${config.tenantId}.`)

  let pushed: { synced: number; conflicts: number; failed: number } | null = null
  if (push) {
    const engine = await buildEngine(ctx, config, strategy, config.tenantId)
    const replayIds = new Set(failed.map((record) => record.id))
    const result = await engine.sync(ctx.createRemote(ctx.env), config.tenantId, {
      direction: 'push',
      filter: (record) => replayIds.has(record.id),
    })
    pushed = { synced: result.synced, conflicts: result.conflicts, failed: result.failed }
  }

  ctx.out.data({ tenantId: config.tenantId, replayed: failed.length, dryRun: false, pushed })
  ctx.out.finish()
  return 0
}