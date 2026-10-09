import type { NextRequest } from 'next/server'
import { requireCapability, requireTenantScope } from '@/lib/admin-context'
import { toErrorResponse } from '@/lib/errors'
import { json, mutationContext } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { createSchoolInTenant } from '@/lib/queries'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  try {
    const context = await requireCapability('tenant:school:create')
    const { tenantId } = await params
    await requireTenantScope(tenantId)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Invalid request body' }, 400)
    }

    const { name, code, address, phone, email, established, motto, logoUrl } = body as Record<string, unknown>

    if (!name || typeof name !== 'string') return json({ error: 'name is required.' }, 400)
    if (!code || typeof code !== 'string') return json({ error: 'code is required.' }, 400)
    if (!address || typeof address !== 'string') return json({ error: 'address is required.' }, 400)
    if (!phone || typeof phone !== 'string') return json({ error: 'phone is required.' }, 400)
    if (!email || typeof email !== 'string') return json({ error: 'email is required.' }, 400)
    if (!established) return json({ error: 'established is required.' }, 400)

    const establishedDate = typeof established === 'string' || typeof established === 'number'
      ? new Date(established)
      : established instanceof Date
        ? established
        : null
    if (!establishedDate || isNaN(establishedDate.getTime())) {
      return json({ error: 'established must be a valid date.' }, 400)
    }

    const existing = await prisma.school.findFirst({ where: { tenantId, code }, select: { id: true } })
    if (existing) return json({ error: 'A school with this code already exists in this tenant.' }, 409)

    const school = await createSchoolInTenant(tenantId, {
      name,
      code,
      address,
      phone,
      email,
      established: establishedDate,
      motto: typeof motto === 'string' ? motto : null,
      logoUrl: typeof logoUrl === 'string' ? logoUrl : null,
    }, mutationContext(context, request))

    return json(school, 201)
  } catch (error) {
    return toErrorResponse(error)
  }
}
