/**
 * CLI-wide types, environment resolution and argument parsing.
 *
 * Everything that resolves configuration throws instead of defaulting: a
 * guessed DATABASE_URL points at the wrong database and a guessed tenantId
 * reads another school's data. The one exception is documented per field —
 * `--quiet` and friends are presentation, not safety.
 *
 * Load order is `.env` then `.env.local`. The real environment always wins over
 * both: for this CLI an operator's exported token must not be replaced by a
 * stale line in a dotenv file, which is the opposite of what
 * tools/db-mirror/env.ts wants and is documented at loadEnv.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { DEFAULT_SYNC_CONFIG, SyncEngine, type SyncStrategy } from '@novastar/sync-engine'
import type { Output } from './output'
import type { ServerStore } from './adapters/server-store'
import type { SyncRemote } from '@novastar/sync-engine'

/** A parsed `--flag value` / `--flag` pair. */
export type Flags = Record<string, string | boolean>

/** Flags that take no value. Anything else consumes the next argument. */
const BOOLEAN_FLAGS = new Set([
  'help',
  'h',
  'json',
  'table',
  'quiet',
  'yes',
  'y',
  'version',
  'all',
  'push',
  'reset-retries',
  'dry-run',
])

export function parseFlags(args: string[]): { flags: Flags; positional: string[] } {
  const flags: Flags = {}
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const body = arg.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    if (BOOLEAN_FLAGS.has(body)) {
      flags[body] = true
      continue
    }
    const next = args[i + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`--${body} needs a value`)
    }
    flags[body] = next
    i++
  }
  return { flags, positional }
}

export function flagString(flags: Flags, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = flags[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

export function flagBoolean(flags: Flags, ...names: string[]): boolean {
  return names.some((name) => flags[name] === true || flags[name] === 'true')
}

export function flagNumber(flags: Flags, name: string, fallback?: number): number | undefined {
  const raw = flagString(flags, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`--${name} must be an integer, got ${JSON.stringify(raw)}`)
  }
  return value
}

/** Reads a required environment variable, or throws naming it. */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]
  if (!value || value.trim() === '') {
    throw new Error(`${name} is not set. Load .env or export it.`)
  }
  return value
}

/** Hides credentials so a connection string can be logged. */
export function redact(url: string): string {
  return url.replace(/:\/\/[^@]*@/, '://***@')
}

/**
 * Loads `.env` then `.env.local`, later files winning over earlier ones but
 * *not* over the real environment.
 *
 * tools/db-mirror uses `override: true`, because there the dotenv file is the
 * source of truth. For an operator CLI it is the other way round: a token
 * exported in the shell for one command must not be silently replaced by a
 * stale line in `.env`. Neither call throws when the file is absent, so this is
 * a no-op in CI.
 */
export function loadEnv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  loadDotenv({ path: resolve(root, '.env'), override: false, quiet: true })
  loadDotenv({ path: resolve(root, '.env.local'), override: false, quiet: true })
}

/**
 * Tenant ids are opaque strings in the schema, so this only rejects values that
 * cannot be one: blank, over-long, or containing whitespace and shell
 * metacharacters. A typo like `--tenant "school one"` is caught here rather than
 * as a confusing empty result later.
 */
const TENANT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export function requireTenantIdFlag(value: string | undefined, source: string): string {
  if (!value) throw new Error(`${source} is required — the CLI will not guess which tenant to touch.`)
  if (!TENANT_ID_PATTERN.test(value)) {
    throw new Error(`${source} is not a valid tenant id: ${JSON.stringify(value)}`)
  }
  return value
}

/** DATABASE_URL, or DIRECT_URL as the plan's fallback. Both unset is an error. */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim() || env.DIRECT_URL?.trim()
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set (DIRECT_URL is not set either). Load .env or export one of them.',
    )
  }
  return url
}

export interface ResolvedConfig {
  databaseUrl: string
  /** Never logged. */
  databaseUrlRedacted: string
  tenantId: string
  schoolId?: string
  strategy?: SyncStrategy
  apiUrl?: string
  apiToken?: string
  batchSize: number
  retryAttempts: number
  retryDelayMs: number
  maxIterations: number
}

/**
 * Resolves the tenant from `--tenant` then `TENANT_ID`. There is no third
 * source: a default tenant is a cross-tenant read.
 */
export function resolveTenantId(flags: Flags, env: NodeJS.ProcessEnv = process.env): string {
  const fromFlag = flagString(flags, 'tenant', 'tenant-id')
  if (fromFlag) return requireTenantIdFlag(fromFlag, '--tenant')
  const fromEnv = env.TENANT_ID?.trim()
  if (fromEnv) return requireTenantIdFlag(fromEnv, 'TENANT_ID')
  throw new Error('tenantId is required: pass --tenant <id> or set TENANT_ID — there is no default tenant.')
}

export const SYNC_STRATEGIES: readonly SyncStrategy[] = ['last-write-wins', 'merge', 'ask-user']

/**
 * The strategy for a command that rewrites data. Never defaulted: a silent
 * `last-write-wins` in a cron context destroys remote data with nobody told.
 * Read-only commands do not need it and leave `config.strategy` undefined.
 */
export function requireStrategy(flags: Flags, env: NodeJS.ProcessEnv = process.env): SyncStrategy {
  const raw = flagString(flags, 'strategy') ?? env.SYNC_CONFLICT_STRATEGY?.trim()
  if (!raw) {
    throw new Error(
      'No conflict strategy given: pass --strategy last-write-wins|merge|ask-user or set SYNC_CONFLICT_STRATEGY. ' +
        'It is not defaulted because last-write-wins overwrites one side of every conflict.',
    )
  }
  if (!SYNC_STRATEGIES.includes(raw as SyncStrategy)) {
    throw new Error(`Unknown strategy ${JSON.stringify(raw)}. Use one of: ${SYNC_STRATEGIES.join(', ')}.`)
  }
  return raw as SyncStrategy
}

/** Cron needs a stop condition; this is the default number of passes. */
export const DEFAULT_DRAIN_ITERATIONS = 10

export function resolveConfig(flags: Flags, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const databaseUrl = resolveDatabaseUrl(env)
  return {
    databaseUrl,
    databaseUrlRedacted: redact(databaseUrl),
    tenantId: resolveTenantId(flags, env),
    schoolId: flagString(flags, 'school', 'school-id') ?? (env.SCHOOL_ID?.trim() || undefined),
    // Left undefined on purpose: only the commands that rewrite data ask for it,
    // via requireStrategy.
    strategy: undefined,
    apiUrl: env.SYNC_API_URL?.trim() || undefined,
    apiToken: env.SYNC_API_TOKEN?.trim() || undefined,
    batchSize: flagNumber(flags, 'batch-size') ?? DEFAULT_SYNC_CONFIG.batchSize,
    retryAttempts: flagNumber(flags, 'retry-attempts') ?? DEFAULT_SYNC_CONFIG.retryAttempts,
    retryDelayMs: flagNumber(flags, 'retry-delay-ms') ?? DEFAULT_SYNC_CONFIG.retryDelayMs,
    maxIterations: flagNumber(flags, 'max-iterations') ?? DEFAULT_DRAIN_ITERATIONS,
  }
}

/** SYNC_API_URL and SYNC_API_TOKEN, for the commands that talk to the portal. */
export function requireRemoteConfig(env: NodeJS.ProcessEnv = process.env): {
  apiUrl: string
  apiToken: string
} {
  const apiUrl = requireEnv('SYNC_API_URL', env)
  const apiToken = requireEnv('SYNC_API_TOKEN', env)
  return { apiUrl, apiToken }
}

/**
 * Narrows records to one school when `--school` is given. A school is not a
 * tenant, so this filters rather than replaces the tenant scope.
 */
export function scopeToSchool<T extends { data: Record<string, unknown> }>(
  records: T[],
  schoolId: string | undefined,
): T[] {
  if (!schoolId) return records
  return records.filter((record) => {
    const value = record.data.schoolId
    return value === undefined || String(value) === schoolId
  })
}

/**
 * What every command receives. The factories are injected so a test can supply
 * a recording store and a fake remote: no command reaches for a real database
 * or the network on its own.
 */
export interface CommandContext {
  flags: Flags
  env: NodeJS.ProcessEnv
  out: Output
  isTty: boolean
  clock: () => Date
  sleep: (ms: number) => Promise<void>
  /** One question, one answer. Only reached by `resolve --strategy ask-user`. */
  prompt: (question: string) => Promise<string>
  createStore: (tenantId: string) => Promise<ServerStore>
  createRemote: (env: NodeJS.ProcessEnv) => SyncRemote
}

/** A command returns the process exit code. */
export type CommandHandler = (ctx: CommandContext) => Promise<number>

/**
 * Assembles a `SyncEngine` over the injected store, with the CLI's clock and
 * delay so a test can make retries and timestamps deterministic.
 */
export async function buildEngine(
  ctx: CommandContext,
  config: ResolvedConfig,
  strategy: SyncStrategy,
  tenantId: string,
): Promise<SyncEngine> {
  return new SyncEngine(
    {
      strategy,
      retryAttempts: config.retryAttempts,
      retryDelayMs: config.retryDelayMs,
      batchSize: config.batchSize,
    },
    await ctx.createStore(tenantId),
    { clock: ctx.clock, sleep: ctx.sleep },
  )
}