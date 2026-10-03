import { describe, expect, test } from 'bun:test'
import { PortalSyncRemote, RemoteSyncError } from '../adapters/remote-endpoint'
import { fixture, TENANT_A, TENANT_B } from './helpers'
import type { SyncRecord } from '@novastar/shared-types'

interface Call {
  url: string
  init: RequestInit
}

function fakeFetch(response: Response | (() => Response)) {
  const calls: Call[] = []
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    return typeof response === 'function' ? response() : response
  }) as unknown as typeof fetch
  return { impl, calls }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const BASE = 'https://portal.example.test'

describe('PortalSyncRemote.push', () => {
  test('sends the tenant, the token and the records', async () => {
    const { impl, calls } = fakeFetch(json({ outcomes: [{ id: fixture().id, status: 'synced' }] }))
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 'service-token', fetchImpl: impl })
    const record = fixture()

    const outcomes = await remote.push(TENANT_A, [record])
    expect(outcomes).toEqual([{ id: record.id, status: 'synced' }])

    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer service-token')
    expect(headers['x-tenant-id']).toBe(TENANT_A)
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.tenantId).toBe(TENANT_A)
    // Dates go over the wire as ISO strings, not as Date objects.
    expect(body.records[0].timestamp).toBe('2026-01-01T00:00:00.000Z')
  })

  test('refuses to send without a tenant', async () => {
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: fakeFetch(json({})).impl })
    expect(remote.push('', [fixture()])).rejects.toThrow(/requires a tenantId/)
  })

  test('sends nothing for an empty batch', async () => {
    const { impl, calls } = fakeFetch(json({ outcomes: [] }))
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    expect(await remote.push(TENANT_A, [])).toEqual([])
    expect(calls).toHaveLength(0)
  })

  test('a 500 with a plausible body is an error, not an acknowledgement', async () => {
    const { impl } = fakeFetch(json({ outcomes: [{ id: 'x', status: 'synced' }] }, 500))
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    const error = await remote.push(TENANT_A, [fixture()]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RemoteSyncError)
    expect((error as RemoteSyncError).status).toBe(500)
    expect((error as Error).message).toContain('returned 500')
  })

  test('a body that is not JSON is an error', async () => {
    const { impl } = fakeFetch(new Response('<html>gateway</html>', { status: 200 }))
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    expect(remote.push(TENANT_A, [fixture()])).rejects.toThrow(/not JSON/)
  })

  test('a network failure is a typed error naming the endpoint', async () => {
    const impl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND portal.example.test')
    }) as unknown as typeof fetch
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    const error = await remote.push(TENANT_A, [fixture()]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RemoteSyncError)
    expect((error as Error).message).toContain('portal.example.test')
  })

  test('every request carries a timeout signal', async () => {
    const { impl, calls } = fakeFetch(json({ outcomes: [{ id: fixture().id, status: 'synced' }] }))
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', timeoutMs: 1234, fetchImpl: impl })
    await remote.push(TENANT_A, [fixture()])
    expect((calls[0]!.init.signal as AbortSignal | undefined)?.aborted).toBe(false)
  })

  test('an outcome for a record that was not sent is rejected', async () => {
    const { impl } = fakeFetch(json({ outcomes: [{ id: 'never-sent', status: 'synced' }] }))
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    expect(remote.push(TENANT_A, [fixture()])).rejects.toThrow(/record that was not sent/)
  })

  test('a conflict outcome carries the remote version through', async () => {
    const remoteVersion: SyncRecord = fixture({ id: 'remote-1', syncStatus: 'synced' })
    const { impl } = fakeFetch(
      json({
        outcomes: [
          {
            id: fixture().id,
            status: 'conflict',
            remote: { ...remoteVersion, timestamp: remoteVersion.timestamp.toISOString() },
          },
        ],
      }),
    )
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    const [outcome] = await remote.push(TENANT_A, [fixture()])
    expect(outcome!.status).toBe('conflict')
    expect(outcome!.remote!.timestamp).toBeInstanceOf(Date)
  })

  test('a conflict outcome for another tenant is refused', async () => {
    const { impl } = fakeFetch(
      json({
        outcomes: [
          {
            id: fixture().id,
            status: 'conflict',
            remote: { ...fixture({ id: 'remote-1', tenantId: TENANT_B }), timestamp: '2026-01-01T00:00:00.000Z' },
          },
        ],
      }),
    )
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    expect(remote.push(TENANT_A, [fixture()])).rejects.toThrow(/different tenant/)
  })
})

describe('PortalSyncRemote.pull', () => {
  test('returns parsed records', async () => {
    const record = fixture()
    const { impl, calls } = fakeFetch(json({ records: [{ ...record, timestamp: record.timestamp.toISOString() }] }))
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })

    const pulled = await remote.pull(TENANT_A, null)
    expect(pulled).toHaveLength(1)
    expect(pulled[0]!.timestamp).toBeInstanceOf(Date)
    expect(calls[0]!.url).toBe(`${BASE}/api/sync`)
  })

  test('passes a cursor when one is given', async () => {
    const { impl, calls } = fakeFetch(json({ records: [] }))
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    await remote.pull(TENANT_A, new Date('2026-01-01T00:00:00.000Z'))
    expect(calls[0]!.url).toBe(`${BASE}/api/sync?since=2026-01-01T00%3A00%3A00.000Z`)
  })

  test('refuses a record for another tenant', async () => {
    const { impl } = fakeFetch(
      json({ records: [{ ...fixture({ tenantId: TENANT_B }), timestamp: '2026-01-01T00:00:00.000Z' }] }),
    )
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    expect(remote.pull(TENANT_A, null)).rejects.toThrow(/different tenant/)
  })

  test('rejects a malformed record', async () => {
    const { impl } = fakeFetch(json({ records: [{ tenantId: TENANT_A, nope: true }] }))
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    expect(remote.pull(TENANT_A, null)).rejects.toThrow(/no id or recordId/)
  })

  test('rejects a response with no records array', async () => {
    const { impl } = fakeFetch(json({}))
    const remote = new PortalSyncRemote({ baseUrl: BASE, token: 't', fetchImpl: impl })
    expect(remote.pull(TENANT_A, null)).rejects.toThrow(/records/)
  })
})

describe('PortalSyncRemote', () => {
  test('the token never appears in an error message', async () => {
    const { impl } = fakeFetch(new Response('nope', { status: 401 }))
    const remote = new PortalSyncRemote({
      baseUrl: 'https://user:secret@portal.example.test',
      token: 'super-secret-token',
      fetchImpl: impl,
    })
    const error = (await remote.pull(TENANT_A, null).catch((e: unknown) => e)) as Error
    expect(error.message).not.toContain('super-secret-token')
    expect(error.message).not.toContain('secret')
    expect(error.message).toContain('***')
  })
})