import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { NextRequest } from 'next/server'

/**
 * School scoping for `DELETE /api/enrollments/[id]`.
 *
 * `Enrollment` has no `schoolId` column, so school scope has to arrive through
 * a relation. With only `{ id, tenantId }` the handler was scoped to a TENANT,
 * and in a multi-school tenant a caller authorised in school A could delete
 * school B's enrollment by guessing its id. `enrollments/route.ts` already
 * solves this for the list read by scoping through `student`; this file holds
 * the single-row handlers to the same rule.
 */

interface Row {
  [key: string]: unknown
}

interface QueryArgs {
  where?: Row
  select?: Row
  include?: Row
}

const TENANT_ID = 'tenant-multi-school'
const SCHOOL_ID = 'school-main'
const OTHER_SCHOOL_ID = 'school-other'
const USER_ID = 'user-admin'

const ENROLLMENTS: Row[] = [
  {
    id: 'enr-mine',
    tenantId: TENANT_ID,
    studentId: 'stu-1',
    classId: 'class-1',
    student: { schoolId: SCHOOL_ID, firstName: 'Ama', lastName: 'Owusu' },
  },
  {
    id: 'enr-other-school',
    tenantId: TENANT_ID,
    studentId: 'stu-9',
    classId: 'class-7',
    // Same tenant, different school. This is the row the defect exposed.
    student: { schoolId: OTHER_SCHOOL_ID, firstName: 'Kofi', lastName: 'Mensah' },
  },
]

// --- Doubles ---------------------------------------------------------------

class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

let session: {
  tenantId: string
  schoolId: string | null
  userId: string
} = { tenantId: TENANT_ID, schoolId: SCHOOL_ID, userId: USER_ID }

const getTenantContext = mock(async () => session)

let grants: string[] = ['enrollment:delete']

const hasPermission = mock(
  async (_userId: string, key: string): Promise<boolean> =>
    grants.includes('*') || grants.includes(key),
)

// Bun's module-mock registry is process-global and outlives this file, so a
// factory that omits an export another file imports breaks it. Spread the real
// module and override only `hasPermission`.
const actualAuth = await import('@novastar/auth')

mock.module('@novastar/auth', () => ({ ...actualAuth, hasPermission }))
mock.module('server-only', () => ({}))
mock.module('@/lib/tenant', () => ({
  UnauthorizedError,
  ForbiddenError,
  getTenantContext,
  getTenantContextOrNull: async () => session,
}))

/** Honours the `student: { schoolId }` relation filter, or nothing matches. */
const enrollmentFindFirst = mock(async (args: QueryArgs): Promise<Row | null> => {
  const where = args.where ?? {}
  return (
    ENROLLMENTS.find((row) => {
      if (row.id !== where.id) return false
      if (row.tenantId !== where.tenantId) return false
      const studentFilter = where.student as Row | undefined
      if (!studentFilter) return true
      return (row.student as Row).schoolId === studentFilter.schoolId
    }) ?? null
  )
})

const enrollmentDelete = mock(async (args: QueryArgs): Promise<Row> => {
  const where = args.where ?? {}
  const found = ENROLLMENTS.find((row) => {
    if (row.id !== where.id) return false
    if (row.tenantId !== where.tenantId) return false
    const studentFilter = where.student as Row | undefined
    if (!studentFilter) return true
    return (row.student as Row).schoolId === studentFilter.schoolId
  })
  if (!found) throw new Error('Record to delete does not exist.')
  return found
})

mock.module('@/lib/prisma', () => ({
  prisma: {
    enrollment: { findFirst: enrollmentFindFirst, delete: enrollmentDelete },
  },
}))

const { DELETE } = await import('@/app/api/enrollments/[id]/route')

// --- Helpers ---------------------------------------------------------------

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function remove(id: string): Promise<{ status: number; body: Row }> {
  const res = await DELETE(
    new NextRequest(`http://localhost/api/enrollments/${id}`),
    params(id) as never,
  )
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => {
  session = { tenantId: TENANT_ID, schoolId: SCHOOL_ID, userId: USER_ID }
  grants = ['enrollment:delete']
  enrollmentFindFirst.mockClear()
  enrollmentDelete.mockClear()
  hasPermission.mockClear()
  hasPermission.mockImplementation(
    async (_userId: string, key: string) => grants.includes('*') || grants.includes(key),
  )
})

// --- Tests -----------------------------------------------------------------

describe('DELETE /api/enrollments/[id] - school scoping', () => {
  it('refuses an enrollment belonging to another school in the same tenant', async () => {
    const { status, body } = await remove('enr-other-school')

    expect(status).toBe(404)
    expect(body.error).toBe('Enrollment not found')
    // The write is the point of the route: nothing may be deleted.
    expect(enrollmentDelete).not.toHaveBeenCalled()
  })

  it('scopes the existence check through the student relation', async () => {
    await remove('enr-other-school')

    const where = (enrollmentFindFirst.mock.calls[0]?.[0] as QueryArgs).where
    expect((where?.student as Row | undefined)?.schoolId).toBe(SCHOOL_ID)
  })

  it('scopes the delete through the student relation too', async () => {
    const { status } = await remove('enr-mine')

    expect(status).toBe(200)
    expect(enrollmentDelete).toHaveBeenCalledTimes(1)

    const where = (enrollmentDelete.mock.calls[0]?.[0] as QueryArgs).where
    expect(where?.id).toBe('enr-mine')
    expect(where?.tenantId).toBe(TENANT_ID)
    expect((where?.student as Row | undefined)?.schoolId).toBe(SCHOOL_ID)
  })

  it('deletes an enrollment in the caller\'s own school', async () => {
    const { status, body } = await remove('enr-mine')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.message).toContain('Ama Owusu')
  })

  it('refuses when the caller has no school assigned', async () => {
    // The delete is now filtered by school, so a context without one would
    // silently match nothing. Say so instead.
    session = { tenantId: TENANT_ID, schoolId: null, userId: USER_ID }

    const { status, body } = await remove('enr-mine')

    expect(status).toBe(400)
    expect(body.error).toBe('No school assigned')
    expect(enrollmentDelete).not.toHaveBeenCalled()
  })

  it('still refuses without the permission', async () => {
    grants = []

    const { status } = await remove('enr-mine')

    expect(status).toBe(403)
    expect(enrollmentDelete).not.toHaveBeenCalled()
  })
})