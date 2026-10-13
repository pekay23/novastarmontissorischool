/**
 * The settlement path: `FinanceService.settlePayment` is the only route by which
 * an async payment (mobile money, bank transfer) becomes settled and the only
 * place the invoice balance moves after a payment was recorded. The properties
 * pinned here are the ones a fraud or a double-spend would need:
 *
 *   - the provider's word decides. A verifier that says PENDING changes nothing;
 *     one that says FAILED fails the payment and leaves the invoice alone.
 *   - the balance moves exactly once, even when the payment was already settled
 *     (idempotent) and even when a concurrent settle landed between the consult
 *     and the transaction.
 *   - the lookup is tenant-scoped: another school's reference is not found here.
 *   - the provider is consulted with the recorded amount and method, so a
 *     mis-scoped verifier cannot invent a settlement.
 *
 * The database is the in-memory fake in `support/fake-prisma.ts`, injected per
 * service instance. Nothing here contacts a database or a provider.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  audits,
  fakePrisma,
  invoices,
  onVerifierCall,
  payments,
  runInsideVerifier,
  seedLedger,
} from "./support/fake-prisma";
import { FinanceService } from "../index";

/** The service with the fake ledger injected. `prisma` is `protected`, which is
 * a compile-time fact only, so the cast is the injection point; a per-instance
 * injection cannot be disturbed by another test file and disturbs none. */
const service = (): FinanceService => {
  const instance = new FinanceService({
    tenantId: "tenant_1",
    schoolId: "school_1",
    userId: "user_bursar",
    role: "BURSAR",
  });
  (instance as unknown as { prisma: typeof fakePrisma }).prisma = fakePrisma;
  return instance;
};

const completed = (amount = 150) => ({
  success: true,
  status: "COMPLETED" as const,
  amount,
  transactionId: "txn_mtn_1",
});
const pending = () => ({ success: true, status: "PENDING" as const, amount: 150 });

beforeEach(() => {
  seedLedger();
});

describe("settlePayment", () => {
  test("a provider that says COMPLETED settles the payment and moves the balance by exactly that amount", async () => {
    const result = await service().settlePayment("MM-1-student_1", async () => completed());

    expect(result?.payment.status).toBe("COMPLETED");
    expect(result?.invoice.paidAmount).toBe(250);
    expect(result?.invoice.balance).toBe(250);
    expect(result?.idempotencySkipped).toBe(false);
    expect(payments[0]?.transactionId).toBe("txn_mtn_1");
    expect(audits.map((entry) => entry.action)).toEqual(["payment.verify.completed"]);
  });

  test("the verifier is consulted with the recorded amount and method", async () => {
    const seen: Array<{ amount: number; methodCode: string }> = [];

    await service().settlePayment("MM-1-student_1", async (query) => {
      seen.push({ amount: query.amount, methodCode: query.methodCode });
      return completed();
    });

    expect(seen).toEqual([{ amount: 150, methodCode: "mtn-momo" }]);
  });

  test("a provider that says PENDING changes nothing at all", async () => {
    const result = await service().settlePayment("MM-1-student_1", async () => pending());

    expect(result?.payment.status).toBe("PENDING");
    expect(payments[0]?.status).toBe("PENDING");
    expect(invoices[0]?.balance).toBe("400.00");
    expect(audits).toHaveLength(0);
  });

  test("a provider that says FAILED fails the payment and leaves the invoice alone", async () => {
    const result = await service().settlePayment("MM-1-student_1", async () => ({
      success: true,
      status: "FAILED" as const,
      amount: 150,
      reason: "payer cancelled",
    }));

    expect(result?.payment.status).toBe("FAILED");
    expect(result?.invoice.balance).toBe(400);
    expect(invoices[0]?.balance).toBe("400.00");
    expect(payments[0]?.notes).toBe("payer cancelled");
    expect(audits.map((entry) => entry.action)).toEqual(["payment.verify.failed"]);
  });

  test("an already-settled payment is reported as-is, without consulting the provider again", async () => {
    payments[0]!.status = "COMPLETED";
    payments[0]!.paidAt = new Date("2026-10-01T09:00:00Z");
    let consulted = 0;

    const result = await service().settlePayment("MM-1-student_1", async () => {
      consulted++;
      return completed();
    });

    expect(consulted).toBe(0);
    expect(result?.idempotencySkipped).toBe(true);
    expect(invoices[0]?.balance).toBe("400.00");
  });

  test("a concurrent settle between the consult and the transaction moves the balance once", async () => {
    onVerifierCall(() => {
      payments[0]!.status = "COMPLETED";
      // The other settle also moved the balance, which is the state this call
      // must not move again.
      invoices[0]!.paidAmount = "250.00";
      invoices[0]!.balance = "250.00";
    });

    const result = await service().settlePayment("MM-1-student_1", async (query) => {
      runInsideVerifier();
      expect(query.currentStatus).toBe("PENDING");
      return completed();
    });

    expect(result?.payment.status).toBe("COMPLETED");
    expect(invoices[0]?.balance).toBe("250.00");
    expect(audits).toHaveLength(0);
  });

  test("a payment whose row belongs to another school is not found, however the reference reads", async () => {
    payments[0]!.tenantId = "tenant_other";
    payments[0]!.schoolId = "school_other";

    const result = await service().settlePayment("MM-1-student_1", async () => completed());

    expect(result).toBeNull();
  });

  test("an unknown reference is null, not a throw", async () => {
    const result = await service().settlePayment("MM-never-existed", async () => completed());

    expect(result).toBeNull();
  });

  test("settling the full balance marks the invoice PAID", async () => {
    payments[0]!.amount = "400.00";

    const result = await service().settlePayment("MM-1-student_1", async () => completed(400));

    expect(result?.invoice.status).toBe("PAID");
    expect(result?.invoice.balance).toBe(0);
    expect(invoices[0]?.paidAt).toBeInstanceOf(Date);
  });
});
