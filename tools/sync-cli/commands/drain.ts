/**
 * `drain` — the cron command. Repeats a full sync until the queue is empty,
 * stops on a record that makes no progress, and always prints a summary.
 *
 * `--max-iterations` is not optional behaviour, it is the stop condition: a
 * queue that never drains (a poison record the remote keeps rejecting) must
 * end the run rather than spin it. A run that stops with work left exits
 * non-zero so cron notices.
 */
import {
  buildEngine,
  DEFAULT_DRAIN_ITERATIONS,
  requireStrategy,
  resolveConfig,
  scopeToSchool,
  type CommandContext,
} from '../config'
import type { SyncRecord } from '@novastar/shared-types'

export type DrainStopReason = 'drained' | 'max-iterations' | 'no-progress' | 'nothing-to-do'

export interface DrainSummary {
  tenantId: string
  iterations: number
  maxIterations: number
  stoppedBy: DrainStopReason
  drained: boolean
  synced: number
  conflicts: number
  failed: number
  pulled: number
  pendingRemaining: number
}

export async function run(ctx: CommandContext): Promise<number> {
  const config = resolveConfig(ctx.flags, ctx.env)
  const strategy = requireStrategy(ctx.flags, ctx.env)
  const maxIterations = Math.max(1, config.maxIterations ?? DEFAULT_DRAIN_ITERATIONS)
  const store = await ctx.createStore(config.tenantId)
  const engine = await buildEngine(ctx, config, strategy, config.tenantId)
  const remote = ctx.createRemote(ctx.env)

  const summary: DrainSummary = {
    tenantId: config.tenantId,
    iterations: 0,
    maxIterations,
    stoppedBy: 'nothing-to-do',
    drained: false,
    synced: 0,
    conflicts: 0,
    failed: 0,
    pulled: 0,
    pendingRemaining: await store.count(config.tenantId, 'pending'),
  }

  while (summary.iterations < maxIterations && summary.pendingRemaining > 0) {
    const pendingBefore = summary.pendingRemaining
    const result = await engine.sync(remote, config.tenantId, {
      direction: 'full',
      filter: config.schoolId
        ? (record: SyncRecord) => scopeToSchool([record], config.schoolId).length === 1
        : undefined,
    })
    summary.iterations++
    summary.synced += result.synced
    summary.conflicts += result.conflicts
    summary.failed += result.failed
    summary.pulled += result.pulled
    summary.pendingRemaining = await store.count(config.tenantId, 'pending')

    if (summary.pendingRemaining >= pendingBefore) {
      // Nothing left the queue this pass. What is left is a record the remote
      // will not accept; looping would spin until maxIterations.
      summary.stoppedBy = 'no-progress'
      break
    }
  }

  if (summary.pendingRemaining === 0) summary.stoppedBy = 'drained'
  else if (summary.stoppedBy === 'nothing-to-do') summary.stoppedBy = 'max-iterations'
  summary.drained = summary.pendingRemaining === 0

  ctx.out.data(summary)
  ctx.out.note(
    summary.drained
      ? `Drained ${summary.tenantId} in ${summary.iterations} iteration(s): ${summary.synced} synced, ${summary.conflicts} conflicting.`
      : `${summary.pendingRemaining} change(s) still queued for ${summary.tenantId} after ${summary.iterations} iteration(s) (${summary.stoppedBy}).`,
  )
  ctx.out.finish()
  // Non-zero for anything left queued and for anything that failed: a run that
  // moved records into `failed` did not drain them, and cron should notice.
  return summary.drained && summary.failed === 0 ? 0 : 1
}