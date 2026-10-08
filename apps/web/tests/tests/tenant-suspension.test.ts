// `./harness` first, always: it registers the `@/lib/prisma` and
// `@novastar/database` mocks, and everything below reaches the database. See the
// harness docstring and `bunfig.toml`, which preloads the harness so the mock
// cannot lose the race.
import { beforeEach, describe, expect, it } from 'bun:test'
import {
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
 * `Tenant.isActive` is a gate, not a label.
 *
 * The defect this file closes: `DELETE /api/tenants/:tenantId` refuses with 405 and
 * points the operator at `PATCH {"isActive": false}` as the tenant's off switch, and
 * that request wrote a column nothing read. Every occurrence of `isActive` in
 * `lib/` was a write of the flag, a read for a badge, or the name of a permission —
 * so suspending a school changed how it looked and nothing else. A suspended
 * tenant could be renamed, re-domained, reconfigured, given staff accounts with live
 * setup emails, and had its full directory and audit trail listed as if nothing had
 * happened.
 *
 * WHAT IS ASSERTED, AND WHY EACH ASSERTION IS THE ONE THAT MATTERS
 * ---------------------------------------------------------------
 * Every refusal is asserted twice: as a thrown `TenantSuspendedError`, and as the
 * absence of the side effect it exists to prevent. The error alone would pass against
 * a gate that threw after the write, and the side effect alone would pass against a
 * gate that swallowed the error and returned an empty page — which is the failure
 * mode a `where: { tenant, isActive: true }` filter would produce, and the reason
 * these gates throw instead of filtering.
 *
 * `setTenantActive` has the opposite assertion: it must keep working on a suspended
 * tenant. Gating it would make suspension permanent and the flag pointless, so the
 * test that matters there is the one that fails if somebody adds the check.
 *
 * The 404 cases are here too, and they are not filler. Requirement: a suspended
 * tenant is a 403 because it exists; a tenant that does not exist is still a 404.
 * Together the two pin the distinction, so a "simplification" that answers 403 to
 * everything fails here rather than in production.
 *
 * Ids below appear in no cookie and no other fixture, so an assertion naming them
 * cannot be satisfied by a value the harness supplied by accident.
 */

const PLATFORM_SESSION_SECRET = 'a-test-secret-that-is-long-enough-to-pass-32'
const OPERATOR = fakeOperator()

const {
  auditAcrossPlatform,
  auditForTenant,
  getSchoolInTenant,
  getTenantById,
  listSchoolsForTenant,
  listUsersForTenant,
  setTenantActive,
  updateTenantFields,
  writeTenantSetting,
} = await import('@/lib/queries')
const { requireExistingTenant, requireTenantScope } = await import('@/lib/admin-context')
const { inviteTenantUser } = await import('@/lib/invite-user')
const {
  NotFoundError,
  TENANT_SUSPENDED_CODE,
  TenantSuspendedError,
  toErrorResponse,
} = await import('@/lib/errors')

const TENANT_ROUTE = await import('@/app/api/tenants/[tenantId]/route')
const SETTINGS_ROUTE = await import('@/app/api/tenants/[tenantId]/settings/route')
const USERS_ROUTE = await import('@/app/api/tenants/[tenantId]/users/route')
const PROVISION_ROUTE = await import('@/app/api/tenants/[tenantId]/provision/route')
const AUDIT_ROUTE = await import('@/app/api/audit/route')

const TENANT_ID = 'tenant-suspension-alpha'
const OTHER_TENANT_ID = 'tenant-suspension-beta'
const SCHOOL_ID = 'school-suspension-alpha'

const TENANT_ROW = {
  id: TENANT_ID,
  name: 'Alpha Montessori',
  code: 'alpha',
  domain: null,
  isActive: true,
  settings: { currency: 'GHS' },
  createdAt: new Date('2026-01-02T08:00:00.000Z'),
  updatedAt: new Date('2026-01-02T08:00:00.000Z'),
  _count: { schools: 1, users: 2 },
}

/** The same tenant after `PATCH {"isActive": false}`: same rows, flag off. */
const SUSPENDED_TENANT_ROW = { ...TENANT_ROW, isActive: false }

const MUTATION_CONTEXT = {
  operatorId: 'operator-suspension-alpha',
  operatorEmail: 'ops@novastar.test',
  ipAddress: null,
  userAgent: null,
}

const SCHOOL_ROW = { id: SCHOOL_ID, tenantId: TENANT_ID, name: 'Alpha Montessori School' }

/**
 * Arms the tenant row every function in this file reads.
 *
 * One implementation answering every `select`, because the projection each call asks
 * for differs (`{ isActive }` for the gate, `{ name, domain, isActive }` for the
 * mutable-field write, `{ settings, isActive }` for the settings merge, the whole
 * detail row for the drill-down) and a test that dispatched on the projection would
 * be asserting the shape of the queries rather than the suspension gate. It answers
 * on `where.id`, so a query that addressed another tenant still misses.
 */
function givenTenant(initial: typeof TENANT_ROW | typeof SUSPENDED_TENANT_ROW): void {
  // The row is state rather than a constant, because `setTenantActive` reads the
  // tenant a second time inside its transaction to build the response it returns. A
  // mock that answered every read with the pre-write row would let a reactivation
  // return 200 while reporting the tenant as still switched off, and the assertion
  // that the response says otherwise would be the only thing standing in for the
  // whole round trip.
  let row = initial
  mocks.tenantFindFirst.mockImplementation(async (args) =>
    args.where?.id === row.id ? row : null,
  )
  mocks.tenantUpdate.mockImplementation(async (args) => {
    const flip = args.data?.isActive
    if (typeof flip === 'boolean') row = { ...row, isActive: flip }
    return row
  })
}

/** A signed-in operator session, backed by a live row. */
function signIn(operator = OPERATOR): void {
  givenLiveOperator(operator)
  setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(operator)) })
}

beforeEach(() => {
  resetHarness()
  process.env.PLATFORM_SESSION_SECRET = PLATFORM_SESSION_SECRET
  process.env.NEXTAUTH_URL = 'https://portal.example.test'
  setCookies({})
})

describe('requireTenantScope — the one gate every drill-down route passes through', () => {
  it('should refuse a suspended tenant', async () => {
    givenTenant(SUSPENDED_TENANT_ROW)

    const thrown: unknown = await requireTenantScope(TENANT_ID).catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(TenantSuspendedError)
    // The code travels on the error as well as on the response, so a caller that
    // catches rather than reads a body can still branch on it. Structural rather than
    // `as TenantSuspendedError` because the class arrives through a dynamic import.
    expect((thrown as { code?: unknown }).code).toBe(TENANT_SUSPENDED_CODE)
  })

  it('should refuse the same tenant an hour later, because the row is the answer', async () => {
    // Not a claim in a session token and not a cached flag: `getTenantById` is read
    // fresh on every request, so suspension takes effect on the next request rather
    // than whenever something expires.
    givenTenant(SUSPENDED_TENANT_ROW)
    await expect(requireTenantScope(TENANT_ID)).rejects.toBeInstanceOf(TenantSuspendedError)

    resetHarness()
    process.env.PLATFORM_SESSION_SECRET = PLATFORM_SESSION_SECRET
    givenTenant(TENANT_ROW)
    await expect(requireTenantScope(TENANT_ID)).resolves.toMatchObject({ isActive: true })
  })

  it('should answer 403 with the stable code, and a body that names only that tenant', async () => {
    const response = toErrorResponse(new TenantSuspendedError(TENANT_ID))

    // 403, not 404: the tenant exists, is listed on the roster, and is reactivatable.
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: `Tenant "${TENANT_ID}" is suspended.`,
      code: 'tenant-suspended',
      tenantId: TENANT_ID,
    })
  })

  it('should still answer 404 for a tenant that does not exist', async () => {
    mocks.tenantFindFirst.mockImplementation(async () => null)

    await expect(requireTenantScope(TENANT_ID)).rejects.toBeInstanceOf(NotFoundError)
    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(1)
  })

  it('should resolve an active tenant', async () => {
    givenTenant(TENANT_ROW)

    const tenant = await requireTenantScope(TENANT_ID)

    expect(tenant.id).toBe(TENANT_ID)
    expect(tenant.isActive).toBe(true)
  })

  it('should not let the exception reach a suspended tenant', async () => {
    // `requireExistingTenant` is the tenant pages' resolution and the only way to get
    // a suspended tenant back out of a gate. It is here so the exception is a
    // documented, single-purpose function rather than an accident — and so that
    // adding a second caller is a visible edit to this file.
    //
    // STRONGER THAN BEFORE THE UNION LANDED. The assertion used to be "it hands back
    // the tenant", which a caller could then do anything with. Now the suspended arm
    // carries `identity` and *no* `tenant`, so the row is not merely unused — it is
    // not there, which is what `tests/tenant-suspension-pages.test.ts` pins on all
    // four pages at once.
    givenTenant(SUSPENDED_TENANT_ROW)

    const resolved = await requireExistingTenant(TENANT_ID)

    expect(resolved.status).toBe('suspended')
    if (resolved.status !== 'suspended') throw new Error('expected the suspended arm')
    expect(resolved.identity.id).toBe(TENANT_ID)
    expect(resolved.identity.code).toBe(TENANT_ROW.code)
    expect('tenant' in resolved).toBe(false)
  })

  it('should hand an active tenant the row and no identity', async () => {
    // The other arm, because a resolver that answers only one shape would let the
    // suspended-arm assertions above pass while breaking every real page.
    givenTenant(TENANT_ROW)

    const resolved = await requireExistingTenant(TENANT_ID)

    expect(resolved.status).toBe('active')
    if (resolved.status !== 'active') throw new Error('expected the active arm')
    expect(resolved.tenant.id).toBe(TENANT_ID)
    expect(resolved.tenant.isActive).toBe(true)
    expect(Object.keys(resolved).sort()).toEqual(['status', 'tenant'])
  })

  it('should make a suspended tenant invisible to the resolution the gate uses', async () => {
    // `getTenantById` is ungated on purpose — `requireTenantScope` needs the row in
    // order to report that it is suspended, and `setTenantActive` needs it to return
    // the reactivated tenant. Asserting the ungated behaviour is what keeps that
    // decision honest: if a future change filters here, this fails and the 403 becomes
    // a 404.
    givenTenant(SUSPENDED_TENANT_ROW)

    expect((await getTenantById(TENANT_ID))?.isActive).toBe(false)
  })
})

describe('the mutable-field write refuses a suspended tenant', () => {
  it('should refuse to rename a suspended tenant, writing and auditing nothing', async () => {
    givenTenant(SUSPENDED_TENANT_ROW)

    await expect(
      updateTenantFields(TENANT_ID, { name: 'Renamed While Off' }, MUTATION_CONTEXT),
    ).rejects.toBeInstanceOf(TenantSuspendedError)

    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })

  it('should refuse to re-domain a suspended tenant too', async () => {
    // The same gate, a different column. Asserted separately because `name` and
    // `domain` are separate entries in the mutable projection and a gate written
    // against one of them would leave the other open.
    givenTenant(SUSPENDED_TENANT_ROW)

    await expect(
      updateTenantFields(TENANT_ID, { domain: 'https://elsewhere.test' }, MUTATION_CONTEXT),
    ).rejects.toBeInstanceOf(TenantSuspendedError)

    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
  })

  it('should still patch an active tenant', async () => {
    // The negative control. Without it, "refuses everything" passes this file too.
    givenTenant(TENANT_ROW)

    const updated = await updateTenantFields(TENANT_ID, { name: 'Renamed' }, MUTATION_CONTEXT)

    expect(updated?.tenant.id).toBe(TENANT_ID)
    expect(mocks.tenantUpdate.mock.calls[0][0].data).toEqual({ name: 'Renamed' })
  })

  it('should still answer null for a tenant that does not exist', async () => {
    // 404 and 403 are different answers, and the caller turns this null into the 404.
    mocks.tenantFindFirst.mockImplementation(async () => null)

    expect(
      await updateTenantFields(TENANT_ID, { name: 'Renamed' }, MUTATION_CONTEXT),
    ).toBeNull()
  })
})

describe('the settings write refuses a suspended tenant', () => {
  it('should refuse one dot-path, writing and auditing nothing', async () => {
    givenTenant(SUSPENDED_TENANT_ROW)

    await expect(
      writeTenantSetting(TENANT_ID, ['timezone'], 'Europe/London', MUTATION_CONTEXT),
    ).rejects.toBeInstanceOf(TenantSuspendedError)

    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })

  it('should still merge into an active tenant', async () => {
    givenTenant(TENANT_ROW)

    const next = await writeTenantSetting(TENANT_ID, ['timezone'], 'Africa/Accra', MUTATION_CONTEXT)

    expect(next).toEqual({ currency: 'GHS', timezone: 'Africa/Accra' })
    expect(mocks.tenantUpdate.mock.calls[0][0].where).toEqual({ id: TENANT_ID })
  })
})

describe('setTenantActive is the way back, so it is not gated', () => {
  it('should reactivate a suspended tenant', async () => {
    givenTenant(SUSPENDED_TENANT_ROW)

    const flipped = await setTenantActive(TENANT_ID, true, MUTATION_CONTEXT)

    expect(flipped?.previous).toBe(false)
    expect(mocks.tenantUpdate.mock.calls[0][0].where).toEqual({ id: TENANT_ID })
    expect(mocks.tenantUpdate.mock.calls[0][0].data).toEqual({ isActive: true })
    // And the entry says which way it moved, so an auditor can tell a reactivation
    // from a no-op flip.
    const entry = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>
    expect(entry.action).toBe('TENANT_REACTIVATE')
    expect(entry.newData).toEqual({ from: false, to: true })
  })

  it('should suspend an already-suspended tenant, recording the attempt', async () => {
    givenTenant(SUSPENDED_TENANT_ROW)

    const flipped = await setTenantActive(TENANT_ID, false, MUTATION_CONTEXT)

    expect(flipped?.previous).toBe(false)
    expect(mocks.tenantUpdate.mock.calls[0][0].data).toEqual({ isActive: false })
  })

  it('should suspend an active tenant', async () => {
    givenTenant(TENANT_ROW)

    const flipped = await setTenantActive(TENANT_ID, false, MUTATION_CONTEXT)

    expect(flipped?.previous).toBe(true)
    expect(mocks.tenantUpdate.mock.calls[0][0].data).toEqual({ isActive: false })
  })
})

describe('the tenant-scoped reads refuse a suspended tenant', () => {
  it('should refuse the school list', async () => {
    givenTenant(SUSPENDED_TENANT_ROW)
    mocks.schoolFindMany.mockImplementation(async () => [])

    await expect(listSchoolsForTenant(TENANT_ID)).rejects.toBeInstanceOf(TenantSuspendedError)

    // Not "an empty list". A suspended school reads as a school with no schools in it,
    // and an operator cannot act on an answer that looks like data.
    expect(mocks.schoolFindMany).toHaveBeenCalledTimes(0)
  })

  it('should still list the schools of an active tenant', async () => {
    givenTenant(TENANT_ROW)
    mocks.schoolFindMany.mockImplementation(async () => [])

    await listSchoolsForTenant(TENANT_ID)

    expect(mocks.schoolFindMany.mock.calls[0][0].where).toEqual({ tenantId: TENANT_ID })
  })

  it("should refuse the user directory", async () => {
    givenTenant(SUSPENDED_TENANT_ROW)
    mocks.userFindMany.mockImplementation(async () => [
      {
        id: 'user-alpha',
        tenantId: TENANT_ID,
        schoolId: SCHOOL_ID,
        email: 'head@alpha.test',
        name: 'Head of School',
        role: { name: 'HEADMASTER' },
        status: 'ACTIVE',
        isActive: true,
        mustChangePassword: false,
        lastLoginAt: null,
        createdAt: new Date('2026-01-06T00:00:00.000Z'),
      },
    ])

    await expect(listUsersForTenant(TENANT_ID)).rejects.toBeInstanceOf(TenantSuspendedError)

    expect(mocks.userFindMany).toHaveBeenCalledTimes(0)
  })

  it('should refuse the tenant audit trail, its rows and its count alike', async () => {
    givenTenant(SUSPENDED_TENANT_ROW)
    mocks.auditFindMany.mockImplementation(async () => [])
    mocks.auditCount.mockImplementation(async () => 0)

    await expect(auditForTenant(TENANT_ID, { take: 25, skip: 0 })).rejects.toBeInstanceOf(
      TenantSuspendedError,
    )

    // Both halves: a page that refused while its count still ran would leak "this
    // tenant has 340 entries" through a total.
    expect(mocks.auditFindMany).toHaveBeenCalledTimes(0)
    expect(mocks.auditCount).toHaveBeenCalledTimes(0)
  })

  it('should refuse one school inside a suspended tenant', async () => {
    givenTenant(SUSPENDED_TENANT_ROW)
    mocks.schoolFindFirst.mockImplementation(async () => SCHOOL_ROW)

    await expect(getSchoolInTenant(TENANT_ID, SCHOOL_ID)).rejects.toBeInstanceOf(
      TenantSuspendedError,
    )

    expect(mocks.schoolFindFirst).toHaveBeenCalledTimes(0)
  })

  it('should still resolve a school inside an active tenant', async () => {
    givenTenant(TENANT_ROW)
    mocks.schoolFindFirst.mockImplementation(async () => SCHOOL_ROW)

    expect(await getSchoolInTenant(TENANT_ID, SCHOOL_ID)).toEqual(SCHOOL_ROW)
    expect(mocks.schoolFindFirst.mock.calls[0][0].where).toEqual({
      id: SCHOOL_ID,
      tenantId: TENANT_ID,
    })
  })

  it('should not let the gate widen: another active tenant is unaffected', async () => {
    // The gate reads the tenant it was given, by primary key. A check written as
    // "any suspended tenant exists" would fail here, and a check written against the
    // wrong column would too.
    mocks.tenantFindFirst.mockImplementation(async (args) =>
      args.where?.id === OTHER_TENANT_ID ? TENANT_ROW : null,
    )
    mocks.userFindMany.mockImplementation(async () => [])

    expect(await listUsersForTenant(OTHER_TENANT_ID)).toEqual([])
    expect(mocks.userFindMany.mock.calls[0][0].where).toEqual({ tenantId: OTHER_TENANT_ID })
  })
})

describe('the platform-wide audit trail withholds a suspended tenant instead of refusing', () => {
  const ACTIVE_TENANT_ID = 'tenant-suspension-gamma'
  const SENTINEL = 'platform'

  function auditRow(id: string, tenantId: string) {
    return {
      id,
      tenantId,
      schoolId: tenantId === SENTINEL ? SENTINEL : 'school-suspension-alpha',
      userId: null,
      operatorId: 'operator-suspension-alpha',
      action: 'TENANT_UPDATE',
      entity: 'tenant',
      entityId: tenantId,
      description: `Entry for ${tenantId}`,
      createdAt: new Date('2026-02-02T10:00:00.000Z'),
    }
  }

  const ACTIVE_ROW = auditRow('audit-alpha-active', ACTIVE_TENANT_ID)
  const SUSPENDED_ROW = auditRow('audit-alpha-suspended', TENANT_ID)
  const SENTINEL_ROW = auditRow('audit-platform-login', SENTINEL)
  const PLATFORM_ROWS = [ACTIVE_ROW, SUSPENDED_ROW, SENTINEL_ROW]

  /**
   * An in-memory audit table the mocks *filter*, rather than a canned answer.
   *
   * This is the whole reason these assertions can be trusted. A mock that returns a
   * fixed array answers the same way whether or not the production predicate is
   * present, so "a suspended tenant's rows are excluded" asserted against one is a
   * claim about the test's own fixture. Honouring the `where` the production code
   * actually sent makes removing that `where` put the rows back, which is the failure
   * the mutation check has to be able to see.
   */
  function givenAuditTable(rows: readonly ReturnType<typeof auditRow>[]): void {
    const visible = (args: { where?: Record<string, unknown> }) => {
      const notIn = (args.where?.tenantId as { notIn?: readonly string[] } | undefined)?.notIn
      return notIn ? rows.filter((row) => !notIn.includes(row.tenantId)) : [...rows]
    }
    mocks.auditFindMany.mockImplementation(async (args) => {
      const matched = visible(args)
      return matched.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? matched.length))
    })
    mocks.auditCount.mockImplementation(async (args) => visible(args).length)
  }

  /** Arms the fleet's suspension state, which is what the exclusion is built from. */
  function givenSuspendedTenants(...ids: readonly string[]): void {
    mocks.tenantFindMany.mockImplementation(async (args) =>
      args.where?.isActive === false ? ids.map((id) => ({ id })) : [],
    )
  }

  beforeEach(() => {
    givenAuditTable(PLATFORM_ROWS)
  })

  it('should leave a suspended tenant out of the rows it returns', async () => {
    givenSuspendedTenants(TENANT_ID)

    const page = await auditAcrossPlatform({ take: 25, skip: 0 })

    // Named rather than counted, so "excluded" cannot be satisfied by a filter that
    // happens to return nothing at all.
    expect(page.data.map((entry) => entry.id)).toEqual(['audit-alpha-active', 'audit-platform-login'])
    expect(page.data.map((entry) => entry.tenantId)).not.toContain(TENANT_ID)
    // And its count, or a suspended school's trail leaks through a total.
    expect(page.meta.total).toBe(2)
  })

  it('should still return the active tenant, and the control that proves it', async () => {
    givenSuspendedTenants(TENANT_ID)

    const page = await auditAcrossPlatform({ take: 25, skip: 0 })

    // The other direction. A predicate that excluded everything would satisfy the test
    // above, so the active tenant's row is asserted by identity.
    const active = page.data.find((entry) => entry.id === ACTIVE_ROW.id)
    expect(active?.tenantId).toBe(ACTIVE_TENANT_ID)
    expect(active?.action).toBe('TENANT_UPDATE')
  })

  it('should keep the console’s own entries, whose tenantId is the sentinel', async () => {
    givenSuspendedTenants(TENANT_ID)

    const page = await auditAcrossPlatform({ take: 25, skip: 0 })

    // The trap this exclusion had to avoid. Every operator sign-in, sign-out and
    // refused attempt is written with `tenantId: 'platform'` (`lib/audit.ts`), which
    // names no tenant at all. An allowlist of active tenants would have deleted the
    // console's own sign-in trail from the one view meant to hold it all.
    expect(page.data.map((entry) => entry.id)).toContain('audit-platform-login')
  })

  it('should say how many rows it withheld, rather than shrinking silently', async () => {
    // The reason the response shape changed. Silent filtering answers "did anything
    // happen to that school?" with "nothing", which is the one conclusion an audit
    // trail must never support.
    givenSuspendedTenants(TENANT_ID)

    const page = await auditAcrossPlatform({ take: 25, skip: 0 })

    expect(page.meta.excludedSuspendedEntries).toBe(1)
    // Arithmetic, not a second independent read: the three numbers have to reconcile,
    // so a client can recover the unfiltered total.
    expect(page.meta.total + page.meta.excludedSuspendedEntries).toBe(PLATFORM_ROWS.length)
  })

  it('should send the exclusion to Prisma on both halves of the page', async () => {
    givenSuspendedTenants(TENANT_ID)

    await auditAcrossPlatform({ take: 25, skip: 0 })

    // `toEqual`, not `toContain`: `where: {}` and a `tenantId: { not: ... }` written
    // against the wrong direction both mention the right words.
    expect(mocks.auditFindMany.mock.calls[0][0].where).toEqual({
      tenantId: { notIn: [TENANT_ID] },
    })
    expect(mocks.auditCount.mock.calls[0][0].where).toEqual({ tenantId: { notIn: [TENANT_ID] } })
    expect(mocks.tenantFindMany.mock.calls[0][0].where).toEqual({ isActive: false })
  })

  it('should count every suspended tenant, not just one', async () => {
    givenSuspendedTenants(TENANT_ID, ACTIVE_TENANT_ID)

    const page = await auditAcrossPlatform({ take: 25, skip: 0 })

    expect(page.data.map((entry) => entry.id)).toEqual(['audit-platform-login'])
    expect(page.meta.total).toBe(1)
    expect(page.meta.excludedSuspendedEntries).toBe(2)
  })

  it('should withhold nothing and filter nothing when no tenant is suspended', async () => {
    // The other branch, and the reason a `where`-less query is still correct here: an
    // empty exclusion set has nothing to exclude. Stated so the branch is a decision
    // rather than an accident of the mock's default answer.
    givenSuspendedTenants()

    const page = await auditAcrossPlatform({ take: 25, skip: 0 })

    expect(mocks.auditFindMany.mock.calls[0][0].where).toBeUndefined()
    expect(mocks.auditCount.mock.calls[0][0].where).toBeUndefined()
    expect(page.meta.excludedSuspendedEntries).toBe(0)
    expect(page.data).toHaveLength(3)
    expect(page.meta.total).toBe(3)
  })

  it('should survive the reactivation: the same tenant comes back into the trail', async () => {
    // The other half of "suspension is a gate, not a delete". Once the flag is off the
    // gate, the rows it withheld are visible again — nothing was destroyed, which is
    // the whole difference between suspension and deletion.
    givenSuspendedTenants()
    const before = await auditAcrossPlatform({ take: 25, skip: 0 })

    givenSuspendedTenants(TENANT_ID)
    const during = await auditAcrossPlatform({ take: 25, skip: 0 })

    givenSuspendedTenants()
    const after = await auditAcrossPlatform({ take: 25, skip: 0 })

    expect(before.data.map((entry) => entry.id)).toContain(SUSPENDED_ROW.id)
    expect(during.data.map((entry) => entry.id)).not.toContain(SUSPENDED_ROW.id)
    expect(after.data.map((entry) => entry.id)).toContain(SUSPENDED_ROW.id)
    expect(after.meta.total).toBe(before.meta.total)
  })

  it('should report the exclusion over GET /api/audit', async () => {
    // The route, so the shape the operator and any client actually receive is pinned
    // rather than assumed. `data` and `meta.total` are unchanged for existing
    // consumers; the withheld count is additive.
    signIn()
    givenSuspendedTenants(TENANT_ID)

    const response = await AUDIT_ROUTE.GET(request('/api/audit'))
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect((body.meta as Record<string, unknown>).excludedSuspendedEntries).toBe(1)
    expect((body.meta as Record<string, unknown>).total).toBe(2)
    expect(JSON.stringify(body.data)).not.toContain('audit-alpha-suspended')
    expect(JSON.stringify(body.data)).toContain('audit-platform-login')
  })
})

describe('inviteTenantUser — no account, and no setup link, into a suspended tenant', () => {
  it('should refuse before creating anything or sending anything', async () => {
    givenTenant(SUSPENDED_TENANT_ROW)
    // The school is present and would resolve if the gate were not there. So a gate
    // that throws for the wrong reason — an outage-shaped error, or a 404 — cannot
    // pass this test.
    mocks.schoolFindFirst.mockImplementation(async () => SCHOOL_ROW)
    mocks.roleFindFirst.mockImplementation(async () => ({ id: 'role-teacher' }))

    await expect(
      inviteTenantUser(
        {
          tenantId: TENANT_ID,
          schoolId: SCHOOL_ID,
          roleName: 'CLASSROOM_TEACHER',
          email: 'new.teacher@alpha.test',
          name: 'New Teacher',
        },
        MUTATION_CONTEXT,
      ),
    ).rejects.toBeInstanceOf(TenantSuspendedError)

    // The three side effects that matter, each named.
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
    expect(sentEmails).toHaveLength(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })

  it('should still create the account in an active tenant', async () => {
    // The negative control for the test above: without it, "this route never mints
    // anything" would pass.
    givenTenant(TENANT_ROW)
    mocks.schoolFindFirst.mockImplementation(async () => SCHOOL_ROW)
    mocks.roleFindFirst.mockImplementation(async () => ({ id: 'role-teacher' }))

    await inviteTenantUser(
      {
        tenantId: TENANT_ID,
        schoolId: SCHOOL_ID,
        roleName: 'CLASSROOM_TEACHER',
        email: 'new.teacher@alpha.test',
        name: 'New Teacher',
      },
      MUTATION_CONTEXT,
    )

    expect(mocks.userCreate).toHaveBeenCalledTimes(1)
    expect(sentEmails).toHaveLength(1)
  })
})

describe('GET /api/tenants/:tenantId — a suspended tenant is 403, not 404 and not data', () => {
  it('should answer 403 with the code', async () => {
    signIn()
    givenTenant(SUSPENDED_TENANT_ROW)

    const response = await TENANT_ROUTE.GET(request(`/api/tenants/${TENANT_ID}`), {
      params: Promise.resolve({ tenantId: TENANT_ID }),
    })

    expect(response.status).toBe(403)
    expect(await readJson(response)).toMatchObject({
      code: TENANT_SUSPENDED_CODE,
      tenantId: TENANT_ID,
    })
  })

  it('should answer 404 for a tenant that does not exist', async () => {
    // The other half of the distinction, on the same route: a stale bookmark is a
    // missing tenant, and an operator debugging one needs to be able to tell the two.
    signIn()
    mocks.tenantFindFirst.mockImplementation(async () => null)

    const response = await TENANT_ROUTE.GET(request('/api/tenants/tenant-suspension-ghost'), {
      params: Promise.resolve({ tenantId: 'tenant-suspension-ghost' }),
    })

    expect(response.status).toBe(404)
    expect((await readJson(response)).code).toBeUndefined()
  })
})

describe('PATCH /api/tenants/:tenantId — fields refuse, isActive does not', () => {
  it('should answer 403 to a rename of a suspended tenant, having written nothing', async () => {
    signIn()
    givenTenant(SUSPENDED_TENANT_ROW)

    const response = await TENANT_ROUTE.PATCH(
      request(`/api/tenants/${TENANT_ID}`, {
        method: 'PATCH',
        body: { name: 'Renamed While Off' },
      }),
      { params: Promise.resolve({ tenantId: TENANT_ID }) },
    )

    expect(response.status).toBe(403)
    expect((await readJson(response)).code).toBe(TENANT_SUSPENDED_CODE)
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })

  it('should reactivate a suspended tenant over the same route', async () => {
    // The route that closes the loop. `PATCH /api/tenants/:id` does not pass through
    // `requireTenantScope` precisely so this can work; if it did, a suspended tenant
    // could never be brought back and the flag would be a one-way door.
    signIn()
    givenTenant(SUSPENDED_TENANT_ROW)

    const response = await TENANT_ROUTE.PATCH(
      request(`/api/tenants/${TENANT_ID}`, { method: 'PATCH', body: { isActive: true } }),
      { params: Promise.resolve({ tenantId: TENANT_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.tenantUpdate.mock.calls[0][0].where).toEqual({ id: TENANT_ID })
    expect(mocks.tenantUpdate.mock.calls[0][0].data).toEqual({ isActive: true })
    expect((await readJson(response)).isActive).toBe(true)
  })

  it('should answer 403 rather than 404 for a rename of a suspended tenant', async () => {
    // Status named separately from the code above: a client that branches on the
    // status has to reach the same conclusion a client that branches on the code
    // does. Collapsing them into the 404 the missing-tenant case uses would tell an
    // operator their tenant had been deleted.
    signIn()
    givenTenant(SUSPENDED_TENANT_ROW)

    const response = await TENANT_ROUTE.PATCH(
      request(`/api/tenants/${TENANT_ID}`, { method: 'PATCH', body: { name: 'Renamed' } }),
      { params: Promise.resolve({ tenantId: TENANT_ID }) },
    )

    expect(response.status).not.toBe(404)
  })
})

describe('PATCH /api/tenants/:tenantId/settings — a suspended tenant keeps its document', () => {
  it('should answer 403 and write nothing', async () => {
    signIn()
    givenTenant(SUSPENDED_TENANT_ROW)

    const response = await SETTINGS_ROUTE.PATCH(
      request(`/api/tenants/${TENANT_ID}/settings`, {
        method: 'PATCH',
        body: { key: 'timezone', value: 'Europe/London' },
      }),
      { params: Promise.resolve({ tenantId: TENANT_ID }) },
    )

    expect(response.status).toBe(403)
    expect((await readJson(response)).code).toBe(TENANT_SUSPENDED_CODE)
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })

  it('should still merge into an active tenant', async () => {
    signIn()
    givenTenant(TENANT_ROW)

    const response = await SETTINGS_ROUTE.PATCH(
      request(`/api/tenants/${TENANT_ID}/settings`, {
        method: 'PATCH',
        body: { key: 'timezone', value: 'Africa/Accra' },
      }),
      { params: Promise.resolve({ tenantId: TENANT_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.tenantUpdate.mock.calls[0][0].data).toMatchObject({
      settings: { currency: 'GHS', timezone: 'Africa/Accra' },
    })
  })
})

describe('POST /api/tenants/:tenantId/users — no credential into a suspended tenant', () => {
  it('should answer 403, having created no account and sent no email', async () => {
    signIn()
    givenTenant(SUSPENDED_TENANT_ROW)
    mocks.schoolFindFirst.mockImplementation(async () => SCHOOL_ROW)
    mocks.roleFindFirst.mockImplementation(async () => ({ id: 'role-teacher' }))

    const response = await USERS_ROUTE.POST(
      request(`/api/tenants/${TENANT_ID}/users`, {
        method: 'POST',
        body: {
          email: 'new.teacher@alpha.test',
          roleName: 'CLASSROOM_TEACHER',
          schoolId: SCHOOL_ID,
        },
      }),
      { params: Promise.resolve({ tenantId: TENANT_ID }) },
    )

    expect(response.status).toBe(403)
    expect((await readJson(response)).code).toBe(TENANT_SUSPENDED_CODE)
    // The whole point: a setup link is good for 24 hours and single use, so a refusal
    // that created the account and skipped the email would still have left a row an
    // operator could act on.
    expect(mocks.userCreate).toHaveBeenCalledTimes(0)
    expect(sentEmails).toHaveLength(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })

  it('should still create the account in an active tenant', async () => {
    signIn()
    givenTenant(TENANT_ROW)
    mocks.schoolFindFirst.mockImplementation(async () => SCHOOL_ROW)
    mocks.roleFindFirst.mockImplementation(async () => ({ id: 'role-teacher' }))

    const response = await USERS_ROUTE.POST(
      request(`/api/tenants/${TENANT_ID}/users`, {
        method: 'POST',
        body: {
          email: 'new.teacher@alpha.test',
          roleName: 'CLASSROOM_TEACHER',
          schoolId: SCHOOL_ID,
        },
      }),
      { params: Promise.resolve({ tenantId: TENANT_ID }) },
    )

    expect(response.status).toBe(201)
    expect(mocks.userCreate).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/tenants/:tenantId/provision — reconciling onto a suspended tenant', () => {
  it('should answer 403 and provision nothing', async () => {
    signIn()
    givenTenant(SUSPENDED_TENANT_ROW)

    const response = await PROVISION_ROUTE.POST(
      request(`/api/tenants/${TENANT_ID}/provision`, {
        method: 'POST',
        body: { school: { name: 'Alpha Montessori School', code: 'alpha-second' } },
      }),
      { params: Promise.resolve({ tenantId: TENANT_ID }) },
    )

    expect(response.status).toBe(403)
    expect((await readJson(response)).code).toBe(TENANT_SUSPENDED_CODE)
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(0)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(0)
  })
})

describe('the refusal discloses nothing beyond the tenant the request named', () => {
  it('should name the selected tenant and nothing else', async () => {
    signIn()
    // Two tenants, one suspended. The operator asked about the suspended one.
    mocks.tenantFindFirst.mockImplementation(async (args) =>
      args.where?.id === TENANT_ID
        ? SUSPENDED_TENANT_ROW
        : args.where?.id === OTHER_TENANT_ID
          ? { ...TENANT_ROW, id: OTHER_TENANT_ID, name: 'Beta Montessori', code: 'beta' }
          : null,
    )

    const response = await TENANT_ROUTE.GET(request(`/api/tenants/${TENANT_ID}`), {
      params: Promise.resolve({ tenantId: TENANT_ID }),
    })
    const body = await readJson(response)

    // It may name the tenant the operator selected — it is in the URL they are
    // holding, and the roster already showed them its name and code.
    expect(String(body.error)).toContain(TENANT_ID)
    // It must not name another tenant, or answer a question nobody asked.
    expect(JSON.stringify(body)).not.toContain(OTHER_TENANT_ID)
    expect(JSON.stringify(body)).not.toContain('Beta Montessori')
    // And it carries no settings document, no user count and no school count, which
    // is what a "here is the suspended tenant anyway" body would smuggle through.
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'tenantId'])
  })

  it('should refuse before the capability is even considered', async () => {
    // Ordering claim, and it is about the *other* direction: a caller without
    // `tenant:update` must still be told only that the grant is missing, so the
    // suspension check cannot become a way to learn which tenants are switched off.
    givenLiveOperator(fakeOperator({ id: OPERATOR.id, capabilities: ['tenant:read'] }))
    setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)) })
    givenTenant(SUSPENDED_TENANT_ROW)

    const response = await TENANT_ROUTE.PATCH(
      request(`/api/tenants/${TENANT_ID}`, { method: 'PATCH', body: { name: 'Renamed' } }),
      { params: Promise.resolve({ tenantId: TENANT_ID }) },
    )

    expect(response.status).toBe(403)
    expect(String((await readJson(response)).error)).toBe(
      'This operator cannot tenant:update.',
    )
    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(0)
  })
})
