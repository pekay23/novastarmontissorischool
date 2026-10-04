/**
 * Money. Every amount in this package is a JavaScript number moving into a
 * `Decimal(12,2)` column, so the properties pinned here are the ones that decide
 * what a parent is charged and what the ledger stores: the shape of the fee, the
 * point where rounding happens, and the fact that there is no pesewa unit at all.
 *
 * The defects this suite exists to hold in place, all of which pass today and are
 * reported rather than fixed:
 *   - the fee is rounded to the pesewa for the sentence a payer reads and not
 *     rounded for the arithmetic, so the two disagree by up to half a pesewa;
 *   - zero, negative, `NaN` and `Infinity` are all accepted and each produces a
 *     different kind of wrong number rather than a refusal;
 *   - an amount is cedis, never pesewas, so an integer count of pesewa is billed
 *     a hundred times over;
 *   - an amount handed in as a string is arithmetically coerced instead of
 *     refused, because the type annotation is the only guard there is.
 *
 * `getFees` is the only function here with no database and no network behind it,
 * so it is the only place a fee claim can be checked against arithmetic.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "./support/fake-prisma";

const { getProvider } = await import("../index");
type PaymentInput = import("../index").PaymentInput;

const input = (overrides: Partial<PaymentInput> = {}): PaymentInput => ({
  amount: 100,
  currency: "GHS",
  payer: { name: "Ama Mensah", phone: "0240000000" },
  metadata: { invoiceId: "invoice_1", studentId: "student_1", termId: "term_1" },
  callbackUrl: "https://portal.novastar.test",
  ...overrides,
});

const mtn = getProvider("mtn-momo");

/**
 * The three variables the package reads, captured and restored rather than left
 * deleted: `bun test` runs every file in one process, so a delete here would
 * decide what `providers.test.ts` sees.
 */
const ENV_VARS = ["MTN_MERCHANT_ID", "SCHOOL_BANK_NAME", "SCHOOL_BANK_ACCOUNT"];
const ORIGINAL_ENV = new Map(ENV_VARS.map((name) => [name, process.env[name]]));

function restoreEnv(): void {
  for (const [name, value] of ORIGINAL_ENV) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

beforeEach(() => {
  for (const name of ENV_VARS) delete process.env[name];
});

afterEach(restoreEnv);

describe("the mobile money fee", () => {
  test("a flat 50 pesewas is charged when the percentage would be less, which is a 50% fee on a cedi", () => {
    // ₵1.00 is the smallest payment that can happen and it loses half its value.
    const fees = mtn.getFees(1);
    expect(fees.processingFee).toBe(0.5);
    expect(fees.netAmount).toBe(0.5);
  });

  test("the percentage takes over above the crossover, and the floor applies below it", () => {
    // 1.5% of 33.33 is 0.4999..., so the floor wins there and loses at 33.34.
    // Both sides are pinned because the crossover is the only thing that tells a
    // reader whether the rate is 1.5% or flat.
    expect(mtn.getFees(33.33).processingFee).toBe(0.5);
    expect(mtn.getFees(33.34).processingFee).toBe(0.5001);
  });

  test("above the crossover the fee is 1.5% of the amount and the net is the remainder", () => {
    const fees = mtn.getFees(1000);
    expect(fees.processingFee).toBe(15);
    expect(fees.totalFees).toBe(fees.processingFee);
    expect(fees.providerFee).toBe(0);
    expect(fees.netAmount).toBe(985);
  });

  test("the fee the payer is told is rounded to the pesewa while the fee computed is not", () => {
    // 100.1 * 0.015 is 1.5014999999999998. The sentence rounds that to ₵1.50;
    // `netAmount` subtracts all of it. The two can never both be right.
    const fees = mtn.getFees(100.1);
    expect(fees.totalFees.toFixed(2)).toBe("1.50");
    expect(Number(fees.totalFees.toFixed(2))).not.toBe(fees.totalFees);
    expect(fees.netAmount).toBeCloseTo(98.5985, 10);
  });

  test("a zero amount is still charged the flat fee, which nets to minus fifty pesewas", () => {
    const fees = mtn.getFees(0);
    expect(fees.processingFee).toBe(0.5);
    expect(fees.netAmount).toBe(-0.5);
  });

  test("a negative amount is charged a fee rather than refused, and nets further negative", () => {
    // -1.5 is below the floor, so a negative payment is charged the same 50
    // pesewas as a one-cedi payment.
    const fees = mtn.getFees(-100);
    expect(fees.processingFee).toBe(0.5);
    expect(fees.netAmount).toBe(-100.5);
  });

  test("an amount that is not a number makes every part of the breakdown NaN", () => {
    const fees = mtn.getFees(Number.NaN);
    expect(Number.isNaN(fees.processingFee)).toBe(true);
    expect(Number.isNaN(fees.totalFees)).toBe(true);
    expect(Number.isNaN(fees.netAmount)).toBe(true);
    // Which is why the fee sentence is dropped further up rather than printed:
    // `NaN > 0` is false. Pinned so the disappearance is known to be arithmetic.
    expect(fees.totalFees > 0).toBe(false);
  });

  test("an infinite amount nets to NaN rather than to an infinite net", () => {
    const fees = mtn.getFees(Number.POSITIVE_INFINITY);
    expect(fees.processingFee).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(fees.netAmount)).toBe(true);
    // And unlike NaN, it does print: `Infinity.toFixed(2)` is the word.
    expect(fees.totalFees > 0).toBe(true);
  });
});

describe("an amount is cedis, never pesewas", () => {
  test("an integer amount is read as whole cedis, so a count of pesewa would bill a hundred times over", () => {
    // There is no pesewa unit anywhere in the package: no conversion, no integer
    // minor unit, no smallest-denomination check. An integer is cedis, so the
    // caller that counted 100 pesewa sends a hundred cedis' worth of instructions.
    const fees = getProvider("bank-transfer").getFees(100);
    expect(fees.netAmount).toBe(100);
    expect(fees.totalFees).toBe(0);
  });

  test("the payer is told the cedis figure with no minor unit anywhere in the text", async () => {
    const result = await getProvider("bank-transfer").processPayment(input({ amount: 100 }));
    expect(result.instructions).toContain("₵100");
    expect(result.instructions).not.toContain("10000");
  });
});

describe("fee-free providers", () => {
  test.each(["bank-transfer", "cash"] as const)("%s charges nothing and returns the amount untouched", (type) => {
    const fees = getProvider(type).getFees(437.5);
    expect(fees.providerFee).toBe(0);
    expect(fees.processingFee).toBe(0);
    expect(fees.totalFees).toBe(0);
    expect(fees.netAmount).toBe(437.5);
  });

  test("a provider with no fee does not validate the amount either, so NaN passes through as the net", () => {
    expect(Number.isNaN(getProvider("cash").getFees(Number.NaN).netAmount)).toBe(true);
  });
});

describe("an amount handed in as something other than a number", () => {
  test("a numeric string is multiplied as if it were a number, because nothing checks the type", () => {
    // "100.50" * 0.015 coerces to 1.5074999999999998. A runtime check would have
    // refused it.
    const fees = mtn.getFees("100.50" as unknown as number);
    expect(fees.processingFee).toBe(1.5074999999999998);
    expect(fees.netAmount).toBe(98.9925);
  });

  test("a string that is not a number becomes NaN, so the fee disappears instead of failing", () => {
    const fees = mtn.getFees("fifty cedis" as unknown as number);
    expect(Number.isNaN(fees.processingFee)).toBe(true);
    expect(fees.totalFees > 0).toBe(false);
  });
});

describe("currency rendering", () => {
  test("an amount with no decimals is rendered bare: no thousands separator, no two decimal places", async () => {
    const result = await mtn.processPayment(input({ amount: 1000 }));
    expect(result.instructions).toContain("₵1000");
    expect(result.instructions).not.toContain("1,000");
    expect(result.instructions).not.toContain("1000.00");
  });

  test("a fraction of a cedi is rendered with whatever digits the float carries", async () => {
    const result = await mtn.processPayment(input({ amount: 100.5 }));
    expect(result.instructions).toContain("₵100.5");
    expect(result.instructions).not.toContain("₵100.50");
  });

  test("an amount with no clean decimal representation is shown to the payer at full float precision", async () => {
    // The parent is told to enter ₵0.30000000000000004 on the phone keypad. There
    // is no formatter, so the float's own repr is what reaches them.
    const result = await mtn.processPayment(input({ amount: 0.1 + 0.2 }));
    expect(result.instructions).toContain("₵0.30000000000000004");
  });

  test("a string amount keeps its own spelling, which the same number would not have kept", async () => {
    // No formatter means each form is rendered by string interpolation alone: the
    // string keeps its trailing zero, the number drops it. Same money, different
    // text, and neither is the two-decimal form the ledger stores.
    const asString = await mtn.processPayment(input({ amount: "100.50" as unknown as number }));
    const asNumber = await mtn.processPayment(input({ amount: 100.5 }));
    expect(asString.instructions).toContain("₵100.50");
    expect(asNumber.instructions).toContain("₵100.5");
  });

  test.each(["mtn-momo", "bank-transfer", "cash"] as const)(
    "%s quotes a cedis amount to the payer with the sign attached",
    async (type) => {
      const result = await getProvider(type).processPayment(input({ amount: 12 }));
      expect(result.instructions).toContain("₵12");
    },
  );
});