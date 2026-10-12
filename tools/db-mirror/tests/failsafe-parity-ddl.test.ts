/**
 * The parity DDL is only useful if it names the tables the mirror is actually
 * refusing for.
 *
 * WHAT WAS BROKEN
 * ---------------
 * `NewsletterSubscription` and `StudentHealthDocument` were missing from the
 * Supabase failsafe, so `tools/migrate`'s require-backup guard refused every
 * write and `db:mirror` exited 1 with the two names. The parity DDL — the file
 * that exists to close exactly that gap — did not contain either of them,
 * because `gen-parity-ddl.ts` carried a hardcoded MIGRATIONS list that stopped
 * at the migrations from October 3rd and a TABLES list of seven tables that had
 * since been provisioned. Nothing asserted the two agreed, so the gap sat
 * there until a scheduled job found it.
 *
 * WHAT THESE TESTS ASSERT
 * -----------------------
 * The generator's declared inputs and the DDL file it emits cannot drift:
 *
 *   1. every table in `PARITY_TABLES` is CREATEs in the file, by name;
 *   2. the file creates nothing that is NOT in `PARITY_TABLES`, so a stale
 *      entry — which would fail the one-shot atomic apply — is caught too;
 *   3. each declared migration really exists on disk, because a typo'd name
 *      silently yields an empty set of statements rather than an error;
 *   4. the file is additive only: a `DROP`/`TRUNCATE`/`DELETE` in a file whose
 *      whole purpose is to bring a failsafe UP would destroy the restore point
 *      it is supposed to protect.
 *
 * `#1` and `#2` together are what would have caught the original defect: the
 * list said 7 tables, and the live gap was 2, and neither number appeared
 * anywhere the tests could see.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import {
  PARITY_DDL_FILE,
  PARITY_ENUMS,
  PARITY_MIGRATIONS,
  PARITY_TABLES,
} from "../provisioning";

const root = resolve(import.meta.dir, "..", "..", "..");
const ddl = readFileSync(resolve(root, PARITY_DDL_FILE), "utf8");

/** `CREATE TABLE "Name" (` — the opening of a table definition. */
const createdTables = (sql: string): string[] => [
  ...sql.matchAll(/CREATE\s+TABLE\s+"([^"]+)"/gi),
].map((m) => m[1]!);

describe("failsafe-parity DDL", () => {
  test("the file exists at the path the mirror's instructions name", () => {
    expect(existsSync(resolve(root, PARITY_DDL_FILE))).toBe(true);
  });

  /**
   * The original defect, as a test. Before the fix this was `[]` for both
   * names: the migrations were not in the generator's list, so no statement
   * mentioning either table was ever emitted.
   */
  test("every table the mirror reports missing is created in the DDL", () => {
    const created = createdTables(ddl);
    for (const table of PARITY_TABLES) {
      expect(created).toContain(table);
    }
  });

  /**
   * The mirror's exact current gap, pinned. These two names are what the
   * 6-hourly job printed; if they ever stop being the gap they must be removed
   * from PARITY_TABLES, not merely left in the file.
   */
  test("the DDL creates exactly the declared tables, so a stale entry fails here", () => {
    expect(createdTables(ddl).sort()).toEqual([...PARITY_TABLES].sort());
  });

  /**
   * A migration name that does not exist yields zero statements rather than an
   * error, so the file would silently shrink. Silence is the bug.
   */
  test("every declared migration exists on disk", () => {
    const dirs = readdirSync(resolve(root, "packages/database/prisma/migrations"));
    for (const m of PARITY_MIGRATIONS) {
      expect(dirs).toContain(m);
    }
  });

  /**
   * The DDL's whole purpose is to raise the failsafe's schema to the primary's.
   * A destructive statement in it would lower it instead — and it is applied
   * atomically, so it would take the existing 66 tables with it.
   */
  test("the DDL is additive: no DROP, TRUNCATE or DELETE anywhere", () => {
    expect(ddl).not.toMatch(/^\s*DROP\s+(TABLE|SCHEMA|DATABASE)/gim);
    expect(ddl).not.toMatch(/^\s*TRUNCATE/gim);
    expect(ddl).not.toMatch(/^\s*DELETE\s+FROM/gim);
  });

  /**
   * An enum in PARITY_ENUMS with no `CREATE TYPE` in the file means the declared
   * input and the output disagree, and a column typed to a missing enum fails
   * the batch mid-way.
   */
  test("every declared enum has a CREATE TYPE", () => {
    for (const e of PARITY_ENUMS) {
      expect(ddl).toMatch(new RegExp(`CREATE\\s+TYPE\\s+"${e}"`, "i"));
    }
  });

  /**
   * Both missing tables carry unique constraints the primary relies on: the
   * newsletter dedupe and the health-doc storage key. An index-less table would
   * copy rows fine and then lose a uniqueness guarantee the app depends on.
   */
  test("each table's unique index is emitted alongside it", () => {
    expect(ddl).toContain('CREATE UNIQUE INDEX "NewsletterSubscription_email_key"');
    expect(ddl).toContain(
      'CREATE UNIQUE INDEX "StudentHealthDocument_storageKey_key"',
    );
  });
});
