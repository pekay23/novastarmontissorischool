import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { toErrorResponse } from '@/lib/api-response'
import { AuditLogAction, logAuditEvent } from '@/lib/audit/logger'
import {
  auditChanges,
  planPromotion,
} from '../../(portal)/promotions/promotion-plan'

/**
 * Class promotion.
 *
 * ## Why there is no promotions table
 *
 * The Laravel source kept a `promotions` table holding the old class, the new
 * class and the student id, and expected it to stay in sync with the student
 * table, the class table and the enrolment table. That is four places to
 * agree and no constraint making them agree. It is NOT ported.
 *
 * This route treats `Enrollment` as the history instead. `Enrollment` already
 * records which class a student was in for which term under
 * `@@unique([tenantId, studentId, termId])`, so the promotion writes the same
 * kind of row the rest of the product reads, and the unique constraint is what
 * makes a repeated promotion idempotent. `Student.classId` stays the
 * current-class pointer the rest of the portal queries.
 *
 * ## Why no student-id rewrite
 *
 * The source controller also rewrote the student's own id number as part of a
 * promotion, taking the new number from the request body. That is an
 * unauthenticated write to a student identifier: anyone who could reach the
 * endpoint could rename a student by posting a different number. `Student.
 * studentId` here is stable for the student's life at the school and is not
 * touched by a promotion.
 *
 * ## Idempotence
 *
 * `Enrollment.upsert` is keyed on the compound unique `[tenantId, studentId,
 * termId]`. Promoting the same cohort to the same term twice is the same end
 * state, so the second call updates rather than inserting and does not raise
 * `P2002`. Re-running a promotion after a partial failure elsewhere is safe.
 */

/**
 * The Neon adapter turns every statement into a network round trip, so an
 * unbounded interactive transaction holds a pooled connection — and this
 * request — open for however long the database feels like answering. A
 * 45-student cohort is 90 statements plus the audit entry, so this is the
 * difference between a promotion that reliably completes and one that
 * intermittently times out with the cohort half-moved.
 */
const PROMOTION_TRANSACTION_BOUNDS = { maxWait: 5_000, timeout: 60_000 } as const

const PromotionSchema = z.object({
  fromClassId: z.string().trim().min(1),
  toClassId: z.string().trim().min(1),
  termId: z.string().trim().min(1),
  overrides: z
    .array(
      z.object({
        studentId: z.string().trim().min(1),
        toClassId: z.string().trim().min(1),
      }),
    )
    .optional()
    .default([]),
})

/**
 * Raised inside the transaction when a student's writes fail.
 *
 * Thrown only at the very end, after every row has been attempted, so the
 * response can name which students failed. The throw itself is what discards
 * the work: the transaction rolls back as a unit, which is the only way to
 * honour "never a partial promotion". A promotion is all-or-nothing by
 * construction — `promoted` is either the whole cohort or zero.
 */
class PromotionAborted extends Error {
  readonly failures: { studentId: string; error: string }[]
  constructor(failures: { studentId: string; error: string }[]) {
    super('Promotion aborted')
    this.name = 'PromotionAborted'
    this.failures = failures
  }
}

/**
 * Whether the caller may promote at all.
 *
 * The page needs this to disable its action rather than presenting a form
 * that can only ever 403. It is computed here with `hasPermission` rather
 * than inferred from the caller's role, because permissions can also arrive
 * by delegation: a role check would lock the button for a Head of School who
 * granted a delegated assistant the right to promote. The check here is
 * advisory for the UI only — `POST` re-runs it and is the authority.
 */
export async function GET() {
  try {
    const { tenantId, schoolId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    const canPromote = await hasPermission(userId, 'promotion:execute', tenantId, schoolId)
    return NextResponse.json({ data: { canPromote } })
  } catch (error) {
    return toErrorResponse('Promotions GET', error, { endpoint: '/api/promotions' })
  }
}

export async function POST(req: NextRequest) {
  // Hoisted so the catch can attribute a failure even if the context lookup
  // is what threw. `schoolId` is not hoisted: it is only ever read off `ctx`,
  // and `ctx.schoolId` is checked for null before anything is written.
  let tenantId = ''
  let userId = ''

  try {
    const ctx = await getTenantContext()
    tenantId = ctx.tenantId
    userId = ctx.userId
    if (!ctx.schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC. `promotion:execute` is the one key for this decision, declared in
    // `permission-keys.ts` and deliberately withheld from CLASSROOM_TEACHER —
    // a teacher teaches a cohort, the school decides what happens to it.
    if (!(await hasPermission(userId, 'promotion:execute', tenantId, ctx.schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = PromotionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 },
      )
    }
    // Inferred rather than annotated as `PromotionRequestInput`: the schema's
    // `.default([])` means `overrides` is always an array once parsed, while
    // the input type allows it to be absent. `planPromotion` accepts either.
    const input = parsed.data

    // Every id in the request is resolved against this tenant before anything
    // is written. `knownClassIds` is built from a single tenant-and-school
    // scoped query, so a class belonging to another school in the same
    // tenant, or to another tenant entirely, is simply not in it and is
    // refused by `planPromotion` exactly like an id that exists nowhere.
    //
    // `ClassTerm.isActive` is the only "is this class running" signal on this
    // schema — `Class` has no active flag. A class with no `ClassTerm` row for
    // the term is treated as unlisted rather than inactive, because the seed
    // writes no `ClassTerm` rows and refusing those would make the feature
    // unusable; a row that exists and is explicitly inactive IS refused.
    const [classes, classTerms, term, cohort] = await Promise.all([
      prisma.class.findMany({
        where: { tenantId, schoolId: ctx.schoolId },
        select: { id: true },
      }),
      prisma.classTerm.findMany({
        where: {
          tenantId,
          termId: input.termId,
          isActive: false,
          classId: { in: [input.fromClassId, input.toClassId, ...input.overrides.map((o) => o.toClassId)] },
        },
        select: { classId: true },
      }),
      prisma.term.findFirst({
        where: { id: input.termId, tenantId, schoolId: ctx.schoolId },
        select: { id: true },
      }),
      // The cohort is the source of truth for who gets moved, read from
      // `Student.classId` — the pointer the rest of the portal queries — and
      // scoped to this tenant and school through the class.
      prisma.student.findMany({
        where: { tenantId, classId: input.fromClassId, class: { schoolId: ctx.schoolId } },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    ])

    const inactive = new Set(classTerms.map((row) => row.classId))
    const plan = planPromotion(input, {
      knownClassIds: classes.map((row) => row.id),
      termKnown: term !== null,
      cohortStudentIds: cohort.map((row) => row.id),
    })

    if (!plan.ok) {
      return NextResponse.json({ error: plan.error, code: plan.code }, { status: plan.status })
    }

    // The inactive-class check runs after planning so the more specific
    // "unknown class" answer wins over "inactive" for an id that is not even
    // the caller's. It is still before every write.
    if (inactive.has(input.toClassId) || input.overrides.some((o) => inactive.has(o.toClassId))) {
      return NextResponse.json(
        { error: 'The target class is not active for this term', code: 'INACTIVE_CLASS' },
        { status: 400 },
      )
    }

    const rows = plan.rows

    const outcome = await prisma.$transaction(
      async (tx) => {
        const failures: { studentId: string; error: string }[] = []

        for (const row of rows) {
          try {
            // Idempotent by the compound unique. `create` sets the cohort's
            // destination; `update` re-points an existing term enrolment and
            // reactivates it, so a promotion that is re-run converges on the
            // same end state instead of failing on `P2002`. `enrolledAt` is
            // left alone on update: it records when the student entered that
            // term, and re-running a promotion must not rewrite it.
            await tx.enrollment.upsert({
              where: {
                tenantId_studentId_termId: {
                  tenantId,
                  studentId: row.studentId,
                  termId: input.termId,
                },
              },
              create: {
                tenantId,
                studentId: row.studentId,
                classId: row.toClassId,
                termId: input.termId,
                isActive: true,
              },
              update: { classId: row.toClassId, isActive: true },
            })

            // `updateMany` rather than `update` so the tenant predicate is part
            // of the write. A student id that was not in this tenant's cohort
            // updates zero rows instead of throwing on a missing row.
            const moved = await tx.student.updateMany({
              where: { id: row.studentId, tenantId },
              data: { classId: row.toClassId },
            })
            if (moved.count !== 1) {
              failures.push({
                studentId: row.studentId,
                error: 'Student no longer exists in this tenant',
              })
            }
          } catch (error) {
            failures.push({
              studentId: row.studentId,
              error: error instanceof Error ? error.message : 'Unknown write failure',
            })
          }
        }

        // Discard everything if any single student failed. Throwing after the
        // loop rather than inside it means the response can still say which
        // students failed, while the rollback guarantees the cohort was not
        // left split across two classes.
        if (failures.length > 0) throw new PromotionAborted(failures)

        // One audit entry for the batch, written inside the same transaction
        // so a rolled-back promotion leaves no trace of having been
        // attempted. `logAuditEvent` takes the transaction client and writes
        // through it; the model is never touched directly here.
        await logAuditEvent(
          {
            userId,
            tenantId,
            schoolId: ctx.schoolId ?? undefined,
            action: AuditLogAction.UPDATE,
            entity: 'ClassPromotion',
            entityId: input.fromClassId,
            description: `Promoted ${rows.length} student(s) from ${input.fromClassId} to ${
              input.toClassId
            } for term ${input.termId}`,
            changes: auditChanges(rows, input.termId),
          },
          tx,
        )

        return { promoted: rows.length }
      },
      PROMOTION_TRANSACTION_BOUNDS,
    )

    return NextResponse.json({
      data: {
        promoted: outcome.promoted,
        fromClassId: input.fromClassId,
        toClassId: input.toClassId,
        termId: input.termId,
        results: rows.map((row) => ({
          studentId: row.studentId,
          fromClassId: row.fromClassId,
          toClassId: row.toClassId,
          overridden: row.overridden,
        })),
        failures: [] as { studentId: string; error: string }[],
      },
    })
  } catch (error) {
    if (error instanceof PromotionAborted) {
      // Nothing was written. `promoted: 0` is literal, not a partial count.
      return NextResponse.json(
        {
          error: 'Promotion failed and nothing was changed',
          code: 'PROMOTION_ABORTED',
          data: { promoted: 0, failures: error.failures },
        },
        { status: 409 },
      )
    }
    return toErrorResponse('Promotions POST', error, {
      tenantId: tenantId || undefined,
      userId: userId || undefined,
      endpoint: '/api/promotions',
    })
  }
}