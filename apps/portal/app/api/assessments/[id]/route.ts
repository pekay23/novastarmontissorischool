import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext, requirePermission } from '@/lib/tenant'
import { z } from 'zod'

// GET /api/assessments/[id] — Get a single assessment with scores
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    await requirePermission('assessment:read')

    const { id } = await params

    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId, tenantId },
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
    console.error('Assessment GET error:', error)
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
    const { schoolId, tenantId, userId: _userId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    await requirePermission('assessment:update')

    const { id } = await params
    const body = await req.json()
    const parseResult = UpdateAssessmentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }

    // Verify ownership
    const existing = await prisma.assessment.findFirst({
      where: { id, schoolId, tenantId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
    }

    const data = parseResult.data
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
      where: { id, schoolId, tenantId },
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
    console.error('Assessment PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update assessment' }, { status: 500 })
  }
}

// DELETE /api/assessments/[id] — Delete an assessment (only if not published)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { schoolId, tenantId } = await getTenantContext()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    await requirePermission('assessment:delete')

    const { id } = await params

    const existing = await prisma.assessment.findFirst({
      where: { id, schoolId, tenantId },
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

    await prisma.assessment.delete({
      where: { id, schoolId, tenantId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Assessment DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete assessment' }, { status: 500 })
  }
}
