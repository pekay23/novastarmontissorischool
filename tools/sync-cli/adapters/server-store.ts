/**
 * `SyncStorage` over Postgres — Option A of the build plan. This is what lets
 * `tools/sync-cli` drive `@novastar/sync-engine` outside a browser, where
 * IndexedDB does not exist.
 *
 * Two independent guards keep this tenant-safe, and both are required:
 *
 *   1. Every statement carries a `tenant_id` predicate, and the bound tenant id
 *      is always passed as a bind parameter — never interpolated.
 *   2. Every method is bound to one tenant at construction and rejects any
 *      other. A store for tenant A cannot read or write tenant B even if a
 *      caller asks it to.
 *
 * The table is not in `packages/database/prisma/schema.prisma`; the DDL is in
 * tools/sync-cli/README.md. A missing table surfaces as
 * `SyncQueueTableMissingError` rather than an empty result, because a status
 * report of "no queued changes" that is really "no table" is a lie.
 */
import type { SyncStatus, SyncStorage } from '@novastar/sync-engine'
import type { SyncRecord } from '@novastar/shared-types'

export const SYNC_QUEUE_TABLE = 'sync_queue'

/** Postgres undefined table. */
const UNDEFINED_TABLE = '42P01'

/** The subset of `pg` this store needs, so a test can record every statement. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>
  end?(): Promise<void>
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
  sync_status: SyncStatus
  recorded_at: Date | string
  retry_count: number
}

const COLUMNS =
  'id, tenant_id, entity_type, entity_id, table_name, record_id, operation, data, sync_status, recorded_at, retry_count'

function toRecord(row: QueueRow): SyncRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    table: row.table_name,
    recordId: row.record_id,
    operation: row.operation,
    data: row.data,
    syncStatus: row.sync_status,
    timestamp: row.recorded_at instanceof Date ? row.recorded_at : new Date(row.recorded_at),
    retryCount: Number(row.retry_count ?? 0),
  }
}

export class SyncQueueTableMissingError extends Error {
  constructor(table: string) {
    super(
      `relation "${table}" does not exist. Apply the DDL in tools/sync-cli/README.md before using this tool — ` +
        'the table is not part of packages/database/prisma/schema.prisma.',
    )
    this.name = 'SyncQueueTableMissingError'
  }
}

/**
 * A `SyncStorage` bound to exactly one tenant. Construct it per tenant; there
 * is no unbound mode, because an unbound store is an unscoped query waiting to
 * happen.
 */
export class ServerStore implements SyncStorage {
  private readonly tenantId: string

  constructor(
    private readonly db: Queryable,
    tenantId: string,
  ) {
    if (!tenantId || tenantId.trim() === '') {
      throw new Error(
        'ServerStore requires a tenantId — an unbound store would query every tenant’s queue at once.',
      )
    }
    this.tenantId = tenantId
  }

  async getPending(tenantId: string, limit: number): Promise<SyncRecord[]> {
    const tenant = this.assertTenant(tenantId, 'getPending')
    const rows = await this.run<QueueRow>(
      `SELECT ${COLUMNS} FROM ${SYNC_QUEUE_TABLE}
       WHERE tenant_id = $1 AND sync_status = 'pending'
       ORDER BY recorded_at ASC
       LIMIT $2`,
      [tenant, limit],
    )
    return rows.rows.map(toRecord)
  }

  async put(record: SyncRecord): Promise<void> {
    const tenant = this.assertTenant(record?.tenantId, 'put')
    await this.run(
      `INSERT INTO ${SYNC_QUEUE_TABLE}
         (id, tenant_id, entity_type, entity_id, table_name, record_id, operation, data, sync_status, recorded_at, retry_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         entity_type = EXCLUDED.entity_type,
         entity_id = EXCLUDED.entity_id,
         table_name = EXCLUDED.table_name,
         record_id = EXCLUDED.record_id,
         operation = EXCLUDED.operation,
         data = EXCLUDED.data,
         sync_status = EXCLUDED.sync_status,
         recorded_at = EXCLUDED.recorded_at,
         retry_count = EXCLUDED.retry_count
       WHERE ${SYNC_QUEUE_TABLE}.tenant_id = EXCLUDED.tenant_id`,
      [
        record.id,
        tenant,
        record.entityType,
        record.entityId,
        record.table,
        record.recordId,
        record.operation,
        JSON.stringify(record.data ?? {}),
        record.syncStatus,
        record.timestamp instanceof Date ? record.timestamp : new Date(record.timestamp),
        record.retryCount,
      ],
    )
  }

  async remove(ids: string[]): Promise<void> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('ServerStore.remove: ids is required — an unbounded delete has no tenant to scope it to')
    }
    await this.run(
      `DELETE FROM ${SYNC_QUEUE_TABLE} WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [ids, this.tenantId],
    )
  }

  async getAll(tenantId: string): Promise<SyncRecord[]> {
    const tenant = this.assertTenant(tenantId, 'getAll')
    const rows = await this.run<QueueRow>(
      `SELECT ${COLUMNS} FROM ${SYNC_QUEUE_TABLE} WHERE tenant_id = $1 ORDER BY recorded_at ASC`,
      [tenant],
    )
    return rows.rows.map(toRecord)
  }

  async clear(tenantId: string): Promise<void> {
    const tenant = this.assertTenant(tenantId, 'clear')
    await this.run(`DELETE FROM ${SYNC_QUEUE_TABLE} WHERE tenant_id = $1`, [tenant])
  }

  async count(tenantId: string, status?: SyncStatus): Promise<number> {
    const tenant = this.assertTenant(tenantId, 'count')
    const rows = status
      ? await this.run<{ count: number }>(
          `SELECT count(*)::int AS count FROM ${SYNC_QUEUE_TABLE} WHERE tenant_id = $1 AND sync_status = $2`,
          [tenant, status],
        )
      : await this.run<{ count: number }>(
          `SELECT count(*)::int AS count FROM ${SYNC_QUEUE_TABLE} WHERE tenant_id = $1`,
          [tenant],
        )
    return Number(rows.rows[0]?.count ?? 0)
  }

  /** Records in one state, oldest first. Used by pending/conflicts/replay. */
  async listByStatus(tenantId: string, status: SyncStatus, limit: number): Promise<SyncRecord[]> {
    const tenant = this.assertTenant(tenantId, 'listByStatus')
    const rows = await this.run<QueueRow>(
      `SELECT ${COLUMNS} FROM ${SYNC_QUEUE_TABLE}
       WHERE tenant_id = $1 AND sync_status = $2
       ORDER BY recorded_at ASC
       LIMIT $3`,
      [tenant, status, limit],
    )
    return rows.rows.map(toRecord)
  }

  /** When the oldest still-unsynced change was queued, or null if there is none. */
  async oldestPendingAt(tenantId: string): Promise<Date | null> {
    const tenant = this.assertTenant(tenantId, 'oldestPendingAt')
    const rows = await this.run<{ oldest: Date | string | null }>(
      `SELECT min(recorded_at) AS oldest FROM ${SYNC_QUEUE_TABLE} WHERE tenant_id = $1 AND sync_status = 'pending'`,
      [tenant],
    )
    const value = rows.rows[0]?.oldest
    return value ? new Date(value) : null
  }

  /** When the queue last drained, or null if it never has. */
  async lastSyncedAt(tenantId: string): Promise<Date | null> {
    const tenant = this.assertTenant(tenantId, 'lastSyncedAt')
    const rows = await this.run<{ latest: Date | string | null }>(
      `SELECT max(recorded_at) AS latest FROM ${SYNC_QUEUE_TABLE} WHERE tenant_id = $1 AND sync_status = 'synced'`,
      [tenant],
    )
    const value = rows.rows[0]?.latest
    return value ? new Date(value) : null
  }

  /** Rejects a tenant other than the one this store was built for. */
  private assertTenant(tenantId: string, method: string): string {
    if (!tenantId || tenantId.trim() === '') {
      throw new Error(`ServerStore.${method}: tenantId is required — there is no default tenant.`)
    }
    if (tenantId !== this.tenantId) {
      throw new Error(
        `ServerStore.${method}: refusing to operate on tenant ${tenantId} — this store is bound to ${this.tenantId}`,
      )
    }
    return tenantId
  }

  private async run<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<{ rows: T[] }> {
    try {
      return await this.db.query<T>(sql, params)
    } catch (error) {
      if ((error as { code?: string } | null)?.code === UNDEFINED_TABLE) {
        throw new SyncQueueTableMissingError(SYNC_QUEUE_TABLE)
      }
      throw error
    }
  }
}

export interface PoolLike extends Queryable {
  end(): Promise<void>
}

/**
 * Lazily imports `pg` so `--help` and argument errors never load the driver.
 * The connection string comes from `resolveConfig`; it is never logged.
 */
export async function createPool(connectionString: string): Promise<PoolLike> {
  const { Pool } = await import('pg')
  return new Pool({ connectionString, max: 4, application_name: 'novastar-sync-cli' }) as unknown as PoolLike
}