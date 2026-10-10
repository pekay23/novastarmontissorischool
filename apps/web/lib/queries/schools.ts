import type { Prisma } from '@novastar/database'
import type { SchoolSummary } from '@/types/admin'
import { prisma } from '@/lib/prisma'
import {
  SCHOOL_SELECT,
  PLATFORM_AUDIT_SCOPE,
  appendAudit,
  assertTenantIsActive,
  type TenantMutationContext,
} from './tenants'

// ---------------------------------------------------------------------------
// School mutations within a tenant
// ---------------------------------------------------------------------------

export async function createSchoolInTenant(
  tenantId: string,
  data: {
    name: string
    code: string
    address: string
    phone: string
    email: string
    established: Date
    motto?: string | null
    logoUrl?: string | null
  },
  context: TenantMutationContext,
): Promise<SchoolSummary> {
  const school = await prisma.$transaction(async (tx) => {
    await assertTenantIsActive(tenantId)

    const created = await tx.school.create({
      data: {
        tenantId,
        name: data.name,
        code: data.code,
        address: data.address,
        phone: data.phone,
        email: data.email,
        established: data.established,
        motto: data.motto ?? null,
        logoUrl: data.logoUrl ?? null,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        code: true,
        email: true,
        phone: true,
        address: true,
        motto: true,
        established: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    await appendAudit(tx, {
      tenantId,
      schoolId: created.id,
      userId: null,
      operatorId: context.operatorId,
      action: 'TENANT_SCHOOL_CREATE',
      entity: 'school',
      entityId: created.id,
      description: `School "${created.name}" created in tenant ${tenantId} by ${context.operatorEmail}`,
      changes: { name: created.name, code: created.code },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    return created
  })

  return {
    id: school.id,
    tenantId: school.tenantId,
    name: school.name,
    code: school.code,
    email: school.email,
    phone: school.phone,
    address: school.address,
    motto: school.motto,
    established: school.established.toISOString(),
    createdAt: school.createdAt.toISOString(),
    updatedAt: school.updatedAt.toISOString(),
  }
}

export async function updateSchoolInTenant(
  tenantId: string,
  schoolId: string,
  data: {
    name?: string
    code?: string
    address?: string
    phone?: string
    email?: string
    established?: Date
    motto?: string | null
    logoUrl?: string | null
  },
  context: TenantMutationContext,
): Promise<{ school: SchoolSummary; previous: Record<string, unknown> } | null> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.school.findFirst({
      where: { id: schoolId, tenantId },
      select: {
        id: true,
        name: true,
        code: true,
        email: true,
        phone: true,
        address: true,
        motto: true,
        established: true,
      },
    })
    if (!before) return null

    const updated = await tx.school.update({
      where: { id: schoolId },
      data,
      select: {
        id: true,
        tenantId: true,
        name: true,
        code: true,
        email: true,
        phone: true,
        address: true,
        motto: true,
        established: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    await appendAudit(tx, {
      tenantId,
      schoolId: updated.id,
      userId: null,
      operatorId: context.operatorId,
      action: 'TENANT_SCHOOL_UPDATE',
      entity: 'school',
      entityId: updated.id,
      description: `School "${updated.name}" updated by ${context.operatorEmail}`,
      changes: { from: before, to: updated },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    return {
      school: {
        id: updated.id,
        tenantId: updated.tenantId,
        name: updated.name,
        code: updated.code,
        email: updated.email,
        phone: updated.phone,
        address: updated.address,
        motto: updated.motto,
        established: updated.established.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      previous: { ...before, established: before.established.toISOString() },
    }
  })
}

export async function deleteSchoolInTenant(
  tenantId: string,
  schoolId: string,
  context: TenantMutationContext,
): Promise<{ deleted: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.school.findFirst({
      where: { id: schoolId, tenantId },
      select: { id: true, name: true },
    })
    if (!before) return null

    const [studentCount, staffCount] = await Promise.all([
      tx.student.count({ where: { tenantId, schoolId } }),
      tx.staff.count({ where: { tenantId, schoolId } }),
    ])
    if (studentCount > 0 || staffCount > 0) {
      throw new Error(
        `Cannot delete school "${before.name}": ${studentCount} student(s) and ${staffCount} staff member(s) are assigned. Remove them first.`,
      )
    }

    await tx.school.delete({ where: { id: schoolId, tenantId } })

    await appendAudit(tx, {
      tenantId,
      schoolId: PLATFORM_AUDIT_SCOPE,
      userId: null,
      operatorId: context.operatorId,
      action: 'TENANT_SCHOOL_DELETE',
      entity: 'school',
      entityId: schoolId,
      description: `School "${before.name}" deleted from tenant ${tenantId} by ${context.operatorEmail}`,
      changes: { name: before.name },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    return { deleted: true }
  })
}