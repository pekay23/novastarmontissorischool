import { describe, expect, test } from 'bun:test'
import {
  IndexedDbSyncStorage,
  MemorySyncStorage,
  MissingTenantError,
  type SyncRecord,
} from '../index'

const TENANT = 'tenant-a'
const OTHER = 'tenant-b'

function record(id: string, tenantId = TENANT, status: SyncRecord['syncStatus'] = 'pending'): SyncRecord {
  return {
    id,
    tenantId,
    entityType: 'students',
    entityId: id,
    table: 'students',
    recordId: id,
    operation: 'upsert',
    data: { id },
    syncStatus: status,
    timestamp: new Date(`2026-01-0${id.slice(-1)}T00:00:00.000Z`),
    retryCount: 0,
  }
}

describe('MemorySyncStorage', () => {
  test('stores, filters and counts per tenant', async () => {
    const storage = new MemorySyncStorage()
    await storage.put(record('r1'))
    await storage.put(record('r2', TENANT, 'conflict'))
    await storage.put(record('r3', OTHER))

    expect((await storage.getPending(TENANT, 10)).map((r) => r.id)).toEqual(['r1'])
    expect((await storage.getAll(TENANT)).map((r) => r.id)).toEqual(['r1', 'r2'])
    expect((await storage.getAll(OTHER)).map((r) => r.id)).toEqual(['r3'])
    expect(await storage.count(TENANT)).toBe(2)
    expect(await storage.count(TENANT, 'conflict')).toBe(1)
    expect(await storage.count(OTHER)).toBe(1)
  })

  test('getPending returns oldest first and honours the limit', async () => {
    const storage = new MemorySyncStorage()
    await storage.put(record('r3'))
    await storage.put(record('r1'))
    await storage.put(record('r2'))
    expect((await storage.getPending(TENANT, 2)).map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  test('put replaces a record with the same id', async () => {
    const storage = new MemorySyncStorage()
    await storage.put(record('r1'))
    await storage.put({ ...record('r1'), syncStatus: 'synced' })
    expect(await storage.count(TENANT)).toBe(1)
    expect(await storage.count(TENANT, 'synced')).toBe(1)
  })

  test('remove drops only the named ids', async () => {
    const storage = new MemorySyncStorage()
    await storage.put(record('r1'))
    await storage.put(record('r2'))
    await storage.put(record('r3', OTHER))
    await storage.remove(['r1', 'r2'])
    expect(await storage.count(TENANT)).toBe(0)
    expect(await storage.count(OTHER)).toBe(1)
  })

  test('clear wipes one tenant only', async () => {
    const storage = new MemorySyncStorage()
    await storage.put(record('r1'))
    await storage.put(record('r2', OTHER))
    await storage.clear(TENANT)
    expect(await storage.count(TENANT)).toBe(0)
    expect(await storage.count(OTHER)).toBe(1)
  })

  test('every method refuses a missing tenantId', async () => {
    const storage = new MemorySyncStorage()
    for (const value of [undefined, '', '  '] as unknown as string[]) {
      expect(storage.getPending(value, 10)).rejects.toThrow(MissingTenantError)
      expect(storage.getAll(value)).rejects.toThrow(/tenantId is required/)
      expect(storage.clear(value)).rejects.toThrow(/tenantId is required/)
      expect(storage.count(value)).rejects.toThrow(/tenantId is required/)
      expect(storage.put({ ...record('r1'), tenantId: value })).rejects.toThrow(/tenantId is required/)
    }
    expect(storage.remove([])).rejects.toThrow(/ids is required/)
  })

  test('copies rows in and out so a caller cannot mutate the queue by reference', async () => {
    const storage = new MemorySyncStorage()
    await storage.put(record('r1'))
    const rows = await storage.getAll(TENANT)
    rows[0]!.syncStatus = 'synced'
    expect(await storage.count(TENANT, 'pending')).toBe(1)
  })
})

describe('IndexedDbSyncStorage', () => {
  test('refuses to pretend it persisted anything outside a browser', async () => {
    // Bun and Node have no IndexedDB. A silent no-op store is how a queue loses
    // writes, so this throws instead.
    if (typeof indexedDB !== 'undefined') return
    const storage = new IndexedDbSyncStorage()
    expect(storage.getAll(TENANT)).rejects.toThrow(/requires IndexedDB/)
    expect(storage.put(record('r1'))).rejects.toThrow(/requires IndexedDB/)
  })

  test('refuses a missing tenantId before touching storage', async () => {
    const storage = new IndexedDbSyncStorage()
    expect(storage.getAll('')).rejects.toThrow(MissingTenantError)
    expect(storage.clear(undefined as unknown as string)).rejects.toThrow(MissingTenantError)
    expect(storage.count('  ')).rejects.toThrow(MissingTenantError)
  })
})