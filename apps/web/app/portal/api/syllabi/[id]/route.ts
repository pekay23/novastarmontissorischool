import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { hasPermission } from '@novastar/auth'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import {
  resolveVisibility,
  classVisibilityWhere,
  visibilityDeniesAll,
} from '@/lib/visibility'
import { SyllabusCreateSchema, SYLLABUS_INCLUDE } from '@/lib/syllabus-contract'
import { toErrorResponse } from '@/lib/api-response'
import { isUniqueConstraintViolation } from '@/lib/prisma-conflict'

async function mutationContext(
  id: string,
  permission: 'academic:update' | 'academic:delete',
) {
  const ctx = await getTenantContext()
  const { userId, tenantId, schoolId } = ctx
  if (!schoolId)
    return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
  if (!(await hasPermission(userId, permission, tenantId, schoolId)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const visibility = await resolveVisibility(ctx, permission)
  if (visibilityDeniesAll(visibility))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const visibleClass: Prisma.ClassWhereInput = {
    tenantId,
    schoolId,
    ...classVisibilityWhere(visibility),
  }
  const where: Prisma.SyllabusWhereUniqueInput = {
    id,
    tenantId,
    OR: [{ schoolId }, { schoolId: null }],
    classSubject: { tenantId, class: visibleClass },
  }
  const existing = await prisma.syllabus.findFirst({
    where,
    select: { id: true },
  })
  if (!existing)
    return NextResponse.json({ error: 'Syllabus not found' }, { status: 404 })
  return { where, visibleClass, tenantId, schoolId }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const context = await mutationContext(id, 'academic:update')
    if (context instanceof Response) return context
    const payload = await req.json().catch(() => null)
    const result = SyllabusCreateSchema.safeParse(payload)
    if (!result.success)
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.issues },
        { status: 400 },
      )
    const { classSubjectId, termId, title, topics, status, body } = result.data
    const [classSubject, term] = await Promise.all([
      prisma.classSubject.findFirst({
        where: {
          id: classSubjectId,
          tenantId: context.tenantId,
          class: context.visibleClass,
        },
        select: { id: true },
      }),
      prisma.term.findFirst({
        where: {
          id: termId,
          tenantId: context.tenantId,
          schoolId: context.schoolId,
        },
        select: { id: true },
      }),
    ])
    if (!classSubject || !term)
      return NextResponse.json(
        { error: 'Class subject or term not found' },
        { status: 404 },
      )
    const updated = await prisma.syllabus.update({
      where: context.where,
      data: {
        classSubjectId,
        termId,
        title,
        topics,
        status,
        body: body ?? null,
      },
      include: SYLLABUS_INCLUDE,
    })
    return NextResponse.json({ data: updated })
  } catch (error) {
    if (isUniqueConstraintViolation(error))
      return NextResponse.json(
        {
          error:
            'A syllabus with this title already exists for this class subject and term',
        },
        { status: 409 },
      )
    return toErrorResponse('Syllabus PATCH', error)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const context = await mutationContext(id, 'academic:delete')
    if (context instanceof Response) return context
    await prisma.syllabus.delete({ where: context.where })
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse('Syllabus DELETE', error)
  }
}
