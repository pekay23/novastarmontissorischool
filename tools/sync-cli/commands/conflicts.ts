/**
 * `conflicts` — records the remote rejected as divergent and that nobody has
 * resolved yet. Read-only.
 */
import { flagNumber, resolveConfig, scopeToSchool, type CommandContext } from '../config'
import type { SyncRecord } from '@novastar/shared-types'

function project(record: SyncRecord): Record<string, unknown> {
  return {
    id: record.id,
    table: record.table,
    recordId: record.recordId,
    operation: record.operation,
    queuedAt: record.timestamp.toISOString(),
    attempts: record.retryCount,
  }
}

export async function run(ctx: CommandContext): Promise<number> {
  const config = resolveConfig(ctx.flags, ctx.env)
  const store = await ctx.createStore(config.tenantId)
  const limit = flagNumber(ctx.flags, 'limit') ?? config.batchSize

  const conflicting = scopeToSchool(
    await store.listByStatus(config.tenantId, 'conflict', limit),
    config.schoolId,
  )

  ctx.out.data(ctx.out.format === 'json' ? conflicting : conflicting.map(project))
  ctx.out.note(
    conflicting.length === 0
      ? `No unresolved conflicts for ${config.tenantId}.`
      : `${conflicting.length} unresolved conflict(s) for ${config.tenantId}. ` +
          'Resolve with: resolve --strategy last-write-wins|merge|ask-user',
  )
  ctx.out.finish()
  return conflicting.length === 0 ? 0 : 1
}