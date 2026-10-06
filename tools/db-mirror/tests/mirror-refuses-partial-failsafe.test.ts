/**
 * `mirror.ts` actually routes through the parity decision — the wiring claim.
 *
 * `failsafe-parity.test.ts` proves the decision function is right. It cannot
 * prove the mirror asks it: the defect this work fixes lived in `mirror.ts`,
 * between the two databases and the function, and a pure-function test would have
 * stayed green while the mirror went on skipping.
 *
 * So this file imports `main()` and gives it a `pg` that is fake. That buys the
 * two assertions that matter and cannot be had any other way:
 *
 *   1. A failsafe missing a table produces an exit code of 1 AND no DDL, no
 *      DML, no `BEGIN`. "Refuses" is a claim about what reached the database;
 *      a refusal that truncated first would be a refusal that emptied the copy.
 *   2. A complete failsafe still copies. A check that always refuses is not a
 *      fix, and only a run that gets past it proves that.
 *
 * What the fake cannot do is pretend to be Postgres. It answers the two
 * `information_schema.tables` queries with rows and everything else empty, so the
 * copy path below the truncation is asserted on the statements issued, never on
 * rows inserted.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

/** One statement the mirror issued, tagged with which database it went to. */
interface Issued {
  readonly side: "neon" | "supabase";
  readonly sql: string;
}

/** The tables each side reports for the case under test. */
interface SideTables {
  readonly neon: readonly string[];
  readonly supabase: readonly string[];
}

/**
 * The live shape: the primary holds the ledger plus two tables the pending
 * migrations are about to create, and the failsafe holds neither.
 *
 * `Announcement` and `RecordAmendment` are in this fixture rather than a
 * ledger-only one because the task statement is right that fixing only the
 * ledger reproduces the same failure on the next migration — and a ledger-only
 * fixture would let that pass.
 */
const PARTIAL: SideTables = {
  neon: [
    "AcademicYear",
    "Announcement",
    "AuditLog",
    "RecordAmendment",
    "Role",
    "_prisma_migrations",
  ],
  supabase: ["AcademicYear", "AuditLog", "Role"],
};

/** The shape after the parity DDL has been applied and the mirror re-run. */
const COMPLETE: SideTables = {
  neon: ["AcademicYear", "AuditLog", "Role", "_prisma_migrations"],
  supabase: ["AcademicYear", "AuditLog", "Role", "_prisma_migrations"],
};

const NEON_HOST =
  "postgresql://u:p@ep-fake-0000-pooler.c-7.us-east-2.aws.neon.tech/neondb";
const SUPABASE_HOST =
  "postgresql://u:p@aws-1-eu-west-1.pooler.supabase.com:6543/postgres";

// ---------------------------------------------------------------------------
// Module scope, in this order, and not inside a hook.
//
// Everything above the `mock.module` call is the truth about `pg`. Everything
// after it is this file's own doing, and `afterAll` puts the real module back so
// a sibling test in this package that imports `pg` for real is unaffected.
// ---------------------------------------------------------------------------

const realPg = await import("pg");

/** Every statement the fake was asked to run, across the current test. */
const issued: Issued[] = [];

/** Which tables each side reports. Rewritten by `beforeEach`, never mid-run. */
let currentTables: SideTables = PARTIAL;

class FakeClient {
  private readonly side: "neon" | "supabase";
  private readonly tables: readonly string[];

  constructor(config: { connectionString: string }) {
    // The side comes from the connection string rather than an argument,
    // because `mirror.ts` decides which database it is talking to from the URL
    // and a fake that trusted a passed-in value would assert nothing about that.
    const host = new URL(
      config.connectionString.replace(":6543/", ":5432/"),
    ).hostname;
    this.side = host.includes("neon") ? "neon" : "supabase";
    this.tables = currentTables[this.side];
  }

  async connect(): Promise<void> {}

  async end(): Promise<void> {}

  async query(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    issued.push({ side: this.side, sql });
    if (/FROM information_schema\.tables/.test(sql)) {
      return { rows: this.tables.map((table_name) => ({ table_name })) };
    }
    if (/FROM information_schema\.columns/.test(sql)) {
      // One column per table is enough for the copy path to reach its INSERTs,
      // which is what the `TRUNCATE` assertions need to exist at all.
      return { rows: [{ column_name: "id" }] };
    }
    return { rows: [{ n: 0 }] };
  }
}

mock.module("pg", () => ({ ...realPg, Client: FakeClient }));

afterAll(() => {
  mock.module("pg", () => realPg);
});

const ENV_KEYS = ["DATABASE_URL", "SUPABASE_DATABASE_URL"] as const;
const envBefore = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

const { main } = await import("../mirror");

let errors: string[] = [];
let logs: string[] = [];
let silenced: { mockRestore(): void }[] = [];

beforeEach(() => {
  // Fake hosts, so nothing in this file can reach a real database even if a
  // future change made the fake connect for real.
  process.env.DATABASE_URL = NEON_HOST;
  process.env.SUPABASE_DATABASE_URL = SUPABASE_HOST;
  issued.length = 0;
  currentTables = PARTIAL;
  errors = [];
  logs = [];
  // Not `mock.restore()`: that would undo the `pg` module mock above and leave
  // the second test of the file talking to a real driver. The two console spies
  // are restored by hand instead, and `pg` is restored once in `afterAll`.
  silenced = [
    spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errors.push(a.map(String).join(" "));
    }),
    spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    }),
  ];
});

afterEach(() => {
  for (const s of silenced) s.mockRestore();
  for (const [k, v] of envBefore) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** Everything the mirror said, on either stream. */
const said = () => [...logs, ...errors].join("\n");

/** True when any statement issued anywhere would write. */
const wroteAnything = () =>
  issued.some(({ sql }) =>
    /\b(TRUNCATE|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i.test(sql),
  );

describe("main() against a failsafe whose schema is partial", () => {
  test("exits 1 and writes nothing at all", async () => {
    const code = await main({ verifyOnly: false });
    expect(code).toBe(1);
    // The load-bearing assertion. A refusal that truncated and re-inserted the
    // matching tables would leave the failsafe looking refreshed and still
    // unrestorable, which is the failure being fixed.
    expect(wroteAnything()).toBe(false);
    expect(issued.some(({ sql }) => /BEGIN/i.test(sql))).toBe(false);
  });

  test("says which tables are missing and how to provision them", async () => {
    const code = await main({ verifyOnly: false });
    const output = said();
    expect(code).toBe(1);
    for (const table of ["Announcement", "RecordAmendment", "_prisma_migrations"]) {
      expect(output).toContain(table);
    }
    expect(output).toContain("apply-schema.ts");
    expect(output).toContain("--dry-run");
    // The old wording, pinned: "skipped" is the defect in one word.
    expect(output).not.toContain("skipped");
  });

  test("never claims the mirror was verified", async () => {
    await main({ verifyOnly: false });
    expect(said()).not.toContain("MIRROR VERIFIED");
  });

  /**
   * `--verify-only` is how `bun run db:mirror:verify` runs, and CI reaches it
   * without a write path. If it skipped the check it would exit 0 over a failsafe
   * `require-backup` is about to refuse — the same green-for-a-broken-backup the
   * copy path used to produce.
   */
  test("--verify-only still refuses to call a partial failsafe verified", async () => {
    const code = await main({ verifyOnly: true });
    expect(code).toBe(1);
    expect(wroteAnything()).toBe(false);
    expect(said()).toContain("NOT VERIFIED");
  });

  test("opens Neon read-only before anything else", async () => {
    await main({ verifyOnly: false });
    const guard = issued.findIndex(
      ({ side, sql }) =>
        side === "neon" && /default_transaction_read_only\s*=\s*on/i.test(sql),
    );
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(wroteAnything()).toBe(false);
  });
});

describe("main() against a complete failsafe", () => {
  test("copies, and exits 0", async () => {
    currentTables = COMPLETE;
    const code = await main({ verifyOnly: false });
    expect(code).toBe(0);
    expect(issued.some(({ sql }) => /TRUNCATE TABLE/i.test(sql))).toBe(true);
    expect(said()).toContain("MIRROR VERIFIED");
  });

  /**
   * A check that always refuses is not a fix. This is the test that says the
   * happy path still works, and it dies against a `parityRefusalReason` that
   * returns a reason unconditionally.
   */
  test("--verify-only over a complete failsafe writes nothing and exits 0", async () => {
    currentTables = COMPLETE;
    const code = await main({ verifyOnly: true });
    expect(code).toBe(0);
    expect(wroteAnything()).toBe(false);
    expect(issued.some(({ sql }) => /TRUNCATE TABLE/i.test(sql))).toBe(false);
  });

  test("the ledger is mirrored like any other table, with no special case", async () => {
    currentTables = COMPLETE;
    await main({ verifyOnly: false });
    const truncate = issued.find(({ sql }) => /TRUNCATE TABLE/i.test(sql))!;
    expect(truncate.sql).toContain("_prisma_migrations");
  });
});