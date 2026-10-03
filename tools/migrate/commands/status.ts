/**
 * `status` — the read-only pre-flight.
 *
 * Reports three things that can disagree and normally do, and exits non-zero
 * when they do:
 *
 *   1. the migrations checked into `packages/database/prisma/migrations`
 *   2. the rows in `_prisma_migrations`
 *   3. the tables actually in the live database
 *
 * **This command writes nothing.** The connection is opened with
 * `default_transaction_read_only = on`, so that is a property of the session
 * rather than a promise in a comment, and the only Prisma call involved is
 * `migrate diff --from-empty`, which Prisma documents as read-only and which
 * needs no database at all.
 *
 * A pending migration counts as a disagreement on purpose. In CI that is the
 * early warning that a deploy is owed, which is the whole reason this command
 * exists. Pass `--allow-pending` to downgrade that to a warning.
 */
import { readdirSync } from "node:fs";
import { databasePackageDir, redact, type Target } from "../env";
import { migrationsDir, prismaVersion } from "../prisma";
import {
  collectSnapshot,
  digestSnapshot,
  openReadOnly,
  LEDGER_TABLE,
  type Queryable,
} from "../fingerprints/tables";
import { schemaFingerprint } from "../fingerprints/schema";
import { heading, line, success, warn, type Context } from "../log";

export interface LedgerRow {
  readonly migration_name: string;
  readonly started_at: Date | string | null;
  readonly finished_at: Date | string | null;
  readonly rolled_back_at: Date | string | null;
  readonly applied_steps_count: number | null;
  readonly logs: string | null;
}

const LEDGER_SQL = `
  SELECT migration_name, started_at, finished_at, rolled_back_at,
         applied_steps_count, logs
    FROM ${LEDGER_TABLE}
   ORDER BY migration_name`;

/** Migration directory names on disk, oldest first. */
export function migrationsOnDisk(): string[] {
  return readdirSync(migrationsDir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
}

export async function ledgerExists(q: Queryable): Promise<boolean> {
  const { rows } = await q.query(
    `SELECT 1 AS present FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    [LEDGER_TABLE],
  );
  return rows.length > 0;
}

/**
 * The ledger, read directly rather than parsed out of `prisma migrate status`
 * text: `rolled_back_at` and a half-applied row are exactly the two states
 * that matter, and neither is legible in the human output.
 */
export async function readLedger(q: Queryable): Promise<LedgerRow[] | undefined> {
  if (!(await ledgerExists(q))) return undefined;
  const { rows } = await q.query(LEDGER_SQL);
  return rows as unknown as LedgerRow[];
}

export interface LedgerComparison {
  /** On disk and recorded as finished. */
  readonly applied: readonly string[];
  /** On disk, not in the ledger: a deploy is owed. */
  readonly pending: readonly string[];
  /** In the ledger, marked rolled back: Prisma will not re-run these. */
  readonly rolledBack: readonly string[];
  /** Finished or rolled back, i.e. not pending. */
  readonly settled: readonly string[];
  /** Recorded as started and never finished or rolled back. */
  readonly failed: readonly string[];
  /** In the ledger but not on disk: the repo has lost history. */
  readonly unknown: readonly string[];
  /** True when a migration is recorded as partially applied. */
  readonly hasFailed: boolean;
  /** True when the three sources can be made to agree by deploying. */
  readonly drifted: boolean;
}

/** Pure, so the classification is testable without a database. */
export function compareLedger(
  onDisk: readonly string[],
  ledger: readonly LedgerRow[] | undefined,
): LedgerComparison {
  if (ledger === undefined) {
    // No ledger at all. Every checked-in migration is pending, and there is no
    // history to compare, which is the `db push` state this repo is in.
    return {
      applied: [],
      pending: [...onDisk],
      rolledBack: [],
      settled: [],
      failed: [],
      unknown: [],
      hasFailed: false,
      drifted: onDisk.length > 0,
    };
  }

  const applied: string[] = [];
  const rolledBack: string[] = [];
  const failed: string[] = [];
  const settled = new Set<string>();
  /** Anything with a ledger row at all, so `migrate deploy` will not re-run it. */
  const recorded = new Set<string>();

  for (const row of ledger) {
    recorded.add(row.migration_name);
    if (row.rolled_back_at) {
      rolledBack.push(row.migration_name);
      settled.add(row.migration_name);
    } else if (row.finished_at) {
      applied.push(row.migration_name);
      settled.add(row.migration_name);
    } else {
      failed.push(row.migration_name);
    }
  }

  const present = new Set(onDisk);
  const unknown = [...settled].filter((name) => !present.has(name)).sort();
  // A failed migration is excluded on purpose: it has a ledger row, so
  // `migrate deploy` reports it and stops rather than trying it again.
  // Reporting it as pending as well would invite a second deploy, which is the
  // failure mode this whole tool exists to prevent.
  const pending = onDisk.filter((name) => !recorded.has(name));

  return {
    applied: applied.sort(),
    pending,
    rolledBack: rolledBack.sort(),
    settled: [...settled].sort(),
    failed: failed.sort(),
    unknown,
    hasFailed: failed.length > 0,
    drifted: pending.length > 0 || unknown.length > 0 || failed.length > 0,
  };
}

const asText = (v: Date | string | null): string =>
  v === null ? "-" : v instanceof Date ? v.toISOString() : v;

export interface StatusOptions {
  readonly target: Target;
  /** Do not treat a pending migration as a failure. */
  readonly allowPending: boolean;
}

export interface StatusOutcome {
  readonly comparison: LedgerComparison;
  /** One human sentence per disagreement. */
  readonly problems: readonly string[];
  /** True when status should exit non-zero. */
  readonly failed: boolean;
}

/** The whole of `status`, factored out so `deploy` can reuse it. */
export async function inspectStatus(
  ctx: Context,
  options: StatusOptions,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<StatusOutcome> {
  const onDisk = migrationsOnDisk();
  const client = await openReadOnly(options.target.url);
  try {
    const ledger = await readLedger(client);
    const snapshot = await collectSnapshot(client);
    const comparison = compareLedger(onDisk, ledger);

    if (!quiet) {
      heading("migrations on disk");
      for (const name of onDisk) line(`  ${name}`);
      line(`  (${onDisk.length})`);

      heading(`ledger: ${LEDGER_TABLE}`);
      if (ledger === undefined) {
        warn(
          `${LEDGER_TABLE} does not exist. The schema was built with ` +
            "`prisma db push`, so there is no history to compare against. Run " +
            "`baseline` to record one.",
        );
      } else {
        for (const row of ledger) {
          const state = row.rolled_back_at
            ? "rolled back"
            : row.finished_at
              ? "applied"
              : "FAILED (started, never finished)";
          line(`  ${row.migration_name}  ${state}`);
          line(
            `      started=${asText(row.started_at)} finished=${asText(row.finished_at)} ` +
              `rolled_back=${asText(row.rolled_back_at)}`,
          );
        }
      }

      heading("live schema");
      line(`  tables: ${snapshot.tables.length}`);
      line(`  enums: ${snapshot.enums.length}`);
      line(`  digest: ${digestSnapshot(snapshot)}`);
    }

    const problems: string[] = [];
    if (comparison.hasFailed) {
      problems.push(
        `partially applied migration(s): ${comparison.failed.join(", ")}. ` +
          "A ledger row with no finished_at means the DDL stopped partway. " +
          "A human has to decide: `rollback` prints the options.",
      );
    }
    if (comparison.unknown.length > 0) {
      problems.push(
        `recorded in the ledger but absent from prisma/migrations: ` +
          `${comparison.unknown.join(", ")}. The repository has lost history.`,
      );
    }
    if (comparison.pending.length > 0) {
      const line_ =
        `not yet applied: ${comparison.pending.join(", ")}. ` +
        "Run `deploy`, or `baseline` if the live schema already has them.";
      if (options.allowPending) warn(line_);
      else problems.push(line_);
    }

    return { comparison, problems, failed: problems.length > 0 };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface StatusCommandOptions {
  readonly target: Target;
  readonly allowPending: boolean;
  /** Also hash `schema.prisma` through Prisma. Offline, adds a subprocess. */
  readonly showSchema: boolean;
}

export async function runStatus(ctx: Context, options: StatusCommandOptions): Promise<void> {
  console.log(
    `[migrate] target ${options.target.kind} ${redact(options.target.url)} ` +
      `(${options.target.source})`,
  );
  console.log(`[migrate] prisma ${prismaVersion()} at ${databasePackageDir()}`);

  const outcome = await inspectStatus(ctx, { target: options.target, allowPending: options.allowPending });
  const { comparison } = outcome;

  if (options.showSchema) {
    heading("schema.prisma");
    const fingerprint = await schemaFingerprint();
    line(`  digest: ${fingerprint.digest}`);
    line(`  statements: ${fingerprint.statements}`);
  }

  heading("summary");
  line(`  applied:    ${comparison.applied.length}`);
  line(`  pending:    ${comparison.pending.length}`);
  line(`  rolled back:${comparison.rolledBack.length}`);
  line(`  failed:     ${comparison.failed.length}`);
  line(`  unknown:    ${comparison.unknown.length}`);

  if (outcome.failed) {
    throw new Error(
      `migration state disagrees with the checked-in migrations:\n  - ` +
        `${outcome.problems.join("\n  - ")}\n` +
        "Nothing was written; this command is read-only.",
    );
  }

  success(
    ctx,
    options.allowPending
      ? `ledger and migrations agree (${comparison.pending.length} pending allowed)`
      : "ledger and migrations agree",
  );
}
