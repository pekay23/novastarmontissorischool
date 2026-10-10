import type { Prisma } from '@prisma/client'
import { scopeFor, type PermissionScope } from '@novastar/shared-types'
import { prisma } from '@/lib/prisma'
import type { TenantContext } from '@/lib/tenant'

/**
 * Row-level visibility.
 *
 * `hasPermission` answers "may this caller perform this action at all". It does
 * not answer "which rows". Those are separate questions and the codebase
 * previously conflated them: `PARENT` holds `student:read`, so gating
 * `GET /api/students` on that key alone would still have returned the entire
 * school roster. This module turns the permission's scope into a concrete
 * Prisma filter so every guarded read is narrowed as well as permitted.
 */

export interface Visibility {
  /** Effective scope for the requested permission, after role narrowing. */
  scope: PermissionScope
  /**
   * Class ids the caller may act within, or `null` when the scope does not
   * restrict by class. An empty array means "no classes" and must match
   * nothing — callers must not treat it as `null`.
   */
  classIds: string[] | null
  /** The caller's `Parent.id` when they have one. */
  parentId: string | null
  /** The caller's `Staff.id` when they have one. */
  staffId: string | null
}

const UNRESTRICTED: Visibility = {
  scope: 'all',
  classIds: null,
  parentId: null,
  staffId: null,
}

export function unrestrictedVisibility(scope: PermissionScope = 'all'): Visibility {
  return { ...UNRESTRICTED, scope }
}

/**
 * Resolve the caller's row-level reach for one permission key.
 *
 * A taker or teacher identity that is missing from the database resolves to an
 * empty `classIds`/`parentId` rather than falling back to `null`, so a broken
 * identity link can never widen access.
 */
export async function resolveVisibility(
  ctx: Pick<TenantContext, 'tenantId' | 'schoolId' | 'userId' | 'role'>,
  permissionKey: string,
): Promise<Visibility> {
  const scope = scopeFor(ctx.role, permissionKey)
  if (scope === 'all') return unrestrictedVisibility(scope)

  const [staff, parent] = await Promise.all([
    prisma.staff.findFirst({
      where: { tenantId: ctx.tenantId, userId: ctx.userId },
      select: { id: true },
    }),
    prisma.parent.findFirst({
      where: { tenantId: ctx.tenantId, userId: ctx.userId },
      select: { id: true },
    }),
  ])

  const staffId = staff?.id ?? null
  const parentId = parent?.id ?? null

  if (scope === 'own') {
    // No parent link means the caller owns nothing, not everything.
    return { scope, classIds: [], parentId, staffId }
  }

  if (scope === 'class' || scope === 'department') {
    if (!staffId) return { scope, classIds: [], parentId, staffId }
    const [asClassTeacher, asSubjectTeacher] = await Promise.all([
      prisma.class.findMany({
        where: { tenantId: ctx.tenantId, classTeacherId: staffId },
        select: { id: true },
      }),
      prisma.classSubject.findMany({
        where: { tenantId: ctx.tenantId, teacherId: staffId },
        select: { classId: true },
      }),
    ])
    const classIds = [
      ...asClassTeacher.map((c) => c.id),
      ...asSubjectTeacher.map((cs) => cs.classId),
    ]
    return { scope, classIds: [...new Set(classIds)], parentId, staffId }
  }

  // `custom` and `department` without a defined policy deny by default.
  return { scope: 'custom', classIds: [], parentId, staffId }
}

/**
 * `true` when the caller holds the permission but the scope resolves to nothing
 * they can see. Callers should return 403 rather than an empty list so a
 * misconfigured assignment is not mistaken for "no data".
 */
export function visibilityDeniesAll(visibility: Visibility): boolean {
  if (visibility.scope === 'all') return false
  if (visibility.scope === 'own') return visibility.parentId === null
  return visibility.classIds !== null && visibility.classIds.length === 0
}

// ---------------------------------------------------------------------------
// Where-clause builders
// ---------------------------------------------------------------------------

/** Restriction for `Student` queries. */
export function studentVisibilityWhere(visibility: Visibility): Prisma.StudentWhereInput {
  switch (visibility.scope) {
    case 'own':
      return { parentId: visibility.parentId ?? '__no-parent__' }
    case 'class':
    case 'department':
      return {
        enrollments: {
          some: { classId: { in: visibility.classIds ?? [] } },
        },
      }
    default:
      return {}
  }
}

/** Restriction for `Class` queries. */
export function classVisibilityWhere(visibility: Visibility): Prisma.ClassWhereInput {
  switch (visibility.scope) {
    case 'class':
    case 'department':
      return { id: { in: visibility.classIds ?? [] } }
    case 'own':
      // A parent can see the class their child is enrolled in.
      return {
        students: {
          some: { parentId: visibility.parentId ?? '__no-parent__' },
        },
      }
    default:
      return {}
  }
}

/** Restriction for `AttendanceStudent` queries. */
export function attendanceVisibilityWhere(
  visibility: Visibility,
): Prisma.AttendanceStudentWhereInput {
  switch (visibility.scope) {
    case 'class':
    case 'department':
      return { classId: { in: visibility.classIds ?? [] } }
    case 'own':
      return { student: { parentId: visibility.parentId ?? '__no-parent__' } }
    default:
      return {}
  }
}

/** Restriction for `Assessment` queries, which hang off `ClassSubject`. */
export function assessmentVisibilityWhere(
  visibility: Visibility,
): Prisma.AssessmentWhereInput {
  switch (visibility.scope) {
    case 'class':
    case 'department':
      return { classSubject: { classId: { in: visibility.classIds ?? [] } } }
    case 'own':
      return { scores: { some: { student: { parentId: visibility.parentId ?? '__no-parent__' } } } }
    default:
      return {}
  }
}

/** Restriction for `Enrollment` queries. */
export function enrollmentVisibilityWhere(visibility: Visibility): Prisma.EnrollmentWhereInput {
  switch (visibility.scope) {
    case 'own':
      return { student: { parentId: visibility.parentId ?? '__no-parent__' } }
    case 'class':
    case 'department':
      return { classId: { in: visibility.classIds ?? [] } }
    default:
      return {}
  }
}

/**
 * Restriction for `Staff` queries.
 *
 * A classroom teacher may read themselves plus the colleagues who teach their
 * own classes. Nobody below head-of-school level can read the full directory.
 */
export async function staffVisibilityWhere(
  tenantId: string,
  visibility: Visibility,
): Promise<Prisma.StaffWhereInput> {
  if (visibility.scope !== 'class' && visibility.scope !== 'department') return {}
  if (!visibility.staffId) return { id: '__no-staff__' }

  const classIds = visibility.classIds ?? []
  if (classIds.length === 0) return { id: visibility.staffId }

  const classes = await prisma.class.findMany({
    where: { tenantId, id: { in: classIds } },
    select: { classTeacherId: true, subjects: { where: { tenantId }, select: { teacherId: true } } },
  })

  const colleagueIds = classes.flatMap((c) => [
    c.classTeacherId,
    ...c.subjects.map((s) => s.teacherId),
  ])
  const ids = new Set<string>([visibility.staffId])
  for (const id of colleagueIds) if (id) ids.add(id)
  return { id: { in: [...ids] } }
}