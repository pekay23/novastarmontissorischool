import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import * as actualDatabase from '@novastar/database'

/**
 * Delegation must be scoped by school and must recognise wildcard grants.
 *
 * Four defects, all in `index.ts`, all of which made delegation either inert or unsafe:
 *
 *   1. `createDelegation` gated on a literal `Set.has`, so a delegator holding `*` or
 *      `academic:*` could not delegate any specific key — the exact case
 *      `getDefaultDelegationRules` exists to enable. It contradicted `hasPermission` and the
 *      policy check beside it, both of which honour wildcards.
 *   2. `getEffectivePermissions` passed its optional `schoolId` straight into a Prisma
 *      `where`. Prisma DROPS an `undefined` filter, so a caller that omitted the school
 *      resolved delegations from every school in the tenant.
 *   3. `getUserSession` counted delegations with `expiresAt > now` (dropping open-ended
 *      rows) while building permissions from a school-less, open-ended-inclusive read.
 *   4. `createDelegation` never checked that `toUserId` was in the tenant/school the row was
 *      written for, so the caller's own scope was stamped onto an arbitrary user id.
 *
 * WHY A FAKE CLIENT, AND WHY IT IS INSTALLED PER TEST
 * ---------------------------------------------------
 * Every export in `index.ts` reaches `prisma` on its first line, so none of this is
 * reachable without one. `@novastar/database` exposes no injection hook — but `mock.module`
 * is enough, and this file follows the discipline of `apps/portal/tests/empty-permissions.test.ts`
 * exactly: the previous namespace is captured at MODULE SCOPE (a capture inside `beforeEach`
 * would record this file's OWN factory, because the registration runs before any hook), and
 * the fake is reinstalled per test and restored after, leaving the process as found.
 *
 * The fake evaluates the `where` clauses rather than ignoring them. That is the point: a
 * store that returned every row regardless of the filter would let defect 2 pass, since the
 * only thing that separates the fixed behaviour from the broken one is WHICH delegations
 * the query is allowed to see.
 */

interface Row {
  [key: string]: unknown
}

const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const SCHOOL_ID = 'school-1'
const OTHER_SCHOOL_ID = 'school-2'

const HEAD_ID = 'user-head'
const TEACHER_ID = 'user-teacher'
const ROLE_ID = 'role-head'

interface UserSpec {
  id: string
  tenantId: string
  schoolId: string | null
  roleId: string | null
}

interface DelegationSpec {
  toUserId: string
  fromUserId: string
  tenantId: string
  schoolId: string
  permissions: string[]
  isActive: boolean
  expiresAt: Date | null
}

let users: UserSpec[] = []
let roles: Row[] = []
let delegations: DelegationSpec[] = []
let createdDelegations: Row[] = []

/** Matches the `expiresAt: null | > now` shape both readers use. */
function isLive(expiry: Date | null): boolean {
  return expiry === null || expiry.getTime() > Date.now()
}

/**
 * The `where` a relation include carries, evaluated against the store.
 *
 * Shared by `delegationFindMany` and the `delegationsTo` include so the two readers of the
 * same table cannot disagree about what is visible — which is the defect under test.
 */
function matchesDelegationWhere(d: DelegationSpec, raw: Row | undefined): boolean {
  const where = (raw ?? {}) as {
    toUserId?: string
    fromUserId?: string
    tenantId?: string
    schoolId?: string
    isActive?: boolean
    expiresAt?: { gt?: Date }
    OR?: Row[]
  }
  if (where.toUserId !== undefined && d.toUserId !== where.toUserId) return false
  if (where.fromUserId !== undefined && d.fromUserId !== where.fromUserId) return false
  if (where.tenantId !== undefined && d.tenantId !== where.tenantId) return false
  // Prisma omits an `undefined` filter. Modelling that faithfully is what makes the
  // defect-2 assertion meaningful rather than incidental.
  if (where.schoolId !== undefined && d.schoolId !== where.schoolId) return false
  if (where.isActive !== undefined && d.isActive !== where.isActive) return false
  // BOTH expiry spellings, or the fake would only ever prove the fixed `OR` shape works:
  // the pre-fix filter was a bare `expiresAt: { gt }`, which matches nothing when the
  // column is null, and a store that ignored it would hand back the open-ended row and
  // let defect 3's test pass against the broken code.
  if (where.OR !== undefined && !isLive(d.expiresAt)) return false
  if (where.expiresAt?.gt !== undefined && d.expiresAt === null) return false
  if (where.expiresAt?.gt !== undefined && d.expiresAt !== null && d.expiresAt.getTime() <= where.expiresAt.gt.getTime()) {
    return false
  }
  return true
}

const userFindUnique = mock(async (args: Row): Promise<Row | null> => {
  const where = (args.where ?? {}) as { id?: string; tenantId?: string }
  const found = users.find(u => u.id === where.id && u.tenantId === where.tenantId)
  if (!found) return null
  // The `select` shape is the recipient check: identity and school only.
  if (args.select) return { id: found.id, schoolId: found.schoolId }
  const role = roles.find(r => r.id === found.roleId)
  const base: Row = {
    id: found.id,
    tenantId: found.tenantId,
    schoolId: found.schoolId,
    roleId: found.roleId,
  }
  // `getUserSession` reads relations, so the include shape has to serve them or the
  // `.length` it computes has nothing to read.
  if (args.include) {
    const include = args.include as Record<string, Row | boolean>
    const to = include.delegationsTo
    const from = include.delegationsFrom
    return {
      ...base,
      role: role ? { ...role } : null,
      delegationsTo:
        typeof to === 'object' && to !== null
          ? delegations.filter(d => matchesDelegationWhere(d, to.where as Row)).map(d => ({ ...d }))
          : [],
      delegationsFrom:
        from === true
          ? delegations.filter(d => d.fromUserId === found.id).map(d => ({ ...d }))
          : [],
    }
  }
  return { ...base, role: role ? { ...role } : null }
})

const roleFindUnique = mock(async (args: Row): Promise<Row | null> => {
  const where = (args.where ?? {}) as { id?: string; tenantId?: string }
  const found = roles.find(r => r.id === where.id && r.tenantId === where.tenantId)
  return found ? { ...found } : null
})

const roleFindMany = mock(async (args: Row): Promise<Row[]> => {
  const where = (args.where ?? {}) as { id?: string; tenantId?: string }
  return roles
    .filter(r => (where.id === undefined || r.id === where.id) && r.tenantId === where.tenantId)
    .map(r => ({ ...r }))
})

const delegationFindMany = mock(async (args: Row): Promise<Row[]> => {
  const where = (args.where ?? {}) as {
    toUserId?: string
    tenantId?: string
    schoolId?: string
    isActive?: boolean
    OR?: Row[]
  }
  return delegations
    .filter(d => matchesDelegationWhere(d, where))
    .map(d => ({ permissions: [...d.permissions] }))
})

const delegationCreate = mock(async (args: Row): Promise<Row> => {
  const row = { id: `delegation-${createdDelegations.length + 1}`, ...(args.data as Row) }
  createdDelegations.push(row)
  return row
})

const previousDatabase: Record<string, unknown> = { ...actualDatabase }

const databaseFactory = () => ({
  ...actualDatabase,
  prisma: {
    user: { findUnique: userFindUnique },
    role: { findUnique: roleFindUnique, findMany: roleFindMany },
    delegation: { findMany: delegationFindMany, create: delegationCreate },
  },
})

mock.module('@novastar/database', databaseFactory)

const { createDelegation, getEffectivePermissions, getUserSession } = await import('@novastar/auth')

/** A delegator whose role carries `permissions` and the delegation policy that name implies. */
function seedHead(roleName: string, permissions: string[]): void {
  roles = [{ id: ROLE_ID, tenantId: TENANT_ID, name: roleName, permissions, inheritsFrom: [] }]
  users = [
    { id: HEAD_ID, tenantId: TENANT_ID, schoolId: SCHOOL_ID, roleId: ROLE_ID },
    { id: TEACHER_ID, tenantId: TENANT_ID, schoolId: SCHOOL_ID, roleId: null },
  ]
}

beforeEach(() => {
  mock.module('@novastar/database', databaseFactory)
  users = []
  roles = []
  delegations = []
  createdDelegations = []
  userFindUnique.mockClear()
  roleFindUnique.mockClear()
  roleFindMany.mockClear()
  delegationFindMany.mockClear()
  delegationCreate.mockClear()
})

afterEach(() => {
  mock.module('@novastar/database', () => previousDatabase)
})

describe('createDelegation honours wildcard grants', () => {
  it('lets a `*` holder delegate a specific key', async () => {
    seedHead('HEADMASTER', ['*'])

    const delegation = await createDelegation({
      fromUserId: HEAD_ID,
      toUserId: TEACHER_ID,
      permissions: ['student:read'],
      tenantId: TENANT_ID,
      schoolId: SCHOOL_ID,
    })

    expect(delegation.permissions).toEqual(['student:read'])
    expect(delegation.isActive).toBe(true)
  })

  it('lets a prefix-wildcard holder delegate a key under that prefix', async () => {
    seedHead('ACADEMIC_COORD', ['academic:*'])

    const delegation = await createDelegation({
      fromUserId: HEAD_ID,
      toUserId: TEACHER_ID,
      permissions: ['academic:read'],
      tenantId: TENANT_ID,
      schoolId: SCHOOL_ID,
    })

    expect(delegation.permissions).toEqual(['academic:read'])
  })

  it('still refuses a key the delegator holds neither exactly nor by wildcard', async () => {
    seedHead('ACADEMIC_COORD', ['academic:read'])

    // Fails on the OWNERSHIP check, not the policy one: `student:*` is inside
    // ACADEMIC_COORD's delegable policy, so reaching the policy error instead would mean
    // the ownership gate let a permission through.
    await expect(
      createDelegation({
        fromUserId: HEAD_ID,
        toUserId: TEACHER_ID,
        permissions: ['student:read'],
        tenantId: TENANT_ID,
        schoolId: SCHOOL_ID,
      }),
    ).rejects.toThrow(/you don't have it/)
    expect(delegationCreate.mock.calls.length).toBe(0)
  })
})

describe('createDelegation refuses a recipient outside the scope it writes for', () => {
  it('refuses a recipient belonging to another tenant', async () => {
    seedHead('HEADMASTER', ['*'])
    users = [
      ...users,
      { id: 'user-outsider', tenantId: OTHER_TENANT_ID, schoolId: SCHOOL_ID, roleId: null },
    ]

    await expect(
      createDelegation({
        fromUserId: HEAD_ID,
        toUserId: 'user-outsider',
        permissions: ['student:read'],
        tenantId: TENANT_ID,
        schoolId: SCHOOL_ID,
      }),
    ).rejects.toThrow(/not found in this tenant/)
    expect(delegationCreate.mock.calls.length).toBe(0)
  })

  it('refuses a recipient who belongs to a different school', async () => {
    seedHead('HEADMASTER', ['*'])
    users = [
      ...users,
      { id: 'user-other-school', tenantId: TENANT_ID, schoolId: OTHER_SCHOOL_ID, roleId: null },
    ]

    await expect(
      createDelegation({
        fromUserId: HEAD_ID,
        toUserId: 'user-other-school',
        permissions: ['student:read'],
        tenantId: TENANT_ID,
        schoolId: SCHOOL_ID,
      }),
    ).rejects.toThrow(/not a member of this school/)
    expect(delegationCreate.mock.calls.length).toBe(0)
  })

  it('accepts a tenant-level recipient, who is inside the school being delegated for', async () => {
    // `User.schoolId` is nullable, so a tenant-wide recipient legitimately exists and
    // refusing them would make the delegation feature unusable for that case.
    seedHead('HEADMASTER', ['*'])
    users = [
      ...users,
      { id: 'user-tenant-level', tenantId: TENANT_ID, schoolId: null, roleId: null },
    ]

    const delegation = await createDelegation({
      fromUserId: HEAD_ID,
      toUserId: 'user-tenant-level',
      permissions: ['student:read'],
      tenantId: TENANT_ID,
      schoolId: SCHOOL_ID,
    })

    expect(delegation.toUserId).toBe('user-tenant-level')
  })
})

describe('getEffectivePermissions does not widen a missing school into every school', () => {
  beforeEach(() => {
    roles = [{ id: 'role-blank', tenantId: TENANT_ID, name: 'CLERK', permissions: [], inheritsFrom: [] }]
    users = [{ id: TEACHER_ID, tenantId: TENANT_ID, schoolId: SCHOOL_ID, roleId: 'role-blank' }]
    delegations = [
      {
        toUserId: TEACHER_ID,
        fromUserId: HEAD_ID,
        tenantId: TENANT_ID,
        schoolId: SCHOOL_ID,
        permissions: ['student:read'],
        isActive: true,
        expiresAt: null,
      },
    ]
  })

  it('includes the delegation when the caller names that school', async () => {
    const perms = await getEffectivePermissions(TEACHER_ID, TENANT_ID, SCHOOL_ID)

    expect(perms.has('student:read')).toBe(true)
    expect(delegationFindMany.mock.calls[0]?.[0]?.where).toMatchObject({
      toUserId: TEACHER_ID,
      tenantId: TENANT_ID,
      schoolId: SCHOOL_ID,
    })
  })

  it('withholds it when the caller names no school, rather than matching any', async () => {
    // The regression. Prisma omits an `undefined` filter, so the old code asked for every
    // delegation in the tenant and answered yes.
    const perms = await getEffectivePermissions(TEACHER_ID, TENANT_ID)

    expect(perms.has('student:read')).toBe(false)
    // Refused by not asking, so there is no query whose missing filter could widen later.
    expect(delegationFindMany.mock.calls.length).toBe(0)
  })

  it('still resolves role permissions when no school is in scope', async () => {
    // Scoping delegation by school must not cost the caller their role's own grants.
    roles = [
      { id: 'role-blank', tenantId: TENANT_ID, name: 'CLERK', permissions: ['dashboard:read'], inheritsFrom: [] },
    ]

    const perms = await getEffectivePermissions(TEACHER_ID, TENANT_ID)

    expect(perms.has('dashboard:read')).toBe(true)
  })
})

describe('getUserSession counts and resolves the same delegations', () => {
  beforeEach(() => {
    roles = [{ id: 'role-blank', tenantId: TENANT_ID, name: 'CLERK', permissions: [], inheritsFrom: [] }]
    users = [{ id: TEACHER_ID, tenantId: TENANT_ID, schoolId: SCHOOL_ID, roleId: 'role-blank' }]
    delegations = [
      {
        toUserId: TEACHER_ID,
        fromUserId: HEAD_ID,
        tenantId: TENANT_ID,
        schoolId: SCHOOL_ID,
        permissions: ['student:read'],
        isActive: true,
        expiresAt: null,
      },
    ]
  })

  it('includes an open-ended delegation in both halves', async () => {
    // `expiresAt: null` is a live delegation. The old filter required `expiresAt > now`,
    // so the row vanished from `delegations` while its key stayed in `permissions`.
    const session = await getUserSession(TEACHER_ID, TENANT_ID, SCHOOL_ID)

    expect(session).not.toBeNull()
    expect(session?.delegations).toBe(1)
    expect(session?.permissions).toContain('student:read')

    // The filter itself, not just the count it produced: the pre-fix shape was
    // `expiresAt: { gt: new Date() }`, which excludes every `expiresAt: null` row.
    const include = userFindUnique.mock.calls[0]?.[0]?.include as Record<string, Row>
    const where = (include.delegationsTo as Row).where as Row
    expect(where.isActive).toBe(true)
    expect(where.schoolId).toBe(SCHOOL_ID)
    expect(where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ])
    // A bare `expiresAt` filter is the defect itself, so refuse it outright.
    expect(where.expiresAt).toBeUndefined()
  })

  it('excludes an expired delegation from both halves', async () => {
    // The control that gives the assertion above its meaning: same row shape, same code
    // path, but genuinely over.
    delegations[0]!.expiresAt = new Date(Date.now() - 60_000)

    const session = await getUserSession(TEACHER_ID, TENANT_ID, SCHOOL_ID)

    expect(session?.delegations).toBe(0)
    expect(session?.permissions).not.toContain('student:read')
  })

  it('does not count another school\'s delegation for a school-scoped session', async () => {
    delegations.push({
toUserId: TEACHER_ID,
          fromUserId: HEAD_ID,
          tenantId: TENANT_ID,
      schoolId: OTHER_SCHOOL_ID,
      permissions: ['payment:read'],
      isActive: true,
      expiresAt: null,
    })

    const session = await getUserSession(TEACHER_ID, TENANT_ID, SCHOOL_ID)

    expect(session?.delegations).toBe(1)
    expect(session?.permissions).not.toContain('payment:read')
  })
})