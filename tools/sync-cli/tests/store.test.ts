import { describe, expect, test } from 'bun:test'
import { ServerStore, SyncQueueTableMissingError } from '../adapters/server-store'
import { createFakeDb, fixture, TENANT_A, TENANT_B } from './helpers'

/** The property under test: no statement reaches the database without a tenant. */
function assertTenantScoped(queries: { sql: string; params: unknown[] }[], tenantId: string): void {
  expect(queries.length).toBeGreaterThan(0)
  for (const query of queries) {
    expect(query.sql).toContain('tenant_id')
    expect(query.params).toContain(tenantId)
  }
}

const WRITE_METHODS: { name: string; run: (store: ServerStore) => Promise<unknown> }[] = [
  { name: 'getPending', run: (s) => s.getPending(TENANT_A, 10) },
  { name: 'getAll', run: (s) => s.getAll(TENANT_A) },
  { name: 'clear', run: (s) => s.clear(TENANT_A) },
  { name: 'count', run: (s) => s.count(TENANT_A) },
  { name: 'count with a status', run: (s) => s.count(TENANT_A, 'pending') },
  { name: 'listByStatus', run: (s) => s.listByStatus(TENANT_A, 'pending', 10) },
  { name: 'oldestPendingAt', run: (s) => s.oldestPendingAt(TENANT_A) },
  { name: 'lastSyncedAt', run: (s) => s.lastSyncedAt(TENANT_A) },
  { name: 'put', run: (s) => s.put(fixture()) },
  { name: 'remove', run: (s) => s.remove([fixture().id]) },
]

describe('ServerStore', () => {
  test('every statement it issues carries its tenant', async () => {
    for (const method of WRITE_METHODS) {
      const { db, queries } = createFakeDb()
      const store = new ServerStore(db, TENANT_A)
      await method.run(store)
      assertTenantScoped(queries, TENANT_A)
    }
  })

  test('a delete carries the tenant as well as the ids', async () => {
    const { db, queries } = createFakeDb([fixture()])
    const store = new ServerStore(db, TENANT_A)
    await store.remove([fixture().id])
    const [query] = queries
    expect(query!.sql).toMatch(/delete from sync_queue/i)
    expect(query!.sql).toContain('tenant_id')
    expect(query!.params).toEqual([[fixture().id], TENANT_A])
  })

  test('the upsert filters on conflict by tenant', async () => {
    const { db, queries } = createFakeDb()
    const store = new ServerStore(db, TENANT_A)
    await store.put(fixture())
    const [query] = queries
    expect(query!.sql).toMatch(/on conflict \(id\) do update/i)
    expect(query!.sql).toContain('sync_queue.tenant_id = EXCLUDED.tenant_id')
  })

  test('refuses to be built without a tenant', () => {
    const { db } = createFakeDb()
    expect(() => new ServerStore(db, '')).toThrow(/requires a tenantId/)
    expect(() => new ServerStore(db, undefined as unknown as string)).toThrow(/requires a tenantId/)
  })

  test('refuses a tenant it was not built for', async () => {
    const { db, queries } = createFakeDb([fixture({ tenantId: TENANT_B })])
    const store = new ServerStore(db, TENANT_A)
    expect(store.getAll(TENANT_B)).rejects.toThrow(/bound to/)
    expect(store.count(TENANT_B)).rejects.toThrow(/bound to/)
    expect(store.clear(TENANT_B)).rejects.toThrow(/bound to/)
    expect(store.put(fixture({ tenantId: TENANT_B }))).rejects.toThrow(/bound to/)
    // Nothing was asked of the database.
    expect(queries).toHaveLength(0)
  })

  test('refuses a missing tenantId', async () => {
    const { db } = createFakeDb()
    const store = new ServerStore(db, TENANT_A)
    expect(store.getAll('')).rejects.toThrow(/tenantId is required/)
    expect(store.count('  ')).rejects.toThrow(/tenantId is required/)
    expect(store.clear(undefined as unknown as string)).rejects.toThrow(/tenantId is required/)
    expect(store.remove([])).rejects.toThrow(/ids is required/)
  })

  test('reads and writes only its own tenant', async () => {
    const { db, rows } = createFakeDb([
      fixture({ id: '00000000-0000-4000-8000-00000000000a', tenantId: TENANT_A }),
      fixture({ id: '00000000-0000-4000-8000-00000000000b', tenantId: TENANT_B }),
    ])
    const store = new ServerStore(db, TENANT_A)

    expect((await store.getAll(TENANT_A)).map((r) => r.tenantId)).toEqual([TENANT_A])
    expect(await store.count(TENANT_A)).toBe(1)

    await store.clear(TENANT_A)
    expect([...rows.values()].map((r) => r.tenant_id)).toEqual([TENANT_B])
  })

  test('round-trips a record', async () => {
    const { db } = createFakeDb()
    const store = new ServerStore(db, TENANT_A)
    // Use ISO string for timestamp to exercise the coercion in toRecord (server-store.ts:61)
    const record = fixture({
      syncStatus: 'conflict',
      retryCount: 2,
      data: { id: 'x', nested: { a: [1, 2] } },
      // An ISO string, not a Date. `SyncRecord.timestamp` is typed `Date`, and
      // `fixture` types its overrides as `Partial<SyncRecord>`, so the string
      // cannot be passed through it without a cast that lies about the type.
      //
      // The cast is not a workaround for a wrong value: `put` coerces both
      // shapes on purpose (adapters/server-store.ts:135, `record.timestamp
      // instanceof Date ? record.timestamp : new Date(record.timestamp)`), which
      // is what makes this a real path rather than a contrived one. What the cast
      // records is that the annotation is narrower than the implementation —
      // the same gap `toRecord` closes for rows coming back out of the database
      // (server-store.ts:61). Passing the field through `fixture` instead would
      // typecheck only by widening `SyncRecord`, which is a production type
      // change and not this test's to make.
      timestamp: '2026-01-01T00:00:00.000Z' as unknown as Date,
    })
    await store.put(record)
    const [stored] = await store.getAll(TENANT_A)
    // toRecord coerces ISO string -> Date, so stored.timestamp is a Date
    expect(stored.timestamp).toBeInstanceOf(Date)
    expect(stored.timestamp.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(stored.syncStatus).toBe('conflict')
    expect(stored.retryCount).toBe(2)
    expect(stored.data).toEqual({ id: 'x', nested: { a: [1, 2] } })
  })

  test('a missing table is an error, not an empty queue', async () => {
    const db = {
      async query() {
        throw Object.assign(new Error('relation "sync_queue" does not exist'), { code: '42P01' })
      },
    }
    const store = new ServerStore(db, TENANT_A)
    expect(store.count(TENANT_A)).rejects.toThrow(SyncQueueTableMissingError)
    expect(store.count(TENANT_A)).rejects.toThrow(/tools\/sync-cli\/README.md/)
  })

  test('any other database error passes through unchanged', async () => {
    const db = {
      async query() {
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
      },
    }
    expect(new ServerStore(db, TENANT_A).count(TENANT_A)).rejects.toThrow(/connection refused/)
  })
})