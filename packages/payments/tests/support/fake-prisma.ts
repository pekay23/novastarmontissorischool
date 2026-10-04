/**
 * An in-memory stand-in for the Prisma client, shaped by what
 * `packages/payments/index.ts` actually asks of it: `payment`, `feeInvoice` and
 * `student`.
 *
 * Rows are stored rather than calls counted, because the properties worth
 * pinning in this package are state changes -- a payment that settles has to land
 * in the ledger, a reconciliation has to leave a stale status rewritten, and a
 * verification that finds nothing has to leave everything alone.
 *
 * A selector is matched on *every* key the caller supplies, not just the one the
 * current code passes. That is what makes "this lookup is not scoped to a tenant"
 * a fact about the code under test: if a lookup ever grew a `tenantId`, this
 * fake would stop finding another school's row, and the cross-tenant cases in
 * `payment-service.test.ts` would fail rather than quietly pass.
 *
 * `include` is honoured for real relations: a list is filtered by its `where`,
 * a single relation is passed through. Otherwise the cash path would be handed
 * every payment on an invoice when it asked for one.
 *
 * Nothing here contacts a database. This module also registers itself as
 * `@novastar/database` and as the mail transport, so it must be imported before
 * the module under test.
 */
import { mock } from "bun:test";

export type Row = Record<string, unknown>;

export interface RecordedCall {
  readonly model: string;
  readonly op: string;
  readonly args: Record<string, unknown>;
}

export interface SentEmail {
  to: string;
  subject: string;
  html: string;
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Row)[key])}`)
    .join(",")}}`;
}

/** Prisma ignores `undefined` in `data`; a fake that assigned it would not. */
function withoutUndefined(data: Row): Row {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([column, expected]) => {
    // `{ payments: { some: { reference } } }` -- a predicate over a relation list.
    if (column === "payments" && expected !== null && typeof expected === "object") {
      const inner = (expected as { some?: Row }).some;
      const list = Array.isArray(row.payments) ? (row.payments as Row[]) : [];
      return list.some((item) => matches(item, inner));
    }
    return canonical(row[column]) === canonical(expected);
  });
}

export class FakeDatabase {
  readonly calls: RecordedCall[] = [];
  readonly payments: Row[] = [];
  readonly invoices: Row[] = [];
  readonly students: Row[] = [];
  readonly sentEmails: SentEmail[] = [];
  /** Set to make the named delegate (`"payment.findFirst"`) reject. */
  readonly failures = new Map<string, Error>();
  /** When set, the next `sendEmail` rejects with it. */
  emailFailure: Error | null = null;

  private counters = new Map<string, number>();

  reset(): void {
    this.calls.length = 0;
    this.payments.length = 0;
    this.invoices.length = 0;
    this.students.length = 0;
    this.sentEmails.length = 0;
    this.failures.clear();
    this.emailFailure = null;
    this.counters.clear();
  }

  callsTo(model: string, op?: string): RecordedCall[] {
    return this.calls.filter((call) => call.model === model && (op === undefined || call.op === op));
  }

  /** A row as the ledger holds it: `findFirst` hands back the object itself. */
  paymentByReference(reference: string): Row | undefined {
    return this.payments.find((row) => row.reference === reference);
  }

  seedPayment(data: Row): Row {
    const row: Row = { id: this.nextId("payment"), tenantId: "tenant_1", schoolId: "school_1", ...data };
    this.payments.push(row);
    return row;
  }

  seedInvoice(data: Row & { payments: Row[] }): Row {
    this.invoices.push(data);
    return data;
  }

  seedStudent(data: Row): Row {
    this.students.push(data);
    return data;
  }

  failOn(delegate: string, message: string): void {
    this.failures.set(delegate, new Error(message));
  }

  private nextId(model: string): string {
    const next = (this.counters.get(model) ?? 0) + 1;
    this.counters.set(model, next);
    return `${model}_${next}`;
  }

  private record(model: string, op: string, args: Row): void {
    this.calls.push({ model, op, args });
    const failure = this.failures.get(`${model}.${op}`);
    if (failure) throw failure;
  }

  private project(row: Row, include: Record<string, unknown> | undefined): Row {
    if (!include) return row;
    const out: Row = { ...row };
    for (const [relation, filter] of Object.entries(include)) {
      const value = row[relation];
      if (!Array.isArray(value)) {
        out[relation] = value;
        continue;
      }
      const spec = filter as { where?: Row } | boolean | undefined;
      const where = spec !== null && typeof spec === "object" ? spec.where : undefined;
      out[relation] = where ? value.filter((item) => matches(item, where)) : value;
    }
    return out;
  }

  private findOne(rows: Row[], where: Row | undefined): Row | null {
    return rows.find((row) => matches(row, where)) ?? null;
  }

  readonly prisma: Record<string, unknown> = {
    payment: {
      findFirst: async (args: Row) => {
        this.record("payment", "findFirst", args);
        const found = this.findOne(this.payments, args.where as Row | undefined);
        return found ? this.project(found, args.include as Record<string, unknown> | undefined) : null;
      },
      create: async (args: Row) => {
        this.record("payment", "create", args);
        const row: Row = { id: this.nextId("payment"), ...(args.data as Row) };
        this.payments.push(row);
        return row;
      },
      update: async (args: Row) => {
        this.record("payment", "update", args);
        const where = args.where as Row | undefined;
        const row = where?.id === undefined ? null : (this.payments.find((p) => p.id === where.id) ?? null);
        if (!row) throw new Error(`FakeDatabase: no Payment row for ${canonical(where)}`);
        Object.assign(row, withoutUndefined(args.data as Row));
        return row;
      },
      updateMany: async (args: Row) => {
        this.record("payment", "updateMany", args);
        const data = withoutUndefined(args.data as Row);
        const matched = this.payments.filter((row) => matches(row, args.where as Row | undefined));
        for (const row of matched) Object.assign(row, data);
        return { count: matched.length };
      },
    },
    feeInvoice: {
      findFirst: async (args: Row) => {
        this.record("feeInvoice", "findFirst", args);
        const found = this.findOne(this.invoices, args.where as Row | undefined);
        return found ? this.project(found, args.include as Record<string, unknown> | undefined) : null;
      },
    },
    student: {
      findUnique: async (args: Row) => {
        this.record("student", "findUnique", args);
        const found = this.findOne(this.students, args.where as Row | undefined);
        return found ? this.project(found, args.include as Record<string, unknown> | undefined) : null;
      },
    },
  };
}

/**
 * One instance for the whole suite. `bun test` runs every file in a single
 * process and module mocks are process-wide, so a per-file fake would mean the
 * second file to import `../index` inherited the first file's store. Sharing one
 * object and resetting it per test avoids depending on which file loads first.
 */
export const db = new FakeDatabase();

export function resetDb(): void {
  db.reset();
}

/**
 * A parent-linked student, which is what the confirmation email path needs.
 */
export function seedStudentWithParent(overrides: Row = {}): Row {
  return db.seedStudent({
    id: "student_1",
    parent: { id: "parent_1", email: "parent@novastar.test", name: "Ama Mensah" },
    class: { id: "class_1", name: "Year 3" },
    ...overrides,
  });
}

mock.module("@novastar/database", () => ({ prisma: db.prisma }));

mock.module("@novastar/notifications", () => ({
  sendEmail: async (options: { to: string; subject: string; html: string }) => {
    if (db.emailFailure) throw db.emailFailure;
    db.sentEmails.push(options);
    return { id: "msg_1" };
  },
}));