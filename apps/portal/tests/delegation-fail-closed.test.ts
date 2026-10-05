import { describe, it, expect, beforeEach, mock } from 'bun:test'

/**
 * `createDelegation` must fail closed for a role with no delegation policy.
 *
 * `getDefaultDelegationRules` names four roles. Every other role in the
 * database — `CLASSROOM_TEACHER`, `HEAD_TEACHER`, `ACCOUNTANT`, `ADMIN_STAFF`,
 * and any custom role a tenant creates — used to fall through a
 * `defaultRules[role.id]?.permissions || ['*']` to the full catalog, so any
 * such role could delegate every permission in the platform.
 *
 * The lookup was also keyed wrongly: `Role.id` is a cuid, while the map is
 * keyed by role NAME, so `defaultRules[role.id]` never matched and HEADMASTER
 * reached the same fallback. These tests pin both halves — an unnamed role
 * gets nothing, and HEADMASTER still gets everything.
 */

import * as actualDatabase from '@novastar/database'

interface RoleRow {
  id: string
  name: string
  permissions: string[]
  inheritsFrom: string[]
}

let roleRow: RoleRow = {
  id: 'role-cuid-1',
  name: 'CLASSROOM_TEACHER',
  permissions: ['student:read', 'assessment:read'],
  inheritsFrom: [],
}

/** `RoleRow` has no index signature, so it is spelled out to satisfy `Row`. */
function roleAsRow(): Row {
  return {
    id: roleRow.id,
    name: roleRow.name,
    permissions: [...roleRow.permissions],
    inheritsFrom: [...roleRow.inheritsFrom],
  }
}

/**
 * The delegator read and the recipient read are two different queries against `user`, so
 * the double has to answer both. `createDelegation` verifies the recipient is inside the
 * tenant and school the row is written for, which it does with `select: { id, schoolId }`
 * about `toUserId`; returning the delegator's row to that query reported `schoolId:
 * undefined`, which is outside `school-1`, and refused every delegation in this file for a
 * reason none of these tests is about.
 */
const userFindUnique = mock(async (args: QueryArgs): Promise<Row | null> => {
  if (args.select) {
    return { id: String(args.where?.id ?? ''), schoolId: 'school-1' }
  }
  return { id: 'user-delegator', roleId: roleRow.id, role: roleAsRow() }
})

const roleFindUnique = mock(async (): Promise<Row | null> => roleAsRow())

const roleFindMany = mock(async (): Promise<Row[]> => [
  { id: roleRow.id, name: roleRow.name },
])

const delegationFindMany = mock(async (): Promise<Row[]> => [])
const delegationCreate = mock(async (args: QueryArgs): Promise<Row> => ({
  id: 'delegation-1',
  ...(args.data ?? {}),
}))
const auditLogCreate = mock(async (): Promise<Row> => ({ id: 'audit-1' }))

mock.module('@novastar/database', () => ({
  ...actualDatabase,
  prisma: {
    user: { findUnique: userFindUnique },
    role: { findUnique: roleFindUnique, findMany: roleFindMany },
    delegation: { findMany: delegationFindMany, create: delegationCreate },
    auditLog: { create: auditLogCreate },
  },
}))

interface Row {
  [key: string]: unknown
}

interface QueryArgs {
  where?: Row
  data?: Row
}

const { createDelegation } = await import('@novastar/auth')

const DELEGATION = {
  fromUserId: 'user-delegator',
  toUserId: 'user-taker',
  tenantId: 'tenant-1',
  schoolId: 'school-1',
}

function delegate(permission: string) {
  return createDelegation({ ...DELEGATION, permissions: [permission] })
}

/** A role whose permissions the delegator genuinely holds, plus its own policy. */
function actingAs(name: string, permissions: string[]): void {
  roleRow = { id: `role-cuid-${name}`, name, permissions, inheritsFrom: [] }
}

beforeEach(() => {
  actingAs('CLASSROOM_TEACHER', ['student:read', 'assessment:read'])
  delegationCreate.mockClear()
  delegationFindMany.mockClear()
  roleFindMany.mockClear()
  roleFindUnique.mockClear()
  userFindUnique.mockClear()
  auditLogCreate.mockClear()
})

// --- Tests -----------------------------------------------------------------

describe('createDelegation - fail closed for a role with no delegation policy', () => {
  it('denies a classroom teacher', async () => {
    await expect(delegate('student:read')).rejects.toThrow(
      'Your role does not allow delegating "student:read"',
    )
    expect(delegationCreate).not.toHaveBeenCalled()
  })

  it('denies a head teacher, who is not in the default rules either', async () => {
    actingAs('HEAD_TEACHER', ['student:read'])
    await expect(delegate('student:read')).rejects.toThrow(
      /does not allow delegating/,
    )
    expect(delegationCreate).not.toHaveBeenCalled()
  })

  it('denies an accountant', async () => {
    actingAs('ACCOUNTANT', ['finance:read'])
    await expect(delegate('finance:read')).rejects.toThrow(/does not allow delegating/)
    expect(delegationCreate).not.toHaveBeenCalled()
  })

  it('denies a custom role', async () => {
    actingAs('DRAMA_TEACHER', ['assessment:read'])
    await expect(delegate('assessment:read')).rejects.toThrow(/does not allow delegating/)
    expect(delegationCreate).not.toHaveBeenCalled()
  })

  it('denies every permission the role holds, not just the first', async () => {
    await expect(delegate('assessment:read')).rejects.toThrow(/does not allow delegating/)
    expect(delegationCreate).not.toHaveBeenCalled()
  })
})

describe('createDelegation - the four configured roles are unaffected', () => {
  it('lets the headmaster delegate anything', async () => {
    actingAs('HEADMASTER', ['system:manage'])

    const created = await delegate('system:manage')

    expect(created).toBeDefined()
    expect(delegationCreate).toHaveBeenCalledTimes(1)
    const data = (delegationCreate.mock.calls[0]?.[0] as QueryArgs).data
    expect(data?.permissions).toEqual(['system:manage'])
    // The approval flag is read from the HEADMASTER policy
    // (`requiresApproval: false`, `maxDurationDays: 365`) rather than from the
    // caller, and `isActive` is derived from that same resolved flag. Deriving
    // `isActive` from the caller's raw input instead is what let a delegation that
    // recorded "awaiting approval" be handed over anyway.
    expect(data?.requiresApproval).toBe(false)
    expect(data?.isActive).toBe(true)
    // `maxDurationDays` is enforced even though the caller passed no expiry, so
    // the delegation is bounded rather than open-ended.
    expect(data?.expiresAt).toBeInstanceOf(Date)
  })

  it('leaves a policy-gated delegation inactive, so it cannot be used before approval', async () => {
    // ASSISTANT_HEAD carries `requiresApproval: true`. The delegation is recorded
    // as needing approval AND is not active — the two must never disagree.
    actingAs('ASSISTANT_HEAD', ['academic:read'])

    await delegate('academic:read')

    const data = (delegationCreate.mock.calls[0]?.[0] as QueryArgs).data
    expect(data?.requiresApproval).toBe(true)
    expect(data?.isActive).toBe(false)
  })

  it('caps the expiry at the policy limit instead of trusting the caller', async () => {
    actingAs('ASSISTANT_HEAD', ['academic:read'])

    // Ten years is far beyond the policy's 90-day cap.
    await createDelegation({
      ...DELEGATION,
      permissions: ['academic:read'],
      expiresAt: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000),
    })

    const data = (delegationCreate.mock.calls[0]?.[0] as QueryArgs).data
    const expiresAt = data?.expiresAt as Date
    const daysOut = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    expect(daysOut).toBeLessThanOrEqual(90)
    expect(daysOut).toBeGreaterThan(89)
  })

  it('lets the academic coordinator delegate its academic prefixes', async () => {
    actingAs('ACADEMIC_COORD', ['assessment:read'])
    await expect(delegate('assessment:read')).resolves.toBeDefined()
    expect(delegationCreate).toHaveBeenCalledTimes(1)
  })

  it('keeps the documented prefix behaviour: assessment:* covers assessment:delete', async () => {
    // `permissionMatches` treats `academic:*` as matching `academic:delete`.
    // That is deliberate and unchanged — whether to delegate a delete is the
    // delegator's choice — so this records the existing behaviour rather than
    // asserting anything new.
    actingAs('ACADEMIC_COORD', ['assessment:delete'])
    await expect(delegate('assessment:delete')).resolves.toBeDefined()
  })

  it('lets the bursar delegate its finance prefixes', async () => {
    actingAs('BURSAR', ['finance:read'])
    await expect(delegate('finance:read')).resolves.toBeDefined()
    expect(delegationCreate).toHaveBeenCalledTimes(1)
  })

  it('does not let a configured role reach outside its prefixes', async () => {
    // A BURSAR rule naming `finance:*` must not cover `system:manage`.
    actingAs('BURSAR', ['system:manage'])
    await expect(delegate('system:manage')).rejects.toThrow(/does not allow delegating/)
    expect(delegationCreate).not.toHaveBeenCalled()
  })
})

describe('createDelegation - the delegator must still hold what they delegate', () => {
  it('rejects a permission the delegator does not hold, before any policy check', async () => {
    actingAs('HEADMASTER', ['finance:read'])
    await expect(delegate('system:manage')).rejects.toThrow(
      'Cannot delegate permission "system:manage" — you don\'t have it',
    )
    expect(delegationCreate).not.toHaveBeenCalled()
  })
})