// `./harness` first, always: it registers the `@/lib/prisma` and
// `@novastar/database` mocks, and everything below reaches the database. See the
// harness docstring and `bunfig.toml`, which preloads the harness so the mock
// cannot lose the race.
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  databaseCalls,
  failNextEmail,
  fakeOperator,
  givenLiveOperator,
  mocks,
  operatorClaims,
  readJson,
  request,
  resetHarness,
  sentEmails,
  setCookies,
} from './harness'
import { ADMIN_SESSION_COOKIE, createSessionToken } from '@/lib/admin-auth'

/**
 * `POST /api/tenants/:tenantId/users` — the console's first and only way to create an
 * account in a tenant.
 *
 * The tests here are grouped by the claim each one defends, and most of them are
 * refusals. That ratio is the design: this route mints credentials, so the things
 * worth proving are the ones where it does *not*, and the one thing worth proving
 * about when it does is that the created row is unusable until its owner chooses a
 * password.
 *
 * Three claims carry most of the weight:
 *
 * - The capability is required, and its absence is a 403 rather than a 401. An
 *   operator who can read a tenant's directory but not change it is a real
 *   configuration, not an error state.
 * - Nothing outside the URL's tenant can be written. Two separate attempts are made:
 *   a body naming a `tenantId` (refused 409) and a `schoolId` belonging to another
 *   tenant (a 404, because the school lookup carries both predicates).
 * - The created account has no password and cannot be signed into until the setup
 *   link is followed. That is asserted on the arguments `prisma.user.create` received,
 *   not on a summary the route produced, because the route is not the thing that
 *   decides it.
 */

const PLATFORM_SESSION_SECRET = 'a-test-secret-that-is-long-enough-to-pass-32'
const OPERATOR = fakeOperator()

const { POST } = await import('@/app/admin/api/tenants/[tenantId]/users/route')

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
  settings: {},
  createdAt: new Date('2026-01-02T08:00:00.000Z'),
  updatedAt: new Date('2026-02-03T08:00:00.000Z'),
  _count: { schools: 1, users: 1 },
}

const SCHOOL = { id: 'school-1', tenantId: 'tenant-a', name: 'Novastar Montessori School' }
const ROLE = { id: 'role-head' }

const BODY = {
  email: 'New.Teacher@novastar.test',
  name: 'New Teacher',
  roleName: 'CLASSROOM_TEACHER',
  schoolId: SCHOOL.id,
}

/**
 * Arms the three reads a successful create depends on: the tenant the URL names, the
 * school inside it, and the role row inside that school.
 *
 * Each answers on its own predicate rather than unconditionally, so a query that
 * dropped `tenantId` — the failure this whole route is shaped around — misses here
 * instead of passing for the wrong reason.
 */
function givenTenant(): void {
  mocks.tenantFindFirst.mockImplementation(async (args) =>
    args.where?.id === TENANT_ROW.id ? TENANT_ROW : null,
  )
  mocks.schoolFindFirst.mockImplementation(async (args) =>
    args.where?.id === SCHOOL.id && args.where?.tenantId === TENANT_ROW.id ? SCHOOL : null,
  )
  mocks.roleFindFirst.mockImplementation(async (args) =>
    args.where?.name === BODY.roleName ? ROLE : null,
  )
}

function post(body: unknown = BODY, tenantId = TENANT_ROW.id) {
  return POST(
    request(`/api/tenants/${tenantId}/users`, { method: 'POST', body }),
    { params: Promise.resolve({ tenantId }) },
  )
}

beforeEach(() => {
  resetHarness()
  process.env.PLATFORM_SESSION_SECRET = PLATFORM_SESSION_SECRET
  process.env.NEXTAUTH_URL = 'https://portal.example.test'
  setCookies({})
  sentEmails.length = 0
})

describe('POST /api/tenants/:tenantId/users — the capability is required', () => {
  it('should answer 401 without a session, and write nothing', async () => {
    const response = await post()

    expect(response.status).toBe(401)
    expect(databaseCalls()).toBe(0)
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
    expect(sentEmails).toHaveLength(0)
  })

  it('should answer 403 for an operator who may read users but not create them', async () => {
    // The two capabilities are separate on purpose, and this is the case that proves
    // it: reading a roster is not authority to add to it. 403, not 401 — the caller
    // proved who they are and only the grant is missing.
    signIn(fakeOperator({ id: OPERATOR.id, capabilities: ['tenant:user:read'] }))

    const response = await post()

    expect(response.status).toBe(403)
    // The refusal names the capability that was missing. It must not name anything
    // about the tenant: this is the one refusal an *authenticated* operator reaches
    // with a URL naming a real tenant, so anything extra here is disclosure to a
    // caller who is not allowed to create accounts.
    const body = await readJson(response)
    expect(body.error).toBe('This operator cannot tenant:user:create.')
    expect(JSON.stringify(body)).not.toContain(TENANT_ROW.code)
    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(0)
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
  })

  it('should not let tenant:provision stand in for tenant:user:create', async () => {
    // Provisioning creates a tenant and its first administrator. Reading that as
    // authority to add a teacher to a tenant that already exists would make the
    // capability that bootstraps a deployment also its account administration path.
    signIn(fakeOperator({ id: OPERATOR.id, capabilities: ['tenant:provision'] }))

    const response = await post()

    expect(response.status).toBe(403)
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
  })
})

describe('POST /api/tenants/:tenantId/users — the tenant is the URL, and only the URL', () => {
  it('should refuse a body that names a different tenant', async () => {
    signIn()

    const response = await post({ ...BODY, tenantId: 'tenant-b' })

    expect(response.status).toBe(409)
    // Not merely ignored. Had the body won, this would have created an account in
    // another school while the operator watched a URL naming this one.
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
    expect(sentEmails).toHaveLength(0)
    // And the body names both sides of the conflict. A 409 with no details cannot be
    // acted on: the operator cannot tell which of the two ids the request disagreed
    // about, and a client cannot recover without guessing.
    const body = await readJson(response)
    expect(body.details).toEqual({ urlTenantId: TENANT_ROW.id, bodyTenantId: 'tenant-b' })
    expect(String(body.error)).toContain('URL segment')
  })

  it('should refuse a school belonging to another tenant, having written nothing', async () => {
    signIn()
    givenTenant()
    // The lookup carries both predicates, so a school from elsewhere is a miss rather
    // than a row the caller is trusted to have named correctly.
    mocks.schoolFindFirst.mockImplementation(async () => null)

    const response = await post({ ...BODY, schoolId: 'school-of-another-tenant' })

    expect(response.status).toBe(404)
    expect(mocks.schoolFindFirst.mock.calls[0][0].where).toEqual({
      id: 'school-of-another-tenant',
      tenantId: TENANT_ROW.id,
    })
    // The refused school id is echoed, and the refusal says it was refused *in this
    // tenant* — which is the whole point: a school id from another tenant is
    // indistinguishable from one that does not exist, by design.
    const body = await readJson(response)
    expect(String(body.error)).toContain('school-of-another-tenant')
    expect(String(body.error)).toContain('in this tenant')
    // The role lookup never ran, so the escalation surface is not even reachable.
    expect(mocks.roleFindFirst).toHaveBeenCalledTimes(0)
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
  })

  it('should answer 404 for a tenant that does not exist', async () => {
    signIn()
    mocks.tenantFindFirst.mockImplementation(async () => null)

    const response = await post(BODY, 'tenant-ghost')

    expect(response.status).toBe(404)
    // The body names the id that missed, so a stale bookmark is diagnosable — and
    // names nothing else, so a 404 cannot be used to probe ids with a different
    // reason attached to each answer.
    expect(String((await readJson(response)).error)).toContain('tenant-ghost')
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
  })

  it('should write the account with the URL tenant, whatever the body said nothing about', async () => {
    signIn()
    givenTenant()

    await post()

    expect(mocks.userCreate.mock.calls[0][0].data).toMatchObject({
      tenantId: TENANT_ROW.id,
      schoolId: SCHOOL.id,
    })
    // And the role was resolved inside that tenant and school, never by id alone.
    expect(mocks.roleFindFirst.mock.calls[0][0].where).toEqual({
      tenantId: TENANT_ROW.id,
      schoolId: SCHOOL.id,
      name: BODY.roleName,
    })
  })
})

describe('POST /api/tenants/:tenantId/users — what it validates', () => {
  it('should refuse an invalid email address before touching the database', async () => {
    signIn()

    const response = await post({ ...BODY, email: 'not-an-address' })

    expect(response.status).toBe(400)
    // The body carries the offending field by name. A 400 with no detail tells an
    // operator their request was wrong without telling them which part, and the
    // schema issues are the only thing here that knows.
    const body = await readJson(response)
    const details = body.details as Array<{ path: string; message: string }>
    expect(details.map((issue) => issue.path)).toContain('email')
    expect(details.every((issue) => issue.message.length > 0)).toBe(true)
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
  })

  it('should refuse a role name that is not one of the platform roles', async () => {
    signIn()
    givenTenant()

    const response = await post({ ...BODY, roleName: 'SUPREME_LEADER' })

    expect(response.status).toBe(400)
    // The refused name is echoed. Naming the vocabulary back is safe — it is seeded,
    // not tenant data — and it tells the operator which value to pick instead.
    expect(String((await readJson(response)).error)).toContain('SUPREME_LEADER')
    // Refused before the role lookup, so the refusal cannot be used to discover which
    // roles this school actually has.
    expect(mocks.roleFindFirst).toHaveBeenCalledTimes(0)
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
  })

  it('should refuse a roleId outright rather than accept it', async () => {
    // `Role.id` is a cuid with no relationship to the role's grants, so honouring one
    // would let the request pick a role row anywhere in the fleet.
    signIn()
    givenTenant()

    const response = await post({ ...BODY, roleId: 'role-of-another-tenant' })

    expect(response.status).toBe(400)
    // The message names `roleName` as the accepted alternative, so the refusal is an
    // instruction rather than a dead end.
    const error = String((await readJson(response)).error)
    expect(error).toContain('roleId')
    expect(error).toContain('roleName')
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
  })

  it('should refuse a role that the named school does not have', async () => {
    signIn()
    givenTenant()
    mocks.roleFindFirst.mockImplementation(async () => null)

    const response = await post({ ...BODY, roleName: 'HEADMASTER' })

    expect(response.status).toBe(400)
    // The refusal says a role does not exist *in the school named*, which is what
    // distinguishes it from the unknown-role 400 above. It deliberately does not
    // echo the role name: the shared function's own message does, and the route
    // narrows it, so a caller cannot use this to enumerate the school's roles.
    expect(String((await readJson(response)).error)).toBe(
      'That role does not exist in the school named.',
    )
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
  })

  it('should refuse a duplicate address in this tenant rather than reissue the link', async () => {
    // "Latest link wins" would overwrite a token the first recipient may already have
    // open, stranding an account that exists and cannot be signed into.
    signIn()
    givenTenant()
    mocks.userFindFirst.mockImplementation(async () => ({ id: 'user-existing' }))

    const response = await post()

    expect(response.status).toBe(409)
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
    expect(sentEmails).toHaveLength(0)
    // "in this tenant" is the claim, and the duplicate read below is what makes it
    // true: the check is scoped by `tenantId`, not by email alone.
    expect(String((await readJson(response)).error)).toContain(
      'already exists in this tenant',
    )
  })

  it('should scope the duplicate-address check to the tenant the URL named', async () => {
    // The predicate behind that sentence. `User`'s uniqueness is
    // `@@unique([tenantId, email])`, so per-tenant uniqueness is a property of the
    // READ as much as of the constraint: without `tenantId` in the `where`, an
    // address that exists in any tenant anywhere in the fleet refuses an invite
    // here, and one tenant's roster becomes a cross-tenant denial of service on
    // account creation. Compared with `toEqual` because `toContain` would pass for a
    // predicate naming the tenant and nothing else.
    signIn()
    givenTenant()

    await post()

    expect(mocks.userFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.userFindFirst.mock.calls[0][0].where).toEqual({
      tenantId: TENANT_ROW.id,
      // Normalised, so the check and the `@@unique` constraint agree on what "the
      // same address" means.
      email: 'new.teacher@novastar.test',
    })
  })
})

describe('POST /api/tenants/:tenantId/users — the account it creates', () => {
  it('should create an account with no password at all', async () => {
    signIn()
    givenTenant()

    const response = await post()

    expect(response.status).toBe(201)
    const data = mocks.userCreate.mock.calls[0][0].data as Record<string, unknown>
    // Null, not an empty string and not a hash of something: there is no password to
    // verify, which is also what makes the sign-in path refuse this account until its
    // owner chooses one.
    expect(data.passwordHash).toBeNull()
    expect(data.mustChangePassword).toBe(true)
    expect(data.emailVerified).toBeNull()
    expect(data.status).toBe('ACTIVE')
    // And the address is stored normalised, so the duplicate check and the unique
    // constraint agree on what "the same address" means.
    expect(data.email).toBe('new.teacher@novastar.test')
  })

  it('should never accept a password, because there is nowhere to put one', async () => {
    signIn()
    givenTenant()

    const response = await post({ ...BODY, password: 'a-long-enough-password' })

    // The schema has no such field and `roleId` is refused by an explicit guard, so
    // an unrecognised key simply does not reach `User`.
    expect(response.status).toBe(201)
    const data = mocks.userCreate.mock.calls[0][0].data as Record<string, unknown>
    expect(Object.keys(data)).not.toContain('password')
    expect(data.passwordHash).toBeNull()
  })

  it('should store the setup token as a digest, never as the token', async () => {
    signIn()
    givenTenant()

    await post()

    const data = mocks.userUpdate.mock.calls[0][0].data as Record<string, unknown>
    expect(String(data.verifyToken)).toMatch(/^[0-9a-f]{64}$/)
    expect(data.verifyTokenExpires).toBeInstanceOf(Date)
  })
})

describe('POST /api/tenants/:tenantId/users — the setup email', () => {
  it('should send the one-time setup link and say so', async () => {
    signIn()
    givenTenant()

    const response = await post()
    const body = await readJson(response)

    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].to).toBe('new.teacher@novastar.test')
    // The link points at the *portal*, which is where the set-password page lives —
    // not at this console, which would 404 in the recipient's browser.
    expect(sentEmails[0].text).toContain('https://portal.example.test/portal/set-password?token=vem_')
    expect(body.setupEmail).toBe('sent')
    expect(body.setupEmailReason).toBeNull()
    // And no token or password in the response, which is what a console that logs
    // responses would otherwise be storing.
    expect(JSON.stringify(body)).not.toContain('vem_')
  })

  it('should surface a delivery failure instead of reporting success', async () => {
    // The state this exists for: the account exists, the recipient has no way in, and
    // without a signal the operator has no reason to chase it.
    signIn()
    givenTenant()
    failNextEmail('not-configured')

    const response = await post()

    expect(response.status).toBe(502)
    const body = await readJson(response)
    expect(body.setupEmail).toBe('failed')
    // `not-configured` is the reason that names `RESEND_API_KEY`, which is the one
    // line an operator needs to fix an undeliverable deployment.
    expect(body.setupEmailReason).toBe('not-configured')
    // The account is still there — reporting a failure must not imply nothing happened.
    expect(mocks.userCreate).toHaveBeenCalledTimes(1)
  })

  it('should record the delivery outcome on the audit row', async () => {
    signIn()
    givenTenant()
    failNextEmail('provider-rejected')

    await post()

    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
    const data = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>
    const changes = data.newData as Record<string, unknown>
    expect(changes.setupEmail).toBe('failed')
    expect(changes.setupEmailReason).toBe('provider-rejected')
  })
})

describe('POST /api/tenants/:tenantId/users — the audit entry', () => {
  it('should attribute the account to the operator, the tenant and the role', async () => {
    signIn()
    givenTenant()

    await post()

    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
    const data = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>
    // `operatorId` is what makes the entry attributable. Before that column existed,
    // this row could say an account appeared and never who created it.
    expect(data.operatorId).toBe(OPERATOR.id)
    // `userId` names the account that was created, which is a real tenant user.
    expect(data.userId).toBe('user-created')
    expect(data.action).toBe('TENANT_USER_CREATE')
    expect(data.entity).toBe('user')
    expect(data.entityId).toBe('user-created')
    // On the school the account was attached to, not the platform sentinel: this
    // action is about one school inside one tenant, and the tenant's own drill-down
    // audit page reads by `tenantId`.
    expect(data.tenantId).toBe(TENANT_ROW.id)
    expect(data.schoolId).toBe(SCHOOL.id)

    const changes = data.newData as Record<string, unknown>
    expect(changes).toMatchObject({
      email: 'new.teacher@novastar.test',
      roleName: 'CLASSROOM_TEACHER',
      roleId: ROLE.id,
      schoolId: SCHOOL.id,
      setupEmail: 'sent',
    })
  })

  it('should file nothing when the account was refused', async () => {
    signIn()
    givenTenant()
    mocks.userFindFirst.mockImplementation(async () => ({ id: 'user-existing' }))

    await post()

    // A refusal that wrote an audit entry claiming an account exists would be worse
    // than no entry at all.
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })
})