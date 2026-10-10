import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { logError } from '@/lib/logger'
import { authorizeHealthAccess } from '@/lib/health/scope'
import { logAuditEvent, AuditLogAction } from '@/lib/audit/logger'

/**
 * A child's health declarations — the three free-text answers the policy asks a
 * parent for, plus when and by whom they were declared.
 *
 * These are the operational fields. A classroom teacher reads them to know what
 * a child may eat and what to watch for; the clinical report behind them lives
 * under `./documents` behind a tighter permission.
 */

/**
 * Free text, so the only real limits are length. A parent writing "mild
 * asthmatic, blue inhaler before PE, severe with dust" must not be cut off
 * mid-sentence, and a cap high enough to hold a real answer (2,000 characters)
 * is far more than any of these fields needs.
 *
 * Empty string is normalised to null so that "the parent cleared the box" and
 * "the parent never filled it in" do not both leave an empty string behind.
 */
const DeclarationSchema = z.object({
  medicalConditions: z.string().max(2000).optional(),
  allergies: z.string().max(2000).optional(),
  dietaryConcerns: z.string().max(2000).optional(),
})

const normalise = (value: string | undefined): string | null | undefined => {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const result = await authorizeHealthAccess(id, 'student:health:read')
    if (!result.ok) {
      return NextResponse.json({ error: result.denial.error }, { status: result.denial.status })
    }

    const { student, tenantId, schoolId, userId } = result.access

    const student_ = await prisma.student.findUniqueOrThrow({
      where: { id: student.id },
      select: {
        medicalConditions: true,
        allergies: true,
        dietaryConcerns: true,
        healthDeclaredAt: true,
        healthDeclaredByParent: true,
        healthDocuments: {
          orderBy: { uploadedAt: 'desc' },
          select: {
            id: true,
            fileName: true,
            contentType: true,
            sizeBytes: true,
            uploadedAt: true,
            supersedesId: true,
            uploadedBy: { select: { id: true } },
          },
        },
      },
    })

    /*
     * Who read a child's health record is itself sensitive, so the read is
     * logged. What is logged is the ACCESS, never the content: `changes` and
     * `description` carry no allergy, condition or dietary text, because the
     * audit log is readable by a wider audience than this route and copying
     * clinical detail into it would create a second, less-protected copy of the
     * exact data the permissions above exist to contain.
     */
    await logAuditEvent({
      userId,
      tenantId,
      schoolId,
      action: AuditLogAction.READ,
      entity: 'StudentHealth',
      entityId: student.id,
      description: `Read health declarations for student ${student.id}`,
    })

    return NextResponse.json({ data: student_ })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Student health GET', error)
    return NextResponse.json({ error: 'Failed to fetch health declarations' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const result = await authorizeHealthAccess(id, 'student:health:write')
    if (!result.ok) {
      return NextResponse.json({ error: result.denial.error }, { status: result.denial.status })
    }

    const { student, tenantId, schoolId, userId } = result.access

    const body = await req.json()
    const parsed = DeclarationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 },
      )
    }

    const medicalConditions = normalise(parsed.data.medicalConditions)
    const allergies = normalise(parsed.data.allergies)
    const dietaryConcerns = normalise(parsed.data.dietaryConcerns)

    // Nothing supplied at all is a no-op, not a write. A PUT that arrives with
    // no recognisable field should not silently stamp a fresh declaration time
    // onto the child's record.
    if (
      medicalConditions === undefined &&
      allergies === undefined &&
      dietaryConcerns === undefined
    ) {
      return NextResponse.json({ error: 'No declaration supplied' }, { status: 400 })
    }

    const changesSomething =
      medicalConditions !== undefined ||
      allergies !== undefined ||
      dietaryConcerns !== undefined

    // Resolved before the write, not inside the data object: an `await` in the
    // middle of a Prisma `data` literal is both unreadable and a second round
    // trip hidden inside what looks like one statement.
    const declaredByParent = changesSomething
      ? await isParentActor(userId, student.parentId)
      : false

    const updated = await prisma.student.update({
      where: { id: student.id },
      data: {
        ...(medicalConditions !== undefined ? { medicalConditions } : {}),
        ...(allergies !== undefined ? { allergies } : {}),
        ...(dietaryConcerns !== undefined ? { dietaryConcerns } : {}),
        /*
         * Stamped only when something actually changed, and `byParent` records
         * that the caller was the parent rather than staff. The policy makes a
         * late-discovered condition carry a withdrawal consequence, so who said
         * it and when is part of the record — but a staff member correcting a
         * typo must not be recorded as the parent having declared it, or the
         * provenance of the warning is lost exactly when it matters.
         */
        ...(changesSomething
          ? { healthDeclaredAt: new Date(), healthDeclaredByParent: declaredByParent }
          : {}),
      },
      select: {
        medicalConditions: true,
        allergies: true,
        dietaryConcerns: true,
        healthDeclaredAt: true,
        healthDeclaredByParent: true,
      },
    })

    await logAuditEvent({
      userId,
      tenantId,
      schoolId,
      action: AuditLogAction.UPDATE,
      entity: 'StudentHealth',
      entityId: student.id,
      // Field NAMES only. See the note on the read path.
      description: 'Updated health declarations',
      changes: {
        fields: Object.keys(parsed.data),
      },
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Student health PUT', error)
    return NextResponse.json({ error: 'Failed to record health declarations' }, { status: 500 })
  }
}

/**
 * Whether the caller is linked to this child as its parent.
 *
 * `authorizeHealthAccess` already proved the caller may act on this child, but
 * "may act" and "is the parent" are different questions: a classroom teacher
 * scoped to `class` passes the first and must fail the second, and the answer
 * decides whether the change is filed as the parent's declaration.
 */
async function isParentActor(userId: string, parentId: string | null): Promise<boolean> {
  if (!parentId) return false
  const parent = await prisma.parent.findFirst({
    where: { id: parentId, userId },
    select: { id: true },
  })
  return parent !== null
}