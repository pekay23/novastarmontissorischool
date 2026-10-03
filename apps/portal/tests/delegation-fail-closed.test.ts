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

const userFindUnique = mock(async (): Promise<Row | null> => ({
  id: 'user-delegator',
  roleId: roleRow.id,
  role: roleAsRow(),
}))

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
    // `createDelegation` defaults the approval flag from its own input, not
    // from the policy — the policy's `requiresApproval` is not read anywhere.
    // Recorded so a future change to that is visible here.
    expect(data?.requiresApproval).toBe(true)
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