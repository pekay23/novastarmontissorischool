/**
 * The provider registry, the QR payload, and the environment the package reads.
 *
 * Three properties, all of which are contracts rather than implementation:
 *
 *   - `getProvider` is the only validation between a stored method code and a
 *     provider, and it validates by truthiness rather than by own-property, so
 *     every key inherited from `Object.prototype` walks straight past it. Those
 *     cases are pinned because they pass.
 *   - The QR is a payment instruction. What this package hands to the encoder is
 *     the part it owns and the part worth testing, so `qrcode` is wrapped to
 *     capture the payload and then delegate to the real encoder -- the pixels are
 *     the library's business, the five fields are ours.
 *   - Only three environment variables are read, and only they may reach text a
 *     parent reads. Everything else in `process.env` is fed a canary and must not
 *     appear in any returned object, which is the shape a leaked credential would
 *     take.
 *
 * Nothing here contacts a payment provider, because there is nothing to contact:
 * the mobile money path builds its instructions and returns them
 * (`index.ts:91-115`). A test for the real MTN API would need a sandbox tenant
 * and a signed-up merchant; that test does not exist and cannot be faked.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import "./support/fake-prisma";

type PaymentInput = import("../index").PaymentInput;
type PaymentProviderType = import("../index").PaymentProviderType;

/** Everything the encoder was asked to draw, in order. */
const qrPayloads: string[] = [];
const qrcodeReal = (await import("qrcode")).default;
const encode = qrcodeReal.toDataURL.bind(qrcodeReal);

mock.module("qrcode", () => ({
  default: {
    toDataURL: (text: string, options?: Parameters<typeof encode>[1]): Promise<string> => {
      qrPayloads.push(text);
      return encode(text, options);
    },
  },
}));

const { getProvider, PaymentService } = await import("../index");

const input = (overrides: Partial<PaymentInput> = {}): PaymentInput => ({
  amount: 100,
  currency: "GHS",
  payer: { name: "Ama Mensah", phone: "0240000000" },
  metadata: { invoiceId: "invoice_1", studentId: "student_1", termId: "term_1" },
  callbackUrl: "https://portal.novastar.test",
  ...overrides,
});

/** Canaries in every variable the package does not read. */
const CANARY = "canary-7f3a1c9e-DO-NOT-LEAK";
const UNREAD_VARS = ["MTN_API_KEY", "MTN_SUBSCRIPTION_KEY", "MTN_TARGET_ENVIRONMENT", "PAYSTACK_SECRET_KEY"];

const ENV_VARS = [
  "MTN_MERCHANT_ID",
  "SCHOOL_BANK_NAME",
  "SCHOOL_BANK_ACCOUNT",
  ...UNREAD_VARS,
];

/** Every string reachable in a returned object, so a leak cannot hide in a field. */
function stringsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, found);
  else if (value instanceof Date) found.push(value.toISOString());
  else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) stringsIn(item, found);
  }
  return found;
}

/**
 * Saved and restored rather than deleted, because `bun test` runs every file in one
 * process and this file's canaries must not outlive it.
 */
const ORIGINAL_ENV = new Map(ENV_VARS.map((name) => [name, process.env[name]]));

beforeEach(() => {
  qrPayloads.length = 0;
  for (const name of ENV_VARS) delete process.env[name];
  for (const name of UNREAD_VARS) process.env[name] = CANARY;
});

afterEach(() => {
  for (const [name, value] of ORIGINAL_ENV) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the provider registry", () => {
  test.each(["mtn-momo", "bank-transfer", "cash"] as const)(
    "%s resolves to a provider carrying that id and a name",
    (type) => {
      const provider = getProvider(type);
      expect(provider.id).toBe(type);
      expect(provider.name.length).toBeGreaterThan(0);
    },
  );

  test("the bulk key resolves to a second instance whose own id is still mtn-momo", async () => {
    // `PAYMENT_PROVIDERS` builds `mtn-bulk` as its own `new MTNMoMoProvider()`
    // (`index.ts:267`), so the key and the provider it holds disagree: the registry
    // says bulk, the provider says mtn-momo, and the row written for a bulk payment
    // records the registry key. `payment-service.test.ts` follows that through.
    const bulk = getProvider("mtn-bulk");
    expect(bulk).not.toBe(getProvider("mtn-momo"));
    expect(bulk.id).toBe("mtn-momo");
    expect(bulk.name).toBe(getProvider("mtn-momo").name);
    // Behaviourally the alias, though: the same fee.
    expect(bulk.getFees(1000)).toEqual(getProvider("mtn-momo").getFees(1000));
    expect(await bulk.processPayment(input())).toHaveProperty("reference");
  });

  test("a key the registry does not hold is refused, and the refusal names the key", () => {
    expect(() => getProvider("vodafone-cash" as PaymentProviderType)).toThrow(
      /^Payment provider "vodafone-cash" not found$/,
    );
  });

  test("a key that names an inherited property is not refused, so the registry validates nothing", () => {
    // `PAYMENT_PROVIDERS` is a plain object literal, so `PAYMENT_PROVIDERS[
    // 'constructor']` is `Object` -- truthy, and a function rather than a payment
    // provider. The guard on line 271-274 is a truthiness check, not an own-key
    // check. These cases pass today; each will fail the day the lookup is fixed.
    for (const key of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"]) {
      expect(() => getProvider(key as PaymentProviderType)).not.toThrow();
      expect(getProvider(key as PaymentProviderType)).not.toHaveProperty("processPayment");
    }
  });
});

describe("the QR payload", () => {
  const qrInput = {
    amount: 100,
    reference: "MM-1760000000000-student_1",
    payerName: "Ama Mensah",
    callbackUrl: "https://portal.novastar.test",
  };

  test("the payload is the five documented fields and nothing else", async () => {
    await PaymentService.generatePaymentQR("mtn-momo", qrInput);

    expect(qrPayloads).toHaveLength(1);
    const payload = JSON.parse(qrPayloads[0] as string) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "amount",
      "callbackUrl",
      "payerName",
      "provider",
      "reference",
    ]);
    expect(payload.provider).toBe("mtn-momo");
  });

  test("the QR carries the caller's amount unrounded, so it can encode a float artefact", async () => {
    await PaymentService.generatePaymentQR("mtn-momo", { ...qrInput, amount: 0.1 + 0.2 });

    const payload = JSON.parse(qrPayloads[0] as string) as { amount: number };
    expect(payload.amount).toBe(0.30000000000000004);
  });

  test("the payload carries the reference, which is all a holder of the QR needs to settle the payment", async () => {
    await PaymentService.generatePaymentQR("mtn-momo", qrInput);

    const payload = JSON.parse(qrPayloads[0] as string) as { reference: string };
    expect(payload.reference).toBe(qrInput.reference);
  });

  test("two references never produce the same payload", async () => {
    await PaymentService.generatePaymentQR("mtn-momo", qrInput);
    await PaymentService.generatePaymentQR("mtn-momo", { ...qrInput, reference: "MM-1760000000001-student_1" });

    expect(qrPayloads).toHaveLength(2);
    expect(qrPayloads[0]).not.toBe(qrPayloads[1]);
  });

  test("what comes back is a real PNG data URL, because the payload is handed to a real encoder", async () => {
    const dataUrl = await PaymentService.generatePaymentQR("mtn-momo", qrInput);

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    const bytes = Buffer.from((dataUrl as string).split(",")[1] as string, "base64");
    // PNG magic. A stubbed encoder returning a plausible-looking string would pass
    // every other assertion in this file.
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("a provider with no QR support yields null rather than an exception", async () => {
    expect(await PaymentService.generatePaymentQR("bank-transfer", qrInput)).toBeNull();
    expect(await PaymentService.generatePaymentQR("cash", qrInput)).toBeNull();
  });
});

describe("the environment this package reads", () => {
  test("the only environment values that reach a payer are the three the payer needs them for", async () => {
    process.env.MTN_MERCHANT_ID = "merchant-canary-1";
    process.env.SCHOOL_BANK_NAME = "Bank Name Canary";
    process.env.SCHOOL_BANK_ACCOUNT = "ACCT-CANARY-0001";

    const momo = await getProvider("mtn-momo").processPayment(input());
    const bank = await getProvider("bank-transfer").processPayment(input());

    expect(momo.instructions).toContain("merchant-canary-1");
    expect(bank.instructions).toContain("Bank Name Canary");
    expect(bank.instructions).toContain("ACCT-CANARY-0001");
  });

  test("a secret in the environment appears in no instruction, result or field of any provider", async () => {
    for (const name of UNREAD_VARS) process.env[name] = CANARY;

    const results = await Promise.all(
      ["mtn-momo", "bank-transfer", "cash"].map((type) => getProvider(type as PaymentProviderType).processPayment(input())),
    );
    const qr = await PaymentService.generatePaymentQR("mtn-momo", {
      amount: 100,
      reference: "MM-1-student_1",
      payerName: "Ama Mensah",
      callbackUrl: "https://portal.novastar.test",
    });

const scanned = [...stringsIn(results), ...stringsIn(qr)];
    expect(scanned.length).toBeGreaterThan(0);
    for (const text of scanned) expect(text).not.toContain(CANARY);
  });

  test("an unset merchant code is spelled 'undefined' in the instructions the payer reads", async () => {
    const result = await getProvider("mtn-momo").processPayment(input());
    expect(result.instructions).toContain('merchant code "undefined"');
  });

  test("an unset bank name and account are spelled 'undefined' in the transfer instructions", async () => {
    const result = await getProvider("bank-transfer").processPayment(input());
    expect(result.instructions).toContain("to: undefined, Account: undefined");
  });
});