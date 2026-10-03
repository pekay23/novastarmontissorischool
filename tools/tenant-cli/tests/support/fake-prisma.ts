/**
 * An in-memory stand-in for the Prisma client.
 *
 * The point is that `clone` and `provision` can be tested against something that
 * actually stores rows, so "running `create` twice leaves exactly one tenant" is
 * a fact about state rather than a fact about how many times a method was called.
 *
 * Rows are keyed by the canonical form of the `where` argument, which makes a
 * generic implementation possible for both single-field selectors (`{ code }`)
 * and Prisma's compound ones (`{ tenantId_code: { tenantId, code } }`): in both
 * cases the key object holds exactly the unique columns.
 *
 * Model names are normalised from the Prisma delegate (`assessmentTypeConfig`)
 * to the schema model (`AssessmentTypeConfig`) so assertions can be written in
 * the vocabulary `NEVER_CLONED` uses.
 *
 * Every delegate call is recorded, reads included. That is what lets
 * `clone.test.ts` assert which models the command touched.
 */
import { mock } from "bun:test";

export type Row = Record<string, unknown>;

export interface RecordedCall {
  readonly model: string;
  readonly op: string;
  readonly args: Record<string, unknown>;
}

/** `assessmentTypeConfig` -> `AssessmentTypeConfig`. */
export function modelName(delegate: string): string {
  return delegate.length === 0 ? delegate : `${delegate[0].toUpperCase()}${delegate.slice(1)}`;
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/** A `where` made of plain column equality, as used by `findFirst` / `count`. */
function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([column, expected]) => canonical(row[column]) === canonical(expected));
}

function orderBy(spec: unknown): (a: Row, b: Row) => number {
  const columns = spec as Record<string, "asc" | "desc"> | undefined;
  const entries = Object.entries(columns ?? {});
  if (entries.length === 0) return () => 0;
  const [[column, direction]] = entries;
  return (a, b) => {
    const left = canonical(a[column]);
    const right = canonical(b[column]);
    return left === right ? 0 : direction === "desc" ? (left < right ? 1 : -1) : left < right ? -1 : 1;
  };
}

export class FakeDatabase {
  readonly calls: RecordedCall[] = [];
  readonly stores = new Map<string, Map<string, Row>>();
  /** How many times `$transaction` was opened. */
  transactions = 0;

  private readonly counters = new Map<string, number>();

  private store(delegate: string): Map<string, Row> {
    const name = modelName(delegate);
    let rows = this.stores.get(name);
    if (!rows) {
      rows = new Map<string, Row>();
      this.stores.set(name, rows);
    }
    return rows;
  }

  private nextId(delegate: string): string {
    const name = modelName(delegate);
    const next = (this.counters.get(name) ?? 0) + 1;
    this.counters.set(name, next);
    return `${name}_${next}`;
  }

  /** Every model name this fake has been asked about, from reads and writes alike. */
  get touchedModels(): string[] {
    return [...new Set(this.calls.map((call) => call.model))].sort();
  }

  countOf(model: string): number {
    return this.store(model).size;
  }

  rowsOf(model: string): Row[] {
    return [...this.store(model).values()];
  }

  /**
   * Seeds a fixture row under a caller-chosen selector, the same kind of key
   * `findUnique` looks up: `{ code }` or `{ tenantId_code: { ... } }`.
   */
  seed(model: string, selector: Record<string, unknown>, data: Row): Row {
    const row: Row = { ...data };
    this.store(model).set(canonical(selector), row);
    return row;
  }

  callsTo(model: string, op?: string): RecordedCall[] {
    const name = modelName(model);
    return this.calls.filter((call) => call.model === name && (op === undefined || call.op === op));
  }

  resetCalls(): void {
    this.calls.length = 0;
  }

  reset(): void {
    this.stores.clear();
    this.counters.clear();
    this.calls.length = 0;
    this.transactions = 0;
  }

  delegate(delegate: string): Record<string, unknown> {
    return new Proxy(
      {},
      {
        get: (_target, property: string | symbol) => {
          if (typeof property !== "string") return undefined;
          return (args: Record<string, unknown> = {}) => {
            this.calls.push({ model: modelName(delegate), op: property, args });
            return Promise.resolve(this.run(delegate, property, args));
          };
        },
      },
    );
  }

  private run(delegate: string, op: string, args: Record<string, unknown>): unknown {
    const rows = this.store(delegate);
    const where = args.where as Record<string, unknown> | undefined;

    switch (op) {
      case "findUnique": {
        if (!where) return null;
        return rows.get(canonical(where)) ?? null;
      }
      case "findFirst":
      case "findMany": {
        const found = [...rows.values()].filter((row) => matches(row, where)).sort(orderBy(args.orderBy));
        return op === "findMany" ? found : (found[0] ?? null);
      }
      case "count":
        return [...rows.values()].filter((row) => matches(row, where)).length;
      case "create": {
        const row: Row = { id: this.nextId(delegate), ...(args.data as Row) };
        rows.set(canonical(row.id), row);
        return row;
      }
      case "update": {
        if (!where) throw new Error(`FakeDatabase: update on ${delegate} without a where clause.`);
        const key = canonical(where);
        // Rows are stored under the selector that created them, so an update by
        // primary key has to fall back to a scan. `seed` keys rows by whatever unique
        // columns the caller chose, so `where: { id }` -- what every production
        // update-by-row looks like -- needs its own fallback comparing the row's id
        // to the requested one.
        let storageKey = rows.has(key) ? key : undefined;
        if (storageKey === undefined && where.id !== undefined) {
          storageKey = [...rows.entries()].find(([, row]) => row.id === where.id)?.[0];
        }
        if (storageKey === undefined) throw new Error(`FakeDatabase: no ${delegate} row for ${key}`);
        const updated = { ...(rows.get(storageKey) as Row), ...(args.data as Row) };
        rows.set(storageKey, updated);
        return updated;
      }
      case "upsert": {
        const key = canonical(where);
        const existing = rows.get(key);
        if (existing) {
          const patch = (args.update as Row | undefined) ?? {};
          const updated = Object.keys(patch).length === 0 ? existing : { ...existing, ...patch };
          rows.set(key, updated);
          return updated;
        }
        const created: Row = { id: this.nextId(delegate), ...(args.create as Row) };
        rows.set(key, created);
        return created;
      }
      default:
        throw new Error(`FakeDatabase: unsupported operation "${op}" on ${delegate}.`);
    }
  }

  /** A client that shares this store, so writes are visible to assertions. */
  transactionClient(): Record<string, unknown> {
    return new Proxy(
      {},
      {
        get: (_target, property: string | symbol) => {
          if (typeof property !== "string") return undefined;
          if (property === "$transaction") {
            return (fn: (tx: unknown) => Promise<unknown>) => fn(this.transactionClient());
          }
          return this.delegate(property);
        },
      },
    );
  }

  get prisma(): Record<string, unknown> {
    const client: Record<string, unknown> = {
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
        this.transactions += 1;
        return fn(this.transactionClient());
      },
    };
    return new Proxy(client, {
      get: (target, property: string | symbol) => {
        if (typeof property !== "string") return undefined;
        if (property in target) return target[property];
        return this.delegate(property);
      },
    });
  }
}

/**
 * Registers the fake as `@novastar/database`.
 *
 * The real module is spread through so that value exports such as `Prisma` and
 * the generated enums keep their identity; only `prisma` is replaced. The real
 * module is captured before `mock.module` is called, because a factory that
 * imports the module it is replacing never resolves.
 *
 * Call this before importing the module under test.
 */
export async function installFakeDatabase(fake: FakeDatabase): Promise<void> {
  const real: Record<string, unknown> = await import("@novastar/database");
  mock.module("@novastar/database", () => ({ ...real, prisma: fake.prisma }));
}