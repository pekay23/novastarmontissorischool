/**
 * The ledger side: what `PaymentService` writes when a payment is taken, what it
 * does when one is verified, and what `reconcilePayments` does with a settlement
 * file.
 *
 * The properties pinned here are state changes, because that is where money goes
 * wrong quietly:
 *
 *   - settling a payment takes a reference and nothing else. No signature, no
 *     secret, no caller identity, no tenant. Whoever holds a reference -- and a
 *     reference is printed in every instruction string, drawn into every QR, and
 *     written on a bank statement -- can flip a row to COMPLETED.
 *   - the row written for a payment disagrees with the result returned to the
 *     caller: cash settles as PENDING with a `paidAt` on it, the term is dropped,
 *     and the amount is the caller's unrounded float going into `Decimal(12,2)`.
 *   - reconciliation compares amounts with `!==`, counts an amount mismatch as
 *     `unmatched` alongside a row it has never seen, reports a row it does not
 *     hold with no `actual` at all, and lets a non-COMPLETED provider row
 *     downgrade a payment that was already settled.
 *
 * Those defects all pass today and are reported rather than fixed, so each test
 * that records one is named `DEFECT` and will fail when the behaviour changes.
 *
 * There is no signature, webhook or HMAC anywhere in this package -- no `crypto`
 * import, no shared secret, no constant-time comparison. `verifyPayment` trusts a
 * bare reference string, so the `settling a payment` cases are what stands in for
 * signature verification here: a tampered payload is the reference, the wrong
 * secret is the absence of any secret, and a missing signature is a missing
 * argument. A test that fed a canary secret in and expected it back would have
 * nothing to assert, because no code path reads one.
 *
 * The database is the in-memory fake in `support/fake-prisma.ts`, which matches
 * every key a caller supplies -- so a lookup that grew a `tenantId` would stop
 * finding another school's row and the cross-tenant cases below would fail
 * rather than quietly pass. Nothing here contacts a database or a mail server.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { db, resetDb, seedStudentWithParent } from "./support/fake-prisma";

const { PaymentService, reconcilePayments } = await import("../index");

type PaymentInput = import("../index").PaymentInput;
type PaymentProviderType = import("../index").PaymentProviderType;
type ReconciliationInput = import("../index").ReconciliationInput;

const STUDENT_ID = "student_1";
const PARENT_EMAIL = "parent@novastar.test";
/** A connection string is the thing a driver error most often quotes. */
const CONNECTION_CANARY = "postgresql://admin:canary-7f3a1c9e@ep-frosty.aws.neon.tech/novastar";

const input = (overrides: Partial<PaymentInput> = {}): PaymentInput => ({
  amount: 100,
  currency: "GHS",
  payer: { name: "Ama Mensah", phone: "0240000000" },
  metadata: {
    invoiceId: "invoice_1",
    studentId: STUDENT_ID,
    termId: "term_1",
    tenantId: "tenant_1",
    schoolId: "school_1",
  },
  callbackUrl: "https://portal.novastar.test",
  ...overrides,
});

const transaction = (overrides: Partial<ReconciliationInput["transactions"][0]> = {}) => ({
  reference: "BANK-1-student_1",
  amount: 100.5,
  transactionId: "txn_1",
  paidAt: new Date("2026-10-01T09:00:00Z"),
  status: "COMPLETED" as const,
  ...overrides,
});

const createdRow = () => {
  const call = db.callsTo("payment", "create")[0];
  if (!call) throw new Error("no payment row was created");
  return call.args.data as Record<string, unknown>;
};

let restoreNow: (() => void) | null = null;
let originalConsoleError: typeof console.error;

beforeEach(() => {
  resetDb();
  originalConsoleError = console.error;
});

afterEach(() => {
  console.error = originalConsoleError;
  restoreNow?.();
  restoreNow = null;
});

// ---------------------------------------------------------------------------
// recording a payment
// ---------------------------------------------------------------------------

describe("recording a payment", () => {
  test("the row is stored under the reference the provider returned, not one invented here", async () => {
    const result = await PaymentService.processPayment("bank-transfer", input());

    expect(result.reference).toMatch(/^BANK-\d+-student_1$/);
    expect(createdRow().reference).toBe(result.reference);
    expect(db.payments).toHaveLength(1);
  });

  test("two payments for the same student in the same millisecond get the same reference", async () => {
    // `reference` is `${prefix}-${Date.now()}-${studentId}` (`index.ts:181`). Millisecond
    // resolution plus the student id is not unique, and nothing downstream notices:
    // verification and reconciliation both look the payment up by reference alone.
    const spy = spyOn(Date, "now").mockReturnValue(1760000000000);
    restoreNow = () => spy.mockRestore();

    const first = await PaymentService.processPayment("bank-transfer", input());
    const second = await PaymentService.processPayment("bank-transfer", input());

    expect(first.reference).toBe(second.reference);
    expect(db.payments.map((row) => row.reference)).toEqual([first.reference, first.reference]);
  });

  test("the amount stored is the caller's unrounded float, not a value rounded to the column", async () => {
    await PaymentService.processPayment("mtn-momo", input({ amount: 100.005 }));

    // `amount` is `Decimal(12,2)`. The row in memory carries every digit of the
    // float; the row on disk carries a rounded one. The fee was computed from the
    // unrounded figure, so the ledger and the fee can disagree in the last digit.
    expect(createdRow().amount).toBe(100.005);
  });

  test("the method is connected by the code the caller asked for", async () => {
    await PaymentService.processPayment("bank-transfer", input());

    expect(createdRow().method).toEqual({ connect: { code: "bank-transfer" } });
  });

  test("DEFECT: a bulk payment is recorded under a method code its own provider does not own", async () => {
    // The registry key is what is stored; the provider it resolves to reports
    // `id: "mtn-momo"`. Anything keyed on the provider id sees no bulk payment,
    // and anything keyed on the stored code sees a method config nobody defined.
    const result = await PaymentService.processPayment("mtn-bulk", input());

    expect(createdRow().method).toEqual({ connect: { code: "mtn-bulk" } });
    expect(result.providerReference).toMatch(/^MM-/);
  });

  test("the term the payment belongs to is dropped from the row", async () => {
    // `PaymentInput.metadata.termId` is required by the type and named on every
    // payment the portal takes, but the `create` on `index.ts:291-307` writes no
    // `termId`, and `Payment` has no `termId` column to write it to.
    await PaymentService.processPayment("bank-transfer", input());

    expect(input().metadata.termId).toBe("term_1");
    expect(createdRow()).not.toHaveProperty("termId");
    expect(Object.keys(createdRow()).sort()).toEqual([
      "amount",
      "invoiceId",
      "method",
      "paidAt",
      "recordedById",
      "reference",
      "schoolId",
      "status",
      "studentId",
      "tenantId",
      "transactionId",
    ]);
  });

  test("DEFECT: a payment with no recorder is attributed to a literal 'system'", async () => {
    // `recordedById` is a required foreign key to `User`, and a cuid is what that
    // table holds. The fallback is a string that only works if a user with the id
    // `system` exists.
    await PaymentService.processPayment("bank-transfer", input());

    expect(createdRow().recordedById).toBe("system");
  });

  test("a named recorder is stored rather than replaced by the fallback", async () => {
    await PaymentService.processPayment(
      "bank-transfer",
      input({ metadata: { ...input().metadata, recordedById: "user_7" } }),
    );

    expect(createdRow().recordedById).toBe("user_7");
  });

  test("DEFECT: a payment with no tenant or school in its metadata is written with undefined rather than refused", async () => {
    const result = await PaymentService.processPayment("bank-transfer", {
      ...input(),
      metadata: { invoiceId: "invoice_1", studentId: STUDENT_ID, termId: "term_1" },
    });

    expect(result.success).toBe(true);
    expect(createdRow().tenantId).toBeUndefined();
    expect(createdRow().schoolId).toBeUndefined();
  });

  test("DEFECT: a cash payment is recorded PENDING with a paidAt, though the provider settled it", async () => {
    // `CashProvider.processPayment` returns COMPLETED (`index.ts:236`) and the
    // service writes `status: "PENDING"` regardless of provider (`index.ts:302`),
    // then stamps `paidAt` with the moment the row was created.
    const result = await PaymentService.processPayment("cash", input());

    expect(result.status).toBe("COMPLETED");
    expect(createdRow().status).toBe("PENDING");
    expect(createdRow().paidAt).toBeInstanceOf(Date);
  });

  test("the reference names the student it is for, so a bank statement line identifies the child", async () => {
    const result = await PaymentService.processPayment("bank-transfer", input());

    expect(result.reference).toContain(STUDENT_ID);
    expect(result.instructions).toContain(STUDENT_ID);
  });

  test("DEFECT: an inherited registry key reaches the caller as a TypeError, not the refusal naming the key", async () => {
    const failure = await PaymentService.processPayment("constructor" as PaymentProviderType, input()).then(
      () => null,
      (error: Error) => error,
    );

    expect(failure).toBeInstanceOf(TypeError);
    expect(failure?.message).toContain("processPayment is not a function");
    expect(failure?.message).not.toContain("not found");
    expect(db.callsTo("payment", "create")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// the fee sentence
// ---------------------------------------------------------------------------

describe("the fee sentence", () => {
  test("a payment with fees gets the fee appended to the provider's own instructions", async () => {
    const result = await PaymentService.processPayment("mtn-momo", input({ amount: 100 }));

    expect(result.instructions).toContain("Dial *170#");
    expect(result.instructions).toMatch(/Fees: ₵1\.50$/);
  });

  test("a fee-free payment gets no fee sentence at all, not an empty one", async () => {
    for (const type of ["bank-transfer", "cash"] as const) {
      const result = await PaymentService.processPayment(type, input());
      expect(result.instructions).not.toContain("Fees");
      expect(result.instructions).not.toMatch(/\s$/);
    }
  });

  test("DEFECT: an amount that is not a number loses the fee sentence silently and is still a successful payment", async () => {
    const result = await PaymentService.processPayment("mtn-momo", input({ amount: Number.NaN }));

    expect(result.success).toBe(true);
    expect(result.instructions).not.toContain("Fees");
    expect(createdRow().amount).toBeNaN();
  });

  test("DEFECT: an infinite amount tells the payer the fee is the word Infinity", async () => {
    const result = await PaymentService.processPayment("mtn-momo", input({ amount: Number.POSITIVE_INFINITY }));

    expect(result.instructions).toMatch(/Fees: ₵Infinity$/);
  });
});

// ---------------------------------------------------------------------------
// settling a payment
// ---------------------------------------------------------------------------

describe("settling a payment", () => {
  const REFERENCE = "BANK-1760000000000-student_1";

  const settled = (overrides: Record<string, unknown> = {}) =>
    db.seedPayment({
      reference: REFERENCE,
      amount: "100.50",
      status: "COMPLETED",
      studentId: STUDENT_ID,
      paidAt: new Date("2026-10-01T09:00:00Z"),
      transactionId: "txn_mtn_1",
      ...overrides,
    });

  test("a settled payment is emailed to the parent of the student on that row", async () => {
    settled();
    seedStudentWithParent();

    await PaymentService.verifyPayment("bank-transfer", REFERENCE);

    expect(db.sentEmails).toHaveLength(1);
    expect(db.sentEmails[0]?.to).toBe(PARENT_EMAIL);
    expect(db.sentEmails[0]?.subject).toBe("Payment Confirmation");
    expect(db.callsTo("student", "findUnique")[0]?.args.where).toEqual({ id: STUDENT_ID });
  });

  test("DEFECT: the receipt quotes the amount with whatever digits the float carries", async () => {
    // `Number("100.50")` is `100.5`, so a parent reads ₵100.5 where the ledger
    // holds ₵100.50. No formatter is applied to the amount in the body.
    settled();
    seedStudentWithParent();

    await PaymentService.verifyPayment("bank-transfer", REFERENCE);

    expect(db.sentEmails[0]?.html).toContain("₵100.5");
    expect(db.sentEmails[0]?.html).not.toContain("₵100.50");
  });

  test("the update writes COMPLETED and the provider's transaction id, scoped to nothing but the reference", async () => {
    settled();
    seedStudentWithParent();

    await PaymentService.verifyPayment("bank-transfer", REFERENCE);

    const update = db.callsTo("payment", "updateMany")[0];
    expect(update?.args.data).toEqual({ status: "COMPLETED", transactionId: "txn_mtn_1" });
    expect(Object.keys(update?.args.where as Record<string, unknown>)).toEqual(["reference"]);
  });

  test("DEFECT: holding a reference from another school is enough to settle that school's payment", async () => {
    // `verifyPayment(providerType, reference)` is the whole signature: no secret,
    // no signature, no caller identity, no tenant. And `updateMany` matches on the
    // reference alone, so the local row -- which was never settled -- is settled
    // too, by a reference that proves nothing about it.
    settled({ tenantId: "tenant_other", schoolId: "school_other", studentId: "student_other" });
    const local = settled({ tenantId: "tenant_1", schoolId: "school_1", status: "PENDING" });
    expect(local.status).toBe("PENDING");
    db.seedStudent({
      id: "student_other",
      parent: { id: "parent_2", email: "parent-other@novastar.test" },
      class: null,
    });

    const result = await PaymentService.verifyPayment("bank-transfer", REFERENCE);

    expect(result.status).toBe("COMPLETED");
    // The write that settled it matched both rows, because its selector was the
    // reference and nothing else, so the local row that was never settled became
    // settled on the strength of another school's row -- and the receipt went to
    // the other school's parent.
    expect(local.schoolId).toBe("school_1");
    expect(local.status).toBe("COMPLETED");
    expect(db.payments).toHaveLength(2);
    expect(db.sentEmails).toHaveLength(1);
    expect(db.sentEmails[0]?.to).toBe("parent-other@novastar.test");
  });

  test("DEFECT: verifying the same payment twice sends the parent two receipts", async () => {
    settled();
    seedStudentWithParent();

    await PaymentService.verifyPayment("bank-transfer", REFERENCE);
    await PaymentService.verifyPayment("bank-transfer", REFERENCE);

    expect(db.sentEmails).toHaveLength(2);
    expect(db.sentEmails[0]).toEqual(db.sentEmails[1]);
  });

  test("a payment that is not settled sends no receipt", async () => {
    settled({ status: "PENDING" });
    seedStudentWithParent();

    const result = await PaymentService.verifyPayment("bank-transfer", REFERENCE);

    expect(result.status).toBe("PENDING");
    expect(db.sentEmails).toHaveLength(0);
    expect(db.callsTo("payment", "updateMany")).toHaveLength(0);
  });

  test("a parent with no email address is not emailed, and the payment still settles", async () => {
    settled();
    seedStudentWithParent({ parent: { id: "parent_1", email: null } });

    const result = await PaymentService.verifyPayment("bank-transfer", REFERENCE);

    expect(result.status).toBe("COMPLETED");
    expect(db.sentEmails).toHaveLength(0);
    expect(db.paymentByReference(REFERENCE)?.status).toBe("COMPLETED");
  });

  test("a payment whose student has no parent settles without an email", async () => {
    settled();
    db.seedStudent({ id: STUDENT_ID, parent: null, class: null });

    const result = await PaymentService.verifyPayment("bank-transfer", REFERENCE);

    expect(result.status).toBe("COMPLETED");
    expect(db.sentEmails).toHaveLength(0);
  });

  test("a failed receipt email neither undoes the settlement nor fails the verification", async () => {
    settled();
    seedStudentWithParent();
    db.emailFailure = new Error("smtp: connection refused");
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    const result = await PaymentService.verifyPayment("bank-transfer", REFERENCE);

    expect(result.status).toBe("COMPLETED");
    expect(result).not.toHaveProperty("error");
    expect(db.paymentByReference(REFERENCE)?.status).toBe("COMPLETED");
    expect(db.sentEmails).toHaveLength(0);
    expect(logged).toHaveLength(1);
    expect(String(logged[0]?.[0])).toContain("[payments]");
  });

  test("an unknown reference is PENDING on the transfer path and FAILED on the cash path", async () => {
    const bank = await PaymentService.verifyPayment("bank-transfer", "BANK-never-existed");
    const momo = await PaymentService.verifyPayment("mtn-momo", "MM-never-existed");
    const cash = await PaymentService.verifyPayment("cash", "CASH-never-existed");

    // One question -- has this payment arrived? -- gets three answers, and the
    // mobile money one is the dangerous shape: a payment that never arrives can
    // never fail, so an unpaid invoice is pending forever.
    expect(bank).toEqual({ success: true, status: "PENDING", amount: 0 });
    expect(momo).toEqual({ success: true, status: "PENDING", amount: 0 });
    expect(cash).toMatchObject({ success: false, status: "FAILED", error: "Payment not found" });
  });

  test("a pending verification reports an amount of 0, which is also what a zero payment reports", async () => {
    db.seedPayment({ reference: "BANK-pending", amount: "100.50", status: "PENDING", studentId: STUDENT_ID });

    const result = await PaymentService.verifyPayment("bank-transfer", "BANK-pending");

    expect(result.status).toBe("PENDING");
    expect(result.amount).toBe(0);
    expect(Number(db.paymentByReference("BANK-pending")?.amount)).toBe(100.5);
  });

  test("a cash payment settles only when the invoice's matching payment row is COMPLETED", async () => {
    db.seedInvoice({
      id: "invoice_1",
      payments: [
        { reference: "CASH-1", amount: "75.00", status: "COMPLETED", paidAt: new Date("2026-10-01") },
      ],
    });

    const result = await PaymentService.verifyPayment("cash", "CASH-1");

    expect(result).toMatchObject({ success: true, status: "COMPLETED", amount: 75 });
    // Only the matching payment came back, so the amount is that payment's and not
    // the first one on the invoice.
    expect(db.callsTo("feeInvoice", "findFirst")[0]?.args.include).toEqual({
      payments: { where: { reference: "CASH-1" } },
    });
  });

  test("DEFECT: a cash payment that exists but is not complete is reported as not found", async () => {
    db.seedInvoice({
      id: "invoice_1",
      payments: [{ reference: "CASH-1", amount: "75.00", status: "PENDING", paidAt: null }],
    });

    const result = await PaymentService.verifyPayment("cash", "CASH-1");

    expect(result).toMatchObject({ success: false, status: "FAILED", error: "Payment not found" });
  });

  test("the same database failure rejects on the transfer path and is reported as FAILED on the mobile money path", async () => {
    db.failOn("payment.findFirst", "connection terminated unexpectedly");

    const bank = PaymentService.verifyPayment("bank-transfer", "BANK-1").then(
      () => null,
      (error: Error) => error,
    );
    const momo = await PaymentService.verifyPayment("mtn-momo", "MM-1");

    expect((await bank)?.message).toBe("connection terminated unexpectedly");
    expect(momo).toMatchObject({ success: false, status: "FAILED", amount: 0 });
  });

  test("DEFECT: a driver error is handed to the caller verbatim, connection string and all", async () => {
    db.failOn("payment.findFirst", `Can't reach database server at ${CONNECTION_CANARY}`);

    const result = await PaymentService.verifyPayment("mtn-momo", "MM-1");

    // Prisma and `pg` both put the host and the credentials in the message of a
    // connection error. This path puts it in the return value, which the portal
    // renders.
    expect(result.error).toBe(`Can't reach database server at ${CONNECTION_CANARY}`);
    expect(String(result.error)).toContain("canary-7f3a1c9e");
  });
});

// ---------------------------------------------------------------------------
// reconciliation
// ---------------------------------------------------------------------------

describe("reconcilePayments", () => {
  const statement = (transactions: ReconciliationInput["transactions"]) =>
    reconcilePayments({ providerType: "bank-transfer", transactions });

  test("a reported amount equal to the stored one is matched, however each is spelled", async () => {
    // The ledger holds a `Decimal`, which Prisma hands back as a string; the
    // statement holds a float. `Number("100.50") === 100.5`, so they match.
    db.seedPayment({ id: "payment_1", reference: "BANK-1", amount: "100.50", status: "PENDING" });

    const result = await statement([transaction({ reference: "BANK-1", amount: 100.5 })]);

    expect(result).toEqual({ matched: 1, unmatched: 0, discrepancies: [] });
  });

  test("a matched transaction whose status differs has the provider's status written over the local one", async () => {
    db.seedPayment({ id: "payment_1", reference: "BANK-1", amount: "100.50", status: "PENDING" });

    await statement([transaction({ reference: "BANK-1", amount: 100.5, status: "COMPLETED" })]);

    const update = db.callsTo("payment", "update")[0];
    expect(update?.args.where).toEqual({ id: "payment_1" });
    expect(update?.args.data).toEqual({ status: "COMPLETED" });
  });

  test("a matched transaction whose status already agrees writes nothing", async () => {
    db.seedPayment({ id: "payment_1", reference: "BANK-1", amount: "100.50", status: "COMPLETED" });

    await statement([transaction({ reference: "BANK-1", amount: 100.5, status: "COMPLETED" })]);

    expect(db.callsTo("payment", "update")).toHaveLength(0);
  });

  test("DEFECT: a non-COMPLETED provider row can downgrade a payment that was already settled", async () => {
    db.seedPayment({ id: "payment_1", reference: "BANK-1", amount: "100.50", status: "COMPLETED" });

    const result = await statement([transaction({ reference: "BANK-1", amount: 100.5, status: "PENDING" })]);

    // A statement row that is merely PENDING -- or FAILED, or one nobody has
    // checked -- overwrites a settled payment, and the fee money with it.
    expect(result.matched).toBe(1);
    expect(db.paymentByReference("BANK-1")?.status).toBe("PENDING");
  });

  test("a payment the ledger does not hold is a discrepancy carrying no actual amount", async () => {
    const result = await statement([transaction({ reference: "BANK-unknown", amount: 100.5 })]);

    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
    // No `actual`, because there is nothing to compare against. A caller cannot
    // tell "never recorded" from "recorded wrong" without reading the shape.
    expect(result.discrepancies).toEqual([{ reference: "BANK-unknown", expected: 100.5 }]);
    expect(result.discrepancies[0]).not.toHaveProperty("actual");
  });

  test("a recorded amount that disagrees is a discrepancy carrying both sides", async () => {
    db.seedPayment({ id: "payment_1", reference: "BANK-1", amount: "90.00", status: "COMPLETED" });

    const result = await statement([transaction({ reference: "BANK-1", amount: 100.5 })]);

    expect(result).toEqual({
      matched: 0,
      unmatched: 1,
      discrepancies: [{ reference: "BANK-1", expected: 100.5, actual: 90 }],
    });
  });

  test("DEFECT: two spellings of the same amount that differ only in float representation are a discrepancy", async () => {
    // The comparison is `Number(payment.amount) !== txn.amount`. `0.1 + 0.2` is
    // worth the same as `0.30` and is not equal to it, so a correct payment is
    // reported as a discrepancy.
    db.seedPayment({ id: "payment_1", reference: "BANK-1", amount: "0.30", status: "COMPLETED" });

    const result = await statement([transaction({ reference: "BANK-1", amount: 0.1 + 0.2 })]);

    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
    // `expected` is the bank statement's figure and `actual` the ledger's, so
    // this states the defect rather than restating it: 0.30000000000000004
    // against 0.3. A closed `Number.isNaN(0.1 + 0.2 - 0.3)` assertion sat here
    // before, which constrains no production symbol and could not fail.
    expect(result.discrepancies).toEqual([
      { reference: "BANK-1", expected: 0.1 + 0.2, actual: 0.3 },
    ]);
  });

  test("an amount mismatch counts as unmatched, so `unmatched` is not a count of missing rows", async () => {
    db.seedPayment({ id: "payment_1", reference: "BANK-1", amount: "90.00", status: "COMPLETED" });
    db.seedPayment({ id: "payment_2", reference: "BANK-2", amount: "100.50", status: "COMPLETED" });

    const result = await statement([
      transaction({ reference: "BANK-1", amount: 100.5 }),
      transaction({ reference: "BANK-2", amount: 100.5 }),
      transaction({ reference: "BANK-3", amount: 100.5 }),
    ]);

    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(2);
    expect(result.discrepancies.map((entry) => entry.reference)).toEqual(["BANK-1", "BANK-3"]);
  });

  test("every transaction in the statement is counted exactly once", async () => {
    db.seedPayment({ id: "payment_1", reference: "BANK-1", amount: "100.50", status: "COMPLETED" });

    const result = await statement([
      transaction({ reference: "BANK-1", amount: 100.5 }),
      transaction({ reference: "BANK-2", amount: 100.5 }),
      transaction({ reference: "BANK-3", amount: 100.5 }),
    ]);

    expect(result.matched + result.unmatched).toBe(3);
  });

  test("an empty statement touches the database not at all", async () => {
    const result = await statement([]);

    expect(result).toEqual({ matched: 0, unmatched: 0, discrepancies: [] });
    expect(db.calls).toHaveLength(0);
  });
});