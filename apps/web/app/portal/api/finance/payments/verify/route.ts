import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { z } from 'zod'
import { logError } from '@/lib/logger'
import { FinanceService, type SettlementOutcome } from '@novastar/domain'
import { PaymentService, sendPaymentReceipt } from '@novastar/payments'

/**
 * Verify a recorded payment with its provider and settle it if the provider
 * confirms the money arrived.
 *
 * This is the only path by which an async payment (MTN MoMo, bank transfer)
 * becomes settled: the provider's answer decides, the domain service applies
 * the transition and the invoice balance atomically, and the parent receives a
 * receipt afterwards. A provider that has not confirmed leaves the payment
 * PENDING — it is never settled on the strength of the local row alone.
 *
 * Bank transfer settles through the sibling `/reconcile` route, where an
 * operator's reconciliation of the statement line IS the confirmation; there is
 * no instant channel to consult for it.
 */
const VerifyPaymentSchema = z.object({
  reference: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx.schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }

    // RBAC: the same authority that may record a payment may verify one.
    if (!(await hasPermission(ctx.userId, 'finance:payment:record', ctx.tenantId, ctx.schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = VerifyPaymentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const { reference } = parseResult.data

    const scope = { tenantId: ctx.tenantId, schoolId: ctx.schoolId }

    // The provider consult needs the recorded payment's own method and state.
    // A lookup outside this tenant answers 404 rather than consulting a
    // provider about another school's reference.
    const recorded = await prisma.payment.findFirst({
      where: { ...scope, reference },
      select: { id: true, amount: true, status: true, method: { select: { code: true } } },
    })
    if (!recorded) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    const methodCode = recorded.method?.code
    if (!methodCode) {
      return NextResponse.json({ error: 'Payment has no method' }, { status: 400 })
    }

    const finance = new FinanceService(ctx)

    // Already settled: the domain reports the row as-is WITHOUT the provider
    // consult. Asking MTN again costs an API call per replay of this endpoint
    // and can only confirm what the ledger already holds.
    if (recorded.status === 'COMPLETED') {
      const settled = await finance.settlePayment(reference, async () => ({
        status: 'COMPLETED',
      }))
      if (!settled) {
        return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
      }
      return NextResponse.json(settled)
    }

    const verification = await PaymentService.verifyPayment(
      methodCode as Parameters<typeof PaymentService.verifyPayment>[0],
      reference,
      scope
    )

    const outcome: SettlementOutcome =
      verification.success && verification.status === 'COMPLETED'
        ? { status: 'COMPLETED', transactionId: verification.transactionId }
        : verification.status === 'FAILED'
          ? { status: 'FAILED', reason: verification.error }
          : { status: 'PENDING' }

    const result = await finance.settlePayment(reference, async () => outcome)
    if (!result) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Best-effort receipt: the settlement is already recorded, so a mail outage
    // must not turn it into a failed verification.
    if (result.payment.status === 'COMPLETED' && !result.idempotencySkipped) {
      await sendPaymentReceipt(reference, methodCode, scope).catch((error) => {
        logError('Finance payments verify receipt', error)
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
    logError('Finance payments verify', error)
    return NextResponse.json({ error: 'Failed to verify payment' }, { status: 500 })
  }
}
