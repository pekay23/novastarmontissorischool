#!/usr/bin/env bun
/**
 * novastar-sync — operator entry point for the sync queue.
 *
 * `--help` runs before anything else: no database, no token, no arguments, exit
 * 0. An operator tool that cannot print its own help without credentials is a
 * tool people stop using.
 *
 * Every subcommand is handed a `CommandContext` whose store and remote are
 * injected. That is how the tests exercise all of this against a recording
 * store and a fake remote, and how nothing here reaches a real database by
 * accident.
 */
import {
  flagBoolean,
  loadEnv,
  parseFlags,
  requireRemoteConfig,
  resolveDatabaseUrl,
  type CommandContext,
  type CommandHandler,
} from './config'
import { Output } from './output'
import { createPool, ServerStore, type PoolLike } from './adapters/server-store'
import { PortalSyncRemote } from './adapters/remote-endpoint'

import * as status from './commands/status'
import * as sync from './commands/sync'
import * as push from './commands/push'
import * as pull from './commands/pull'
import * as pending from './commands/pending'
import * as conflicts from './commands/conflicts'
import * as resolve from './commands/resolve'
import * as replay from './commands/replay'
import * as drain from './commands/drain'
import * as clear from './commands/clear'

export const USAGE = `novastar-sync — drive the sync queue for one tenant

Usage:
  novastar-sync <command> [flags]

Commands:
  status                 Queue depth, oldest pending change, conflicts, last drain.
                         READ-ONLY. The only command considered safe for CI.
  sync                   Full pass: pull remote changes, then push the queue.
  push                   Push queued changes only.
  pull                   Pull remote changes only.
  pending                List queued, unsent changes.
  conflicts              List unresolved conflicts.
  resolve                Apply a conflict strategy to those conflicts.
  replay                 Re-queue failed records, optionally push them.
  drain                  Loop sync until the queue is empty. For cron.
  clear                  Delete a tenant's queue. DESTROYS UNSYNCED WORK.

Global flags:
  --json                 Print one JSON document on stdout. Nothing else.
  --table                Human-readable output (default).
  --quiet                Suppress informational output. Warnings still print.
  --help                 This text. Works with no database and no token.

Scope flags:
  --tenant <id>          Tenant to operate on. Falls back to TENANT_ID.
                         Required explicitly by 'clear'.
  --school <id>          Narrow to one school (listings, pulls and pushes).

Command flags:
  sync|push|pull|resolve|replay|drain
                         --strategy last-write-wins|merge|ask-user  (required;
                         also settable as SYNC_CONFLICT_STRATEGY)
                         --limit <n>, --batch-size <n>, --retry-attempts <n>
  pending|conflicts      --limit <n>
  resolve                --ids <a,b,c>
  replay                 --push, --reset-retries, --dry-run
  drain                  --max-iterations <n>   (default 10)
  clear                  --tenant <id> --yes

Environment:
  DATABASE_URL           Postgres connection string. DIRECT_URL is the fallback.
                         Required by every command except --help.
  TENANT_ID, SCHOOL_ID   Default scope.
  SYNC_API_URL           Portal sync endpoint. Required by sync/push/pull/
                         resolve/replay/drain.
  SYNC_API_TOKEN         Service token for that endpoint. Never logged.
  SYNC_CONFLICT_STRATEGY Default conflict strategy, same three values.

Examples:
  novastar-sync status --json
  novastar-sync pending --tenant school-a --limit 20
  novastar-sync drain --tenant school-a --strategy merge --max-iterations 5
  novastar-sync clear --tenant school-a --yes
`

const COMMANDS: Record<string, CommandHandler> = {
  status: status.run,
  sync: sync.run,
  push: push.run,
  pull: pull.run,
  pending: pending.run,
  conflicts: conflicts.run,
  resolve: resolve.run,
  replay: replay.run,
  drain: drain.run,
  clear: clear.run,
}

/** One pool per tenant, closed after the command so the process can exit. */
const pools = new Map<string, Promise<PoolLike>>()

export function createOutput(flags: CommandContext['flags']): Output {
  return new Output({
    json: flagBoolean(flags, 'json'),
    table: flagBoolean(flags, 'table'),
    quiet: flagBoolean(flags, 'quiet'),
  })
}

/** One line from stdin. Empty string when stdin is closed or not a terminal. */
async function readLine(): Promise<string> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of process.stdin) {
    buffered += decoder.decode(chunk as Uint8Array, { stream: true })
    const newline = buffered.indexOf('\n')
    if (newline !== -1) return buffered.slice(0, newline)
  }
  return buffered.trim()
}

/** Prompt on stderr: with --json, stdout carries the JSON document and nothing else. */
async function askOnStdin(question: string): Promise<string> {
  process.stderr.write(question)
  return readLine()
}

export async function dispatch(argv: string[], out: Output): Promise<number> {
  let parsed
  try {
    parsed = parseFlags(argv)
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error))
    return 2
  }
  const { flags, positional } = parsed
  const command = positional[0]

  // Before anything that needs a database, a token, or the environment.
  if (flagBoolean(flags, 'help', 'h') || command === undefined || command === 'help') {
    out.raw(USAGE.trimEnd() + '\n')
    return 0
  }

  const handler = COMMANDS[command]
  if (!handler) {
    out.error(`Unknown command ${JSON.stringify(command)}\n`)
    out.raw(USAGE.trimEnd() + '\n')
    return 2
  }
  if (positional.length > 1) {
    out.error(`Unexpected argument ${JSON.stringify(positional[1])}`)
    return 2
  }

  loadEnv()

  const ctx: CommandContext = {
    flags,
    env: process.env,
    out,
    isTty: Boolean(process.stdin.isTTY),
    clock: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    prompt: askOnStdin,
    createStore: async (tenantId) => new ServerStore(await poolFor(tenantId), tenantId),
    createRemote: (env) => {
      const { apiUrl, apiToken } = requireRemoteConfig(env)
      return new PortalSyncRemote({ baseUrl: apiUrl, token: apiToken })
    },
  }

  try {
    return await handler(ctx)
  } catch (error) {
    out.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  } finally {
    await closePools()
  }
}

/** Lazily imports `pg`, so `--help` never loads the driver. */
async function poolFor(tenantId: string): Promise<PoolLike> {
  const existing = pools.get(tenantId)
  if (existing) return existing
  const pool = createPool(resolveDatabaseUrl(process.env))
  pools.set(tenantId, pool)
  return pool
}

export async function closePools(): Promise<void> {
  const open = [...pools.values()]
  pools.clear()
  await Promise.all(
    open.map(async (pool) => {
      try {
        await (await pool).end()
      } catch {
        // A pool that never opened, or already closed, is not a failure here.
      }
    }),
  )
}

if (import.meta.main) {
  const code = await dispatch(process.argv.slice(2), createOutput({}))
  process.exitCode = code
}