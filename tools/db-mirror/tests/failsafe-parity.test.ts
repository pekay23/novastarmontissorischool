/**
 * The failsafe-parity decision, tested where it can be reached.
 *
 * WHAT WAS BROKEN
 * ---------------
 * `mirror.ts` computed `onlyNeon = neonTables.filter((t) => !supaTables.has(t))`,
 * printed it as `Missing on Supabase (skipped)`, mirrored the tables that were
 * shared, and then exited 0 having printed "MIRROR VERIFIED". A failsafe missing
 * `_prisma_migrations` therefore reported healthy. `require-backup.ts` — which is
 * correct and is NOT changed by this work — refused every deploy with "a mirror
 * missing tables is not a backup", so the operator was told the mirror was fine by
 * the mirror and told it was not a backup by the guard, with nothing explaining
 * the gap.
 *
 * WHY THESE TESTS EXIST IN TWO FILES' WORTH OF BEHAVIOUR, NOT ONE
 * --------------------------------------------------------------
 * Two distinct claims are load-bearing and they break differently:
 *
 *   1. `compareFailsafeParity` and its helpers get the answer right. Pure, and
 *      tested as pure below.
 *   2. `mirror.ts` ACTUALLY ROUTES THROUGH THAT ANSWER. That is a wiring fact
 *      about a script whose I/O is two live databases, which no unit test can
 *      reach. It is covered by importing `main()` with a fake `pg` and asserting
 *      on the SQL that was issued — which is stronger than reading the source,
 *      because a fake `Client` records every statement and the refusal's whole
 *      claim is "issued no DDL and no DML".
 *
 * Every test below is paired with the mutation it kills; see the report. Two
 * mutations are NOT killable and are named as such at the end of this file.
 */
import { describe, expect, test } from "bun:test";
import {
  compareFailsafeParity,
  formatParityReport,
  parityRefusalReason,
  provisioningCommands,
  LEDGER_TABLE,
  PARITY_DDL_FILE,
  type FailsafeParity,
} from "../provisioning";

/**
 * The two-database shape this work started from, named so a reader can see the
 * defect without scrolling: the primary has 6 tables and the failsafe 3, and the
 * three that differ are the ledger plus the two the pending migrations create.
 */
const PARTIAL_GAP = {
  primary: [
    "AcademicYear",
    "Announcement",
    "AuditLog",
    "RecordAmendment",
    "Role",
    LEDGER_TABLE,
  ],
  failsafe: ["AcademicYear", "AuditLog", "Role"],
} as const;

/** The same gap reduced to the ledger alone, which is how it presented today. */
const LEDGER_GAP = {
  primary: ["AcademicYear", "AuditLog", "Role", LEDGER_TABLE],
  failsafe: ["AcademicYear", "AuditLog", "Role"],
} as const;

describe("compareFailsafeParity", () => {
  test("the live defect: tables missing on the failsafe are not parity", () => {
    const parity = compareFailsafeParity(PARTIAL_GAP.primary, PARTIAL_GAP.failsafe);
    expect(parity.complete).toBe(false);
    expect(parity.missingOnFailsafe).toEqual([
      "Announcement",
      "RecordAmendment",
      LEDGER_TABLE,
    ]);
    expect(parity.shared).toEqual(["AcademicYear", "AuditLog", "Role"]);
  });

  test("the ledger alone is named as missing, with nothing else", () => {
    const parity = compareFailsafeParity(LEDGER_GAP.primary, LEDGER_GAP.failsafe);
    expect(parity.complete).toBe(false);
    expect(parity.missingOnFailsafe).toEqual([LEDGER_TABLE]);
    expect(parity.shared).toEqual(["AcademicYear", "AuditLog", "Role"]);
  });

  /**
   * The case the task statement calls out: fixing only the ledger would pass the
   * test above and still fail the very next deploy. `RecordAmendment` and
   * `Announcement` arrive in the same shape as the ledger and must be named with
   * it, not special-cased away.
   */
  test("a table about to be migrated is named alongside the ledger, not after it", () => {
    const parity = compareFailsafeParity(PARTIAL_GAP.primary, PARTIAL_GAP.failsafe);
    expect(parity.missingOnFailsafe).toContain("Announcement");
    expect(parity.missingOnFailsafe).toContain("RecordAmendment");
    expect(parity.missingOnFailsafe).toHaveLength(3);
  });

  test("a failsafe table the primary does not have is extra, never missing", () => {
    const parity = compareFailsafeParity(
      ["School", "Tenant"],
      ["School", "Tenant", "LegacyImport"],
    );
    expect(parity.missingOnFailsafe).toEqual([]);
    expect(parity.extraOnFailsafe).toEqual(["LegacyImport"]);
    expect(parity.complete).toBe(true);
  });

  /**
   * Order-insensitive input, deterministic output. `listTables` orders by name on
   * both sides today, but two databases disagreeing about collation is not the
   * thing that should decide whether a mirror reports itself as complete — and a
   * plan that reorders run to run makes two runs impossible to diff.
   */
  test("output is sorted, so input order cannot change the plan", () => {
    const a = compareFailsafeParity(["Zebra", "Apple", "Mango"], ["Apple"]);
    const b = compareFailsafeParity(["Mango", "Zebra", "Apple"], ["Apple"]);
    expect(a.missingOnFailsafe).toEqual(["Mango", "Zebra"]);
    expect(b).toEqual(a);
  });

  test("a duplicated input name is collapsed, not provisioned twice", () => {
    const parity = compareFailsafeParity(["Announcement", "Announcement"], ["School"]);
    expect(parity.missingOnFailsafe).toEqual(["Announcement"]);
  });

  test("two empty databases are complete; one empty side is not", () => {
    expect(compareFailsafeParity([], []).complete).toBe(true);
    expect(compareFailsafeParity(["School"], []).complete).toBe(false);
  });
});

describe("parityRefusalReason", () => {
  test("a complete failsafe is given permission, as null rather than as a flag", () => {
    expect(parityRefusalReason(compareFailsafeParity(["School"], ["School"]))).toBeNull();
  });

  /**
   * The reason must name every table and say what is wrong, because it is the
   * only thing between the operator and `bun run db:mirror` returning 0 forever
   * with a partial failsafe. A reason that said only "parity check failed" would
   * reproduce the original defect in prose.
   */
  test("the refusal names every missing table and the consequence", () => {
    const parity = compareFailsafeParity(PARTIAL_GAP.primary, PARTIAL_GAP.failsafe);
    const reason = parityRefusalReason(parity)!;
    expect(reason).toContain(LEDGER_TABLE);
    expect(reason).toContain("Announcement");
    expect(reason).toContain("RecordAmendment");
    expect(reason).toContain("3 table(s)");
    expect(reason).toContain("not a backup");
  });
});

describe("provisioningCommands", () => {
  test("dry run is offered before the apply, and the apply carries --allow-nonempty", () => {
    const cmds = provisioningCommands([LEDGER_TABLE]);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toContain("--dry-run");
    expect(cmds[1]).not.toContain("--dry-run");
    expect(cmds[0]!.indexOf("--dry-run")).toBeLessThan(cmds[1]!.length);
    // The failsafe is populated by definition, so an apply that omits this
    // refuses on the very database it exists to repair.
    for (const cmd of cmds) expect(cmd).toContain("--allow-nonempty");
  });

  test("the target is the failsafe, never the primary", () => {
    for (const cmd of provisioningCommands([LEDGER_TABLE])) {
      expect(cmd).toContain("supabase");
      expect(cmd).not.toMatch(/\bneon\b/);
    }
  });

  test("the named DDL file is the one the report points at", () => {
    expect(provisioningCommands([LEDGER_TABLE])[0]).toContain(PARITY_DDL_FILE);
  });

  test("the file is overridable, so the caller can point at a real path", () => {
    expect(provisioningCommands(["X"], "tmp/x.sql")[0]).toContain("tmp/x.sql");
  });
});

describe("formatParityReport", () => {
  /**
   * The literal string the old code printed. Pinned because "skipped" is the
   * whole defect in two words: it told the operator a class of loss was a
   * deliberate choice.
   */
  test("never describes a missing table as skipped", () => {
    const parity = compareFailsafeParity(PARTIAL_GAP.primary, PARTIAL_GAP.failsafe);
    expect(formatParityReport(parity)).not.toContain("skipped");
  });

  test("names every missing table and gives the two commands to run", () => {
    const parity = compareFailsafeParity(PARTIAL_GAP.primary, PARTIAL_GAP.failsafe);
    const report = formatParityReport(parity);
    for (const table of ["Announcement", "RecordAmendment", LEDGER_TABLE]) {
      expect(report).toContain(table);
    }
    expect(report).toContain(PARITY_DDL_FILE);
    expect(report).toContain("--dry-run");
  });

  /**
   * The ledger is reported with what it is, because it is the table an operator
   * is most likely to talk themselves out of provisioning: it is "just
   * bookkeeping". The reason it must be provisioned anyway is in the same block.
   */
  test("the ledger is labelled as Prisma's, with the reason it belongs there", () => {
    const parity = compareFailsafeParity([LEDGER_TABLE], []);
    const report = formatParityReport(parity);
    expect(report).toContain("Prisma ledger");
    expect(report).toContain("max(finished_at)");
    expect(report).toContain("never itself be a migrate deploy target");
  });

  test("a complete failsafe with nothing extra prints nothing at all", () => {
    expect(formatParityReport(compareFailsafeParity(["School"], ["School"]))).toBe("");
  });

  test("an extra failsafe table is reported but does not read as a loss", () => {
    const parity = compareFailsafeParity(["School"], ["School", "LegacyImport"]);
    const report = formatParityReport(parity);
    expect(report).toContain("LegacyImport");
    expect(report).toContain("left alone");
    expect(report).not.toContain("must be provisioned");
  });
});

/**
 * Two claims no test in this file kills, stated rather than papered over:
 *
 * 1. `normalize()` in mirror.ts — the JSONB/ARRAY parameter marshalling. It is
 *    only reachable with a real driver round-tripping a real row, and a fake
 *    `pg` cannot exercise it. Untested before this work and untested after.
 *
 * 2. The `default_transaction_read_only` guard on the Neon session. Asserting it
 *    would mean asserting that the mirror opens production read-only, and the
 *    only honest way to assert that is to look at the session's
 *    `transaction_read_only` afterwards, from a real connection, in an
 *    integration test this repo does not have. The statement is asserted here
 *    as text only, which proves the call is made and nothing about its effect.
 *
 * The `pg`-faked run in `mirror-refuses-partial-failsafe.test.ts` asserts the
 * SQL that WAS issued. That is what makes claim 2 above partly meaningful: the
 * fake records the statement, so a mutation that deletes it dies.
 */
export type { FailsafeParity };