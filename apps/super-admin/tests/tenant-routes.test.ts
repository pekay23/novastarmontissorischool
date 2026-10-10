// `./harness` first, always: it registers the `@/lib/prisma` mock, and every
// `@/lib/*` module below reaches the database. See the harness docstring and
// `bunfig.toml`, which preloads the harness so the mock cannot lose the race.
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  databaseCalls,
  fakeOperator,
  givenLiveOperator,
  mocks,
  operatorClaims,
  readJson,
  request,
  resetHarness,
  setCookies,
} from './harness'
import { ADMIN_SESSION_COOKIE, createSessionToken } from '@/lib/admin-auth'
import { TENANT_LIST_FIELDS } from '@/types/admin'

/**
 * The route handlers, and the two claims that matter most about them: an
 * unauthenticated caller gets nothing, and an operator sees only the fields the
 * response contract names.
 *
 * The field assertion is the one worth reading. `TENANT_LIST_FIELDS` is data, not
 * prose, so the test compares the response against the same list the components
 * render against. Adding a column to the Prisma `select` without deciding it
 * belongs in the API response fails here.
 *
 * A signed-in operator is now a *row*, so `signIn` arms both the cookie and the live
 * read behind it. A test that set only the cookie would pass against a console that
 * never checked the row at all.
 */

const PLATFORM_SESSION_SECRET = 'a-test-secret-that-is-long-enough-to-pass-32'
const OPERATOR = fakeOperator()

const { GET: GET_TENANTS, POST: POST_TENANTS } = await import('@/app/api/tenants/route')
const TENANT_ROUTE = await import('@/app/api/tenants/[tenantId]/route')
const SETTINGS_ROUTE = await import('@/app/api/tenants/[tenantId]/settings/route')
const AUDIT_ROUTE = await import('@/app/api/audit/route')
const HEALTH_ROUTE = await import('@/app/api/health/route')

/** A signed-in operator session, backed by a live row. */
function signIn(operator = OPERATOR): void {
  givenLiveOperator(operator)
  setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(operator)) })
}

const TENANT_ROW = {
  id: 'tenant-a',
  name: 'Novastar Montessori',
  code: 'novastar',
  domain: null,
  isActive: true,
  createdAt: new Date('2026-01-02T08:00:00.000Z'),
  updatedAt: new Date('2026-02-03T08:00:00.000Z'),
  _count: { schools: 1, users: 12 },
}

beforeEach(() => {
  resetHarness()
  process.env.PLATFORM_SESSION_SECRET = PLATFORM_SESSION_SECRET
  delete process.env.SUPER_ADMIN_SECRET
  delete process.env.SUPER_ADMIN_EMAIL
  setCookies({})
})

describe('GET /api/tenants — the roster', () => {
  it('should answer 401 with no session and read nothing', async () => {
    const response = await GET_TENANTS()

    expect(response.status).toBe(401)
    // No data, not even an empty list. `[]` would tell an unauthenticated caller
    // that the platform has no tenants, which is itself the answer they wanted.
    const body = await readJson(response)
    expect(body.tenants).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('novastar')
    expect(databaseCalls()).toBe(0)
  })

  it('should answer 401 for a portal session cookie', async () => {
    setCookies({ 'next-auth.session-token': 'portal.session.value' })

    const response = await GET_TENANTS()

    expect(response.status).toBe(401)
    expect(databaseCalls()).toBe(0)
  })

  it('should answer 401 for a cookie signed with the portal secret', async () => {
    setCookies({ [ADMIN_SESSION_COOKIE]: 'eyJ2IjoxfQ.bm90LWEtc2lnbmF0dXJl' })

    const response = await GET_TENANTS()

    expect(response.status).toBe(401)
    expect(databaseCalls()).toBe(0)
  })

  it('should answer 401 for a valid cookie whose operator row is gone', async () => {
    // The token verifies; the account does not exist. A revoked operator is refused
    // on the next request rather than when the cookie expires.
    setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)) })
    givenLiveOperator(null)

    const response = await GET_TENANTS()

    expect(response.status).toBe(401)
    expect(mocks.tenantFindMany).toHaveBeenCalledTimes(0)
  })

  it('should answer 403 for an operator whose row holds no grants', async () => {
    // Authenticated, authorised by nobody. Distinct from 401 on purpose: the
    // caller proved who they are and only the grant is missing.
    const row = fakeOperator({ capabilities: [] })
    givenLiveOperator(row)
    setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(row)) })

    const response = await GET_TENANTS()

    expect(response.status).toBe(403)
    // The refusal names the missing grant, and nothing beyond it.
    expect(String((await readJson(response)).error)).toBe(
      'This operator holds no platform capability.',
    )
    expect(mocks.tenantFindMany).toHaveBeenCalledTimes(0)
  })

  it('should answer 403 when the row no longer grants what the route needs', async () => {
    // Signed in with everything, then reduced to one capability by an administrator:
    // the session survives and the route refuses.
    givenLiveOperator(fakeOperator({ id: OPERATOR.id, capabilities: ['tenant:update'] }))
    setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)) })

    const response = await GET_TENANTS()

    expect(response.status).toBe(403)
    // The named capability is the whole message: it tells the operator what to ask
    // for and discloses nothing about the fleet.
    expect(String((await readJson(response)).error)).toBe('This operator cannot tenant:read.')
    expect(mocks.tenantFindMany).toHaveBeenCalledTimes(0)
  })

  it('should let an operator list tenants, exposing exactly the contract fields', async () => {
    signIn()
    mocks.tenantFindMany.mockImplementation(async () => [TENANT_ROW])

    const response = await GET_TENANTS()

    expect(response.status).toBe(200)
    const body = await readJson(response)
    const tenants = body.tenants as Array<Record<string, unknown>>
    expect(tenants).toHaveLength(1)

    // Exactly these keys, in this order. An extra one is a leak of storage detail;
    // a missing one is a component that will render `undefined`.
    expect(Object.keys(tenants[0])).toEqual([...TENANT_LIST_FIELDS])
    expect(tenants[0]).toEqual({
      id: 'tenant-a',
      name: 'Novastar Montessori',
      code: 'novastar',
      domain: null,
      isActive: true,
      createdAt: '2026-01-02T08:00:00.000Z',
      updatedAt: '2026-02-03T08:00:00.000Z',
      schoolCount: 1,
      userCount: 12,
    })
  })

  it('should select the fields rather than reading whole rows', async () => {
    signIn()
    mocks.tenantFindMany.mockImplementation(async () => [TENANT_ROW])

    await GET_TENANTS()

    const arg = mocks.tenantFindMany.mock.calls[0][0]
    // A `select` is the mechanism. Without it the row carries `settings` and every
    // relation Prisma feels like including.
    expect(arg.select).toBeDefined()
    expect(Object.keys(arg.select as Record<string, unknown>).sort()).toEqual([
      '_count',
      'code',
      'createdAt',
      'domain',
      'id',
      'isActive',
      'name',
      'updatedAt',
    ])
    expect((arg.select as Record<string, unknown>).settings).toBeUndefined()
  })

  it('should order deterministically, so two operators see the same list', async () => {
    signIn()
    await GET_TENANTS()

    expect(mocks.tenantFindMany.mock.calls[0][0].orderBy).toEqual({ code: 'asc' })
  })
})

describe('GET /api/tenants/:tenantId — one tenant, or a 404', () => {
  it('should answer 401 without a session', async () => {
    const response = await TENANT_ROUTE.GET(request('/api/tenants/tenant-a'), {
      params: Promise.resolve({ tenantId: 'tenant-a' }),
    })

    expect(response.status).toBe(401)
    expect(databaseCalls()).toBe(0)
  })

  it('should answer 404 for an unknown id rather than the roster', async () => {
    signIn()
    mocks.tenantFindFirst.mockImplementation(async () => null)

    const response = await TENANT_ROUTE.GET(request('/api/tenants/tenant-ghost'), {
      params: Promise.resolve({ tenantId: 'tenant-ghost' }),
    })

    expect(response.status).toBe(404)
    // One read, and no second, unscoped one. A fallback to "all tenants" would
    // have shown a fleet listing behind a URL naming one school.
    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.tenantFindMany).toHaveBeenCalledTimes(0)
  })

  it('should answer the one tenant the URL named', async () => {
    signIn()
    mocks.tenantFindFirst.mockImplementation(async (args) =>
      args.where?.id === 'tenant-a' ? { ...TENANT_ROW, settings: { currency: 'GHS' } } : null,
    )

    const response = await TENANT_ROUTE.GET(request('/api/tenants/tenant-a'), {
      params: Promise.resolve({ tenantId: 'tenant-a' }),
    })

    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect((body.tenant as Record<string, unknown>).id).toBe('tenant-a')
    expect((body.tenant as Record<string, unknown>).settings).toEqual({ currency: 'GHS' })
  })
})

describe('PATCH /api/tenants/:tenantId — the URL addresses the tenant', () => {
  it('should answer 401 without a session and write nothing', async () => {
    const response = await TENANT_ROUTE.PATCH(
      request('/api/tenants/tenant-a', { method: 'PATCH', body: { isActive: false } }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    expect(response.status).toBe(401)
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })

  it('should refuse a body that names a different tenant', async () => {
    signIn()

    const response = await TENANT_ROUTE.PATCH(
      request('/api/tenants/tenant-a', {
        method: 'PATCH',
        body: { tenantId: 'tenant-b', isActive: false },
      }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    expect(response.status).toBe(409)
    // The rejection is the point: had the body won, this would have suspended
    // tenant-b while the operator believed they had suspended tenant-a.
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
    // And the body names both sides of the conflict. "409, no details" leaves an
    // operator unable to tell which of two tenants the request was actually about.
    const body = await readJson(response)
    expect(body.details).toEqual({ urlTenantId: 'tenant-a', bodyTenantId: 'tenant-b' })
    expect(String(body.error)).toContain('URL segment')
  })

  it('should patch the mutable fields on the URL tenant and nowhere else', async () => {
    // The other arm of the same route, and the one nothing else here reaches: every
    // other PATCH test in this file sends `isActive` or a refused `code`, so
    // `updateTenantFields` — and its `where` — was reached by no test at all.
    signIn()
    mocks.tenantFindFirst.mockImplementation(async (args) =>
      args.select?.settings !== undefined
        ? { ...TENANT_ROW, settings: {} }
        : { name: 'Before', domain: null, isActive: true },
    )

    const response = await TENANT_ROUTE.PATCH(
      request('/api/tenants/tenant-a', {
        method: 'PATCH',
        body: { name: '  Novastar Montessori School  ', domain: 'https://novastar.test' },
      }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    expect(response.status).toBe(200)
    // The write's `where`, compared whole. A substring or key-presence check passes
    // for `{ id: { not: 'tenant-a' } }` — a write to every tenant except the URL's.
    expect(mocks.tenantUpdate.mock.calls[0][0].where).toEqual({ id: 'tenant-a' })
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(1)
    // Trimmed, and `code` still absent: the mutable projection, not a spread.
    expect(mocks.tenantUpdate.mock.calls[0][0].data).toEqual({
      name: 'Novastar Montessori School',
      domain: 'https://novastar.test',
    })
    // The previous values are read on the tenant the URL named, so the entry can
    // say what moved from rather than filing "changed from X to X".
    expect(mocks.tenantFindFirst.mock.calls[0][0].where).toEqual({ id: 'tenant-a' })
    const entry = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>
    expect(entry.action).toBe('TENANT_UPDATE')
    expect(entry.tenantId).toBe('tenant-a')
    expect(entry.entityId).toBe('tenant-a')
    expect(entry.newData).toEqual({
      from: { name: 'Before', domain: null },
      to: { name: 'Novastar Montessori School', domain: 'https://novastar.test' },
    })
    // And the response reports which fields changed, so a client cannot mistake a
    // partial patch for a whole one.
    expect((await readJson(response)).changed).toEqual({
      name: 'Novastar Montessori School',
      domain: 'https://novastar.test',
    })
  })

  it('should suspend the URL tenant and record the change in one transaction', async () => {
    signIn()
    mocks.tenantFindFirst.mockImplementation(async (args) =>
      args.select?.settings !== undefined ? { ...TENANT_ROW, settings: {} } : { isActive: true },
    )

    const response = await TENANT_ROUTE.PATCH(
      request('/api/tenants/tenant-a', { method: 'PATCH', body: { isActive: false } }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.$transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.tenantUpdate.mock.calls[0][0].where).toEqual({ id: 'tenant-a' })
    // The audit entry lands in the same transaction, so a change cannot be
    // committed without a record of it.
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
    const entry = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>
    expect(entry.tenantId).toBe('tenant-a')
    expect(entry.action).toBe('TENANT_SUSPEND')
    expect(entry.newData).toEqual({ from: true, to: false })
    // Attributable to the operator account, from the verified session and nothing
    // else — before `AuditLog.operatorId` this entry could say what changed but not
    // who changed it.
    expect(entry.operatorId).toBe(OPERATOR.id)
    expect(entry.userId).toBeNull()
  })

  it('should answer 404 for a suspension of a tenant that does not exist', async () => {
    signIn()
    mocks.tenantFindFirst.mockImplementation(async () => null)

    const response = await TENANT_ROUTE.PATCH(
      request('/api/tenants/tenant-ghost', { method: 'PATCH', body: { isActive: false } }),
      { params: Promise.resolve({ tenantId: 'tenant-ghost' }) },
    )

    expect(response.status).toBe(404)
    // The body names the id that missed. A bare 404 would not distinguish "no such
    // tenant" from a route that 404s for anything at all.
    expect(String((await readJson(response)).error)).toContain('tenant-ghost')
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
  })

  it('should not let a body patch the routing key', async () => {
    signIn()
    mocks.tenantFindFirst.mockImplementation(async (args) =>
      args.select?.name !== undefined ? { name: 'A', domain: null, isActive: true } : { ...TENANT_ROW, settings: {} },
    )

    const response = await TENANT_ROUTE.PATCH(
      request('/api/tenants/tenant-a', { method: 'PATCH', body: { code: 'somewhere-else' } }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    // `code` is not a mutable field, so a body carrying only it has nothing to do.
    expect(response.status).toBe(400)
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
  })

  it('should refuse to delete a tenant, and say what to do instead', async () => {
    signIn()

    // Takes no arguments: it refuses before reading anything, so there is no
    // request to inspect and no tenant id to honour.
    const response = await TENANT_ROUTE.DELETE()

    expect(response.status).toBe(405)
    expect(await response.text()).toContain('isActive')
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
  })
})

describe('PATCH /api/tenants/:tenantId/settings — dot-paths, not documents', () => {
  it('should refuse a prototype-polluting key, and name the key it refused', async () => {
    signIn()

    const response = await SETTINGS_ROUTE.PATCH(
      request('/api/tenants/tenant-a/settings', {
        method: 'PATCH',
        body: { key: '__proto__.isActive', value: false },
      }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    expect(response.status).toBe(400)
    // The rejected key is echoed back. A bare 400 leaves an operator who sent
    // `__proto__.isActive` with nothing to fix and every reason to retry it — and it
    // leaves a reader unable to tell this refusal from a missing `value`.
    const body = await readJson(response)
    expect(String(body.error)).toContain('__proto__.isActive')
    expect(String(body.error)).toContain('not a writable setting path')
    // Nothing was written, and the tenant was never looked up: the body checks run
    // before the database, so the refusal cannot be used to discover whether this
    // tenant id exists.
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(0)
  })

  it('should refuse a body that names a different tenant, naming both', async () => {
    signIn()
    mocks.tenantFindFirst.mockImplementation(async () => ({ ...TENANT_ROW, settings: {} }))

    const response = await SETTINGS_ROUTE.PATCH(
      request('/api/tenants/tenant-a/settings', {
        method: 'PATCH',
        body: { tenantId: 'tenant-b', key: 'timezone', value: 'Africa/Accra' },
      }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    expect(response.status).toBe(409)
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
    // The pair, so the operator can see which two tenants the request disagreed
    // about rather than being told only that it was refused.
    expect((await readJson(response)).details).toEqual({
      urlTenantId: 'tenant-a',
      bodyTenantId: 'tenant-b',
    })
  })

  it('should merge one key into the stored document, scoped to the URL tenant', async () => {
    signIn()
    mocks.tenantFindFirst.mockImplementation(async (args) => {
      // `requireTenantScope` reads the whole detail row; the merge reads `settings`
      // and `isActive`, because `writeTenantSetting` refuses a suspended tenant on
      // the same read it merges on. Dispatching on the select keeps the two apart.
      if (args.select?.name !== undefined) return { ...TENANT_ROW, settings: {} }
      return { settings: { currency: 'GHS', timezone: 'Africa/Accra' }, isActive: true }
    })

    const response = await SETTINGS_ROUTE.PATCH(
      request('/api/tenants/tenant-a/settings', {
        method: 'PATCH',
        body: { key: 'timezone', value: 'Europe/London' },
      }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    expect(response.status).toBe(200)
    // `currency` survives. A whole-document write would have erased it.
    const written = mocks.tenantUpdate.mock.calls[0][0].data as Record<string, unknown>
    expect(written.settings).toEqual({
      currency: 'GHS',
      timezone: 'Europe/London',
    })
    expect(mocks.tenantUpdate.mock.calls[0][0].where).toEqual({ id: 'tenant-a' })
  })
})

describe('the fleet-wide routes are gated too', () => {
  it('should refuse a tenant-scoped operator on the cross-tenant audit route', async () => {
    // The behavioural half of `rbac.test.ts`'s wildcard table, on the route where
    // getting it wrong actually leaks. A tenant-scoped grant — including a
    // `tenant:*` wildcard on the row, which `narrowCapabilities` drops because
    // `tenant:*` is not in the vocabulary — covers everything inside a tenant and
    // nothing across them. If a `tenant:*` grant satisfied `platform:audit`, one
    // tenant-scoped grant would read every tenant's audit rows.
    givenLiveOperator(
      fakeOperator({ id: OPERATOR.id, capabilities: ['tenant:*', 'tenant:read'] }),
    )
    setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)) })

    const response = await AUDIT_ROUTE.GET(request('/api/audit'))

    expect(response.status).toBe(403)
    // The named capability, and nothing about the fleet.
    expect(String((await readJson(response)).error)).toBe(
      'This operator cannot platform:audit.',
    )
    // Not one row of the fleet's trail.
    expect(mocks.auditFindMany).toHaveBeenCalledTimes(0)
    expect(mocks.auditCount).toHaveBeenCalledTimes(0)
  })

  it('should refuse a wildcard-only grant outright, because the vocabulary drops it', async () => {
    // Worth stating rather than leaving implied: a row carrying nothing but
    // `tenant:*` is narrowed to an empty grant set and refused at the gate, so the
    // wildcard path in `permissionMatches` is unreachable for stored operator
    // capabilities. That is fail-closed and correct; it is asserted because the
    // refusal message is the *other* one and a reader should know which to expect.
    givenLiveOperator(fakeOperator({ id: OPERATOR.id, capabilities: ['tenant:*'] }))
    setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)) })

    const response = await AUDIT_ROUTE.GET(request('/api/audit'))

    expect(response.status).toBe(403)
    expect(String((await readJson(response)).error)).toBe(
      'This operator holds no platform capability.',
    )
    expect(mocks.auditFindMany).toHaveBeenCalledTimes(0)
  })

  it('should answer 401 for the audit route without a session', async () => {
    const response = await AUDIT_ROUTE.GET(request('/api/audit'))

    expect(response.status).toBe(401)
    expect(mocks.auditFindMany).toHaveBeenCalledTimes(0)
  })

  it('should answer 401 for the health route without a session', async () => {
    // Otherwise an unauthenticated caller could poll this to learn whether the
    // platform has been provisioned and whether its database is up.
    const response = await HEALTH_ROUTE.GET()

    expect(response.status).toBe(401)
    expect(databaseCalls()).toBe(0)
  })

  it('should refuse POST /api/tenants without a session, and never provision', async () => {
    const { provisionTenant } = await import('./harness')
    const response = await POST_TENANTS(
      request('/api/tenants', { method: 'POST', body: { tenant: {}, school: {} } }),
    )

    expect(response.status).toBe(401)
    expect(provisionTenant).toHaveBeenCalledTimes(0)
  })
})
