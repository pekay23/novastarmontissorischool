/**
 * `rollback` — guidance, not automation.
 *
 * Prisma has no down-migration. Nothing does: reversing DDL is a decision
 * about data, not a mechanical inverse, and an automated version of it is how
 * a rollback deletes the row a customer is about to dispute. So this command
 * **writes nothing**, ever. It reads the ledger, reads the migration file from
 * disk, and prints what a human needs in order to decide.
 *
 * What it prints:
 *   - the last applied migrations, newest first
 *   - the SQL that migration actually ran, verbatim, for review
 *   - the exact `migrate resolve --rolled-back` command for the ledger
 *   - the two ways the database can be brought back, and their consequences
 *
 * Reversing the ledger and reversing the schema are separate acts. Marking a
 * migration rolled back tells Prisma not to run it again; it does not undo
 * anything it already did. Both are printed so neither is mistaken for the
 * other.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { databasePackageDir, redact, type Target } from "../env";
import { migrationsDir, prismaVersion } from "../prisma";
import { openReadOnly } from "../fingerprints/tables";
import { heading, line, success, warn, type Context } from "../log";
import { readLedger, type LedgerRow } from "./status";

export const ROLLBACK_MECHANISM = "read-only ledger inspection (writes nothing)";

export interface RollbackOptions {
  readonly target: Target;
  /** `--migration <name>`; otherwise the most recently finished. */
  readonly migration?: string;
  /** How many applied migrations to list. */
  readonly limit: number;
  /** Lines of migration SQL to show. */
  readonly sqlLines: number;
}

/** Newest first by `finished_at`. Pure, so the ordering is testable. */
export function byMostRecent(rows: readonly LedgerRow[]): LedgerRow[] {
  const at = (r: LedgerRow): number => {
    const v = r.finished_at ?? r.started_at;
    if (v === null) return 0;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  return [...rows].sort((a, b) => at(b) - at(a));
}

const asText = (v: Date | string | null): string =>
  v === null ? "NULL" : v instanceof Date ? v.toISOString() : v;

export async function runRollback(ctx: Context, options: RollbackOptions): Promise<void> {
  console.log(
    `[migrate] target ${options.target.kind} ${redact(options.target.url)} ` +
      `(${options.target.source})`,
  );
  console.log(`[migrate] prisma ${prismaVersion()} at ${databasePackageDir()}`);

  const client = await openReadOnly(options.target.url);
  let ledger: LedgerRow[] | undefined;
  try {
    ledger = await readLedger(client);
  } finally {
    await client.end().catch(() => undefined);
  }

  if (ledger === undefined) {
    throw new Error(
      "_prisma_migrations does not exist, so there is no recorded history to " +
        "roll back. This database was built with `prisma db push`; it is not " +
        "in a rolled-back state, it is an untracked one. Run `baseline` if the " +
        "schema on disk is what is actually live.",
    );
  }

  const applied = byMostRecent(ledger).filter(
    (r) => r.finished_at !== null && r.rolled_back_at === null,
  );

  heading("applied migrations, most recent first");
  if (applied.length === 0) {
    line("  (none)");
  }
  for (const row of applied.slice(0, options.limit)) {
    line(
      `  ${row.migration_name}  finished=${asText(row.finished_at)} ` +
        `steps=${row.applied_steps_count ?? "?"}`,
    );
  }

  const unfinished = ledger.filter(
    (r) => r.finished_at === null && r.rolled_back_at === null,
  );
  if (unfinished.length > 0) {
    heading("started but never finished — these are the ones to deal with first");
    for (const row of unfinished) {
      line(
        `  ${row.migration_name}  started=${asText(row.started_at)} ` +
          `steps=${row.applied_steps_count ?? "?"}`,
      );
    }
  }

  const chosen =
    options.migration !== undefined
      ? ledger.find((r) => r.migration_name === options.migration)
      : applied[0];

  if (chosen === undefined) {
    success(ctx, "nothing to roll back; this command wrote nothing");
    return;
  }

  heading(`migration under consideration: ${chosen.migration_name}`);
  const sqlPath = resolve(migrationsDir(), chosen.migration_name, "migration.sql");
  let sql: string[];
  try {
    sql = readFileSync(sqlPath, "utf-8").split(/\r?\n/);
  } catch {
    warn(`no migration.sql at ${sqlPath}; it may not be in this repository.`);
    sql = [];
  }
  const shown = sql.slice(0, options.sqlLines);
  heading(`what it ran (first ${shown.length} of ${sql.length} lines, not executed)`);
  for (const l of shown) line(`  ${l}`);
  if (sql.length > shown.length) line("  ...");

  heading("what a human has to do, in this order");
  line(
    "  1. Decide whether the schema or the data is the thing you are reversing.\n" +
      "     Reversing schema loses the data in the affected tables. Reversing data\n" +
      "     does not change the schema. They are different operations.",
  );
  line(
    "  2. Author the reversal by hand from the SQL above. There is no automated\n" +
      "     down-migration, and this tool will not write one.",
  );
  line(
    `  3. Tell Prisma not to re-apply the migration:\n` +
      `       DATABASE_URL=<target> prisma migrate resolve --rolled-back ${chosen.migration_name}\n` +
      "     This edits the ledger only. It is not a substitute for step 2.",
  );
  line(
    "  4. Re-check with `verify` and `status`. Both are read-only and both must\n" +
      "     agree before the next deploy.",
  );

  success(ctx, `printed the manual rollback plan for ${chosen.migration_name}; nothing was written`);
}
