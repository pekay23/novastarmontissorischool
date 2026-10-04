/**
 * `FinanceService` seen from a caller who has no school. Every public method
 * takes a school scope before it does anything else, and that ordering is the
 * only part of this class a test can reach without a database: each one has to
 * refuse, rather than run a query over a wider set of invoices than the caller
 * is entitled to.
 *
 * The assertion is on the exact message, not on `toThrow`, because ordering is
 * the property being pinned. A guard moved below the first query still refuses --
 * one row later, with `Invoice not found`, `Class not found`, or a connection
 * error instead. Only the wording says the guard ran before the lookup.
 *
 * Invoice numbering is not covered, deliberately. `generateInvoiceNumber` is
 * private, takes a `Prisma.TransactionClient`, and returns a row count rendered
 * into a string, so there is no way to reach it without either a live Postgres
 * or a stand-in for `tx`. A stand-in that answers `count()` with a constant
 * would pass just as happily if the query stopped filtering on tenant and school
 * -- and that filter is the only thing about it worth testing, since it is what
 * lets two schools in one tenant hold the same invoice number. Reaching it
 * needs the render split out as a pure `renderInvoiceNumber(count, year)`.
 */
import { describe, expect, test } from "bun:test";
import { FinanceService } from "../index";

/** A tenant operator whose school assignment has gone missing. */
function withoutSchool(): FinanceService {
  return new FinanceService({
    tenantId: "tenant_novastar",
    schoolId: null,
    userId: "user_head",
    role: "HEADMASTER",
  });
}

/** Every public entry point on the service, and how to call it. */
const CALLS: Array<[string, (service: FinanceService) => Promise<unknown>]> = [
  [
    "calculateOutstandingBalance",
    (service) => service.calculateOutstandingBalance("student_1"),
  ],
  [
    "generateInvoicesForClass",
    (service) =>
      service.generateInvoicesForClass(
        "class_1",
        "term_1",
        "academic_year_1",
      ),
  ],
  ["getInvoiceById", (service) => service.getInvoiceById("invoice_1")],
  [
    "recordPayment",
    (service) =>
      service.recordPayment({
        invoiceId: "invoice_1",
        amount: 250,
        methodCode: "CASH",
        reference: "receipt_1",
      }),
  ],
];

/** The only wording a caller gets when their school assignment is missing. */
const REFUSAL = "No school assigned to user";

describe("FinanceService with no school assigned", () => {
  test.each(CALLS)(
    "%s refuses on the scope guard, not on a lookup",
    async (_method, call) => {
      // A resolved promise is turned into an empty string rather than asserted
      // with `rejects`, so a method that quietly went ahead shows the empty
      // string next to the refusal it should have produced.
      const message = await call(withoutSchool()).then(
        () => "",
        (error: unknown) => (error as Error).message,
      );

      expect(message).toBe(REFUSAL);
    },
  );

  test("the prototype holds nothing beyond the methods this file refuses", () => {
    // Closes the loop. A public method added later that forgot `schoolScope()`
    // would slip past the table above, because the table would be missing it
    // too. `private` is erased by the compiler, so both helpers sit on the
    // prototype and are named here -- a helper that had grown into an entry
    // point would otherwise turn up as an unexplained name.
    const onPrototype = Object.getOwnPropertyNames(FinanceService.prototype)
      .filter((name) => name !== "constructor")
      .sort();
    const expected = [
      ...CALLS.map(([method]) => method),
      "generateInvoiceNumber",
      "resolvePaymentMethod",
    ].sort();

    expect(onPrototype).toEqual(expected);
  });
});