/**
 * Base service layer for all domain services.
 *
 * Provides per-request tenant isolation, transaction support, and audit
 * logging — the three primitives that API routes were previously
 * re-implementing (poorly) on every endpoint.
 *
 * Each domain service (FinanceService, PeopleService, etc.) extends
 * BaseService and focuses on business invariants, not boilerplate.
 */

import { prisma, type Prisma, type PrismaClient } from '@novastar/database'

export { prisma, type Prisma, type PrismaClient }

/**
 * Minimal context required by every domain service.
 * Structurally compatible with TenantContext from the portal app.
 */
export interface ServiceContext {
  tenantId: string
  schoolId: string | null
  userId: string
  role: string | null
}

export abstract class BaseService {
  protected readonly ctx: ServiceContext
  protected readonly prisma: PrismaClient

  constructor(ctx: ServiceContext) {
    this.ctx = ctx
    this.prisma = prisma
  }

  /**
   * Returns `{ tenantId, schoolId }` for school-scoped queries.
   * Throws if the user has no school assigned — fail-closed.
   */
  protected schoolScope(): { tenantId: string; schoolId: string } {
    if (!this.ctx.schoolId) {
      throw new Error('No school assigned to user')
    }
    return {
      tenantId: this.ctx.tenantId,
      schoolId: this.ctx.schoolId,
    }
  }

  /**
   * Returns `{ tenantId }` for tenant-level queries
   * (e.g., grading scales, role definitions).
   */
  protected tenantScope(): { tenantId: string } {
    return {
      tenantId: this.ctx.tenantId,
    }
  }

  /**
   * Run a callback inside a Prisma transaction.
   * All DB operations in the callback share a single transaction.
   */
  protected async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction(fn)
  }

  /**
   * Write an audit log entry.
   * Includes old and new data for change tracking.
   */
  protected async audit(
    action: string,
    entity: string,
    entityId?: string,
    oldData?: Record<string, unknown>,
    newData?: Record<string, unknown>
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: this.ctx.tenantId,
        schoolId: this.ctx.schoolId ?? '',
        userId: this.ctx.userId,
        action,
        entity,
        entityId: entityId ?? undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column accepts any JSON-serialisable value
        oldData: oldData as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column accepts any JSON-serialisable value
        newData: newData as any,
      },
    })
  }
}
