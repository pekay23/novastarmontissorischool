import { beforeEach, expect, it, mock } from 'bun:test'
import { NextRequest } from 'next/server'

const context = { tenantId: 'tenant-a', schoolId: 'school-a', userId: 'teacher-a', role: 'CLASSROOM_TEACHER' }
let visible = true
let finalized = false
let transactions = 0
const reads: unknown[] = []
const writes: unknown[] = []
const amendmentRows: unknown[] = []
const student = () => ({ id: 'student-a', tenantId: 'tenant-a', schoolId: 'school-a', firstName: 'Ama', lastName: 'Mensah', classId: 'class-a', finalizedAt: finalized ? new Date('2026-01-01') : null })
mock.module('@/lib/tenant', () => ({ getTenantContext: async () => context }))
mock.module('@novastar/auth', () => ({ hasPermission: async () => true }))
mock.module('@/lib/visibility', () => ({
  resolveVisibility: async () => ({ scope: 'class', classIds: ['class-a'], staffId: 'teacher-a', parentId: null }),
  visibilityDeniesAll: () => false,
  studentVisibilityWhere: () => ({ enrollments: { some: { classId: { in: ['class-a'] } } } }),
  classVisibilityWhere: () => ({ id: { in: ['class-a'] } }),
}))
const update = async (args: unknown) => { writes.push(args); return student() }
mock.module('@/lib/prisma', () => ({ prisma: {
  student: {
    findFirst: async (args: unknown) => { reads.push(args); return visible ? student() : null },
    update,
    delete: async (args: unknown) => { writes.push(args); return student() },
    create: async (args: unknown) => { writes.push(args); return student() },
  },
  class: { findFirst: async ({ where }: { where: { id: string; tenantId: string; schoolId: string } }) => where.id === 'class-a' && where.tenantId === 'tenant-a' && where.schoolId === 'school-a' ? { id: 'class-a' } : null },
  parent: { findFirst: async ({ where }: { where: { id: string; tenantId: string; schoolId: string } }) => where.id === 'parent-a' && where.tenantId === 'tenant-a' && where.schoolId === 'school-a' ? { id: 'parent-a' } : null },
  $transaction: async (work: (tx: { student: { update: typeof update }; recordAmendment: { createMany: (args: { data: unknown[] }) => Promise<{ count: number }> } }) => Promise<unknown>) => {
    transactions++
    return work({ student: { update }, recordAmendment: { createMany: async ({ data }) => { amendmentRows.push(...data); return { count: data.length } } } })
  },
} }))
const { PATCH, DELETE } = await import('@/app/portal/api/students/[id]/route')
const { POST } = await import('@/app/portal/api/students/route')
const params = { params: Promise.resolve({ id: 'student-a' }) }
function request(body: Record<string, unknown>, method = 'PATCH') {
  return new NextRequest('https://school.test/portal/api/students/student-a', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}
beforeEach(() => { visible = true; finalized = false; transactions = 0; reads.length = 0; writes.length = 0; amendmentRows.length = 0 })

it('keeps tenant, school and class visibility in the student update predicate', async () => {
  expect((await PATCH(request({ firstName: 'Afia' }), params)).status).toBe(200)
  expect(writes[0]).toMatchObject({ where: { id: 'student-a', tenantId: 'tenant-a', schoolId: 'school-a', AND: [{ enrollments: { some: { classId: { in: ['class-a'] } } } }] } })
})
it('refuses a record outside the resolved row scope', async () => {
  visible = false
  expect((await PATCH(request({ firstName: 'Afia' }), params)).status).toBe(404)
  expect(writes).toHaveLength(0)
})
it('rejects a class relationship outside the current school before updating', async () => {
  expect((await PATCH(request({ classId: 'foreign-class' }), params)).status).toBe(404)
  expect(writes).toHaveLength(0)
})
it('requires a reason before changing a finalized student', async () => {
  finalized = true
  expect((await PATCH(request({ firstName: 'Afia' }), params)).status).toBe(400)
  expect(writes).toHaveLength(0)
})
it('writes the finalized correction and its reason together', async () => {
  finalized = true
  expect((await PATCH(request({ firstName: 'Afia', amendmentReason: 'Corrected from the admission document' }), params)).status).toBe(200)
  expect(transactions).toBe(1)
  expect(amendmentRows).toHaveLength(1)
  expect(amendmentRows[0]).toMatchObject({ entity: 'Student', entityId: 'student-a', field: 'firstName', reason: 'Corrected from the admission document', tenantId: 'tenant-a', schoolId: 'school-a' })
})
it('does not allow a finalized student to be deleted', async () => {
  finalized = true
  expect((await DELETE(new NextRequest('https://school.test/portal/api/students/student-a', { method: 'DELETE' }), params)).status).toBe(409)
  expect(writes).toHaveLength(0)
})
it('refuses a foreign parent when creating a student', async () => {
  const response = await POST(request({ studentId: 'S-1', firstName: 'Ama', lastName: 'Mensah', gender: 'FEMALE', dateOfBirth: '2020-01-01', classId: 'class-a', parentId: 'foreign-parent' }, 'POST'))
  expect(response.status).toBe(404)
  expect(writes).toHaveLength(0)
})
