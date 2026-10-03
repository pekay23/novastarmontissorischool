/**
 * `resolve` — apply a conflict strategy to the records the remote rejected.
 *
 * Two safety properties, both enforced here rather than in the engine:
 *   - The strategy is never defaulted. `resolve` without one exits non-zero.
 *   - `ask-user` without a TTY exits non-zero. There is no fallback to
 *     last-write-wins, because in a cron context that is how remote data
 *     disappears without anyone being told.
 */
import {
  buildEngine,
  flagNumber,
  flagString,
  requireStrategy,
  resolveConfig,
  scopeToSchool,
  type CommandContext,
} from '../config'
import { AskUserWithoutDeciderError, type Conflict, type ConflictDecision } from '@novastar/sync-engine'
import type { SyncRecord } from '@novastar/shared-types'

function label(record: SyncRecord): string {
  return `${record.table}:${record.recordId}`
}

export async function run(ctx: CommandContext): Promise<number> {
  const config = resolveConfig(ctx.flags, ctx.env)
  const strategy = requireStrategy(ctx.flags, ctx.env)

  if (strategy === 'ask-user' && !ctx.isTty) {
    ctx.out.error(
      'resolve --strategy ask-user needs an interactive terminal: it asks per record and there is no safe ' +
        'default to fall back to. Re-run with --strategy merge or --strategy last-write-wins, or from a terminal.',
    )
    return 1
  }

  const store = await ctx.createStore(config.tenantId)
  const only = flagString(ctx.flags, 'ids')
  const ids = only ? new Set(only.split(',').map((id) => id.trim()).filter(Boolean)) : undefined
  const limit = flagNumber(ctx.flags, 'limit') ?? config.batchSize

  const queued = scopeToSchool(await store.listByStatus(config.tenantId, 'conflict', limit), config.schoolId)
  const conflicts = ids ? queued.filter((record) => ids.has(record.id)) : queued

  if (conflicts.length === 0) {
    ctx.out.data({ tenantId: config.tenantId, strategy, considered: 0, resolved: 0, unmatched: [] })
    ctx.out.note(`No unresolved conflicts for ${config.tenantId}.`)
    ctx.out.finish()
    return 0
  }

  const remote = ctx.createRemote(ctx.env)
  const remoteRecords = await remote.pull(config.tenantId, null)

  const pairs: Conflict[] = []
  const unmatched: string[] = []
  for (const local of conflicts) {
    const match = remoteRecords.find((r) => r.table === local.table && r.recordId === local.recordId)
    if (!match) {
      unmatched.push(label(local))
      continue
    }
    pairs.push({ id: local.id, local, remote: match })
  }
  if (unmatched.length > 0) {
    // A conflict with no remote side cannot be decided by merge or
    // last-write-wins. Left as-is rather than guessed at.
    ctx.out.warn(
      `No remote version found for ${unmatched.length} record(s), left conflicted: ${unmatched.join(', ')}`,
    )
  }

  const engine = await buildEngine(ctx, config, strategy, config.tenantId)
  const resolutions = await engine.resolveConflicts(config.tenantId, pairs, {
    onConflict: (conflict) => askUser(ctx, conflict),
  })

  // Only the records this command resolved go out — a `resolve` must not also
  // push whatever else happened to be queued.
  const winnerIds = new Set(
    resolutions.filter((r) => r.winner !== 'remote').map((resolution) => resolution.id),
  )
  const pushed = await engine.sync(remote, config.tenantId, {
    direction: 'push',
    filter: (record) => winnerIds.has(record.id),
  })

  const summary = {
    tenantId: config.tenantId,
    strategy,
    considered: conflicts.length,
    resolved: resolutions.length,
    local: resolutions.filter((r) => r.winner === 'local').length,
    merged: resolutions.filter((r) => r.winner === 'merged').length,
    remote: resolutions.filter((r) => r.winner === 'remote').length,
    unmatched,
    pushed: { synced: pushed.synced, conflicts: pushed.conflicts, failed: pushed.failed },
  }
  ctx.out.data(summary)
  ctx.out.note(
    `Resolved ${resolutions.length} conflict(s) for ${config.tenantId} with ${strategy}: ` +
      `${summary.local} local, ${summary.merged} merged, ${summary.remote} already newer on the remote.`,
  )
  ctx.out.finish()
  return unmatched.length > 0 || pushed.failed > 0 ? 1 : 0
}

async function askUser(ctx: CommandContext, conflict: Conflict): Promise<ConflictDecision> {
  const answer = (
    await ctx.prompt(
      `Conflict on ${label(conflict.local)} — [l]ocal ${conflict.local.timestamp.toISOString()} / ` +
        `[r]emote ${conflict.remote.timestamp.toISOString()} / [m]erge? `,
    )
  )
    .trim()
    .toLowerCase()
  if (answer === 'l' || answer === 'local') return 'local'
  if (answer === 'r' || answer === 'remote') return 'remote'
  if (answer === 'm' || answer === 'merge') return 'merged'
  ctx.out.error(`Unrecognised answer ${JSON.stringify(answer)} — refusing to guess. No conflict was resolved.`)
  throw new AskUserWithoutDeciderError()
}