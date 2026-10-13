import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { z } from 'zod'
import { logError } from '@/lib/logger'
import { FinanceService } from '@novastar/domain'
import { sendPaymentReceipt } from '@novastar/payments'

/**
 * Reconcile a recorded bank-transfer payment.
 *
 * Bank transfer has no instant verification channel: the confirmation is a
 * human matching a line on the bank statement to the recorded payment. This
 * route is that confirmation, and it routes it through the SAME domain
 * transition `settlePayment` uses for provider-verified payments — the balance
 * moves once, atomically, with the audit trail to say who confirmed it. A
 * reconciliation without a matching PENDING row is refused rather than
 * silently marking something paid.
 *
 * `reconcilePayments` in `@novastar/payments` remains the bulk path for a
 * settlement file; this is the per-payment surface an operator reaches from the
 * portal.
 */
const ReconcileSchema = z.object({
  reference: z.string().min(1),
  /** The bank's own reference for the line, recorded on the payment row. */
  statementReference: z.string().min(1).max(120),
})

/** Method codes settled by operator reconciliation rather than a provider call. */
const MANUAL_METHODS = new Set(['bank-transfer', 'BANK_TRANSFER', 'bank'])

export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx.schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    if (!(await hasPermission(ctx.userId, 'finance:payment:record', ctx.tenantId, ctx.schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = ReconcileSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { reference, statementReference } = parseResult.data

    const scope = { tenantId: ctx.tenantId, schoolId: ctx.schoolId }

    const recorded = await prisma.payment.findFirst({
      where: { ...scope, reference },
      select: { status: true, method: { select: { code: true } } },
    })
    if (!recorded) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }
    if (!recorded.method?.code || !MANUAL_METHODS.has(recorded.method.code)) {
      return NextResponse.json(
        { error: 'Only bank-transfer payments settle by reconciliation; mobile money verifies with the provider' },
        { status: 400 }
      )
    }
    if (recorded.status !== 'PENDING') {
      return NextResponse.json(
        { error: `A payment that is ${recorded.status} cannot be reconciled` },
        { status: 409 }
      )
    }

    const finance = new FinanceService(ctx)
    const result = await finance.settlePayment(reference, async () => ({
      status: 'COMPLETED' as const,
      // A reconciliation confirms the row; it does not replace the provider
      // reference a dispute would need, so the statement reference rides along
      // as the audit note rather than overwriting the column.
      note: `Bank statement reference ${statementReference}`,
    }))
    if (!result) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    if (result.payment.status === 'COMPLETED' && !result.idempotencySkipped) {
      await sendPaymentReceipt(reference, 'Bank transfer', scope).catch((error) => {
        logError('Finance payments reconcile receipt', error)
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Finance payments reconcile', error)
    return NextResponse.json({ error: 'Failed to reconcile payment' }, { status: 500 })
  }
}
