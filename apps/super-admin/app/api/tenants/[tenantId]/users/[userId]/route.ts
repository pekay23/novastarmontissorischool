import type { NextRequest } from 'next/server'
import { requireCapability, requireTenantScope } from '@/lib/admin-context'
import { RequestError, toErrorResponse } from '@/lib/errors'
import { json, mutationContext } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import {
  updateUserInTenant,
  deactivateUserInTenant,
  reactivateUserInTenant,
} from '@/lib/queries'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; userId: string }> },
): Promise<Response> {
  try {
    const context = await requireCapability('tenant:user:update')
    const { tenantId, userId } = await params
    const tenant = await requireTenantScope(tenantId)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Invalid request body' }, 400)
    }

    const { name, roleName, schoolId, isActive } = body as Record<string, unknown>

    if (Object.hasOwn(body as Record<string, unknown>, 'tenantId')) {
      return json({ error: 'The URL segment addresses the tenant.' }, 409)
    }
    if (Object.hasOwn(body as Record<string, unknown>, 'userId')) {
      return json({ error: 'The URL segment addresses the user.' }, 409)
    }

    const updateData: { name?: string | null; roleName?: string; schoolId?: string | null; isActive?: boolean } = {}
    if (name !== undefined) updateData.name = typeof name === 'string' ? name : null
    if (roleName !== undefined) updateData.roleName = typeof roleName === 'string' ? roleName : ''
    if (schoolId !== undefined) updateData.schoolId = typeof schoolId === 'string' ? schoolId : null
    if (isActive !== undefined) updateData.isActive = typeof isActive === 'boolean' ? isActive : false

    if (Object.keys(updateData).length === 0) {
      return json({ error: 'Nothing to update.' }, 400)
    }

    if (schoolId !== undefined && typeof schoolId === 'string' && schoolId.length > 0) {
      const school = await prisma.school.findFirst({ where: { id: schoolId, tenantId }, select: { id: true } })
      if (!school) return json({ error: 'School not found in this tenant.' }, 400)
    }

    const result = await updateUserInTenant(tenantId, userId, updateData, mutationContext(context, request))
    if (!result) return json({ error: 'User not found in this tenant.' }, 404)

    return json(result.user, 200)
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; userId: string }> },
): Promise<Response> {
  try {
    const context = await requireCapability('tenant:user:update')
    const { tenantId, userId } = await params
    await requireTenantScope(tenantId)

    const result = await deactivateUserInTenant(tenantId, userId, mutationContext(context, request))
    if (!result) return json({ error: 'User not found in this tenant.' }, 404)

    return new Response(null, { status: 204 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
