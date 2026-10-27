import { beforeEach, expect, it, mock } from 'bun:test'
import type { TenantContext } from '@/lib/tenant'

let grants = new Set(['student:read'])
const studentQueries: unknown[] = []
mock.module('@novastar/auth', () => ({
  hasPermission: async (_user: string, permission: string) =>
    grants.has(permission),
}))
mock.module('@/lib/visibility', () => ({
  resolveVisibility: async () => ({
    scope: 'own',
    classIds: [],
    parentId: 'parent-a',
    staffId: null,
  }),
  visibilityDeniesAll: () => false,
  studentVisibilityWhere: () => ({ parentId: 'parent-a' }),
  staffVisibilityWhere: async () => ({}),
}))
mock.module('@/lib/prisma', () => ({
  prisma: {
    student: {
      count: async (query: unknown) => {
        studentQueries.push(query)
        return 2
      },
    },
    staff: {
      count: async () => {
        throw new Error('Staff counts are not available to a parent')
      },
    },
    feeInvoice: {
      count: async () => {
        throw new Error('Finance counts require finance:read')
      },
    },
  },
}))
const { getDashboardCards } = await import('@/lib/queries/dashboard')
const context: TenantContext = {
  tenantId: 'tenant-a',
  schoolId: 'school-a',
  userId: 'user-a',
  role: 'PARENT',
  user: {
    id: 'user-a',
    tenantId: 'tenant-a',
    schoolId: 'school-a',
    role: 'PARENT',
    email: 'parent@example.test',
    name: 'Parent',
  },
}
beforeEach(() => {
  grants = new Set(['student:read'])
  studentQueries.length = 0
})

it('parents receive their own child count without querying unrelated statistics', async () => {
  const cards = await getDashboardCards(context)
  expect(cards).toEqual([
    {
      name: 'Your children',
      value: 2,
      kind: 'students',
      href: '/portal/students',
    },
  ])
  expect(studentQueries[0]).toEqual({
    where: { tenantId: 'tenant-a', schoolId: 'school-a', parentId: 'parent-a' },
  })
})
it('no school assignment or no read grants produces no aggregate queries', async () => {
  expect(await getDashboardCards({ ...context, schoolId: null })).toEqual([])
  grants.clear()
  expect(await getDashboardCards(context)).toEqual([])
  expect(studentQueries).toHaveLength(0)
})
