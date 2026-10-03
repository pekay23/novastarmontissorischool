// ============================================================================
// Sync Engine — offline-first synchronization between a local change queue and
// a remote endpoint, using an explicit conflict-resolution strategy.
//
// Storage is injected (Option A of the build plan). The browser gets IndexedDB,
// which is the default implementation here; `tools/sync-cli` injects a Postgres
// implementation of the same interface. Nothing outside this file needs to know
// which one is in use, and nothing here touches a database directly.
//
// Tenant isolation: every method takes an explicit tenantId and throws rather
// than defaulting. A default tenant is a cross-tenant data leak, so the only
// accepted answer to a missing tenantId is an error.
// ============================================================================

import { openDB } from 'idb'
import type { SyncRecord } from '@novastar/shared-types'

/** Re-exported so a consumer of `SyncStorage` gets the record type from here. */
export type { SyncRecord }

export type SyncStrategy = 'last-write-wins' | 'merge' | 'ask-user'

export interface SyncConfig {
  strategy: SyncStrategy
  retryAttempts: number
  retryDelayMs: number
  batchSize: number
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  strategy: 'last-write-wins',
  retryAttempts: 3,
  retryDelayMs: 1000,
  batchSize: 50,
}

export interface SyncOptions {
  /** Overrides for the constructor-supplied config, for a single run. */
  config?: Partial<SyncConfig>
  onProgress?: (progress: number) => void
  /**
   * Narrows what this run touches, e.g. to one school. Records the filter
   * rejects stay queued — they are out of scope, not failed.
   */
  filter?: (record: SyncRecord) => boolean
  /**
   * The `ask-user` decider. Absent it, `ask-user` refuses to resolve — it must
   * never fall back to last-write-wins, which would silently destroy one side.
   */
  onConflict?: (conflict: Conflict) => ConflictDecision | Promise<ConflictDecision>
  direction?: SyncDirection
}

/**
 * The operations the engine needs from a queue. Six methods, all of them
 * tenant-scoped: five take a tenantId, and `remove` takes ids that the engine
 * only ever obtained from a tenant-scoped read for the tenant it is acting as.
 */
export interface SyncStorage {
  getPending(tenantId: string, limit: number): Promise<SyncRecord[]>
  put(record: SyncRecord): Promise<void>
  remove(ids: string[]): Promise<void>
  getAll(tenantId: string): Promise<SyncRecord[]>
  clear(tenantId: string): Promise<void>
  count(tenantId: string, status?: SyncRecord['syncStatus']): Promise<number>
}

export type SyncStatus = SyncRecord['syncStatus']

/** What the remote said about one pushed record. */
export interface PushOutcome {
  id: string
  status: 'synced' | 'conflict' | 'failed'
  /** The remote's current version, present only when status is 'conflict'. */
  remote?: SyncRecord
  error?: string
}

export interface SyncRemote {
  push(tenantId: string, records: SyncRecord[]): Promise<PushOutcome[]>
  pull(tenantId: string, since: Date | null): Promise<SyncRecord[]>
}

export type SyncDirection = 'full' | 'push' | 'pull'

export interface SyncResult {
  tenantId: string
  synced: number
  conflicts: number
  failed: number
  pulled: number
  /** Records still queued for this tenant when the run finished. */
  pending: number
}

export interface Conflict {
  id: string
  local: SyncRecord
  remote: SyncRecord
}

export type ConflictDecision = 'local' | 'remote' | 'merged'

export interface ConflictResolution {
  id: string
  winner: ConflictDecision
  data: Record<string, unknown>
}

export interface EngineDeps {
  /** Injectable clock so timestamp comparisons are deterministic in tests. */
  clock?: () => Date
  /** Injectable delay so retry backoff does not slow tests down. */
  sleep?: (ms: number) => Promise<void>
}

export class MissingTenantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingTenantError'
  }
}

export class AskUserWithoutDeciderError extends Error {
  constructor() {
    super(
      "the 'ask-user' strategy needs a decision function — it must not fall back to last-write-wins, " +
        'which would overwrite one side of the conflict without telling anyone',
    )
    this.name = 'AskUserWithoutDeciderError'
  }
}

/** Rejects a missing tenant instead of inventing one. */
export function requireTenantId(tenantId: string | undefined | null, caller: string): string {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new MissingTenantError(
      `${caller}: tenantId is required — defaulting to a hardcoded value would break tenant isolation`,
    )
  }
  return tenantId
}

/**
 * Applies one strategy to one conflicting pair. Pure: it decides, it does not
 * write. Callers persist the result.
 */
export function applyStrategy(
  strategy: SyncStrategy,
  conflict: Conflict,
  decide?: (conflict: Conflict) => ConflictDecision | undefined,
): ConflictResolution {
  const { local, remote } = conflict
  switch (strategy) {
    case 'last-write-wins': {
      // Ties go to the local record so the outcome is deterministic rather than
      // dependent on which side happened to arrive first.
      const localWins = local.timestamp.getTime() >= remote.timestamp.getTime()
      return {
        id: conflict.id,
        winner: localWins ? 'local' : 'remote',
        data: localWins ? local.data : remote.data,
      }
    }
    case 'merge':
      return { id: conflict.id, winner: 'merged', data: { ...remote.data, ...local.data } }
    case 'ask-user': {
      if (!decide) throw new AskUserWithoutDeciderError()
      const decision = decide(conflict)
      if (decision !== 'local' && decision !== 'remote' && decision !== 'merged') {
        throw new AskUserWithoutDeciderError()
      }
      if (decision === 'local') return { id: conflict.id, winner: 'local', data: local.data }
      if (decision === 'remote') return { id: conflict.id, winner: 'remote', data: remote.data }
      return { id: conflict.id, winner: 'merged', data: { ...remote.data, ...local.data } }
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory storage: the Node/Bun and test implementation.
// ---------------------------------------------------------------------------

export class MemorySyncStorage implements SyncStorage {
  private rows = new Map<string, SyncRecord>()

  async getPending(tenantId: string, limit: number): Promise<SyncRecord[]> {
    const tenant = requireTenantId(tenantId, 'SyncStorage.getPending')
    return [...this.rows.values()]
      .filter((r) => r.tenantId === tenant && r.syncStatus === 'pending')
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(0, Math.max(0, limit))
      .map((r) => ({ ...r }))
  }

  async put(record: SyncRecord): Promise<void> {
    requireTenantId(record?.tenantId, 'SyncStorage.put')
    this.rows.set(record.id, { ...record })
  }

  async remove(ids: string[]): Promise<void> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('SyncStorage.remove: ids is required — an unbounded delete has no tenant to scope it to')
    }
    for (const id of ids) this.rows.delete(id)
  }

  async getAll(tenantId: string): Promise<SyncRecord[]> {
    const tenant = requireTenantId(tenantId, 'SyncStorage.getAll')
    return [...this.rows.values()]
      .filter((r) => r.tenantId === tenant)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((r) => ({ ...r }))
  }

  async clear(tenantId: string): Promise<void> {
    const tenant = requireTenantId(tenantId, 'SyncStorage.clear')
    for (const [id, row] of [...this.rows.entries()]) {
      if (row.tenantId === tenant) this.rows.delete(id)
    }
  }

  async count(tenantId: string, status?: SyncStatus): Promise<number> {
    const tenant = requireTenantId(tenantId, 'SyncStorage.count')
    return [...this.rows.values()].filter(
      (r) => r.tenantId === tenant && (status === undefined || r.syncStatus === status),
    ).length
  }
}

// ---------------------------------------------------------------------------
// IndexedDB storage: the browser default.
// ---------------------------------------------------------------------------

interface QueueDbSchema {
  queue: {
    key: string
    value: SyncRecord
    indexes: { 'by-tenant': string; 'by-status': string }
  }
}

async function openQueueDb(name: string) {
  return openDB<QueueDbSchema>(name, 1, {
    upgrade(db) {
      const store = db.createObjectStore('queue', { keyPath: 'id' })
      store.createIndex('by-tenant', 'tenantId')
      store.createIndex('by-status', 'syncStatus')
    },
  })
}

/**
 * Derived rather than written out: `IDBPDatabase` is a DOM name, and this file
 * is also compiled as part of projects that do not include the DOM lib.
 */
type QueueDb = Awaited<ReturnType<typeof openQueueDb>>

const DEFAULT_DB_NAME = 'novastar-sync'

export interface IndexedDbStorageOptions {
  /** Opens a specific database — for tests and for a second queue. */
  name?: string
}

/**
 * The default storage. The browser has IndexedDB; Node and Bun do not, so every
 * method here throws a typed error when there is no `indexedDB` rather than
 * pretending to have persisted anything. A silent no-op store is how a queue
 * loses writes.
 */
export class IndexedDbSyncStorage implements SyncStorage {
  private db: Promise<QueueDb> | null = null

  constructor(private readonly options: IndexedDbStorageOptions = {}) {}

  async initialize(): Promise<void> {
    await this.open()
  }

  private open(): Promise<QueueDb> {
    if (!this.db) {
      // Read off globalThis rather than by name: this file is also compiled by
      // projects whose `lib` excludes DOM, where the bare name would not resolve.
      const indexedDbFactory = (globalThis as { indexedDB?: unknown }).indexedDB
      if (indexedDbFactory === undefined) {
        throw new Error(
          'IndexedDbSyncStorage requires IndexedDB — in Node or Bun inject a SyncStorage instead ' +
            '(see tools/sync-cli/adapters/server-store.ts)',
        )
      }
      this.db = openQueueDb(this.options.name ?? DEFAULT_DB_NAME)
    }
    return this.db
  }

  async getPending(tenantId: string, limit: number): Promise<SyncRecord[]> {
    const tenant = requireTenantId(tenantId, 'IndexedDbSyncStorage.getPending')
    const rows = await this.getAll(tenant)
    return rows.filter((r) => r.syncStatus === 'pending').slice(0, Math.max(0, limit))
  }

  async put(record: SyncRecord): Promise<void> {
    requireTenantId(record?.tenantId, 'IndexedDbSyncStorage.put')
    await (await this.open()).put('queue', record)
  }

  async remove(ids: string[]): Promise<void> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error(
        'IndexedDbSyncStorage.remove: ids is required — an unbounded delete has no tenant to scope it to',
      )
    }
    const db = await this.open()
    const tx = db.transaction('queue', 'readwrite')
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done])
  }

  async getAll(tenantId: string): Promise<SyncRecord[]> {
    const tenant = requireTenantId(tenantId, 'IndexedDbSyncStorage.getAll')
    const rows = await (await this.open()).getAllFromIndex('queue', 'by-tenant', tenant)
    return rows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  async clear(tenantId: string): Promise<void> {
    const tenant = requireTenantId(tenantId, 'IndexedDbSyncStorage.clear')
    const db = await this.open()
    const rows = await db.getAllFromIndex('queue', 'by-tenant', tenant)
    // Deletes this tenant's rows only. A bare `clear()` on the object store
    // would take every tenant's queue with it.
    const tx = db.transaction('queue', 'readwrite')
    await Promise.all([...rows.map((row) => tx.store.delete(row.id)), tx.done])
  }

  async count(tenantId: string, status?: SyncStatus): Promise<number> {
    const rows = await this.getAll(tenantId)
    return rows.filter((r) => status === undefined || r.syncStatus === status).length
  }
}

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

export class SyncEngine {
  private config: SyncConfig
  private storage: SyncStorage
  private clock: () => Date
  private sleep: (ms: number) => Promise<void>

  constructor(
    config: SyncConfig = DEFAULT_SYNC_CONFIG,
    storage?: SyncStorage,
    deps: EngineDeps = {},
  ) {
    this.config = config
    this.storage = storage ?? new IndexedDbSyncStorage()
    this.clock = deps.clock ?? (() => new Date())
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  /** Opens the storage if it needs opening. A no-op for a storage that does not. */
  async initialize(): Promise<void> {
    const openable = this.storage as { initialize?: () => Promise<void> }
    if (typeof openable.initialize === 'function') await openable.initialize.call(this.storage)
  }

  async write(table: string, record: Record<string, unknown>): Promise<SyncRecord> {
    // Write to local storage and mark as pending sync.
    const tenantId = record.tenantId as string | undefined
    if (!tenantId) {
      throw new MissingTenantError(
        'tenantId is required for sync records — defaulting to a hardcoded value would break tenant isolation',
      )
    }

    const syncRecord: SyncRecord = {
      id: crypto.randomUUID(),
      tenantId,
      entityType: table,
      entityId: record.id as string,
      table,
      recordId: record.id as string,
      operation: 'upsert',
      data: record,
      syncStatus: 'pending',
      timestamp: this.clock(),
      retryCount: 0,
    }
    await this.storage.put(syncRecord)
    return syncRecord
  }

  async getPendingChanges(tenantId: string, limit?: number): Promise<SyncRecord[]> {
    return this.storage.getPending(
      requireTenantId(tenantId, 'SyncEngine.getPendingChanges'),
      limit ?? this.config.batchSize,
    )
  }

  /**
   * Pulls, then pushes, honouring the configured strategy. Counts real work:
   * `synced` is what the remote acknowledged, `conflicts` is what came back
   * divergent, `failed` is what exhausted its retries.
   */
  async sync(remote: SyncRemote, tenantId: string, options: SyncOptions = {}): Promise<SyncResult> {
    const tenant = requireTenantId(tenantId, 'SyncEngine.sync')
    if (!remote || typeof remote.push !== 'function' || typeof remote.pull !== 'function') {
      throw new TypeError(
        'SyncEngine.sync needs a SyncRemote adapter with push() and pull(). A bare URL cannot carry a ' +
          'service token or a timeout — see tools/sync-cli/adapters/remote-endpoint.ts',
      )
    }
    const config = { ...this.config, ...options.config }
    const direction = options.direction ?? 'full'
    const result: SyncResult = { tenantId: tenant, synced: 0, conflicts: 0, failed: 0, pulled: 0, pending: 0 }

    if (direction !== 'push') {
      const pulled = await remote.pull(tenant, null)
      for (const record of pulled) {
        // A remote that answers with another tenant's records must not be able
        // to write them into this tenant's queue.
        if (record.tenantId !== tenant) continue
        if (options.filter && !options.filter(record)) continue
        await this.storage.put({ ...record, syncStatus: record.syncStatus === 'pending' ? 'synced' : record.syncStatus })
      }
      result.pulled = pulled.length
    }

    if (direction !== 'pull') {
      const requeue: SyncRecord[] = []
      let batch = await this.fetchPending(tenant, config.batchSize, options.filter)
      while (batch.length > 0) {
        const outcomes = await this.pushBatch(remote, tenant, batch, config)
        for (const [index, outcome] of outcomes.entries()) {
          const record = batch[index]
          if (!record || record.tenantId !== tenant) continue
          const settled = await this.settle(record, outcome, options)
          result.synced += settled.synced
          result.conflicts += settled.conflicts
          result.failed += settled.failed
          if (settled.requeue) requeue.push(settled.requeue)
        }
        // How much of this run's work is finished: what has been settled, over what has
        // been settled plus what is still queued.
        const done = result.synced + result.conflicts + result.failed
        options.onProgress?.(
          Math.min(1, done / Math.max(1, done + (await this.storage.count(tenant, 'pending')))),
        )
        const next = await this.fetchPending(tenant, config.batchSize, options.filter)
        // Stop when the queue did not shrink. Whatever is left is a conflict or
        // a failure this pass re-queued, and looping on it is a hot loop.
        if (next.length >= batch.length) break
        batch = next
      }

      // Records whose conflict resolved in favour of the local side go out once
      // more in this same run. Exactly one extra pass: a second conflict is
      // recorded, not re-resolved.
      if (requeue.length > 0) {
        const outcomes = await this.pushBatch(remote, tenant, requeue, config)
        for (const [index, outcome] of outcomes.entries()) {
          const record = requeue[index]
          if (!record || record.tenantId !== tenant) continue
          const settled = await this.settle(record, outcome, options)
          result.synced += settled.synced
          result.conflicts += settled.conflicts
          result.failed += settled.failed
        }
      }
    }

    result.pending = await this.storage.count(tenant, 'pending')
    return result
  }

  /**
   * Decides and records the outcome of every conflict. Local winners and merged
   * winners go back on the queue as `pending` so the next push sends them;
   * remote winners leave the queue, because the remote already has the data.
   */
  async resolveConflicts(
    tenantId: string,
    conflicts: Conflict[],
    options: SyncOptions = {},
  ): Promise<ConflictResolution[]> {
    const tenant = requireTenantId(tenantId, 'SyncEngine.resolveConflicts')
    const resolutions: ConflictResolution[] = []
    for (const conflict of conflicts) {
      const local = requireTenantId(conflict?.local?.tenantId, 'SyncEngine.resolveConflicts')
      const remote = requireTenantId(conflict?.remote?.tenantId, 'SyncEngine.resolveConflicts')
      if (local !== tenant || remote !== tenant) {
        throw new Error(
          `SyncEngine.resolveConflicts: conflict ${conflict.id} crosses tenants — refusing to resolve across tenants`,
        )
      }
      const resolution = await this.resolveOne(conflict, options)
      if (resolution.winner === 'remote') {
        await this.storage.remove([conflict.local.id])
      } else {
        await this.storage.put({
          ...conflict.local,
          data: resolution.data,
          syncStatus: 'pending',
          timestamp: this.clock(),
        })
      }
      resolutions.push(resolution)
    }
    return resolutions
  }

  async clear(tenantId: string): Promise<void> {
    await this.storage.clear(requireTenantId(tenantId, 'SyncEngine.clear'))
  }

  /** Queue depth for one tenant. Read-only. */
  async count(tenantId: string, status?: SyncStatus): Promise<number> {
    return this.storage.count(requireTenantId(tenantId, 'SyncEngine.count'), status)
  }

  /** The queue's pending records, after the run's scope filter. */
  private async fetchPending(
    tenantId: string,
    limit: number,
    filter?: (record: SyncRecord) => boolean,
  ): Promise<SyncRecord[]> {
    const rows = await this.storage.getPending(tenantId, limit)
    return filter ? rows.filter(filter) : rows
  }

  /**
   * Records the remote's verdict for one pushed record: drop it on success,
   * park it as failed with its retry count bumped on failure, or resolve the
   * conflict and say whether the winner still needs to go out.
   */
  private async settle(
    record: SyncRecord,
    outcome: PushOutcome,
    options: SyncOptions,
  ): Promise<{ synced: number; conflicts: number; failed: number; requeue: SyncRecord | null }> {
    if (outcome.status === 'synced') {
      await this.storage.remove([record.id])
      return { synced: 1, conflicts: 0, failed: 0, requeue: null }
    }
    if (outcome.status === 'failed') {
      await this.storage.put({ ...record, syncStatus: 'failed', retryCount: record.retryCount + 1 })
      return { synced: 0, conflicts: 0, failed: 1, requeue: null }
    }
    if (!outcome.remote) {
      await this.storage.put({ ...record, syncStatus: 'conflict' })
      return { synced: 0, conflicts: 1, failed: 0, requeue: null }
    }
    const resolution = await this.resolveOne({ id: record.id, local: record, remote: outcome.remote }, options)
    if (resolution.winner === 'remote') {
      // The remote already holds the winning data; drop the local copy.
      await this.storage.remove([record.id])
      return { synced: 0, conflicts: 1, failed: 0, requeue: null }
    }
    const winner: SyncRecord = {
      ...record,
      data: resolution.data,
      syncStatus: 'pending',
      timestamp: this.clock(),
    }
    await this.storage.put(winner)
    return { synced: 0, conflicts: 1, failed: 0, requeue: winner }
  }

  private async resolveOne(
    conflict: Conflict,
    options: SyncOptions,
  ): Promise<ConflictResolution> {
    const strategy = options.config?.strategy ?? this.config.strategy
    let decide: ((c: Conflict) => ConflictDecision | undefined) | undefined
    if (strategy === 'ask-user') {
      if (!options.onConflict) throw new AskUserWithoutDeciderError()
      // Awaited here so applyStrategy stays a pure synchronous decision.
      const chosen = await options.onConflict(conflict)
      decide = () => chosen
    }
    return applyStrategy(strategy, conflict, decide)
  }

  /**
   * Pushes a batch in one call, then retries each failure individually up to
   * `retryAttempts`, so one bad record does not fail its batch-mates.
   */
  private async pushBatch(
    remote: SyncRemote,
    tenantId: string,
    batch: SyncRecord[],
    config: SyncConfig,
  ): Promise<PushOutcome[]> {
    const outcomes: PushOutcome[] = []
    let batchCallFailed: string | undefined
    let batchOutcomes: PushOutcome[] = []
    try {
      batchOutcomes = await remote.push(tenantId, batch)
    } catch (error) {
      batchCallFailed = error instanceof Error ? error.message : String(error)
    }

    for (const record of batch) {
      const fromBatch = batchCallFailed
        ? undefined
        : batchOutcomes.find((o) => o.id === record.id)
      if (fromBatch && fromBatch.status !== 'failed') {
        outcomes.push(fromBatch)
        continue
      }
      outcomes.push(
        await this.retryRecord(remote, tenantId, record, config, fromBatch?.error ?? batchCallFailed),
      )
    }
    return outcomes
  }

  private async retryRecord(
    remote: SyncRemote,
    tenantId: string,
    record: SyncRecord,
    config: SyncConfig,
    firstError?: string,
  ): Promise<PushOutcome> {
    const attempts = Math.max(1, config.retryAttempts)
    let lastError = firstError ?? 'remote reported failure'
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const outcomes = await remote.push(tenantId, [record])
        const outcome = outcomes.find((o) => o.id === record.id)
        if (outcome && outcome.status !== 'failed') return outcome
        lastError = outcome?.error ?? 'remote returned no outcome for this record'
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      if (attempt < attempts) await this.sleep(config.retryDelayMs)
    }
    return { id: record.id, status: 'failed', error: lastError }
  }
}