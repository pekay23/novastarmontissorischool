import 'server-only'
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Audit logging with hash chain — each entry's hash includes the previous
 * entry's hash, making the log tamper-evident.
 *
 * Adapted from Aerojet Academy's `lib/audit/logger.ts`.
 */

export enum AuditLogAction {
  // Auth events
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  TWO_FACTOR_ENABLED = 'TWO_FACTOR_ENABLED',
  TWO_FACTOR_DISABLED = 'TWO_FACTOR_DISABLED',
  PASSKEY_REGISTERED = 'PASSKEY_REGISTERED',
  PASSKEY_LOGIN = 'PASSKEY_LOGIN',
  // Generic CRUD
  CREATE = 'CREATE',
  // `READ`, not `SYSTEM_UPDATE`: a read that filed itself as an update asserted a
  // write that did not happen, and a reader filtering `action = SYSTEM_UPDATE` to
  // find changes saw reads in the answer. It is a member of its own rather than a
  // reading of an existing one because `SYSTEM` is spoken for — see the note there.
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  // Domain events
  PAYMENT_APPROVE = 'PAYMENT_APPROVE',
  PAYMENT_REJECT = 'PAYMENT_REJECT',
  USER_ROLE_CHANGED = 'USER_ROLE_CHANGED',
  USER_SUSPENDED = 'USER_SUSPENDED',
  USER_REACTIVATED = 'USER_REACTIVATED',
  IMPORT = 'IMPORT',
  // RESERVED for refusals. The config write routes give it exactly one meaning — "this
  // row is a refusal, and `changes.refused` says which check refused it" — and
  // `successRows()` in `tests/config-write-audit.test.ts` classifies on precisely that,
  // so anything that succeeded and is filed as `SYSTEM` becomes invisible to a reader
  // asking what happened. `READ` exists above so a read never has to borrow `SYSTEM`.
  SYSTEM = 'SYSTEM',
  SYSTEM_UPDATE = 'SYSTEM_UPDATE',
  ADMISSIONS_TOGGLE = 'ADMISSIONS_TOGGLE',
}

interface AuditLogParams {
  userId?: string
  action: string
  entity?: string
  entityId?: string
  description?: string
  changes?: Prisma.InputJsonValue
  ipAddress?: string
  userAgent?: string
  details?: Prisma.InputJsonValue
  tenantId?: string
  schoolId?: string
}

function computeHash(
  previousHash: string | null,
  action: string,
  entityId: string | undefined,
  changes: Prisma.InputJsonValue,
  timestamp: Date
): string {
  const data = [
    previousHash || '',
    action,
    entityId || '',
    JSON.stringify(changes || {}),
    timestamp.toISOString(),
  ].join('|')
  return crypto.createHash('sha256').update(data).digest('hex')
}

/**
 * Logs a system or user action to the audit_logs table.
 * Implements hash chain: each entry's hash includes the previous entry's hash.
 */
export async function logAuditEvent(params: AuditLogParams, tx?: Prisma.TransactionClient) {
  const client = tx || prisma
  try {
    const timestamp = new Date()

    // Resolve tenantId/schoolId from user if not explicitly provided. This runs
    // BEFORE the chain lookup because the chain is scoped by tenant — the previous
    // order asked for the previous hash first, which is what forced it to be global.
    let tenantId: string | undefined = params.tenantId
    let schoolId: string | undefined = params.schoolId
    if (!tenantId && params.userId) {
      const user = await prisma.user.findUnique({
        where: { id: params.userId },
        select: { tenantId: true, schoolId: true },
      })
      if (user) {
        tenantId = tenantId ?? user.tenantId
        schoolId = schoolId ?? user.schoolId ?? undefined
      }
    }

    // Fallback for system-level logs
    tenantId = tenantId ?? 'system'
    schoolId = schoolId ?? 'system'

    // Chain continuity is scoped to this tenant. The previous implementation asked
    // for the globally most recent entry, so every tenant's chain was threaded
    // through every other tenant's writes: a school could not verify its own log
    // without entries it has no right to see, and one tenant's audit write silently
    // became a link in another tenant's chain.
    const lastEntry = await prisma.auditLog.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, hash: true },
    })

    const previousHash = lastEntry?.hash ?? null
    const hash = computeHash(
      previousHash,
      params.action,
      params.entityId,
      params.changes ?? params.details ?? {},
      timestamp
    )

    const data: Prisma.AuditLogUncheckedCreateInput = {
      action: params.action,
      entity: params.entity ?? 'system',
      tenantId,
      schoolId,
      previousHash: previousHash || undefined,
      hash,
    }

    if (params.userId) data.userId = params.userId
    if (params.entityId) data.entityId = params.entityId
    if (params.description) data.description = params.description
    else if (params.details) data.description = JSON.stringify(params.details)

    const changesData = params.changes || params.details || {}
    if (changesData) data.newData = changesData as Prisma.InputJsonValue
    if (params.ipAddress) data.ipAddress = params.ipAddress
    if (params.userAgent) data.userAgent = params.userAgent

    return await client.auditLog.create({ data })
  } catch (error) {
    // We don't want to crash the main process if logging fails
    console.error('[AUDIT_LOG_ERROR]', error)
    return null
  }
}

/** Alias for legacy compatibility. */
export const createAuditLog = logAuditEvent

/**
 * Fetches audit logs with filtering and pagination.
 */
export async function queryAuditLogs(params: {
  action?: string
  entity?: string
  userId?: string
  startDate?: Date
  endDate?: Date
  limit: number
  offset: number
}) {
  const where: Prisma.AuditLogWhereInput = {}
  if (params.action) where.action = params.action
  if (params.entity) where.entity = params.entity
  if (params.userId) where.userId = params.userId
  if (params.startDate || params.endDate) {
    where.createdAt = {
      ...(params.startDate && { gte: params.startDate }),
      ...(params.endDate && { lte: params.endDate }),
    }
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      take: params.limit,
      skip: params.offset,
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    }),
    prisma.auditLog.count({ where }),
  ])

  return { logs, total }
}
