import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { z } from 'zod'
import { logError } from '@/lib/logger'

/**
 * Admin API for the attendance-taker grant matrix
 * (`/settings/attendance-takers`).
 *
 * `AttendanceTaker` decides who may mark attendance for
 * which class — its compound key is
 * `(tenantId, schoolId, classId, staffId)`, with `classId`
 * null meaning the school-wide grant. It was previously
 * reachable only through the generic entity CRUD, which is
 * the wrong UI for a grant matrix; this route backs the
 * matrix page, where rows are staff and columns are classes.
 *
 * Gated on `config:write` — the same key the generic config
 * CRUD (`/api/config/[entityType]`) writes with — so only
 * roles holding `system` category permissions (the seeded
 * Head of School) can change who may mark attendance.
 */

const GRANT_SCHEMA = z.object({
  staffId: z.string().min(1),
  classId: z.string().nullable(),
  canMarkStudent: z.boolean(),
  canMarkStaff: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

const RELEASE_SCHEMA = z.object({
  staffId: z.string().min(1),
  classId: z.string().nullable(),
})

/**
 * The Neon adapter turns every statement into a network round trip,
 * so an unbounded interactive transaction holds a pooled connection
 * — and this request — open for however long the database feels
 * like answering.
 */
const GRANT_TRANSACTION_BOUNDS = { maxWait: 2_000, timeout: 30_000 } as const

export async function GET(req: NextRequest) {
  try {
    const { tenantId, schoolId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    if (!(await hasPermission(userId, 'config:write', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [staff, classes, grants] = await Promise.all([
      prisma.staff.findMany({
        where: { tenantId, schoolId },
        select: { id: true, firstName: true, lastName: true, employeeId: true },
        orderBy: { lastName: 'asc' },
      }),
      prisma.class.findMany({
        where: { tenantId, schoolId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.attendanceTaker.findMany({
        where: { tenantId, schoolId },
        select: {
          staffId: true,
          classId: true,
          canMarkStudent: true,
          canMarkStaff: true,
          isActive: true,
        },
      }),
    ])

    return NextResponse.json({ staff, classes, grants })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logError('AttendanceTakers GET', error)
    return NextResponse.json({ error: 'Failed to fetch attendance takers' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tenantId, schoolId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    if (!(await hasPermission(userId, 'config:write', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = GRANT_SCHEMA.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 })
    }
    const { staffId, classId, canMarkStudent } = parsed.data

    // Read-modify-write in one transaction. A blind `upsert` on the
    // compound unique cannot be used here: `classId` is part of the
    // key and nullable, so the update branch is keyed on the row this
    // read found (the same pattern as the attendance write path).
    const grant = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.attendanceTaker.findFirst({
          where: { tenantId, schoolId, staffId, classId },
        })
        if (existing) {
          return tx.attendanceTaker.update({
            where: { id: existing.id },
            data: {
              canMarkStudent,
              ...(parsed.data.canMarkStaff !== undefined
                ? { canMarkStaff: parsed.data.canMarkStaff }
                : {}),
              ...(parsed.data.isActive !== undefined
                ? { isActive: parsed.data.isActive }
                : {}),
            },
          })
        }
        return tx.attendanceTaker.create({
          data: {
            tenantId,
            schoolId,
            staffId,
            classId,
            canMarkStudent,
            canMarkStaff: parsed.data.canMarkStaff ?? false,
            isActive: parsed.data.isActive ?? true,
          },
        })
      },
      GRANT_TRANSACTION_BOUNDS,
    )

    return NextResponse.json(grant)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('AttendanceTakers POST', error)
    return NextResponse.json({ error: 'Failed to save attendance taker grant' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { tenantId, schoolId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    if (!(await hasPermission(userId, 'config:write', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = RELEASE_SCHEMA.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 })
    }
    const { staffId, classId } = parsed.data

    // `deleteMany`, not `delete`: the compound unique includes the
    // nullable `classId`, and PostgreSQL treats every NULL as
    // distinct, so more than one school-wide (`classId: null`) row
    // for the same staff member can exist. Every copy must go.
    const result = await prisma.attendanceTaker.deleteMany({
      where: { tenantId, schoolId, staffId, classId },
    })

    return NextResponse.json({ deleted: result.count })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('AttendanceTakers DELETE', error)
    return NextResponse.json({ error: 'Failed to remove attendance taker grant' }, { status: 500 })
  }
}
