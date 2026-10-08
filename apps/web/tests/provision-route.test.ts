// `./harness` first, always: it registers the `@/lib/prisma` mock, and every
// `@/lib/*` module below reaches the database. See the harness docstring and
// `bunfig.toml`, which preloads the harness so the mock cannot lose the race.
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  fakeOperator,
  givenLiveOperator,
  lastProvisionInput,
  mocks,
  operatorClaims,
  provisionTenant,
  readJson,
  request,
  resetHarness,
  setCookies,
} from './harness'
import { ADMIN_SESSION_COOKIE, createSessionToken } from '@/lib/admin-auth'

/**
 * Provisioning, and the claim that made this a shared function instead of a
 * second implementation: the console does not create tenants, it delegates.
 *
 * `provisionTenant` is mocked, so every test here is asserting the *call* —
 * that the console hands over the request and reports what came back, once, and
 * that it refuses the one request that would address a different tenant through
 * this route. The idempotency itself belongs to `tools/tenant-cli`, which has its
 * own tests; duplicating them here would be testing the mock.
 */

const PLATFORM_SESSION_SECRET = 'a-test-secret-that-is-long-enough-to-pass-32'
const OPERATOR = fakeOperator()

const { POST: POST_TENANTS } = await import('@/app/admin/api/tenants/route')
const { POST: POST_RECONCILE } = await import('@/app/admin/api/tenants/[tenantId]/provision/route')
const { PLATFORM_AUDIT_SCOPE } = await import('@/lib/queries')

/** A signed-in operator session, backed by a live row. */
function signIn(): void {
  givenLiveOperator(OPERATOR)
  setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)) })
}

/** The response shape `provisionNewTenant` projects onto. */
interface OutcomeBody {
  readonly created?: boolean
  readonly permissionsCreated?: number
  readonly rolesCreated?: number
  readonly tenant?: { readonly code?: string; readonly createdAt?: string }
  readonly school?: { readonly code?: string }
  readonly admin?: { readonly email?: string } | null
}

const BODY = {
  tenant: { name: 'Novastar Montessori', code: 'novastar', domain: null, settings: { currency: 'GHS' } },
  school: {
    name: 'Novastar Montessori School',
    code: 'novastar-main',
    address: 'Spintex, Accra',
    phone: '+233 000 000 000',
    email: 'office@novastar.test',
    established: '2026-01-05',
    motto: null,
  },
  // A full run, so the shared function's result and the audit entry agree about
  // whether an administrator was requested. The tests that are about the password
  // replace this object; the one about a tenant without an administrator removes it.
  admin: { email: 'admin@novastar.test', password: 'a-long-enough-password', roleName: 'School Admin' },
}

function provisioned(overrides: Record<string, unknown> = {}) {
  return {
    created: true,
    tenant: {
      id: 'tenant-a',
      name: 'Novastar Montessori',
      code: 'novastar',
      domain: null,
      isActive: true,
      settings: { currency: 'GHS' },
      createdAt: new Date('2026-01-02T08:00:00.000Z'),
      updatedAt: new Date('2026-01-02T08:00:00.000Z'),
    },
    school: { id: 'school-1', code: 'novastar-main', name: 'Novastar Montessori School' },
    admin: { id: 'user-1', email: 'admin@novastar.test', roleName: 'School Admin', created: true },
    permissionsCreated: 24,
    rolesCreated: 4,
    ...overrides,
  }
}

/** The tenant row `requireTenantScope` reads: a full `TenantDetail` projection. */
const TENANT_ROW = {
  id: 'tenant-a',
  name: 'Novastar Montessori',
  code: 'novastar',
  domain: null,
  isActive: true,
  settings: { currency: 'GHS' },
  createdAt: new Date('2026-01-02T08:00:00.000Z'),
  updatedAt: new Date('2026-01-02T08:00:00.000Z'),
  _count: { schools: 1, users: 1 },
}

beforeEach(() => {
  resetHarness()
  process.env.PLATFORM_SESSION_SECRET = PLATFORM_SESSION_SECRET
  delete process.env.SUPER_ADMIN_SECRET
  delete process.env.SUPER_ADMIN_EMAIL
  setCookies({})
})

describe('POST /api/tenants — delegate, once, and report', () => {
  it('should call provisionTenant exactly once and answer 201', async () => {
    signIn()
    provisionTenant.mockImplementation(async () => provisioned())

    const response = await POST_TENANTS(request('/api/tenants', { method: 'POST', body: BODY }))

    expect(response.status).toBe(201)
    expect(provisionTenant).toHaveBeenCalledTimes(1)
    // And the route did not reach around the shared function to write the tenant
    // itself. Two writers means two idempotency stories.
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
  })

  it('should hand the request over in the shape provisionTenant accepts', async () => {
    signIn()
    provisionTenant.mockImplementation(async () => provisioned())

    await POST_TENANTS(request('/api/tenants', { method: 'POST', body: BODY }))

    expect(lastProvisionInput()).toEqual({
      tenant: { name: 'Novastar Montessori', code: 'novastar', domain: null, settings: { currency: 'GHS' } },
      school: {
        name: 'Novastar Montessori School',
        code: 'novastar-main',
        address: 'Spintex, Accra',
        phone: '+233 000 000 000',
        email: 'office@novastar.test',
        established: new Date('2026-01-05'),
        motto: null,
      },
      admin: { email: 'admin@novastar.test', password: 'a-long-enough-password', roleName: 'School Admin' },
    })
  })

  it('should surface what the shared function returned', async () => {
    signIn()
    provisionTenant.mockImplementation(async () => provisioned())

    const response = await POST_TENANTS(request('/api/tenants', { method: 'POST', body: BODY }))
    const body = (await readJson(response)) as OutcomeBody

    expect(body.created).toBe(true)
    expect(body.permissionsCreated).toBe(24)
    expect(body.rolesCreated).toBe(4)
    expect(body.tenant?.code).toBe('novastar')
    expect(body.school?.code).toBe('novastar-main')
    expect(body.admin?.email).toBe('admin@novastar.test')
    expect(body.tenant?.createdAt).toBe('2026-01-02T08:00:00.000Z')
  })

  it('should answer 200 and created:false when the code already existed', async () => {
    signIn()
    provisionTenant.mockImplementation(async () => provisioned({ created: false }))

    const response = await POST_TENANTS(request('/api/tenants', { method: 'POST', body: BODY }))
    const body = (await readJson(response)) as OutcomeBody

    // The distinction survives in the body, not only the status: a reconcile that
    // reported 201 would tell an operator they onboarded a school twice.
    expect(response.status).toBe(200)
    expect(body.created).toBe(false)
  })

  it('should report a tenant provisioned without an administrator', async () => {
    signIn()
    provisionTenant.mockImplementation(async () => provisioned({ admin: null }))
    const { admin: _admin, ...withoutAdmin } = BODY

    const response = await POST_TENANTS(
      request('/api/tenants', { method: 'POST', body: withoutAdmin }),
    )
    const body = (await readJson(response)) as OutcomeBody

    expect(body.admin).toBeNull()
    expect(lastProvisionInput()).not.toHaveProperty('admin')
    // And the audit entry says so too, rather than recording a null administrator
    // for a run that created one.
    const entry = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>
    expect(entry.newData).toEqual({ code: 'novastar', created: true, adminEmail: null })
  })

  it('should record the provisioning in the audit log, scoped to the new tenant', async () => {
    signIn()
    provisionTenant.mockImplementation(async () => provisioned())

    await POST_TENANTS(request('/api/tenants', { method: 'POST', body: BODY }))

    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
    const entry = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>
    expect(entry.action).toBe('TENANT_PROVISION')
    // On the tenant the result named, not the code the body asked for.
    expect(entry.tenantId).toBe('tenant-a')
    expect(entry.schoolId).toBe(PLATFORM_AUDIT_SCOPE)
    expect(entry.changes).toBeUndefined()
    // `appendAudit` files the change payload under `newData`, so that is where the
    // outcome lands on the row.
    expect(entry.newData).toEqual({ code: 'novastar', created: true, adminEmail: 'admin@novastar.test' })
    // Attributable to the operator account rather than to nobody.
    expect(entry.operatorId).toBe(OPERATOR.id)
    expect(entry.userId).toBeNull()
  })

  it('should refuse a body that is not a provisioning request, without calling anything', async () => {
    signIn()

    const response = await POST_TENANTS(
      request('/api/tenants', { method: 'POST', body: { tenant: { code: 'novastar' }, school: {} } }),
    )

    expect(response.status).toBe(400)
    expect(provisionTenant).toHaveBeenCalledTimes(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })

  it('should report a failed provisioning as a server error, and claim nothing', async () => {
    signIn()
    provisionTenant.mockImplementation(async () => {
      throw new Error('tenant code already in use by a deleted record')
    })

    const response = await POST_TENANTS(request('/api/tenants', { method: 'POST', body: BODY }))

    // 500, not 502: `provisionTenant` runs in this process, so there is no
    // upstream service to have failed. And the body carries no tenant, because
    // none was reported as created.
    expect(response.status).toBe(500)
    const body = (await readJson(response)) as OutcomeBody
    expect(body.created).toBeUndefined()
    // The shared function threw, so no audit entry claims a tenant was created.
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })
})

describe('POST /api/tenants — the administrator password', () => {
  it('should take the password from the body when one is given', async () => {
    signIn()
    provisionTenant.mockImplementation(async () => provisioned())
    process.env.TENANT_ADMIN_PASSWORD = 'from-the-environment-please'

    await POST_TENANTS(
      request('/api/tenants', {
        method: 'POST',
        body: { ...BODY, admin: { email: 'admin@novastar.test', password: 'from-the-body-please' } },
      }),
    )

    expect(lastProvisionInput()?.admin?.password).toBe('from-the-body-please')
  })

  it('should fall back to TENANT_ADMIN_PASSWORD, and never echo it back', async () => {
    signIn()
    provisionTenant.mockImplementation(async () => provisioned())
    process.env.TENANT_ADMIN_PASSWORD = 'from-the-environment-please'

    const response = await POST_TENANTS(
      request('/api/tenants', {
        method: 'POST',
        body: { ...BODY, admin: { email: 'admin@novastar.test' } },
      }),
    )

    expect(lastProvisionInput()?.admin?.password).toBe('from-the-environment-please')
    // The password goes in and does not come out — not in the body, not in the
    // audit entry, not in the error text.
    expect(await response.text()).not.toContain('from-the-environment-please')
    expect(JSON.stringify(mocks.auditCreate.mock.calls[0][0])).not.toContain('from-the-environment-please')
  })

  it('should refuse an administrator email with no password available anywhere', async () => {
    signIn()
    delete process.env.TENANT_ADMIN_PASSWORD

    const response = await POST_TENANTS(
      request('/api/tenants', {
        method: 'POST',
        body: { ...BODY, admin: { email: 'admin@novastar.test' } },
      }),
    )

    expect(response.status).toBe(400)
    // The refusal names the environment variable that would have supplied it. The
    // console cannot fix a misconfigured deployment on its own, so a bare 400 is a
    // support ticket with nothing in it.
    expect(await response.text()).toContain('TENANT_ADMIN_PASSWORD')
    expect(provisionTenant).toHaveBeenCalledTimes(0)
  })
})

describe('POST /api/tenants/:tenantId/provision — the URL addresses the tenant', () => {
  it('should refuse a body naming another tenant code, without provisioning anything', async () => {
    signIn()
    mocks.tenantFindFirst.mockImplementation(async () => TENANT_ROW)

    const response = await POST_RECONCILE(
      request('/api/tenants/tenant-a/provision', {
        method: 'POST',
        body: { ...BODY, tenant: { ...BODY.tenant, code: 'some-other-school' } },
      }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    // This is the cross-tenant write expressed as an ordinary request: keyed on
    // `code`, so a body naming another code would have touched another school
    // while the operator watched a URL that says otherwise.
    expect(response.status).toBe(409)
    expect(provisionTenant).toHaveBeenCalledTimes(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
    // All three values, because there are three. The URL names an id and a code; the
    // body names a different code. A 409 that reported only the mismatch would leave
    // the operator unable to tell which of the two codes the request would have
    // created — and `code` is the idempotency key the shared function keys on, so it
    // is the one value that decides what would have been written.
    const body = await readJson(response)
    expect(body.details).toEqual({
      urlTenantId: 'tenant-a',
      urlTenantCode: 'novastar',
      bodyTenantCode: 'some-other-school',
    })
    expect(String(body.error)).toContain('some-other-school')
    expect(String(body.error)).toContain('novastar')
  })

  it('should reconcile the URL tenant when the code matches', async () => {
    signIn()
    mocks.tenantFindFirst.mockImplementation(async () => TENANT_ROW)
    provisionTenant.mockImplementation(async () => provisioned({ created: false }))

    const response = await POST_RECONCILE(
      request('/api/tenants/tenant-a/provision', { method: 'POST', body: BODY }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    expect(response.status).toBe(200)
    expect(provisionTenant).toHaveBeenCalledTimes(1)
    expect(lastProvisionInput()?.tenant?.code).toBe('novastar')
  })

  it('should answer 401 without a session and provision nothing', async () => {
    mocks.tenantFindFirst.mockImplementation(async () => TENANT_ROW)

    const response = await POST_RECONCILE(
      request('/api/tenants/tenant-a/provision', { method: 'POST', body: BODY }),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    )

    expect(response.status).toBe(401)
    expect(provisionTenant).toHaveBeenCalledTimes(0)
    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(0)
  })
})
