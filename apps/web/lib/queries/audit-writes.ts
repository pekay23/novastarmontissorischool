import { createHash } from 'node:crypto'
import type { Prisma } from '@novastar/database'
import type { AuditEntrySummary, Paged, PaginationQuery } from '@/types/admin'
import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export const AUDIT_SELECT = {
  id: true,
  tenantId: true,
  schoolId: true,
  userId: true,
  // Present so a console action reads as attributable in this console's own audit
  // view. `userId` stays alongside it rather than being replaced: a tenant action
  // has a user and no operator, and a console action has an operator and no user.
  operatorId: true,
  action: true,
  entity: true,
  entityId: true,
  description: true,
  createdAt: true,
} as const

type AuditRow = {
  id: string
  tenantId: string
  schoolId: string
  userId: string | null
  operatorId: string | null
  action: string
  entity: string
  entityId: string | null
  description: string | null
  createdAt: Date
}

export function toAuditEntry(row: AuditRow): AuditEntrySummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    schoolId: row.schoolId,
    userId: row.userId,
    operatorId: row.operatorId,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  }
}

export function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

export function pageOf<T>(rows: T[], total: number, page: PaginationQuery): Paged<T> {
  return {
    data: rows,
    meta: { total, take: page.take, skip: page.skip, hasMore: page.skip + rows.length < total },
  }
}

/**
 * The `tenantId`/`schoolId` written on an entry that is about the platform
 * rather than about any school — an operator signing in, or signing out.
 *
 * `AuditLog.tenantId` and `AuditLog.schoolId` are plain `String` columns with no
 * referential integrity (only `userId` is a relation), so a sentinel is
 * storable. It matches the portal's own `'system'` fallback in
 * `apps/portal/lib/audit/logger.ts:89-90`, so an operator reading the same table
 * from either app sees one vocabulary rather than two.
 */
export const PLATFORM_AUDIT_SCOPE = 'platform'

export interface AuditWrite {
  readonly tenantId: string
  readonly schoolId: string
  readonly userId?: string | null
  /**
   * The platform operator the entry is attributable to.
   *
   * A sibling of `userId` and not a replacement. A console action has no `User` —
   * the operator belongs to no tenant — so before this column every console entry
   * was written with `userId: null` and the trail could say what happened but never
   * who did it. Pointing `userId` at the nearest school administrator would be
   * worse than null: it would name a tenant member who did not perform the action.
   */
  readonly operatorId?: string | null
  readonly action: string
  readonly entity: string
  readonly entityId?: string | null
  readonly description?: string | null
  readonly changes?: Record<string, unknown>
  readonly ipAddress?: string | null
  readonly userAgent?: string | null
}

/** Either the pooled client or a transaction. Reads and writes accept both. */
type Db = Prisma.TransactionClient | typeof prisma

/**
 * Appends one tamper-evident audit entry on an existing transaction.
 *
 * The hash chain is per-tenant. Each tenant has its own independent chain,
 * so a compromise in one tenant's chain does not affect others. The head read
 * is scoped to the tenant the write is for.
 */
export async function appendAudit(db: Db, entry: AuditWrite): Promise<void> {
  // PER-TENANT: the audit hash chain is per-tenant, so its head is the last
  // entry for this tenant only.
  const head = await db.auditLog.findFirst({
    where: { tenantId: entry.tenantId },
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  })
  const previousHash = head?.hash ?? null
  const createdAt = new Date()

  await db.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      schoolId: entry.schoolId,
      userId: entry.userId ?? null,
      operatorId: entry.operatorId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      description: entry.description ?? null,
      newData: (entry.changes ?? {}) as Prisma.InputJsonValue,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      previousHash,
      hash: computeAuditHash(previousHash, entry.tenantId, entry.action, entry.entityId ?? null, entry.changes ?? {}, createdAt),
      createdAt,
    },
  })
}

/**
 * Appends one audit entry in its own transaction.
 *
 * Used only for events that have no accompanying mutation — signing in, signing
 * out, a refused attempt. A mutation's entry is written by that mutation's
 * transaction instead.
 */
export async function writeAuditEntry(entry: AuditWrite): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await appendAudit(tx, entry)
  })
}

function computeAuditHash(
  previousHash: string | null,
  tenantId: string,
  action: string,
  entityId: string | null,
  changes: Record<string, unknown>,
  timestamp: Date,
): string {
  // The same input tuple as `apps/portal/lib/audit/logger.ts:52-67`, so an
  // auditor verifying an entry with either app's code gets the same answer.
  const data = [
    previousHash ?? '',
    tenantId,
    action,
    entityId ?? '',
    JSON.stringify(changes ?? {}),
    timestamp.toISOString(),
  ].join('|')
  return createHash('sha256').update(data).digest('hex')
}