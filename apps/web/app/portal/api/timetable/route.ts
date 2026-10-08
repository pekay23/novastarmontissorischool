import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { resolveVisibility, visibilityDeniesAll } from '@/lib/visibility'
import { ENTITY_CONFIG_MAP } from '@novastar/shared-types'
import { z } from 'zod'
import { logError } from '@/lib/logger'
// Shared. Both timetable models carry real unique constraints — `Timetable` on
// `(tenantId, classId, termId, name)` and `TimetableEntry` on
// `(tenantId, timetableId, dayOfWeek, startTime, classSubjectId)` — so a
// duplicate POST is an expected client outcome and must be a 409, not a 500.
import { isUniqueConstraintViolation, duplicateResponse } from '@/lib/prisma-conflict'

/**
 * The Neon adapter turns every statement into a network round trip, so
 * an unbounded interactive transaction holds a pooled connection — and
 * this request — open for however long the database feels like answering.
 * Same bounds as the attendance write path.
 */
const TIMETABLE_TRANSACTION_BOUNDS = { maxWait: 2_000, timeout: 30_000 } as const

/**
 * `HH:mm` validation, reused rather than restated.
 *
 * The pattern is owned by `entity-api-config.ts` as a module-private
 * `HHMM_REGEX` and applied to every `timetable_entry` time field
 * there. It is not exported, and this file may not edit that module,
 * so the schema is reused through the published entity config: the
 * create schema for `timetable_entry` carries the exact Zod string
 * the generic config route validates with, and this route validates
 * with the same one — so the two cannot drift apart, and a second
 * regex can never disagree with the first.
 *
 * `EntityApiConfig.createSchema` is declared as a bare
 * `z.ZodType<Record<string, unknown>>`, which erases the field
 * shape, so the fields are read back through `shape` — available
 * only on a `ZodObject`. `instanceof` is both the narrowing and the
 * check: the fields are `HHMM_REGEX`, a `z.string().regex(...)`, so
 * `ZodString` is the honest type to demand and the output type this
 * function promises (`string`). A config that stopped being an
 * object, or that changed a time field to something else, throws at
 * module load rather than silently validating nothing. A cast would
 * have made this a compile-time promise about a value this file
 * cannot see, and a wrong value would then have become `undefined` —
 * a Zod field that accepts anything.
 */
function timetableEntryTimeField(field: 'startTime' | 'endTime'): z.ZodString {
  const createSchema = ENTITY_CONFIG_MAP.timetable_entry.createSchema
  if (!(createSchema instanceof z.ZodObject)) {
    throw new Error('ENTITY_CONFIG_MAP.timetable_entry.createSchema is not a ZodObject')
  }
  const found = createSchema.shape[field]
  if (!(found instanceof z.ZodString)) {
    throw new Error(`ENTITY_CONFIG_MAP.timetable_entry.createSchema.shape.${field} is not a string schema`)
  }
  return found
}

/**
 * One timetable entry as the write path accepts it.
 *
 * `dayOfWeek` is validated to 1–7 (the column's documented domain)
 * and both times to `HH:mm`. The `refine` enforces `endTime >
 * startTime`: both fields are zero-padded fixed-width text, so a
 * lexicographic comparison is a chronological one, and a zero- or
 * negative-length period is a data error the grid would render as
 * nonsense. The check lives here, at the boundary, so no caller can
 * write an inverted period.
 */
const TimetableEntryInputSchema = z
  .object({
    classSubjectId: z.string().min(1),
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: timetableEntryTimeField('startTime'),
    endTime: timetableEntryTimeField('endTime'),
    room: z.string().nullable().optional(),
  })
  .refine((entry) => entry.endTime > entry.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  })

const CreateTimetableSchema = z.object({
  classId: z.string().min(1),
  termId: z.string().min(1),
  name: z.string().trim().min(1),
  isPublished: z.boolean().default(false),
  entries: z.array(TimetableEntryInputSchema).default([]),
})

export type CreateTimetableInput = z.infer<typeof CreateTimetableSchema>

/**
 * Validate a timetable-create payload without touching the database.
 *
 * Exported pure so the validation rules (day-of-week domain, `HH:mm`
 * grammar, `endTime > startTime`) are provable without a Prisma client.
 */
export function validateCreateTimetable(body: unknown) {
  return CreateTimetableSchema.safeParse(body)
}

/**
 * The entry projection shared by the read shape of GET and POST.
 *
 * Entries are ordered by day then start time — the same ordering the
 * grid applies client-side, so the two cannot disagree — and each
 * entry carries its subject and teacher names inline rather than
 * making the client resolve `classSubjectId` itself.
 */
const entriesInclude = {
  orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  include: {
    classSubject: {
      select: {
        subject: { select: { name: true, code: true } },
        teacher: { select: { firstName: true, lastName: true } },
      },
    },
  },
  // `satisfies`, not `as const`: the sort directions must stay the literal
  // type `'asc'` for Prisma, but `as const` also makes `orderBy` a
  // `readonly` tuple, and the generated args demand a mutable array. This
  // checks the shape against the real type without freezing it.
} satisfies Prisma.Timetable$entriesArgs

/**
 * The relations the read shape of GET and POST select alongside
 * `entries`.
 *
 * `class` and `term` are selected for their names only. They cost no
 * extra round trip — the timetable row is joined either way — and the
 * grid's caption needs them: without them the page can only print the
 * raw `classId`/`termId` cuids it was handed in the query string,
 * which is a worse label than no label at all.
 */
const timetableInclude = {
  class: { select: { id: true, name: true } },
  term: { select: { id: true, name: true } },
  entries: entriesInclude,
} satisfies Prisma.TimetableInclude

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'timetable:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope. The permission gate answers "may they read timetables
    // at all"; this answers "which classes'". A classroom teacher must
    // see only their own classes' timetables, not the school's.
    const visibility = await resolveVisibility(ctx, 'timetable:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const classId = searchParams.get('classId')
    const termId = searchParams.get('termId')

    // `Timetable` has no schoolId column, so school scope arrives through
    // the class relation. The visibility filter composes under `AND`
    // rather than as a spread: the `?classId=` parameter must NARROW the
    // visible set, never replace the scope. Spread first and the parameter
    // overwrote `id: { in: [...] }` with the raw string, so a classroom
    // teacher could read any class by id. Under `AND`, an out-of-scope
    // classId yields an unsatisfiable predicate and no rows.
    const where: Prisma.TimetableWhereInput = {
      tenantId,
      class: { schoolId },
    }
    // The scope is narrowed on `Timetable.classId`, a plain String column.
    //
    // `classVisibilityWhere` cannot be used here: it builds a
    // `ClassWhereInput` — `{ id: { in: [...] } }` — which is only valid
    // inside a `class:` relation filter. `TimetableWhereInput.AND` takes
    // `TimetableWhereInput` clauses, so TypeScript rejects the Class shape,
    // and it was wrong at runtime too: read as a Timetable clause it
    // compares `Timetable.id` — the timetable's own cuid — against class
    // ids, so it matches nothing. A teacher with a narrow scope would have
    // been refused their own classes' timetables.
    //
    // `classIds === null` is the unrestricted case (`scopeFor` returned
    // `all`) and must send no predicate. An empty array is not
    // unrestricted: it is "no classes", and `classId: { in: [] }` matches
    // nothing, which is the correct answer.
    if (visibility.classIds) where.AND = [{ classId: { in: visibility.classIds } }]
    if (classId) where.classId = classId
    if (termId) where.termId = termId

    // `(tenantId, classId, termId, name)` is unique, but `classId` +
    // `termId` alone may match several named timetables; the earliest
    // name is picked so the same request always answers the same row.
    const timetable = await prisma.timetable.findFirst({
      where,
      orderBy: { name: 'asc' },
      include: timetableInclude,
    })

    if (!timetable) {
      return NextResponse.json({ error: 'Timetable not found' }, { status: 404 })
    }
    return NextResponse.json({ data: timetable })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Timetable GET', error)
    return NextResponse.json({ error: 'Failed to fetch timetable' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'timetable:update', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope under the write key. `timetable:update` resolves to `class` for a
    // classroom teacher, and the target of this write is a class named in the
    // body — so without narrowing that id, a teacher could write the schedule of
    // any class in the school. The class lookup below therefore tests membership
    // of the caller's visible classes, not merely existence in this school.
    const visibility = await resolveVisibility(ctx, 'timetable:update')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = validateCreateTimetable(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { classId, termId, name, isPublished, entries } = parseResult.data

    // The class must exist in this tenant and school, or the write would
    // fail on the foreign key as a 500. The two conditions compose: `AND`
    // rather than a spread, so neither can overwrite the other.
    const classWhere: Prisma.ClassWhereInput = { id: classId, tenantId, schoolId }
    if (visibility.classIds) classWhere.AND = [{ id: { in: visibility.classIds } }]
    const classRow = await prisma.class.findFirst({
      where: classWhere,
      select: { id: true },
    })
    if (!classRow) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    const termRow = await prisma.term.findFirst({
      where: { id: termId, tenantId, schoolId },
      select: { id: true },
    })
    if (!termRow) {
      return NextResponse.json({ error: 'Term not found' }, { status: 404 })
    }

    // Every entry's classSubject must belong to this class and tenant.
    // Checked up front because a bad id would otherwise surface as a
    // foreign-key 500 after the timetable row was already created.
    if (entries.length > 0) {
      const valid = await prisma.classSubject.findMany({
        where: {
          tenantId,
          classId,
          id: { in: entries.map((entry) => entry.classSubjectId) },
        },
        select: { id: true },
      })
      const validIds = new Set(valid.map((cs) => cs.id))
      if (entries.some((entry) => !validIds.has(entry.classSubjectId))) {
        return NextResponse.json(
          {
            error: 'Invalid input',
            details: [
              {
                code: 'custom',
                message: 'classSubjectId must belong to this class',
                path: ['entries', 'classSubjectId'],
              },
            ],
          },
          { status: 400 },
        )
      }
    }

    // Timetable and its entries are written in one transaction: a
    // timetable whose entries partially failed to insert would render
    // as a schedule with silently missing periods.
    const timetable = await prisma.$transaction(
      async (tx) => {
        const created = await tx.timetable.create({
          data: { tenantId, classId, termId, name, isPublished },
        })
        if (entries.length > 0) {
          await tx.timetableEntry.createMany({
            data: entries.map((entry) => ({
              tenantId,
              timetableId: created.id,
              classSubjectId: entry.classSubjectId,
              dayOfWeek: entry.dayOfWeek,
              startTime: entry.startTime,
              endTime: entry.endTime,
              room: entry.room ?? null,
            })),
          })
        }
        return tx.timetable.findUnique({
          where: { id: created.id },
          include: timetableInclude,
        })
      },
      TIMETABLE_TRANSACTION_BOUNDS,
    )

    return NextResponse.json({ data: timetable }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Before the generic 500: a duplicate timetable name or a duplicate
    // (day, startTime, classSubject) entry is a client error, and the
    // catch-all would otherwise report it as an outage.
    if (isUniqueConstraintViolation(error)) return duplicateResponse()
    logError('Timetable POST', error)
    return NextResponse.json({ error: 'Failed to create timetable' }, { status: 500 })
  }
}
