import type { Prisma } from '@novastar/database'
import type { TenantUserSummary } from '@/types/admin'
import { prisma } from '@/lib/prisma'
import { TENANT_USER_SELECT, PLATFORM_AUDIT_SCOPE, appendAudit, iso, assertTenantIsActive, type TenantMutationContext } from './tenants'

// ---------------------------------------------------------------------------
// User mutations within a tenant
// ---------------------------------------------------------------------------

export interface UpdateUserInTenantData {
  name?: string | null
  roleName?: string
  schoolId?: string | null
  isActive?: boolean
}

export async function updateUserInTenant(
  tenantId: string,
  userId: string,
  data: UpdateUserInTenantData,
  context: TenantMutationContext,
): Promise<{ user: TenantUserSummary; previous: Record<string, unknown> } | null> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        schoolId: true,
        status: true,
        isActive: true,
        mustChangePassword: true,
        role: { select: { name: true } },
      },
    })
    if (!before) return null

    const updateData: Record<string, unknown> = {}
    const previous: Record<string, unknown> = {}

    if (data.name !== undefined) {
      updateData.name = data.name
      previous.name = before.name
    }
    if (data.schoolId !== undefined) {
      updateData.schoolId = data.schoolId
      previous.schoolId = before.schoolId
    }
    if (data.isActive !== undefined) {
      updateData.isActive = data.isActive
      previous.isActive = before.isActive
    }
    if (data.roleName !== undefined) {
      const role = await tx.role.findFirst({
        where: { tenantId, name: data.roleName },
        select: { id: true },
      })
      if (!role) throw new Error(`Role "${data.roleName}" not found in tenant ${tenantId}`)
      updateData.roleId = role.id
      previous.roleName = before.role?.name ?? null
    }

    const updated = await tx.user.update({
      where: { id: userId, tenantId },
      data: updateData,
      select: {
        id: true,
        tenantId: true,
        schoolId: true,
        email: true,
        name: true,
        mustChangePassword: true,
        role: { select: { name: true } },
        status: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    })

    await appendAudit(tx, {
      tenantId,
      schoolId: PLATFORM_AUDIT_SCOPE,
      userId: updated.id,
      operatorId: context.operatorId,
      action: 'TENANT_USER_UPDATE',
      entity: 'user',
      entityId: updated.id,
      description: `User ${updated.email} updated by ${context.operatorEmail}`,
      changes: previous,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    return {
      user: {
        id: updated.id,
        tenantId: updated.tenantId,
        schoolId: updated.schoolId,
        email: updated.email,
        name: updated.name,
        mustChangePassword: updated.mustChangePassword,
        roleName: updated.role?.name ?? null,
        status: updated.status,
        isActive: updated.isActive,
        lastLoginAt: iso(updated.lastLoginAt),
        createdAt: updated.createdAt.toISOString(),
      },
      previous,
    }
  })
}

export async function deactivateUserInTenant(
  tenantId: string,
  userId: string,
  context: TenantMutationContext,
): Promise<{ user: TenantUserSummary; previous: Record<string, unknown> } | null> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, email: true, isActive: true, status: true, mustChangePassword: true },
    })
    if (!before) return null

    const updated = await tx.user.update({
      where: { id: userId, tenantId },
      data: { isActive: false, status: 'SUSPENDED' },
      select: {
        id: true,
        tenantId: true,
        schoolId: true,
        email: true,
        name: true,
        mustChangePassword: true,
        role: { select: { name: true } },
        status: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    })

    await appendAudit(tx, {
      tenantId,
      schoolId: PLATFORM_AUDIT_SCOPE,
      userId: updated.id,
      operatorId: context.operatorId,
      action: 'TENANT_USER_DEACTIVATE',
      entity: 'user',
      entityId: updated.id,
      description: `User ${updated.email} deactivated by ${context.operatorEmail}`,
      changes: { from: { isActive: before.isActive, status: before.status }, to: { isActive: false, status: 'SUSPENDED' } },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    return {
      user: {
        id: updated.id,
        tenantId: updated.tenantId,
        schoolId: updated.schoolId,
        email: updated.email,
        name: updated.name,
        mustChangePassword: updated.mustChangePassword,
        roleName: updated.role?.name ?? null,
        status: updated.status,
        isActive: updated.isActive,
        lastLoginAt: iso(updated.lastLoginAt),
        createdAt: updated.createdAt.toISOString(),
      },
      previous: { isActive: before.isActive, status: before.status },
    }
  })
}

export async function reactivateUserInTenant(
  tenantId: string,
  userId: string,
  context: TenantMutationContext,
): Promise<{ user: TenantUserSummary; previous: Record<string, unknown> } | null> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, email: true, isActive: true, status: true, mustChangePassword: true },
    })
    if (!before) return null

    const updated = await tx.user.update({
      where: { id: userId, tenantId },
      data: { isActive: true, status: 'ACTIVE' },
      select: {
        id: true,
        tenantId: true,
        schoolId: true,
        email: true,
        name: true,
        mustChangePassword: true,
        role: { select: { name: true } },
        status: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    })

    await appendAudit(tx, {
      tenantId,
      schoolId: PLATFORM_AUDIT_SCOPE,
      userId: updated.id,
      operatorId: context.operatorId,
      action: 'TENANT_USER_REACTIVATE',
      entity: 'user',
      entityId: updated.id,
      description: `User ${updated.email} reactivated by ${context.operatorEmail}`,
      changes: { from: { isActive: before.isActive, status: before.status }, to: { isActive: true, status: 'ACTIVE' } },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    return {
      user: {
        id: updated.id,
        tenantId: updated.tenantId,
        schoolId: updated.schoolId,
        email: updated.email,
        name: updated.name,
        mustChangePassword: updated.mustChangePassword,
        roleName: updated.role?.name ?? null,
        status: updated.status,
        isActive: updated.isActive,
        lastLoginAt: iso(updated.lastLoginAt),
        createdAt: updated.createdAt.toISOString(),
      },
      previous: { isActive: before.isActive, status: before.status },
    }
  })
}