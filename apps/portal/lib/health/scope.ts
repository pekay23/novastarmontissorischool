import 'server-only'

import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import {
  resolveVisibility,
  studentVisibilityWhere,
  visibilityDeniesAll,
} from '@/lib/visibility'

/**
 * The single gate for a child's health record.
 *
 * Three routes touch health data — read the declarations, write them, and
 * upload or fetch the medical officer's report — and each one needs the same
 * four checks in the same order. Inline them and the fourth copy drifts, which on
 * a permissions boundary is how a leak happens. So they live here.
 *
 * Two properties are load-bearing:
 *
 * 1. THE VISIBILITY FILTER IS PART OF THE LOOKUP. `findFirst` takes
 *    `studentVisibilityWhere(visibility)`, so a child the caller may not see is
 *    indistinguishable from one that does not exist — both 404. Checking the
 *    row first and returning 403 afterwards would confirm the id resolves to a
 *    real student, turning this route into an oracle for the roll.
 *
 * 2. THE PERMISSION PASSED IN IS THE ONE ENFORCED, INCLUDING ITS SCOPE. Both
 *    `hasPermission` and `resolveVisibility` receive the same key, so a role's
 *    narrowing in `ROLE_READ_SCOPE` applies. A parent holding
 *    `student:health:read` resolves to scope `own` and is filtered by parentId;
 *    a classroom teacher resolves to `class`. Passing `student:read` here
 *    instead would silently widen both to whatever that key's scope happens to
 *    be, which is the failure this indirection exists to make impossible.
 */

export const HEALTH_PERMISSIONS = [
  'student:health:read',
  'student:health:write',
  'document:health:upload',
  'document:health:read',
] as const

export type HealthPermission = (typeof HEALTH_PERMISSIONS)[number]

export interface HealthDenial {
  status: number
  error: string
}

export interface AuthorizedHealthAccess {
  student: {
    id: string
    tenantId: string
    schoolId: string
    firstName: string
    lastName: string
    parentId: string | null
  }
  tenantId: string
  schoolId: string
  userId: string
}

export async function authorizeHealthAccess(
  studentId: string,
  permission: HealthPermission,
): Promise<{ ok: true; access: AuthorizedHealthAccess } | { ok: false; denial: HealthDenial }> {
  const ctx = await getTenantContext()
  const { schoolId, tenantId, userId } = ctx
  if (!schoolId) return { ok: false, denial: { status: 400, error: 'No school assigned' } }

  if (!(await hasPermission(userId, permission, tenantId, schoolId))) {
    return { ok: false, denial: { status: 403, error: 'Forbidden' } }
  }

  const visibility = await resolveVisibility(ctx, permission)
  if (visibilityDeniesAll(visibility)) {
    return { ok: false, denial: { status: 403, error: 'Forbidden' } }
  }

  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId, tenantId, ...studentVisibilityWhere(visibility) },
    select: {
      id: true,
      tenantId: true,
      schoolId: true,
      firstName: true,
      lastName: true,
      parentId: true,
    },
  })
  if (!student) return { ok: false, denial: { status: 404, error: 'Student not found' } }

  return { ok: true, access: { student, tenantId, schoolId, userId } }
}