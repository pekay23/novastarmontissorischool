import 'server-only'
import { Prisma } from '@novastar/database'
import { logError } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { appendAuditChain } from '@novastar/auth'

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

/**
 * Logs a system or user action to the audit_logs table.
 * Implements hash chain: each entry's hash includes the previous entry's hash.
 *
 * Delegates to the shared `appendAuditChain` in `@novastar/auth`, which resolves
 * tenant/school from the user, reads the previous entry's hash scoped to this
 * tenant, and computes the new hash. The `client` (transaction-aware) parameter
 * is passed through so writes inside a transaction participate in the chain.
 */
export async function logAuditEvent(params: AuditLogParams, tx?: Prisma.TransactionClient) {
  const client = tx || prisma
  try {
    const chainData = await appendAuditChain(client, {
      tenantId: params.tenantId,
      schoolId: params.schoolId,
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      changes: params.changes,
      details: params.details,
      description: params.description,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    })
    return await client.auditLog.create({ data: chainData })
  } catch (error) {
    logError('[AUDIT_LOG_ERROR]', error)
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
