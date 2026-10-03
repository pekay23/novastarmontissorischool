/**
 * HTTP client for the portal's sync API — the `SyncRemote` half of
 * `SyncEngine.sync`.
 *
 * The remote is injected rather than reached for from the engine, because a
 * bare URL cannot carry a service token, and a request without a timeout hangs a
 * cron job forever. Both of those live here instead.
 *
 * Two things this client will not do:
 *   - treat a non-2xx response as success. Every non-2xx becomes a
 *     `RemoteSyncError`, so a 500 with a JSON body that looks like data cannot be
 *     mistaken for an acknowledgement.
 *   - accept a record for a tenant other than the one it asked about.
 *
 * NOTE: `apps/portal/app/api/sync/route.ts` does not exist yet — it is Phase 5
 * of the build plan and lives in the portal, which this workspace does not own.
 * Until it does, push/pull fail with a 404 that names the missing route.
 */
import type { PushOutcome, SyncRemote } from '@novastar/sync-engine'
import type { SyncRecord } from '@novastar/shared-types'
import { redact } from '../config'

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_BODY_CHARS = 500

export class RemoteSyncError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'RemoteSyncError'
    this.status = status
  }
}

export interface RemoteOptions {
  baseUrl: string
  /** Service token, not a user session. Never logged. */
  token: string
  timeoutMs?: number
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

/** SyncRecord with its Date fields as ISO strings, which is what JSON carries. */
interface WireRecord {
  id: string
  tenantId: string
  entityType: string
  entityId: string
  table: string
  recordId: string
  operation: SyncRecord['operation']
  data: Record<string, unknown>
  syncStatus: SyncRecord['syncStatus']
  timestamp: string
  retryCount: number
}

function toWire(record: SyncRecord): WireRecord {
  return { ...record, timestamp: record.timestamp.toISOString() }
}

function fromWire(value: unknown, tenantId: string, where: string): SyncRecord {
  const row = value as Partial<WireRecord> | null
  if (!row || typeof row.id !== 'string' || typeof row.recordId !== 'string') {
    throw new RemoteSyncError(`${where}: the remote returned a record with no id or recordId`)
  }
  if (row.tenantId !== tenantId) {
    throw new RemoteSyncError(
      `${where}: the remote returned a record for a different tenant — refusing to store it`,
    )
  }
  const timestamp = new Date(row.timestamp ?? Number.NaN)
  if (Number.isNaN(timestamp.getTime())) {
    throw new RemoteSyncError(`${where}: the remote returned a record with an unparseable timestamp`)
  }
  const table = row.table ?? row.entityType ?? row.recordId
  return {
    id: row.id,
    tenantId: row.tenantId,
    entityType: row.entityType ?? table,
    entityId: row.entityId ?? row.recordId,
    table,
    recordId: row.recordId,
    operation: row.operation ?? 'upsert',
    data: (row.data as Record<string, unknown>) ?? {},
    syncStatus: row.syncStatus ?? 'synced',
    timestamp,
    retryCount: Number(row.retryCount ?? 0),
  }
}

export class PortalSyncRemote implements SyncRemote {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: RemoteOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async push(tenantId: string, records: SyncRecord[]): Promise<PushOutcome[]> {
    if (!tenantId) throw new RemoteSyncError('push requires a tenantId')
    if (records.length === 0) return []
    const body = await this.request('POST', '/api/sync', tenantId, { tenantId, records: records.map(toWire) })
    const outcomes = (body as { outcomes?: unknown }).outcomes
    if (!Array.isArray(outcomes)) {
      throw new RemoteSyncError('push: the remote did not return an `outcomes` array')
    }
    const byId = new Map(records.map((r) => [r.id, r]))
    return outcomes.map((raw) => {
      const outcome = raw as { id?: unknown; status?: unknown; remote?: unknown; error?: unknown }
      const record = typeof outcome.id === 'string' ? byId.get(outcome.id) : undefined
      if (!record) {
        throw new RemoteSyncError('push: the remote returned an outcome for a record that was not sent')
      }
      if (outcome.status === 'conflict') {
        return {
          id: record.id,
          status: 'conflict',
          remote: fromWire(outcome.remote, tenantId, 'push'),
        }
      }
      if (outcome.status === 'failed') {
        return { id: record.id, status: 'failed', error: String(outcome.error ?? 'remote reported failure') }
      }
      if (outcome.status !== 'synced') {
        throw new RemoteSyncError(`push: unknown outcome status ${JSON.stringify(outcome.status)}`)
      }
      return { id: record.id, status: 'synced' }
    })
  }

  async pull(tenantId: string, since: Date | null): Promise<SyncRecord[]> {
    if (!tenantId) throw new RemoteSyncError('pull requires a tenantId')
    const query = since ? `?since=${encodeURIComponent(since.toISOString())}` : ''
    const body = await this.request('GET', `/api/sync${query}`, tenantId)
    const records = (body as { records?: unknown }).records
    if (!Array.isArray(records)) {
      throw new RemoteSyncError('pull: the remote did not return a `records` array')
    }
    return records.map((raw) => fromWire(raw, tenantId, 'pull'))
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    tenantId: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = new URL(path, this.options.baseUrl)

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.token}`,
          // The tenant also travels in a header: the portal route must take the
          // tenant from the authenticated service token, not from the body it
          // is being handed.
          'x-tenant-id': tenantId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new RemoteSyncError(
        `${method} ${redact(url.toString())} failed: ${message} (timeout ${this.timeoutMs}ms)`,
      )
    }

    const text = await response.text()
    if (!response.ok) {
      throw new RemoteSyncError(
        `${method} ${redact(url.toString())} returned ${response.status}: ${text.slice(0, MAX_BODY_CHARS)}`,
        response.status,
      )
    }
    if (text === '') return {}
    try {
      return JSON.parse(text)
    } catch {
      throw new RemoteSyncError(
        `${method} ${redact(url.toString())} returned a body that is not JSON: ${text.slice(0, MAX_BODY_CHARS)}`,
        response.status,
      )
    }
  }
}