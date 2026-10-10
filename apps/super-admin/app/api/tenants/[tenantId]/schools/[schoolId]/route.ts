import type { NextRequest } from 'next/server'
import { requireCapability, requireTenantScope } from '@/lib/admin-context'
import { RequestError, toErrorResponse } from '@/lib/errors'
import { json, mutationContext } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { updateSchoolInTenant, deleteSchoolInTenant } from '@/lib/queries'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; schoolId: string }> },
): Promise<Response> {
  try {
    const context = await requireCapability('tenant:school:update')
    const { tenantId, schoolId } = await params
    await requireTenantScope(tenantId)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Invalid request body' }, 400)
    }

    const { name, code, address, phone, email, established, motto, logoUrl } = body as Record<string, unknown>

    const updateData: Record<string, unknown> = {}
    if (name !== undefined && typeof name === 'string') updateData.name = name
    if (address !== undefined && typeof address === 'string') updateData.address = address
    if (phone !== undefined && typeof phone === 'string') updateData.phone = phone
    if (email !== undefined && typeof email === 'string') updateData.email = email
    if (motto !== undefined) updateData.motto = typeof motto === 'string' ? motto : null
    if (logoUrl !== undefined) updateData.logoUrl = typeof logoUrl === 'string' ? logoUrl : null

    if (code !== undefined && typeof code === 'string') {
      const existing = await prisma.school.findFirst({ where: { tenantId, code, NOT: { id: schoolId } }, select: { id: true } })
      if (existing) return json({ error: 'A school with this code already exists in this tenant.' }, 409)
      updateData.code = code
    }

    if (established !== undefined) {
      const date = typeof established === 'string' || typeof established === 'number'
        ? new Date(established)
        : established instanceof Date
          ? established
          : null
      if (!date || isNaN(date.getTime())) return json({ error: 'established must be a valid date.' }, 400)
      updateData.established = date
    }

    if (Object.keys(updateData).length === 0) {
      return json({ error: 'Nothing to update.' }, 400)
    }

    const result = await updateSchoolInTenant(tenantId, schoolId, updateData, mutationContext(context, request))
    if (!result) return json({ error: 'School not found in this tenant.' }, 404)

    return json(result.school, 200)
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; schoolId: string }> },
): Promise<Response> {
  try {
    const context = await requireCapability('tenant:school:delete')
    const { tenantId, schoolId } = await params
    await requireTenantScope(tenantId)

    const result = await deleteSchoolInTenant(tenantId, schoolId, mutationContext(context, request))
    if (!result) return json({ error: 'School not found in this tenant.' }, 404)

    return new Response(null, { status: 204 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
