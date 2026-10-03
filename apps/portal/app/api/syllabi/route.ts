import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { toErrorResponse } from '@/lib/api-response'

/**
 * Syllabi are the per-term topic lists a class subject is taught against.
 *
 * The Laravel source stored one opaque CKEditor 5 HTML blob per syllabus.
 * That is deliberately NOT ported: a syllabus here is consumed as a
 * structured topic list, so the rows are `topics String[]` plus an
 * optional free-text `body`. See the syllabus page for the editor.
 *
 * The read and the write are permissioned with the academic-category
 * keys rather than with `config:read`/`config:write`, which is what the
 * generic `config/[entityType]` route uses for every entity including
 * this one. `academic:read`/`academic:create` are the narrower, real
 * keys for this resource: they are granted to HEADMASTER,
 * ASSISTANT_HEAD, HEAD_TEACHER and CLASSROOM_TEACHER, so a teacher can
 * author the syllabus for the class subject they teach without also
 * being handed the platform-wide configuration surface. Nothing
 * invents a key — both are declared in `permission-keys.ts`.
 */

/**
 * Duck-typed on `code` AND `name` rather than on `code` alone, which would
 * also catch an unrelated error object that happens to carry a `code` field,
 * and rather than by `instanceof Prisma.PrismaClientKnownRequestError`, which
 * cannot be exercised from a test that must not open a database connection.
 * The `Syllabus` model carries the
 * `@@unique([tenantId, classSubjectId, termId, title])` constraint, so a
 * duplicate POST is an expected client outcome — report it as 409.
 *
 * Checked BEFORE `toErrorResponse`, which would otherwise log an ordinary
 * duplicate as an outage and store it on the platform-errors page.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002' &&
    (err as { name?: unknown }).name === 'PrismaClientKnownRequestError'
  )
}

function duplicateResponse() {
  return NextResponse.json(
    { error: 'A syllabus with this title already exists for this class subject and term' },
    { status: 409 },
  )
}

/**
 * `title` and every `topics` entry are trimmed before the length check, so a
 * whitespace-only title is rejected as empty rather than persisted as a blank
 * string that renders as an unclickable row in the list.
 *
 * `topics` must be non-empty here even though the shared `SyllabusSchema`
 * behind `POST /api/config/syllabus` defaults it to `[]`. That generic
 * schema exists to describe the column; a syllabus with no topics is not a
 * syllabus, so the dedicated route is stricter. The generic route is not
 * modified here — it belongs to another owner.
 */
const SyllabusCreateSchema = z.object({
  classSubjectId: z.string().trim().min(1),
  termId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  body: z.string().nullable().optional(),
  topics: z.array(z.string().trim().min(1)).min(1),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
})

/** The shared projection for a syllabus row, so GET and POST agree. */
const SYLLABUS_INCLUDE = {
  classSubject: {
    include: {
      class: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true, code: true } },
    },
  },
  term: { select: { id: true, name: true, academicYear: { select: { name: true } } } },
} as const

export async function GET(req: NextRequest) {
  try {
    const { tenantId, schoolId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    if (!(await hasPermission(userId, 'academic:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const classSubjectId = searchParams.get('classSubjectId')
    const termId = searchParams.get('termId')

    // The create form needs class/term/class-subject option lists, and no
    // route in the product exposes `ClassSubject` directly (it is not in
    // ENTITY_CONFIG_MAP, so there is no generic config route for it). The
    // options are tenant-scoped reads on the same gate as the syllabi read,
    // so they live here rather than on a route another agent would have to
    // add. `lookups` is opt-in: a plain list request pays nothing extra.
    if (searchParams.get('lookups') === 'true') {
      const [clsRes, termRes, csRes] = await Promise.all([
        prisma.class.findMany({
          where: { tenantId, schoolId },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.term.findMany({
          where: { tenantId, schoolId },
          // `isCurrent` is selected because the create form defaults the term
          // to the current one; without it the page cannot pick a sensible
          // default and falls back to an arbitrary row.
          select: {
            id: true,
            name: true,
            isCurrent: true,
            academicYear: { select: { name: true } },
          },
          orderBy: { startDate: 'desc' },
        }),
        prisma.classSubject.findMany({
          where: { tenantId, class: { schoolId } },
          include: {
            class: { select: { id: true, name: true } },
            subject: { select: { id: true, name: true, code: true } },
          },
          orderBy: [{ class: { name: 'asc' } }, { subject: { name: 'asc' } }],
        }),
      ])
      return NextResponse.json({
        data: { classes: clsRes, terms: termRes, classSubjects: csRes },
      })
    }

    const where: Prisma.SyllabusWhereInput = { tenantId }
    // `Syllabus.schoolId` is nullable, so a tenant-scoped filter alone would
    // also surface rows belonging to a sibling school in the same tenant, and
    // dropping the filter entirely would do the same. Match this school plus
    // the rows that never had a school recorded — never another school's.
    where.OR = [{ schoolId }, { schoolId: null }]
    if (classSubjectId) where.classSubjectId = classSubjectId
    if (termId) where.termId = termId

    const syllabi = await prisma.syllabus.findMany({
      where,
      include: SYLLABUS_INCLUDE,
      orderBy: { title: 'asc' },
    })

    return NextResponse.json({ data: syllabi })
  } catch (error) {
    return toErrorResponse('Syllabi GET', error, { endpoint: '/api/syllabi' })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tenantId, schoolId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    if (!(await hasPermission(userId, 'academic:create', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = SyllabusCreateSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.issues },
        { status: 400 },
      )
    }
    const data = parseResult.data

    // Cross-tenant FK checks, both BEFORE the write. A `Syllabus` row stores
    // `classSubjectId` and `termId` as bare ids, so nothing at the database
    // layer stops a caller naming another tenant's rows: the row would be
    // created inside this tenant while pointing at foreign data, and the
    // include below would then read that foreign class subject's name into
    // this tenant's response. `ClassSubject` carries no `schoolId` column of
    // its own, so it is scoped by tenant and through its class; `Term` is
    // school-scoped directly.
    const [classSubject, term] = await Promise.all([
      prisma.classSubject.findFirst({
        where: { id: data.classSubjectId, tenantId, class: { schoolId } },
        select: { id: true },
      }),
      prisma.term.findFirst({
        where: { id: data.termId, tenantId, schoolId },
        select: { id: true },
      }),
    ])
    if (!classSubject) {
      return NextResponse.json({ error: 'Class subject not found' }, { status: 404 })
    }
    if (!term) {
      return NextResponse.json({ error: 'Term not found' }, { status: 404 })
    }

    const syllabus = await prisma.syllabus.create({
      data: {
        tenantId,
        schoolId,
        classSubjectId: data.classSubjectId,
        termId: data.termId,
        title: data.title,
        body: data.body ?? null,
        topics: data.topics,
        status: data.status,
      },
      include: SYLLABUS_INCLUDE,
    })

    return NextResponse.json({ data: syllabus }, { status: 201 })
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return duplicateResponse()
    return toErrorResponse('Syllabi POST', error, { endpoint: '/api/syllabi' })
  }
}