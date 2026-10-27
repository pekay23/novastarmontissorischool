import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { NextRequest } from 'next/server'

const context = {
  tenantId: 'tenant-a',
  schoolId: 'school-a',
  userId: 'teacher-a',
  role: 'CLASSROOM_TEACHER',
}
let grants = new Set(['academic:update', 'academic:delete', 'class:edit'])
let visibleClasses = ['class-a']
let recordClass = 'class-a'
const writes: unknown[] = []
const seen: unknown[] = []

mock.module('@/lib/tenant', () => ({ getTenantContext: async () => context }))
mock.module('@novastar/auth', () => ({
  hasPermission: async (_user: string, permission: string) =>
    grants.has(permission),
}))
mock.module('@/lib/visibility', () => ({
  resolveVisibility: async () => ({
    scope: 'class',
    classIds: visibleClasses,
    staffId: 'teacher-a',
    parentId: null,
  }),
  visibilityDeniesAll: () => visibleClasses.length === 0,
  classVisibilityWhere: () => ({ id: { in: visibleClasses } }),
}))
mock.module('@/lib/api-response', () => ({
  toErrorResponse: async () => new Response(null, { status: 500 }),
}))

type ScopedSyllabusQuery = {
  where: {
    id: string
    tenantId: string
    OR: { schoolId: string | null }[]
    classSubject: {
      tenantId: string
      class: { tenantId: string; schoolId: string; id: { in: string[] } }
    }
  }
}
mock.module('@/lib/prisma', () => ({
  prisma: {
    syllabus: {
      findFirst: async ({ where }: ScopedSyllabusQuery) => {
        seen.push(where)
        return where.id === 'syllabus-a' &&
          where.tenantId === 'tenant-a' &&
          where.classSubject.class.schoolId === 'school-a' &&
          where.classSubject.class.id.in.includes(recordClass)
          ? { id: 'syllabus-a' }
          : null
      },
      update: async (args: unknown) => {
        writes.push(args)
        return { id: 'syllabus-a' }
      },
      delete: async (args: unknown) => {
        writes.push(args)
        return { id: 'syllabus-a' }
      },
    },
    classSubject: {
      findFirst: async ({
        where,
      }: {
        where: {
          id: string
          tenantId: string
          class: { schoolId: string; id: { in: string[] } }
        }
      }) =>
        where.id === 'subject-a' &&
        where.tenantId === 'tenant-a' &&
        where.class.schoolId === 'school-a' &&
        where.class.id.in.includes('class-a')
          ? { id: 'subject-a' }
          : null,
    },
    term: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; tenantId: string; schoolId: string }
      }) =>
        where.id === 'term-a' &&
        where.tenantId === 'tenant-a' &&
        where.schoolId === 'school-a'
          ? { id: 'term-a' }
          : null,
    },
    classLevel: {
      findMany: async (args: unknown) => {
        seen.push(args)
        return [{ id: 'level-a', name: 'Primary 1' }]
      },
    },
    staff: {
      findMany: async () => {
        throw new Error('Teacher names must not be read without teacher:read')
      },
    },
  },
}))

const { PATCH, DELETE } = await import('@/app/portal/api/syllabi/[id]/route')
const { GET: OPTIONS } = await import('@/app/portal/api/classes/options/route')
const params = { params: Promise.resolve({ id: 'syllabus-a' }) }
const validBody = {
  classSubjectId: 'subject-a',
  termId: 'term-a',
  title: 'Reading',
  topics: ['Letters'],
  status: 'DRAFT',
}
const patch = (body = validBody) =>
  PATCH(
    new NextRequest('https://school.test/portal/api/syllabi/syllabus-a', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    params,
  )

beforeEach(() => {
  grants = new Set(['academic:update', 'academic:delete', 'class:edit'])
  visibleClasses = ['class-a']
  recordClass = 'class-a'
  writes.length = 0
  seen.length = 0
})

describe('dedicated syllabus mutations', () => {
  it('does not require the broader configuration permission to save an authorized syllabus', async () => {
    expect((await patch()).status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      where: {
        id: 'syllabus-a',
        tenantId: 'tenant-a',
        classSubject: {
          class: { schoolId: 'school-a', id: { in: ['class-a'] } },
        },
      },
    })
  })
  it('rejects an edit without academic:update before any write', async () => {
    grants.delete('academic:update')
    expect((await patch()).status).toBe(403)
    expect(writes).toHaveLength(0)
  })
  it('does not let a teacher edit a syllabus for another class', async () => {
    recordClass = 'class-other'
    expect((await patch()).status).toBe(404)
    expect(writes).toHaveLength(0)
  })
  it('refuses a foreign class subject before changing the record', async () => {
    expect(
      (await patch({ ...validBody, classSubjectId: 'subject-foreign' })).status,
    ).toBe(404)
    expect(writes).toHaveLength(0)
  })
  it('refuses a foreign term before changing the record', async () => {
    expect((await patch({ ...validBody, termId: 'term-foreign' })).status).toBe(
      404,
    )
    expect(writes).toHaveLength(0)
  })
  it('rejects whitespace-only content', async () => {
    expect((await patch({ ...validBody, title: '  ' })).status).toBe(400)
    expect(writes).toHaveLength(0)
  })
  it('refuses a teacher with no visible classes', async () => {
    visibleClasses = []
    expect((await patch()).status).toBe(403)
    expect(writes).toHaveLength(0)
  })
  it('carries class visibility into deletes', async () => {
    recordClass = 'class-other'
    expect(
      (
        await DELETE(
          new NextRequest('https://school.test/portal/api/syllabi/syllabus-a', {
            method: 'DELETE',
          }),
          params,
        )
      ).status,
    ).toBe(404)
    expect(writes).toHaveLength(0)
  })
})

describe('class editor options', () => {
  it('returns scoped levels without exposing the staff directory to a class editor', async () => {
    const response = await OPTIONS()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      levels: [{ id: 'level-a', name: 'Primary 1' }],
      teachers: [],
      canAssignTeacher: false,
    })
    expect(seen[0]).toMatchObject({
      where: { tenantId: 'tenant-a', schoolId: 'school-a' },
    })
  })
  it('refuses options to a caller who cannot create or edit classes', async () => {
    grants.clear()
    expect((await OPTIONS()).status).toBe(403)
    expect(seen).toHaveLength(0)
  })
})
