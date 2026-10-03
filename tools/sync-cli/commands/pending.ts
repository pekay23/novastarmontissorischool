/**
 * `pending` — what is queued for this tenant and has not gone out yet.
 * Read-only.
 */
import { flagNumber, resolveConfig, scopeToSchool, type CommandContext } from '../config'
import type { SyncRecord } from '@novastar/shared-types'

function project(record: SyncRecord): Record<string, unknown> {
  return {
    id: record.id,
    table: record.table,
    recordId: record.recordId,
    operation: record.operation,
    status: record.syncStatus,
    queuedAt: record.timestamp.toISOString(),
    attempts: record.retryCount,
  }
}

export async function run(ctx: CommandContext): Promise<number> {
  const config = resolveConfig(ctx.flags, ctx.env)
  const store = await ctx.createStore(config.tenantId)
  const limit = flagNumber(ctx.flags, 'limit') ?? config.batchSize

  const queued = scopeToSchool(await store.getPending(config.tenantId, limit), config.schoolId)

  ctx.out.data(ctx.out.format === 'json' ? queued : queued.map(project))
  ctx.out.note(
    queued.length === 0
      ? `No pending changes for ${config.tenantId}.`
      : `${queued.length} pending change(s) for ${config.tenantId}${config.schoolId ? ` / school ${config.schoolId}` : ''}.`,
  )
  ctx.out.finish()
  return 0
}