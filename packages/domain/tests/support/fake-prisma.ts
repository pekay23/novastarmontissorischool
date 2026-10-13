/**
 * An in-memory stand-in for the Prisma client, shaped by what
 * `FinanceService.settlePayment` asks of it: a tenant-scoped payment lookup with
 * its invoice and method, a payment update, an invoice update, and audit rows.
 *
 * The service is handed this client by direct property injection in the test
 * (`service.prisma = fakePrisma`) rather than through `mock.module`: module
 * mocks are captured at first import, and with several test files in one
 * process the real client wins often enough to matter. Injection is per
 * instance, so no other test file can disturb it and it can disturb none.
 *
 * Nothing here contacts a database.
 */

type Row = Record<string, unknown>;

export const payments: Row[] = [];
export const invoices: Row[] = [];
export const audits: Row[] = [];

/** Runs inside the verifier, to simulate a concurrent settlement. */
let insideVerifier: (() => void) | null = null;

export function onVerifierCall(fn: () => void): void {
  insideVerifier = fn;
}

export function runInsideVerifier(): void {
  insideVerifier?.();
}

export function resetLedger(): void {
  payments.length = 0;
  invoices.length = 0;
  audits.length = 0;
  insideVerifier = null;
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => row[key] === expected);
}

function project(row: Row, include: Row | undefined): Row {
  if (!include) return { ...row };
  const out: Row = { ...row };
  for (const [relation, spec] of Object.entries(include)) {
    if (relation === "invoice") {
      const invoice = invoices.find((candidate) => candidate.id === row.invoiceId);
      const select = ((spec as Row)?.select ?? {}) as Row;
      out.invoice = invoice
        ? Object.fromEntries(Object.keys(select).map((key) => [key, invoice[key]]))
        : null;
    } else if (relation === "method") {
      out.method = { code: row.methodCode ?? "mtn-momo" };
    } else {
      out[relation] = row[relation];
    }
  }
  return out;
}

/** The slice of the Prisma client this path uses, with the shapes it answers in. */
interface FakeClient {
  payment: {
    findFirst: (args: Row) => Promise<Row | null>;
    update: (args: Row) => Promise<Row>;
  };
  feeInvoice: {
    update: (args: Row) => Promise<Row>;
  };
  auditLog: {
    create: (args: Row) => Promise<Row>;
  };
  $transaction: <T>(fn: (tx: FakeClient) => Promise<T>) => Promise<T>;
}

const client: FakeClient = {
  payment: {
    findFirst: async (args: Row) => {
      const found = payments.find((row) => matches(row, args.where as Row));
      if (!found) return null;
      return project(found, args.include as Row);
    },
    update: async (args: Row) => {
      const row = payments.find((candidate) => candidate.id === (args.where as Row).id);
      if (!row) throw new Error("FakeDatabase: no Payment row");
      Object.assign(row, args.data as Row);
      return { ...row };
    },
  },
  feeInvoice: {
    update: async (args: Row) => {
      const row = invoices.find((candidate) => candidate.id === (args.where as Row).id)
      if (!row) throw new Error("FakeDatabase: no FeeInvoice row")
      // The money columns move atomically in production; the fake applies the
      // same increment/decrement semantics so a regression to absolute writes
      // fails here rather than in a concurrent-settlement race nobody can test.
      for (const [key, value] of Object.entries(args.data as Row)) {
        if (value && typeof value === "object" && "increment" in (value as Row)) {
          row[key] = Number(row[key] ?? 0) + Number((value as Row).increment)
        } else if (value && typeof value === "object" && "decrement" in (value as Row)) {
          row[key] = Number(row[key] ?? 0) - Number((value as Row).decrement)
        } else {
          row[key] = value
        }
      }
      return { ...row }
    },
  },
  auditLog: {
    create: async (args: Row) => {
      const row: Row = { id: `audit_${audits.length + 1}`, ...(args.data as Row) };
      audits.push(row);
      return row;
    },
  },
  $transaction: async <T>(fn: (tx: FakeClient) => Promise<T>): Promise<T> => fn(client),
};

export const fakePrisma = client;

/** A pending ₵150 mobile-money payment against a ₵400 balance. */
export function seedLedger(): void {
  resetLedger();
  invoices.push({
    id: "invoice_1",
    invoiceNumber: "INV-2026-0007",
    totalAmount: "500.00",
    paidAmount: "100.00",
    balance: "400.00",
    status: "PARTIAL",
  });
  payments.push({
    id: "payment_1",
    tenantId: "tenant_1",
    schoolId: "school_1",
    invoiceId: "invoice_1",
    methodCode: "mtn-momo",
    reference: "MM-1-student_1",
    amount: "150.00",
    status: "PENDING",
    paidAt: null,
    transactionId: null,
  });
}
