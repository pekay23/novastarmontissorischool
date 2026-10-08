/**
 * PATCH  /api/system/errors/:id   — mark error as resolved/unresolved
 *
 * Only HEADMASTER role can access. Mutations are audit-logged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { logAuditEvent, AuditLogAction } from '@/lib/audit/logger'
import { toErrorResponse } from '@/lib/api-response'
import { isPlatformAdmin } from '@/lib/constants/platform-roles'
import { z } from 'zod'

const ResolveSchema = z.object({
  resolved: z.boolean(),
})

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Hoisted so the catch block can attribute the failure to a tenant and an id.
  let ctx: { tenantId?: string; userId?: string } = {}
  let errorId: string | undefined
  try {
    const session = await getCachedSessionAndTenant()
    ctx = { tenantId: session.tenantId, userId: session.userId }
    if (!isPlatformAdmin(session.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const { id } = await context.params
    errorId = id

    const body = await req.json().catch(() => ({}))
    const parsed = ResolveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', details: parsed.error.issues }, { status: 400 })
    }

    const { resolved } = parsed.data

    const updateData: Prisma.SystemErrorUpdateInput = {
      resolved,
      resolvedAt: resolved ? new Date() : null,
      resolvedByUser: resolved ? { connect: { id: session.userId } } : { disconnect: true },
    }

    const errorEntry = await prisma.systemError.update({
      where: { id, tenantId: session.tenantId },
      data: updateData,
    }).catch((err: unknown) => {
      // P2025 = no matching row. A stale id or another tenant's id are the
      // same answer to the client, and neither is worth logging as a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return null
      }
      throw err
    })

    if (!errorEntry) {
      return NextResponse.json({ error: 'Error not found' }, { status: 404 })
    }

    await logAuditEvent({
      userId: session.userId,
      action: AuditLogAction.UPDATE,
      entity: 'system_error',
      entityId: id,
      description: `System error ${errorEntry.errorType} marked as ${resolved ? 'resolved' : 'unresolved'}`,
      tenantId: session.tenantId,
      schoolId: session.schoolId ?? undefined,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse('SYSTEM_ERRORS_API', error, {
      ...ctx,
      endpoint: errorId ? `PATCH /api/system/errors/${errorId}` : 'PATCH /api/system/errors',
    })
  }
}
