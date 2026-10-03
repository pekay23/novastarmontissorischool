/**
 * Test doubles. No database and no network anywhere in these tests: the store is
 * driven by a fake that records every statement it is handed, and the remote is
 * a plain function.
 */
import { resolve } from 'node:path'
import { Output, type Writable } from '../output'
import { ServerStore, type Queryable } from '../adapters/server-store'
import type { CommandContext } from '../config'
import type { PushOutcome, SyncRecord, SyncRemote } from '@novastar/sync-engine'

export const TENANT_A = '11111111-1111-4111-8111-111111111111'
export const TENANT_B = '22222222-2222-4222-8222-222222222222'

export interface RecordedQuery {
  sql: string
  params: unknown[]
}

interface QueueRow {
  id: string
  tenant_id: string
  entity_type: string
  entity_id: string
  table_name: string
  record_id: string
  operation: SyncRecord['operation']
  data: Record<string, unknown>
  sync_status: SyncRecord['syncStatus']
  recorded_at: Date
  retry_count: number
}

function toRow(record: SyncRecord): QueueRow {
  return {
    id: record.id,
    tenant_id: record.tenantId,
    entity_type: record.entityType,
    entity_id: record.entityId,
    table_name: record.table,
    record_id: record.recordId,
    operation: record.operation,
    data: record.data,
    sync_status: record.syncStatus,
    recorded_at: record.timestamp,
    retry_count: record.retryCount,
  }
}

export function fixture(overrides: Partial<SyncRecord> = {}): SyncRecord {
  const id = overrides.id ?? '00000000-0000-4000-8000-000000000001'
  return {
    id,
    tenantId: TENANT_A,
    entityType: 'students',
    entityId: id,
    table: 'students',
    recordId: id,
    operation: 'upsert',
    data: { id, firstName: 'Adwoa' },
    syncStatus: 'pending',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    retryCount: 0,
    ...overrides,
  }
}

/**
 * A `pg`-shaped client that answers the store's statements from memory.
 *
 * It resolves the tenant from the statement's own bind parameters, so a query
 * that stopped carrying its tenant would silently return nothing rather than
 * another school's rows. `assertTenantScoped` is the assertion that catches it.
 */
export function createFakeDb(seed: SyncRecord[] = [], knownTenants: string[] = [TENANT_A, TENANT_B]) {
  const rows = new Map<string, QueueRow>()
  for (const record of seed) rows.set(record.id, toRow(record))
  const queries: RecordedQuery[] = []

  const db: Queryable = {
    async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
      queries.push({ sql, params })
      const lower = sql.toLowerCase()
      const tenant = params.find(
        (value): value is string => typeof value === 'string' && knownTenants.includes(value),
      )
      const scoped = () => [...rows.values()].filter((row) => row.tenant_id === tenant)

      if (lower.includes('insert into')) {
        const [id, tenantId, entityType, entityId, tableName, recordId, operation, data, status, recordedAt, retries] =
          params as [string, string, string, string, string, string, string, string, string, Date, number]
        rows.set(id, {
          id,
          tenant_id: tenantId,
          entity_type: entityType,
          entity_id: entityId,
          table_name: tableName,
          record_id: recordId,
          operation: operation as SyncRecord['operation'],
          data: JSON.parse(data) as Record<string, unknown>,
          sync_status: status as SyncRecord['syncStatus'],
          recorded_at: recordedAt,
          retry_count: retries,
        })
        return { rows: [] as T[], rowCount: 1 }
      }

      if (lower.includes('delete from')) {
        if (lower.includes('= any(')) {
          const ids = params[0] as string[]
          let deleted = 0
          for (const id of ids) {
            const row = rows.get(id)
            if (row && row.tenant_id === tenant) {
              rows.delete(id)
              deleted++
            }
          }
          return { rows: [] as T[], rowCount: deleted }
        }
        let deleted = 0
        for (const [id, row] of [...rows.entries()]) {
          if (row.tenant_id === tenant) {
            rows.delete(id)
            deleted++
          }
        }
        return { rows: [] as T[], rowCount: deleted }
      }

      if (lower.includes('count(*)')) {
        const status = params.find((value) => typeof value === 'string' && value !== tenant)
        const matching = scoped().filter((row) => !status || row.sync_status === status)
        return { rows: [{ count: matching.length }] as T[], rowCount: 1 }
      }

      if (lower.includes('min(recorded_at)')) {
        const times = scoped()
          .filter((row) => row.sync_status === 'pending')
          .map((row) => row.recorded_at)
        return { rows: [{ oldest: times.length ? new Date(Math.min(...times.map((t) => t.getTime()))) : null }] as T[], rowCount: 1 }
      }

      if (lower.includes('max(recorded_at)')) {
        const times = scoped()
          .filter((row) => row.sync_status === 'synced')
          .map((row) => row.recorded_at)
        return { rows: [{ latest: times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null }] as T[], rowCount: 1 }
      }

      const status = params.find((value) => typeof value === 'string' && value !== tenant)
      const limit = [...params].reverse().find((value) => typeof value === 'number')
      const scopedRows = scoped()
      const matching = scopedRows
        .filter((row) => !status || row.sync_status === status)
        .sort((a, b) => a.recorded_at.getTime() - b.recorded_at.getTime())
        .slice(0, limit ?? scopedRows.length)
      return { rows: matching as T[], rowCount: matching.length }
    },
  }

  return { db, queries, rows }
}

/** Statements that change data. status must issue none of these. */
export function isWrite(sql: string): boolean {
  const lower = sql.toLowerCase()
  return lower.includes('insert into') || lower.includes('delete from') || lower.includes('update ')
}

export interface FakeRemote {
  remote: SyncRemote
  pushes: SyncRecord[][]
  pulls: number
}

export function createFakeRemote(
  handlers: {
    push?: (records: SyncRecord[]) => PushOutcome[]
    pull?: (tenantId: string) => SyncRecord[]
  } = {},
): FakeRemote {
  const state: FakeRemote = { remote: null as unknown as SyncRemote, pushes: [], pulls: 0 }
  state.remote = {
    async push(_tenantId, records) {
      state.pushes.push(records)
      return handlers.push ? handlers.push(records) : records.map((r) => ({ id: r.id, status: 'synced' }))
    },
    async pull(tenantId) {
      state.pulls++
      return handlers.pull ? handlers.pull(tenantId) : []
    },
  }
  return state
}

class Buffer implements Writable {
  private chunks: string[] = []
  write(chunk: string): boolean {
    this.chunks.push(chunk)
    return true
  }
  text(): string {
    return this.chunks.join('')
  }
}

export const TEST_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://sync:sync@127.0.0.1:5432/sync_test',
  TENANT_ID: TENANT_A,
  SYNC_API_URL: 'https://portal.example.test',
  SYNC_API_TOKEN: 'test-token-not-a-secret',
  SYNC_CONFLICT_STRATEGY: 'last-write-wins',
}

export interface TestHarness {
  ctx: CommandContext
  stdout: Buffer
  stderr: Buffer
  fake: ReturnType<typeof createFakeDb>
  store: (tenantId?: string) => ServerStore
  remote: FakeRemote
  clock: { now: Date }
}

export function createHarness(
  options: {
    seed?: SyncRecord[]
    env?: NodeJS.ProcessEnv
    flags?: CommandContext['flags']
    json?: boolean
    isTty?: boolean
    now?: Date
    remote?: FakeRemote
    answers?: string[]
  } = {},
): TestHarness {
  const stdout = new Buffer()
  const stderr = new Buffer()
  const fake = createFakeDb(options.seed ?? [])
  // The caller's FakeRemote object is used as-is, so its counters are the ones
  // the test can assert on.
  const remote = options.remote ?? createFakeRemote()
  const clock = { now: options.now ?? new Date('2026-10-03T09:00:00.000Z') }
  const answers = [...(options.answers ?? [])]

  const ctx: CommandContext = {
    flags: options.flags ?? {},
    env: options.env ?? { ...TEST_ENV },
    out: new Output({ json: options.json, table: !options.json, quiet: false }, stdout, stderr),
    isTty: options.isTty ?? false,
    clock: () => clock.now,
    sleep: async () => {},
    prompt: async () => answers.shift() ?? '',
    createStore: async (tenantId) => new ServerStore(fake.db, tenantId),
    createRemote: () => remote.remote,
  }

  return {
    ctx,
    stdout,
    stderr,
    fake,
    store: (tenantId = TEST_ENV.TENANT_ID!) => new ServerStore(fake.db, tenantId),
    remote,
    clock,
  }
}

/** Spawns the real CLI in a child process. Used where exit codes matter. */
export async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, 'index.ts', ...args], {
    cwd: resolve(import.meta.dir, '..'),
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, stdout, stderr }
}