import { describe, expect, test } from 'bun:test'
import {
  AskUserWithoutDeciderError,
  MissingTenantError,
  MemorySyncStorage,
  SyncEngine,
  applyStrategy,
  type Conflict,
  type PushOutcome,
  type SyncRecord,
  type SyncRemote,
} from '../index'

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'

function record(overrides: Partial<SyncRecord> & { id: string; tenantId: string }): SyncRecord {
  return {
    entityType: 'students',
    entityId: overrides.id,
    table: 'students',
    recordId: overrides.id,
    operation: 'upsert',
    data: { id: overrides.id, firstName: 'Adwoa' },
    syncStatus: 'pending',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    retryCount: 0,
    ...overrides,
  }
}

interface FakeRemote {
  remote: SyncRemote
  pushed: string[][]
  pulls: number
}

function fakeRemote(
  respond: (records: SyncRecord[], attempt: number) => PushOutcome[] | Error,
  pull: (records: SyncRecord[]) => SyncRecord[] = () => [],
): FakeRemote {
  const state: FakeRemote = { remote: null as unknown as SyncRemote, pushed: [], pulls: 0 }
  const attempts = new Map<string, number>()
  state.remote = {
    async push(tenantId: string, records: SyncRecord[]) {
      if (!tenantId) throw new Error('push requires a tenant')
      state.pushed.push(records.map((r) => r.id))
      const attempt = (attempts.get(records[0]!.id) ?? 0) + 1
      attempts.set(records[0]!.id, attempt)
      const result = respond(records, attempt)
      if (result instanceof Error) throw result
      return result
    },
    async pull(tenantId: string) {
      if (!tenantId) throw new Error('pull requires a tenant')
      state.pulls++
      return pull([])
    },
  }
  return state
}

describe('SyncEngine storage injection', () => {
  test('the no-argument constructor still works (backwards compatibility)', () => {
    const engine = new SyncEngine()
    expect(engine).toBeInstanceOf(SyncEngine)
    expect(new SyncEngine({ strategy: 'merge', retryAttempts: 1, retryDelayMs: 0, batchSize: 5 })).toBeInstanceOf(
      SyncEngine,
    )
  })

  test('getPendingChanges returns the records an injected storage queued', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(undefined, storage)

    await engine.write('students', { id: 's1', tenantId: TENANT_A })
    await engine.write('students', { id: 's2', tenantId: TENANT_A })
    await engine.write('students', { id: 's3', tenantId: TENANT_A })
    await engine.write('students', { id: 's9', tenantId: TENANT_B })

    const pendingA = await engine.getPendingChanges(TENANT_A)
    expect(pendingA.map((r) => r.recordId).sort()).toEqual(['s1', 's2', 's3'])
    expect(pendingA.every((r) => r.syncStatus === 'pending')).toBe(true)

    // Tenant isolation is not a filter applied at the end: B's record is never
    // in A's pending set at all.
    const pendingB = await engine.getPendingChanges(TENANT_B)
    expect(pendingB.map((r) => r.recordId)).toEqual(['s9'])
  })

  test('getPendingChanges honours the injected limit', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(undefined, storage)
    for (const id of ['s1', 's2', 's3']) await engine.write('students', { id, tenantId: TENANT_A })
    expect(await engine.getPendingChanges(TENANT_A, 2)).toHaveLength(2)
  })

  test('write() stores the record instead of only returning it', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(undefined, storage)
    const written = await engine.write('students', { id: 's1', tenantId: TENANT_A, firstName: 'Kwame' })
    expect(written.syncStatus).toBe('pending')
    expect(written.timestamp).toBeInstanceOf(Date)
    const rows = await storage.getAll(TENANT_A)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(written.id)
  })

  test('write() uses the injected clock', async () => {
    const fixed = new Date('2026-03-04T05:06:07.000Z')
    const engine = new SyncEngine(undefined, new MemorySyncStorage(), { clock: () => fixed })
    const written = await engine.write('students', { id: 's1', tenantId: TENANT_A })
    expect(written.timestamp.toISOString()).toBe('2026-03-04T05:06:07.000Z')
  })
})

describe('SyncEngine tenant guards', () => {
  test('write() throws without a tenantId', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(undefined, storage)
    expect(engine.write('students', { id: 's1' })).rejects.toThrow(MissingTenantError)
    expect(await storage.count(TENANT_A)).toBe(0)
  })

  test('every queue method refuses a missing tenantId', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(undefined, storage)
    const missing = [undefined, '', '   '] as unknown as string[]
    for (const value of missing) {
      expect(engine.getPendingChanges(value)).rejects.toThrow(/tenantId is required/)
      expect(engine.clear(value)).rejects.toThrow(/tenantId is required/)
      expect(engine.count(value)).rejects.toThrow(/tenantId is required/)
      expect(engine.resolveConflicts(value, [])).rejects.toThrow(/tenantId is required/)
      expect(engine.sync(fakeRemote(() => []).remote, value)).rejects.toThrow(/tenantId is required/)
      expect(storage.getPending(value, 10)).rejects.toThrow(/tenantId is required/)
      expect(storage.getAll(value)).rejects.toThrow(/tenantId is required/)
      expect(storage.clear(value)).rejects.toThrow(/tenantId is required/)
      expect(storage.count(value)).rejects.toThrow(/tenantId is required/)
      expect(storage.put(record({ id: 'x', tenantId: value }))).rejects.toThrow(/tenantId is required/)
      expect(storage.remove([])).rejects.toThrow(/ids is required/)
    }
  })
})

describe('SyncEngine.sync', () => {
  test('refuses a bare endpoint string instead of pretending to sync', async () => {
    const engine = new SyncEngine(undefined, new MemorySyncStorage())
    expect(engine.sync('https://portal.example.com/api/sync' as unknown as SyncRemote, TENANT_A)).rejects.toThrow(
      /SyncRemote/,
    )
  })

  test('counts records the remote acknowledged and clears them from the queue', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(undefined, storage)
    await engine.write('students', { id: 's1', tenantId: TENANT_A })
    await engine.write('students', { id: 's2', tenantId: TENANT_A })

    const { remote } = fakeRemote((records) => records.map((r) => ({ id: r.id, status: 'synced' as const })))
    const result = await engine.sync(remote, TENANT_A)

    expect(result.synced).toBe(2)
    expect(result.conflicts).toBe(0)
    expect(result.pending).toBe(0)
    expect(await storage.count(TENANT_A, 'pending')).toBe(0)
  })

  test('never touches another tenant’s records', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(
      { strategy: 'last-write-wins', retryAttempts: 1, retryDelayMs: 0, batchSize: 10 },
      storage,
      { sleep: async () => {} },
    )
    const a = await engine.write('students', { id: 'a1', tenantId: TENANT_A })
    await engine.write('students', { id: 'b1', tenantId: TENANT_B })

    const { remote, pushed } = fakeRemote(() => [])
    // The remote acknowledges nothing, so tenant A's record ends up failed —
    // but only tenant A's, and only tenant A's id was ever offered to the remote.
    await engine.sync(remote, TENANT_A)
    expect(pushed.length).toBeGreaterThan(0)
    expect(pushed.flat().every((id) => id === a.id)).toBe(true)
    expect(await storage.count(TENANT_A, 'failed')).toBe(1)
    expect(await storage.count(TENANT_A, 'pending')).toBe(0)
    expect(await storage.count(TENANT_B, 'pending')).toBe(1)
    expect(await storage.count(TENANT_B, 'failed')).toBe(0)
  })

  test('a remote version that is newer wins, and the local copy leaves the queue', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(
      { strategy: 'last-write-wins', retryAttempts: 1, retryDelayMs: 0, batchSize: 10 },
      storage,
      { clock: () => new Date('2026-01-01T00:00:00.000Z') },
    )
    const local = record({ id: 's1', tenantId: TENANT_A, timestamp: new Date('2026-01-01T00:00:00.000Z') })
    await storage.put(local)
    const remoteVersion = record({
      id: 's1',
      tenantId: TENANT_A,
      syncStatus: 'synced',
      timestamp: new Date('2026-02-01T00:00:00.000Z'),
      data: { id: 's1', firstName: 'REMOTE' },
    })

    const { remote } = fakeRemote(() => [{ id: 's1', status: 'conflict', remote: remoteVersion }])
    const result = await engine.sync(remote, TENANT_A)

    expect(result.conflicts).toBe(1)
    expect(result.pending).toBe(0)
    expect(await storage.count(TENANT_A)).toBe(0)
  })

  test('a local version that is newer is re-queued and pushed again in the same run', async () => {
    const storage = new MemorySyncStorage()
    const resolvedAt = new Date('2026-06-01T12:00:00.000Z')
    const engine = new SyncEngine(
      { strategy: 'last-write-wins', retryAttempts: 1, retryDelayMs: 0, batchSize: 10 },
      storage,
      { clock: () => resolvedAt },
    )
    await storage.put(
      record({ id: 's1', tenantId: TENANT_A, timestamp: new Date('2026-05-01T00:00:00.000Z'), data: { firstName: 'LOCAL' } }),
    )
    const remoteVersion = record({
      id: 's1',
      tenantId: TENANT_A,
      syncStatus: 'synced',
      timestamp: new Date('2026-04-01T00:00:00.000Z'),
      data: { firstName: 'REMOTE' },
    })

    const { remote, pushed } = fakeRemote((records, attempt) =>
      // First push comes back divergent; the re-push of the local winner is
      // accepted.
      records.map((r) =>
        attempt === 1
          ? { id: r.id, status: 'conflict' as const, remote: remoteVersion }
          : { id: r.id, status: 'synced' as const },
      ),
    )
    const result = await engine.sync(remote, TENANT_A)

    expect(result.conflicts).toBe(1)
    expect(result.synced).toBe(1)
    expect(result.pending).toBe(0)
    expect(pushed).toEqual([['s1'], ['s1']])
    expect(await storage.count(TENANT_A, 'pending')).toBe(0)
  })

  test('merge keeps both sides', async () => {
    const resolution = applyStrategy('merge', {
      id: 's1',
      local: record({ id: 's1', tenantId: TENANT_A, data: { firstName: 'LOCAL', phone: '020' } }),
      remote: record({ id: 's1', tenantId: TENANT_A, data: { firstName: 'REMOTE', city: 'Accra' } }),
    })
    expect(resolution.winner).toBe('merged')
    expect(resolution.data).toEqual({ firstName: 'LOCAL', phone: '020', city: 'Accra' })
  })

  test('a push that keeps failing is retried and then reported, never dropped', async () => {
    const storage = new MemorySyncStorage()
    const sleeps: number[] = []
    const engine = new SyncEngine(
      { strategy: 'last-write-wins', retryAttempts: 3, retryDelayMs: 1000, batchSize: 10 },
      storage,
      { sleep: async (ms) => { sleeps.push(ms) } },
    )
    await storage.put(record({ id: 's1', tenantId: TENANT_A }))

    const { remote, pushed } = fakeRemote(() => new Error('remote is down'))
    const result = await engine.sync(remote, TENANT_A)

    expect(result.failed).toBe(1)
    expect(result.synced).toBe(0)
    expect(sleeps).toEqual([1000, 1000])
    // One batch attempt plus one retry per configured attempt.
    expect(pushed.length).toBe(1 + 3)
    const rows = await storage.getAll(TENANT_A)
    expect(rows[0]!.syncStatus).toBe('failed')
    expect(rows[0]!.retryCount).toBe(1)
  })

  test('ask-user without a decider refuses instead of falling back', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(
      { strategy: 'ask-user', retryAttempts: 1, retryDelayMs: 0, batchSize: 10 },
      storage,
    )
    await storage.put(record({ id: 's1', tenantId: TENANT_A }))
    const remoteVersion = record({ id: 's1', tenantId: TENANT_A, syncStatus: 'synced', data: { v: 'remote' } })
    const { remote } = fakeRemote(() => [{ id: 's1', status: 'conflict', remote: remoteVersion }])

    expect(engine.sync(remote, TENANT_A)).rejects.toThrow(AskUserWithoutDeciderError)
    // Nothing was resolved and nothing was lost.
    const rows = await storage.getAll(TENANT_A)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.syncStatus).toBe('pending')
  })

  test('ask-user uses the decider it is given', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(
      { strategy: 'ask-user', retryAttempts: 1, retryDelayMs: 0, batchSize: 10 },
      storage,
    )
    await storage.put(record({ id: 's1', tenantId: TENANT_A }))
    const remoteVersion = record({ id: 's1', tenantId: TENANT_A, syncStatus: 'synced', data: { v: 'remote' } })
    const { remote } = fakeRemote(() => [{ id: 's1', status: 'conflict', remote: remoteVersion }])

    const result = await engine.sync(remote, TENANT_A, { onConflict: (): 'remote' => 'remote' })
    expect(result.conflicts).toBe(1)
    expect(result.pending).toBe(0)
  })
})

describe('SyncEngine.resolveConflicts', () => {
  const local = record({
    id: 's1',
    tenantId: TENANT_A,
    data: { firstName: 'LOCAL' },
    timestamp: new Date('2026-05-01T00:00:00.000Z'),
  })
  const remoteVersion = record({
    id: 's1',
    tenantId: TENANT_A,
    syncStatus: 'synced',
    data: { firstName: 'REMOTE' },
    timestamp: new Date('2026-04-01T00:00:00.000Z'),
  })

  test('last-write-wins applies the newer record deterministically', async () => {
    const storage = new MemorySyncStorage()
    const resolvedAt = new Date('2026-07-07T07:07:07.000Z')
    const engine = new SyncEngine(
      { strategy: 'last-write-wins', retryAttempts: 1, retryDelayMs: 0, batchSize: 10 },
      storage,
      { clock: () => resolvedAt },
    )
    await storage.put({ ...local, syncStatus: 'conflict' })

    const conflict: Conflict = { id: local.id, local, remote: remoteVersion }
    const resolutions = await engine.resolveConflicts(TENANT_A, [conflict])

    expect(resolutions).toEqual([{ id: 's1', winner: 'local', data: { firstName: 'LOCAL' } }])
    const rows = await storage.getAll(TENANT_A)
    expect(rows[0]!.syncStatus).toBe('pending')
    expect(rows[0]!.timestamp.toISOString()).toBe('2026-07-07T07:07:07.000Z')
  })

  test('last-write-wins gives the remote when the remote is newer', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(undefined, storage)
    const olderLocal = { ...local, timestamp: new Date('2026-01-01T00:00:00.000Z') }
    const newerRemote = { ...remoteVersion, timestamp: new Date('2026-09-09T00:00:00.000Z') }
    await storage.put({ ...olderLocal, syncStatus: 'conflict' })

    const resolutions = await engine.resolveConflicts(TENANT_A, [
      { id: 's1', local: olderLocal, remote: newerRemote },
    ])
    expect(resolutions[0]!.winner).toBe('remote')
    expect(resolutions[0]!.data).toEqual({ firstName: 'REMOTE' })
    // The remote already holds the winner, so the local copy is dropped.
    expect(await storage.count(TENANT_A)).toBe(0)
  })

  test('a remote winner leaves the queue, because the remote already has the data', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(undefined, storage)
    const olderLocal = { ...local, timestamp: new Date('2026-01-01T00:00:00.000Z') }
    await storage.put({ ...olderLocal, syncStatus: 'conflict' })

    const resolutions = await engine.resolveConflicts(TENANT_A, [
      { id: 's1', local: olderLocal, remote: remoteVersion },
    ])
    expect(resolutions[0]!.winner).toBe('remote')
    expect(await storage.count(TENANT_A)).toBe(0)
  })

  test('refuses a conflict that crosses tenants', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(undefined, storage)
    const foreign = record({ id: 's2', tenantId: TENANT_B, syncStatus: 'conflict' })
    await storage.put(foreign)
    expect(
      engine.resolveConflicts(TENANT_A, [{ id: 's2', local: local, remote: { ...remoteVersion, tenantId: TENANT_B } }]),
    ).rejects.toThrow(/crosses tenants/)
  })
})

describe('SyncEngine.clear', () => {
  test('clears one tenant and leaves the other alone', async () => {
    const storage = new MemorySyncStorage()
    const engine = new SyncEngine(undefined, storage)
    await engine.write('students', { id: 'a1', tenantId: TENANT_A })
    await engine.write('students', { id: 'b1', tenantId: TENANT_B })

    await engine.clear(TENANT_A)
    expect(await storage.count(TENANT_A)).toBe(0)
    expect(await storage.count(TENANT_B)).toBe(1)
  })
})