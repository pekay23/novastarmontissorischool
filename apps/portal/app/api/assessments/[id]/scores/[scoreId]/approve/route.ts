import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  studentVisibilityWhere,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { AuditLogAction, logAuditEvent } from '@/lib/audit/logger'
import { logError } from '@/lib/logger'

/**
 * Approving a mark, and withdrawing that approval.
 *
 * `Score.isApproved` / `approvedById` / `approvedAt` existed in the schema with
 * zero writers, so `GET .../scores` reported an `approved` count that could only
 * ever be `0`. Nothing was gated: a teacher could enter a mark, the assessment
 * could go to parents on the report card, and the mark could then be changed with
 * no approval step and no record of who signed off on what.
 *
 * ## Why approval is a separate act from entering a mark
 *
 * `assessment:grade` is held by `CLASSROOM_TEACHER`; `score:approve` is not. That
 * separation is the whole point — the teacher who types a mark must not be the one
 * who signs it off, or approval records nothing but "this teacher checked their
 * own work". `score:approve` sits with the roles that already approve: head
 * teacher and above.
 *
 * ## The approver is the session, never the request
 *
 * `approvedById` comes from the authenticated caller and from nowhere else. A
 * body-supplied `approvedById` would let any teacher approve a mark in the name
 * of the head of school, and the column exists precisely to answer "who signed
 * this", so a spoofable value is worse than no value at all. There is no
 * `approvedById` in the request schema because there is nothing a client may say
 * about it.
 *
 * ## Withdrawal clears the whole triple
 *
 * Approving sets `isApproved`, `approvedById` and `approvedAt` together, and
 * withdrawing clears all three. A half-cleared row would keep a name and a
 * timestamp next to `isApproved: false`, which reads as though someone had
 * withdrawn it rather than never having approved it.
 *
 * ## Editing a mark withdraws approval on the write path
 *
 * Enforced in `../route.ts`, not here: an approval attests to a specific mark, so
 * changing the mark has to withdraw it. A caller cannot reach an approved-and-
 * changed mark by approving it after the fact without the intervening edit having
 * withdrawn it first.
 */

const APPROVE_ERRORS = {
  forbidden: 'You do not have permission to approve scores.',
  notFound: 'Score not found',
  unpublished:
    'This assessment is not published, so its marks cannot be approved. Publish the assessment first.',
  noMark: 'This score has no mark to approve.',
} as const

type ApproveHandler = (
  req: NextRequest,
  ctx: { params: Promise<{ id: string; scoreId: string }> },
  approved: boolean,
) => Promise<NextResponse>

/**
 * One implementation behind both verbs, so approve and withdraw cannot drift.
 *
 * `approved` is a parameter of this function and never of the request, which is
 * what makes "withdraw" structurally unable to accept an `approvedById` from a
 * body: there is no body parser anywhere in this file.
 */
const setApproval: ApproveHandler = async (req, { params }, approved) => {
  const verb = approved ? 'approve' : 'withdraw approval for'
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC. `score:approve` is the whole authorisation for this write; the
    // route that enters marks holds `assessment:grade` and cannot reach here.
    if (!(await hasPermission(userId, 'score:approve', tenantId, schoolId))) {
      return NextResponse.json({ error: APPROVE_ERRORS.forbidden }, { status: 403 })
    }

    // Row scope, on the same key rather than on `assessment:read`. A role
    // holding `score:approve` narrowly must not be able to approve outside it.
    const visibility = await resolveVisibility(ctx, 'score:approve')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: APPROVE_ERRORS.forbidden }, { status: 403 })
    }

    const { id: assessmentId, scoreId } = await params

    // `Score` carries no `schoolId` of its own; it reaches a school through its
    // student, and a class only through that student's enrolments. Both clauses
    // go in the `where`, composed under `AND` with the student scope so neither
    // can overwrite the other, and the tenant clause stays in the update below so
    // the write cannot reach wider than the read proved.
    const clauses: Prisma.ScoreWhereInput[] = [{ student: { schoolId } }]
    const studentScope = studentVisibilityWhere(visibility)
    if (Object.keys(studentScope).length > 0) clauses.push({ student: studentScope })

    const score = await prisma.score.findFirst({
      where: { id: scoreId, assessmentId, tenantId, AND: clauses },
      select: {
        id: true,
        rawScore: true,
        isApproved: true,
        assessment: { select: { isPublished: true } },
      },
    })
    if (!score) {
      return NextResponse.json({ error: APPROVE_ERRORS.notFound }, { status: 404 })
    }

    // Approval is a statement about a mark that will be reported. An unpublished
    // assessment is not on any report yet, and an absent mark has nothing to
    // attest to — both would otherwise record a signature against nothing.
    if (!score.assessment.isPublished) {
      return NextResponse.json({ error: APPROVE_ERRORS.unpublished }, { status: 409 })
    }
    if (score.rawScore === null) {
      return NextResponse.json({ error: APPROVE_ERRORS.noMark }, { status: 409 })
    }

    // The already-correct state is not an error and not a second audit entry:
    // approving an approved mark is a no-op a well-behaved client should not be
    // punished for, and it is worth answering so the client can settle.
    if (score.isApproved === approved) {
      return NextResponse.json({ success: true, score, changed: false })
    }

    // `updateMany` against the same scoped `where` rather than `update({ where:
    // { id } })`. The read above proved the row is in scope, but a bare id write
    // re-proves nothing at the moment of writing; `updateMany` carries the scope
    // into the write, so a row that moved out of scope in between is reported as
    // not found instead of being written.
    const { count } = await prisma.score.updateMany({
      where: { id: scoreId, assessmentId, tenantId, AND: clauses },
      data: {
        isApproved: approved,
        approvedById: approved ? userId : null,
        approvedAt: approved ? new Date() : null,
      },
    })
    if (count === 0) {
      return NextResponse.json({ error: APPROVE_ERRORS.notFound }, { status: 404 })
    }

    // Approval is a governance act, so it belongs in the school's audit trail
    // and not only in the row. The description names the mark's own identity and
    // the actor comes from the session, so the entry cannot be attributed to
    // anyone but the caller.
    await logAuditEvent({
      userId,
      tenantId,
      schoolId,
      action: AuditLogAction.UPDATE,
      entity: 'Score',
      entityId: scoreId,
      description: approved
        ? `Approved score ${scoreId} on assessment ${assessmentId}`
        : `Withdrew approval for score ${scoreId} on assessment ${assessmentId}`,
    })

    const updated = await prisma.score.findFirst({
      where: { id: scoreId, tenantId },
      include: { approvedBy: { select: { name: true } } },
    })

    return NextResponse.json({ success: true, score: updated, changed: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError(`Score ${verb}`, error)
    return NextResponse.json({ error: `Failed to ${verb} score` }, { status: 500 })
  }
}

/** POST /api/assessments/[id]/scores/[scoreId]/approve */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; scoreId: string }> },
) {
  return setApproval(req, ctx, true)
}

/**
 * DELETE withdraws the approval.
 *
 * DELETE rather than a `PATCH {"approved": false}` body because there is nothing
 * to send: the request carries no opinion about who approved or when, so a verb
 * that cannot be given a payload cannot be asked to lie about one.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; scoreId: string }> },
) {
  return setApproval(req, ctx, false)
}