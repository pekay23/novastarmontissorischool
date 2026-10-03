// `./harness` first, always: it registers the `@/lib/prisma` mock, and every
// `@/lib/*` module below reaches the database. See the harness docstring and
// `bunfig.toml`, which preloads the harness so the mock cannot lose the race.
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  fakeOperator,
  givenLiveOperator,
  mocks,
  operatorClaims,
  resetHarness,
  setCookies,
} from './harness'
import { ADMIN_SESSION_COOKIE, ADMIN_TENANT_COOKIE, createSessionToken } from '@/lib/admin-auth'

/**
 * Switching tenants changes exactly one thing.
 *
 * The console's whole read model is three tenant-scoped queries plus two
 * fleet-wide ones. Each scoped query takes its tenant id as an argument — there is
 * no ambient scope to get stale — and this file asserts that argument reaches
 * Prisma's `where`. A drill-down that dropped the `where` would return another
 * school's directory, which is the failure the whole separate-app split exists to
 * prevent, and nothing above it would notice.
 */

const PLATFORM_SESSION_SECRET = 'a-test-secret-that-is-long-enough-to-pass-32'
const OPERATOR = fakeOperator()

const {
  auditAcrossPlatform,
  auditForTenant,
  listSchoolsForTenant,
  listTenantsAcrossPlatform,
  listUsersForTenant,
} = await import('@/lib/queries')
const { getSelectedTenantId } = await import('@/lib/admin-context')

/** A live row and a matching cookie, so the reads below happen as they would. */
function signIn(): void {
  givenLiveOperator(OPERATOR)
  setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)) })
}

function selectTenant(tenantId: string): void {
  setCookies({
    [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(OPERATOR)),
    [ADMIN_TENANT_COOKIE]: tenantId,
  })
}

const SCHOOL_ROW = {
  id: 'school-1',
  tenantId: 'tenant-a',
  name: 'Novastar Montessori School',
  code: 'novastar-main',
  email: 'office@novastar.test',
  phone: '+233 000 000 000',
  address: 'Spintex, Accra',
  motto: null,
  established: new Date('2026-01-05T00:00:00.000Z'),
  createdAt: new Date('2026-01-05T00:00:00.000Z'),
  updatedAt: new Date('2026-01-05T00:00:00.000Z'),
}

const USER_ROW = {
  id: 'user-1',
  tenantId: 'tenant-a',
  schoolId: 'school-1',
  email: 'head@novastar.test',
  name: 'Head of School',
  role: { name: 'HEADMASTER' },
  status: 'ACTIVE',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: new Date('2026-02-01T09:00:00.000Z'),
  createdAt: new Date('2026-01-06T00:00:00.000Z'),
}

const AUDIT_ROW = {
  id: 'audit-1',
  tenantId: 'tenant-a',
  schoolId: 'platform',
  userId: null,
  // The console's own trail: an operator, and no tenant user.
  operatorId: OPERATOR.id,
  action: 'TENANT_PROVISION',
  entity: 'tenant',
  entityId: 'tenant-a',
  description: 'Tenant provisioned',
  createdAt: new Date('2026-02-02T10:00:00.000Z'),
}

beforeEach(() => {
  resetHarness()
  process.env.PLATFORM_SESSION_SECRET = PLATFORM_SESSION_SECRET
  signIn()
})

describe('each drill-down query filters on the tenant it was given', () => {
  it('should scope the school list', async () => {
    mocks.schoolFindMany.mockImplementation(async () => [SCHOOL_ROW])

    const schools = await listSchoolsForTenant('tenant-a')

    expect(mocks.schoolFindMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a' })
    expect(schools[0].code).toBe('novastar-main')
  })

  it('should scope the user directory', async () => {
    mocks.userFindMany.mockImplementation(async () => [USER_ROW])

    const users = await listUsersForTenant('tenant-a')

    expect(mocks.userFindMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a' })
    // The projection carries no credential column, so none can be rendered.
    const select = mocks.userFindMany.mock.calls[0][0].select as Record<string, unknown>
    expect(select).not.toHaveProperty('passwordHash')
    expect(select).not.toHaveProperty('twoFactorSecret')
    expect(users[0].roleName).toBe('HEADMASTER')
  })

  it('should scope the tenant audit trail, and its count with it', async () => {
    mocks.auditFindMany.mockImplementation(async () => [AUDIT_ROW])
    mocks.auditCount.mockImplementation(async () => 1)

    const page = await auditForTenant('tenant-a', { take: 25, skip: 0 })

    // Both halves. A filtered page beside an unfiltered count would render a
    // "1 of 340" pager that can never be walked.
    expect(mocks.auditFindMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a' })
    expect(mocks.auditCount.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a' })
    expect(page.meta.total).toBe(1)
  })

  it('should page the tenant audit trail rather than reading it whole', async () => {
    await auditForTenant('tenant-a', { take: 25, skip: 50 })

    expect(mocks.auditFindMany.mock.calls[0][0].take).toBe(25)
    expect(mocks.auditFindMany.mock.calls[0][0].skip).toBe(50)
    expect(mocks.auditFindMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' })
  })

  it('should read the operator column the trail is now attributable by', async () => {
    mocks.auditFindMany.mockImplementation(async () => [AUDIT_ROW])
    mocks.auditCount.mockImplementation(async () => 1)

    const page = await auditForTenant('tenant-a', { take: 25, skip: 0 })

    // The projection has to ask for it, and the row has to carry it through to the
    // page — before `AuditLog.operatorId`, every console entry read back with no
    // author at all.
    const select = mocks.auditFindMany.mock.calls[0][0].select as Record<string, unknown>
    expect(select).toHaveProperty('operatorId')
    expect(page.data[0].operatorId).toBe(OPERATOR.id)
    // `userId` stays a sibling rather than being reused for the operator.
    expect(page.data[0].userId).toBeNull()
  })
})

describe('switching the selection changes the scope and nothing else', () => {
  it('should move the where value when the operator switches tenant', async () => {
    selectTenant('tenant-a')
    const first = await getSelectedTenantId()
    await listSchoolsForTenant(first as string)

    selectTenant('tenant-b')
    const second = await getSelectedTenantId()
    await listSchoolsForTenant(second as string)

    expect(mocks.schoolFindMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a' })
    expect(mocks.schoolFindMany.mock.calls[1][0].where).toEqual({ tenantId: 'tenant-b' })
    // Same projection, same order, same shape. Only the scope moved.
    expect(mocks.schoolFindMany.mock.calls[0][0].select).toEqual(
      mocks.schoolFindMany.mock.calls[1][0].select,
    )
  })

  it('should not carry the previous tenant into a later query', async () => {
    selectTenant('tenant-a')
    await listSchoolsForTenant('tenant-a')

    // Signed back out of any drill-down: the selection cookie is cleared and a
    // fresh page load happens. Nothing from tenant-a may persist.
    setCookies({})
    expect(await getSelectedTenantId()).toBeNull()

    await listUsersForTenant('tenant-b')
    expect(mocks.userFindMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-b' })
  })
})

describe('the two fleet-wide reads are the only unscoped ones', () => {
  it('should page the platform audit trail with no tenant filter', async () => {
    mocks.auditFindMany.mockImplementation(async () => [AUDIT_ROW])
    mocks.auditCount.mockImplementation(async () => 1)

    await auditAcrossPlatform({ take: 25, skip: 0 })

    // Unfiltered by design, and marked CROSS-TENANT in the source. Paged anyway:
    // an unpaged fleet-wide audit log is how a control plane runs out of memory.
    expect(mocks.auditFindMany.mock.calls[0][0].where).toBeUndefined()
    expect(mocks.auditCount.mock.calls[0][0].where).toBeUndefined()
    expect(mocks.auditFindMany.mock.calls[0][0].take).toBe(25)
  })

  it('should project the roster narrowly rather than reading whole tenant rows', async () => {
    await listTenantsAcrossPlatform()

    const select = mocks.tenantFindMany.mock.calls[0][0].select as Record<string, unknown>
    expect(select).not.toHaveProperty('settings')
    expect(Object.keys(select).sort()).toEqual([
      '_count',
      'code',
      'createdAt',
      'domain',
      'id',
      'isActive',
      'name',
      'updatedAt',
    ])
  })
})
