import { describe, expect, test } from 'bun:test'
import { dispatch } from '../index'
import { Output } from '../output'
import * as clear from '../commands/clear'
import * as conflicts from '../commands/conflicts'
import * as drain from '../commands/drain'
import * as pending from '../commands/pending'
import * as push from '../commands/push'
import * as replay from '../commands/replay'
import * as resolve from '../commands/resolve'
import * as status from '../commands/status'
import * as sync from '../commands/sync'
import { createFakeRemote, createHarness, fixture, isWrite, TENANT_A, TENANT_B, type FakeRemote } from './helpers'
import type { SyncRecord } from '@novastar/shared-types'

const LOCAL_ID = '00000000-0000-4000-8000-00000000000a'
const SECOND_ID = '00000000-0000-4000-8000-00000000000c'
const REMOTE_ID = '00000000-0000-4000-8000-00000000000b'

/** A local record parked in the conflict state. */
function conflicted(timestamp: string, data: Record<string, unknown>, id = LOCAL_ID): SyncRecord {
  return fixture({ id, syncStatus: 'conflict', timestamp: new Date(timestamp), data })
}

/**
 * The remote's version of the same entity: a different queue id, the same
 * `recordId`, because that is how the CLI pairs the two sides of a conflict.
 */
function remoteVersion(
  timestamp: string,
  data: Record<string, unknown>,
  recordId = LOCAL_ID,
): SyncRecord {
  return fixture({
    id: REMOTE_ID,
    entityId: recordId,
    recordId,
    syncStatus: 'synced',
    timestamp: new Date(timestamp),
    data,
  })
}

/** Pushes that always conflict with an older remote version, so nothing drains. */
function alwaysConflicts(): FakeRemote {
  return createFakeRemote({
    pull: () => [],
    push: (records) =>
      records.map((record) => ({
        id: record.id,
        status: 'conflict' as const,
        remote: remoteVersion('2020-01-01T00:00:00.000Z', { stale: true }, record.recordId),
      })),
  })
}

describe('status', () => {
  test('is read-only: two runs issue zero writes', async () => {
    const harness = createHarness({
      seed: [
        conflicted('2026-01-01T00:00:00.000Z', { firstName: 'LOCAL' }),
        fixture({ id: REMOTE_ID, syncStatus: 'synced', timestamp: new Date('2026-01-02T00:00:00.000Z') }),
        fixture({ id: '00000000-0000-4000-8000-00000000000c', tenantId: TENANT_B }),
      ],
    })

    const first = await status.run(harness.ctx)
    const afterFirst = harness.fake.queries.length
    const second = await status.run(harness.ctx)

    expect(first).toBe(0)
    expect(second).toBe(0)
    expect(harness.fake.queries.length).toBeGreaterThan(afterFirst)
    expect(harness.fake.queries.filter((query) => isWrite(query.sql))).toEqual([])
    expect(harness.stdout.text()).toContain(`${TENANT_A}`)
  })

  test('reports real queue depth, not zero', async () => {
    const harness = createHarness({
      json: true,
      seed: [
        conflicted('2026-01-01T00:00:00.000Z', {}, LOCAL_ID),
        conflicted('2026-01-05T00:00:00.000Z', {}, SECOND_ID),
      ],
    })
    await status.run(harness.ctx)
    const summary = JSON.parse(harness.stdout.text())
    expect(summary).toMatchObject({
      tenantId: TENANT_A,
      total: 2,
      pending: 0,
      conflicts: 2,
      failed: 0,
      oldestPendingAt: null,
      lastSyncedAt: null,
    })
    // The connection string is redacted in anything an operator sees.
    expect(harness.stdout.text()).not.toContain('sync:sync')
  })

  test('oldestPendingAt and lastSyncedAt come from the queue, not from a guess', async () => {
    const harness = createHarness({
      json: true,
      seed: [
        fixture({ id: LOCAL_ID, timestamp: new Date('2026-01-01T00:00:00.000Z') }),
        fixture({ id: REMOTE_ID, syncStatus: 'synced', timestamp: new Date('2026-01-09T00:00:00.000Z') }),
        fixture({ id: SECOND_ID, timestamp: new Date('2026-01-05T00:00:00.000Z') }),
      ],
    })
    await status.run(harness.ctx)
    expect(JSON.parse(harness.stdout.text())).toMatchObject({
      oldestPendingAt: '2026-01-01T00:00:00.000Z',
      lastSyncedAt: '2026-01-09T00:00:00.000Z',
      pending: 2,
      synced: 1,
    })
  })

  test('counts stay inside one tenant', async () => {
    const harness = createHarness({
      json: true,
      seed: [fixture({ id: LOCAL_ID, tenantId: TENANT_B })],
    })
    await status.run(harness.ctx)
    expect(JSON.parse(harness.stdout.text())).toMatchObject({ total: 0, pending: 0 })
  })
})

describe('clear', () => {
  test('without --yes it refuses, states the row count, and writes nothing', async () => {
    const harness = createHarness({
      flags: { tenant: TENANT_A },
      seed: [fixture({ id: LOCAL_ID }), fixture({ id: REMOTE_ID, syncStatus: 'synced' })],
    })

    const code = await clear.run(harness.ctx)
    expect(code).toBe(1)
    expect(harness.fake.rows.size).toBe(2)
    expect(harness.fake.queries.filter((query) => isWrite(query.sql))).toEqual([])
    // The count is stated before the question, including how many are unsynced.
    expect(harness.stderr.text()).toContain('2 sync-queue row(s)')
    expect(harness.stderr.text()).toContain('1 unsynced change(s)')
    expect(harness.stderr.text()).toContain('--yes')
  })

  test('with --yes it deletes that tenant only', async () => {
    const harness = createHarness({
      flags: { tenant: TENANT_A, yes: true },
      seed: [
        fixture({ id: LOCAL_ID, tenantId: TENANT_A }),
        fixture({ id: REMOTE_ID, tenantId: TENANT_B }),
      ],
    })
    const code = await clear.run(harness.ctx)
    expect(code).toBe(0)
    expect([...harness.fake.rows.values()].map((row) => row.tenant_id)).toEqual([TENANT_B])
  })

  test('requires an explicit --tenant', async () => {
    const harness = createHarness({ flags: { yes: true } })
    // TENANT_ID is set in the environment and is deliberately not a fallback.
    expect(clear.run(harness.ctx)).rejects.toThrow(/--tenant is required/)
    expect(harness.fake.queries).toHaveLength(0)
  })
})

describe('resolve', () => {
  test('ask-user with no TTY exits non-zero and does not fall back', async () => {
    const harness = createHarness({
      flags: { strategy: 'ask-user' },
      env: { ...createHarness().ctx.env, SYNC_CONFLICT_STRATEGY: '' },
      isTty: false,
      seed: [conflicted('2026-01-01T00:00:00.000Z', {})],
    })

    const code = await resolve.run(harness.ctx)
    expect(code).toBe(1)
    expect(harness.stderr.text()).toContain('ask-user needs an interactive terminal')
    expect(harness.stderr.text()).toContain('no safe default to fall back to')
    // No store statement and no remote call happened.
    expect(harness.fake.queries).toHaveLength(0)
    expect(harness.remote.pulls).toBe(0)
    expect(harness.remote.pushes).toHaveLength(0)
  })

  test('ask-user with a TTY asks per record and honours the answer', async () => {
    const harness = createHarness({
      flags: { strategy: 'ask-user' },
      isTty: true,
      answers: ['remote'],
      seed: [conflicted('2026-01-01T00:00:00.000Z', { firstName: 'LOCAL' })],
      remote: createFakeRemote({ pull: () => [remoteVersion('2026-05-01T00:00:00.000Z', { firstName: 'REMOTE' })] }),
    })

    const code = await resolve.run(harness.ctx)
    expect(code).toBe(0)
    expect(harness.stdout.text()).toContain('resolved')
    expect(harness.fake.rows.size).toBe(0)
  })

  test('last-write-wins applies the newer record, and the clock is injected', async () => {
    const harness = createHarness({
      json: true,
      seed: [conflicted('2026-01-01T00:00:00.000Z', { firstName: 'LOCAL' })],
      now: new Date('2026-10-03T09:00:00.000Z'),
      remote: createFakeRemote({ pull: () => [remoteVersion('2026-05-01T00:00:00.000Z', { firstName: 'REMOTE' })] }),
    })

    const code = await resolve.run(harness.ctx)
    expect(code).toBe(0)
    const summary = JSON.parse(harness.stdout.text())
    expect(summary).toMatchObject({ strategy: 'last-write-wins', resolved: 1, remote: 1, local: 0 })
    // The remote already held the newer data, so the local copy is gone and
    // nothing was pushed.
    expect(harness.fake.rows.size).toBe(0)
    expect(harness.remote.pushes).toHaveLength(0)
  })

  test('last-write-wins keeps the newer local record and pushes it', async () => {
    const harness = createHarness({
      json: true,
      seed: [conflicted('2026-09-01T00:00:00.000Z', { firstName: 'LOCAL' })],
      remote: createFakeRemote({ pull: () => [remoteVersion('2026-05-01T00:00:00.000Z', { firstName: 'REMOTE' })] }),
    })

    const code = await resolve.run(harness.ctx)
    expect(code).toBe(0)
    expect(JSON.parse(harness.stdout.text())).toMatchObject({ resolved: 1, local: 1, pushed: { synced: 1 } })
    expect(harness.remote.pushes).toHaveLength(1)
    expect(harness.fake.rows.size).toBe(0)
  })

  test('merge keeps both sides', async () => {
    const harness = createHarness({
      json: true,
      flags: { strategy: 'merge' },
      seed: [conflicted('2026-09-01T00:00:00.000Z', { firstName: 'LOCAL' })],
      remote: createFakeRemote({
        pull: () => [remoteVersion('2026-05-01T00:00:00.000Z', { firstName: 'REMOTE', city: 'Accra' })],
      }),
    })
    await resolve.run(harness.ctx)
    expect(JSON.parse(harness.stdout.text())).toMatchObject({ merged: 1 })
    expect(harness.remote.pushes[0]?.[0]?.data).toEqual({ firstName: 'LOCAL', city: 'Accra' })
  })

  test('refuses without a strategy rather than defaulting', async () => {
    const harness = createHarness({
      env: { ...createHarness().ctx.env, SYNC_CONFLICT_STRATEGY: '' },
      seed: [conflicted('2026-09-01T00:00:00.000Z', {})],
    })
    expect(resolve.run(harness.ctx)).rejects.toThrow(/--strategy/)
  })

  test('a conflict with no remote side is left alone and reported', async () => {
    const harness = createHarness({
      json: true,
      seed: [conflicted('2026-09-01T00:00:00.000Z', {})],
      remote: createFakeRemote({ pull: () => [] }),
    })
    const code = await resolve.run(harness.ctx)
    expect(code).toBe(1)
    expect(JSON.parse(harness.stdout.text())).toMatchObject({ resolved: 0 })
    expect(harness.stderr.text()).toContain('No remote version found')
    expect(harness.fake.rows.size).toBe(1)
  })
})

describe('pending and conflicts', () => {
  test('pending lists only this tenant, oldest first', async () => {
    const harness = createHarness({
      seed: [
        fixture({ id: LOCAL_ID, timestamp: new Date('2026-02-01T00:00:00.000Z') }),
        fixture({ id: REMOTE_ID, timestamp: new Date('2026-01-01T00:00:00.000Z') }),
        fixture({ id: '00000000-0000-4000-8000-00000000000c', tenantId: TENANT_B }),
      ],
    })
    expect(await pending.run(harness.ctx)).toBe(0)
    const lines = harness.stdout.text().split('\n')
    expect(lines[0]).toContain('recordId')
    expect(harness.stdout.text()).toContain('2 pending change(s)')
    expect(harness.fake.queries.filter((query) => isWrite(query.sql))).toEqual([])
  })

  test('conflicts exits non-zero while any are unresolved', async () => {
    const empty = createHarness()
    expect(await conflicts.run(empty.ctx)).toBe(0)

    const harness = createHarness({ seed: [conflicted('2026-01-01T00:00:00.000Z', {})] })
    expect(await conflicts.run(harness.ctx)).toBe(1)
    expect(harness.stdout.text()).toContain('resolve --strategy')
  })
})

describe('sync, push and pull', () => {
  test('push never pulls', async () => {
    const harness = createHarness({ seed: [fixture()] })
    expect(await push.run(harness.ctx)).toBe(0)
    expect(harness.remote.pulls).toBe(0)
    expect(harness.remote.pushes).toHaveLength(1)
    expect(harness.fake.rows.size).toBe(0)
  })

  test('pull never pushes', async () => {
    const harness = createHarness({
      remote: createFakeRemote({ pull: () => [fixture({ id: REMOTE_ID, syncStatus: 'synced' })] }),
    })
    expect(await sync.runDirection(harness.ctx, 'pull')).toBe(0)
    expect(harness.remote.pushes).toHaveLength(0)
    expect(harness.remote.pulls).toBe(1)
  })

  test('a sync whose pushes fail exits non-zero instead of reporting success', async () => {
    const harness = createHarness({
      seed: [fixture()],
      remote: createFakeRemote({ push: (records) => records.map((r) => ({ id: r.id, status: 'failed', error: 'nope' })) }),
    })
    expect(await sync.run(harness.ctx)).toBe(1)
  })
})

describe('drain', () => {
  test('drains an empty queue immediately', async () => {
    const harness = createHarness({ json: true })
    expect(await drain.run(harness.ctx)).toBe(0)
    expect(JSON.parse(harness.stdout.text())).toMatchObject({
      iterations: 0,
      stoppedBy: 'drained',
      drained: true,
      pendingRemaining: 0,
    })
  })

  test('stops on a poison record instead of looping', async () => {
    const harness = createHarness({
      json: true,
      seed: [fixture()],
      remote: alwaysConflicts(),
    })

    const code = await drain.run(harness.ctx)
    expect(code).toBe(1)
    const summary = JSON.parse(harness.stdout.text())
    expect(summary.stoppedBy).toBe('no-progress')
    expect(summary.iterations).toBe(1)
    expect(summary.maxIterations).toBe(10)
    expect(summary.pendingRemaining).toBe(1)
  })

  test('reports failure even when nothing is left pending', async () => {
    const harness = createHarness({
      json: true,
      seed: [fixture()],
      remote: createFakeRemote({ push: (records) => records.map((r) => ({ id: r.id, status: 'failed', error: 'rejected' })) }),
    })
    expect(await drain.run(harness.ctx)).toBe(1)
    expect(JSON.parse(harness.stdout.text())).toMatchObject({ drained: true, failed: 1 })
  })

  test('honours --max-iterations', async () => {
    const harness = createHarness({
      json: true,
      flags: { 'max-iterations': '1' },
      seed: [fixture({ id: LOCAL_ID }), fixture({ id: SECOND_ID, recordId: SECOND_ID, entityId: SECOND_ID })],
      remote: createFakeRemote({
        push: (records) =>
          records.map((r) =>
            r.id === LOCAL_ID
              ? { id: r.id, status: 'synced' as const }
              : {
                  id: r.id,
                  status: 'conflict' as const,
                  remote: remoteVersion('2020-01-01T00:00:00.000Z', { stale: true }, r.recordId),
                },
          ),
      }),
    })
    expect(await drain.run(harness.ctx)).toBe(1)
    expect(JSON.parse(harness.stdout.text())).toMatchObject({
      maxIterations: 1,
      iterations: 1,
      drained: false,
      stoppedBy: 'max-iterations',
      pendingRemaining: 1,
    })
  })
})

describe('replay', () => {
  test('--dry-run re-queues nothing', async () => {
    const harness = createHarness({
      json: true,
      flags: { 'dry-run': true },
      seed: [fixture({ syncStatus: 'failed', retryCount: 3 })],
    })
    expect(await replay.run(harness.ctx)).toBe(0)
    expect(harness.fake.queries.filter((query) => isWrite(query.sql))).toEqual([])
    expect(JSON.parse(harness.stdout.text())).toMatchObject({ replayed: 1, dryRun: true })
  })

  test('puts failed records back on the queue', async () => {
    const harness = createHarness({ seed: [fixture({ syncStatus: 'failed', retryCount: 3 })] })
    expect(await replay.run(harness.ctx)).toBe(0)
    expect([...harness.fake.rows.values()][0]?.sync_status).toBe('pending')
    expect([...harness.fake.rows.values()][0]?.retry_count).toBe(3)
  })
})

describe('dispatch', () => {
  function captureOutput(): { out: Output; stdout: () => string; stderr: () => string } {
    const chunks: string[] = []
    const errors: string[] = []
    return {
      out: new Output(
        {},
        { write: (chunk: string) => { chunks.push(chunk); return true } },
        { write: (chunk: string) => { errors.push(chunk); return true } },
      ),
      stdout: () => chunks.join(''),
      stderr: () => errors.join(''),
    }
  }

  test('--help works with no database and no token', async () => {
    const capture = captureOutput()
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL = ''
    try {
      expect(await dispatch(['--help'], capture.out)).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previous
    }
    expect(capture.stdout()).toContain('novastar-sync')
    expect(capture.stdout()).toContain('DESTROYS UNSYNCED WORK')
  })

  test('a command with no arguments prints help and exits 0', async () => {
    const capture = captureOutput()
    expect(await dispatch([], capture.out)).toBe(0)
    expect(capture.stdout()).toContain('Usage:')
  })

  test('a missing DATABASE_URL exits non-zero and names the variable', async () => {
    const capture = captureOutput()
    const saved = { DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL }
    process.env.DATABASE_URL = ''
    process.env.DIRECT_URL = ''
    try {
      const code = await dispatch(['status', '--tenant', 'school-a'], capture.out)
      expect(code).toBe(1)
      expect(capture.stderr()).toContain('DATABASE_URL')
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  test('an unknown command exits 2', async () => {
    const capture = captureOutput()
    expect(await dispatch(['frobnicate'], capture.out)).toBe(2)
    expect(capture.stderr()).toContain('Unknown command')
  })
})