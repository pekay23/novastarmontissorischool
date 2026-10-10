import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  assessmentVisibilityWhere,
  visibilityDeniesAll,
  type Visibility,
} from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

/**
 * The one predicate every handler in this file reads and writes through.
 *
 * `assessment:read` and `assessment:update` are held by `CLASSROOM_TEACHER` at
 * `class` scope, so `{ id, schoolId, tenantId }` on its own is not a narrowing
 * of them: it is every assessment in the school, student names and raw scores
 * included. The row scope composes under `AND` rather than as a spread, so it
 * cannot be silently overwritten by a later property on the same object, and an
 * out-of-scope id simply matches nothing.
 *
 * Built once and shared by GET, PATCH and DELETE so the three cannot drift --
 * the defect this exists to close was that the mutation handlers applied a
 * weaker `where` than the read handler in the same file. Typed as the
 * unique-where input, so a write carries the scope rather than merely trusting
 * the read that preceded it.
 */
function scopedAssessmentWhere(input: {
  id: string
  schoolId: string
  tenantId: string
  visibility: Visibility
}): Prisma.AssessmentWhereUniqueInput {
  const where: Prisma.AssessmentWhereUniqueInput = {
    id: input.id,
    schoolId: input.schoolId,
    tenantId: input.tenantId,
  }
  const scope = assessmentVisibilityWhere(input.visibility)
  if (Object.keys(scope).length > 0) where.AND = [scope]
  return where
}

// GET /api/assessments/[id] — Get a single assessment with scores
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'assessment:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope, same discipline as the list route and the scores route.
    const visibility = await resolveVisibility(ctx, 'assessment:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    const assessment = await prisma.assessment.findFirst({
      where: scopedAssessmentWhere({ id, schoolId, tenantId, visibility }),
      include: {
        classSubject: {
          include: {
            subject: { select: { name: true, code: true } },
            class: { select: { name: true } },
            teacher: { select: { firstName: true, lastName: true } },
          },
        },
        type: true,
        scores: {
          include: {
            student: { select: { firstName: true, lastName: true, studentId: true } },
          },
        },
      },
    })

    if (!assessment) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
    }

    return NextResponse.json(assessment)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Assessment GET', error)
    return NextResponse.json({ error: 'Failed to fetch assessment' }, { status: 500 })
  }
}

const UpdateAssessmentSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  maxScore: z.number().int().positive().optional(),
  assessmentDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  isPublished: z.boolean().optional(),
})

// PATCH /api/assessments/[id] — Update an assessment
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'assessment:update', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateAssessmentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    // Publishing to parents is a different act from editing the assessment, and
    // it is the consequential one: parents see the result, and DELETE then
    // refuses while scores exist. `assessment:publish` was granted to
    // CLASSROOM_TEACHER and asserted in the role matrix but checked nowhere, so
    // the branch ran under `assessment:update` and the key was fiction. Refuse
    // rather than ignore the field: a caller who cannot publish must not be
    // answered 200 as though they had. Every role the seed gives
    // `assessment:update` also gets `assessment:publish` (both are `academic`,
    // non-delete), so this changes nothing until one of the two is delegated on
    // its own -- which is the point.
    if (
      data.isPublished !== undefined &&
      !(await hasPermission(userId, 'assessment:publish', tenantId, schoolId))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope. The old "Verify ownership" comment described an existence
    // check: `{ id, schoolId, tenantId }` proves the row is in this school, not
    // that the caller may touch it, so a classroom teacher could publish or
    // unpublish any assessment in the school by id.
    const visibility = await resolveVisibility(ctx, 'assessment:update')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const where = scopedAssessmentWhere({ id, schoolId, tenantId, visibility })
    const existing = await prisma.assessment.findFirst({ where })
    if (!existing) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.description !== undefined) updateData.description = data.description
    if (data.maxScore !== undefined) updateData.maxScore = data.maxScore
    if (data.assessmentDate !== undefined) updateData.assessmentDate = new Date(data.assessmentDate)
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null

    if (data.isPublished !== undefined) {
      updateData.isPublished = data.isPublished
      if (data.isPublished) {
        updateData.publishedAt = new Date()
      }
    }

    const updated = await prisma.assessment.update({
      where,
      data: updateData,
    })

    return NextResponse.json({ success: true, assessment: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Assessment PATCH', error)
    return NextResponse.json({ error: 'Failed to update assessment' }, { status: 500 })
  }
}

// DELETE /api/assessments/[id] — Delete an assessment (only if not published)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC
    if (!(await hasPermission(userId, 'assessment:delete', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Row scope under the delete key, same reason as PATCH. No seeded role that
    // resolves to a limited scope holds `assessment:delete`, so this is inert
    // today; it is the gate that would hold if one were.
    const visibility = await resolveVisibility(ctx, 'assessment:delete')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    const where = scopedAssessmentWhere({ id, schoolId, tenantId, visibility })
    const existing = await prisma.assessment.findFirst({
      where,
      include: { scores: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
    }

    if (existing.isPublished && existing.scores.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete a published assessment with scores' },
        { status: 403 },
      )
    }

    await prisma.assessment.delete({ where })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Assessment DELETE', error)
    return NextResponse.json({ error: 'Failed to delete assessment' }, { status: 500 })
  }
}
