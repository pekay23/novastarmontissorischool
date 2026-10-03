/**
 * `sync` — a full pass: pull the remote's changes, then push the queue.
 *
 * `push` and `pull` are the same runner with a direction, so the batch size,
 * retry policy, tenant scope and strategy cannot drift apart between them.
 */
import {
  buildEngine,
  requireStrategy,
  resolveConfig,
  scopeToSchool,
  type CommandContext,
} from '../config'
import type { SyncDirection } from '@novastar/sync-engine'
import type { SyncRecord } from '@novastar/shared-types'

export async function run(ctx: CommandContext): Promise<number> {
  return runDirection(ctx, 'full')
}

export async function runDirection(ctx: CommandContext, direction: SyncDirection): Promise<number> {
  const config = resolveConfig(ctx.flags, ctx.env)
  // A sync can resolve a conflict destructively, so the strategy is required
  // rather than defaulted.
  const strategy = requireStrategy(ctx.flags, ctx.env)

  const engine = await buildEngine(ctx, config, strategy, config.tenantId)
  const remote = ctx.createRemote(ctx.env)

  const result = await engine.sync(remote, config.tenantId, {
    direction,
    filter: config.schoolId
      ? (record: SyncRecord) => scopeToSchool([record], config.schoolId).length === 1
      : undefined,
    onProgress: (progress) => ctx.out.note(`  progress ${(progress * 100).toFixed(0)}%`),
  })

  ctx.out.data({ ...result, strategy, direction })
  ctx.out.finish()
  return result.failed > 0 ? 1 : 0
}