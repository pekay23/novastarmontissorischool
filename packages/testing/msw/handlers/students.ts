import { http, HttpResponse } from 'msw'
import { studentFixtures } from '../fixtures/students'

const STUDENTS_BASE = '/api/students'

export const studentHandlers = [
  // GET /api/students
  http.get(STUDENTS_BASE, ({ request }) => {
    const url = new URL(request.url)
    const classId = url.searchParams.get('classId')
    const page = Number(url.searchParams.get('page') ?? '1')
    const limit = Number(url.searchParams.get('limit') ?? '20')

    let students = [...studentFixtures]
    if (classId) {
      students = students.filter((s) => s.classId === classId)
    }

    const start = (page - 1) * limit
    const paginated = students.slice(start, start + limit)

    return HttpResponse.json({
      data: paginated,
      meta: {
        page,
        limit,
        total: students.length,
        totalPages: Math.ceil(students.length / limit),
        hasNext: start + limit < students.length,
        hasPrev: page > 1,
      },
    })
  }),

  // POST /api/students
  http.post(STUDENTS_BASE, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    const newStudent = {
      id: `test_student_${studentFixtures.length + 1}`,
      tenantId: 'test_tenant_1',
      schoolId: 'test_school_1',
      ...body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    studentFixtures.push(newStudent as typeof studentFixtures[0])
    return HttpResponse.json(newStudent, { status: 201 })
  }),

  // GET /api/students/:id
  http.get(`${STUDENTS_BASE}/:id`, ({ params }) => {
    const student = studentFixtures.find((s) => s.id === params.id)
    if (!student) {
      return HttpResponse.json(
        { error: 'Student not found', code: 'STUDENT_NOT_FOUND' },
        { status: 404 }
      )
    }
    return HttpResponse.json(student)
  }),

  // PATCH /api/students/:id
  http.patch(`${STUDENTS_BASE}/:id`, async ({ params, request }) => {
    const index = studentFixtures.findIndex((s) => s.id === params.id)
    if (index === -1) {
      return HttpResponse.json(
        { error: 'Student not found', code: 'STUDENT_NOT_FOUND' },
        { status: 404 }
      )
    }
    const body = await request.json() as Record<string, unknown>
    studentFixtures[index] = { ...studentFixtures[index], ...body, updatedAt: new Date().toISOString() } as typeof studentFixtures[0]
    return HttpResponse.json(studentFixtures[index])
  }),

  // DELETE /api/students/:id
  http.delete(`${STUDENTS_BASE}/:id`, ({ params }) => {
    const index = studentFixtures.findIndex((s) => s.id === params.id)
    if (index === -1) {
      return HttpResponse.json(
        { error: 'Student not found', code: 'STUDENT_NOT_FOUND' },
        { status: 404 }
      )
    }
    studentFixtures.splice(index, 1)
    return HttpResponse.json({ success: true })
  }),

  // Unknown student routes return 404-shaped body
  http.all(`${STUDENTS_BASE}/*`, () => {
    return HttpResponse.json(
      { error: 'Not found', code: 'STUDENT_ROUTE_NOT_FOUND' },
      { status: 404 }
    )
  }),
]