/**
 * `verify` — does the live schema match `schema.prisma`?
 *
 * The answer comes from Prisma, not from a comparison this tool invented:
 *
 *     prisma migrate diff --exit-code \
 *       --from-config-datasource --to-schema prisma/schema.prisma
 *
 * Exit 0 means empty diff, 2 means the database differs, 1 means the
 * comparison itself failed. `migrate diff` is documented read-only and writes
 * to neither datasource, so this command cannot change the database.
 *
 * When there is drift, the same comparison is re-run with `--script` to render
 * what Prisma would do, and the quoted identifiers in that script are
 * intersected with the tables that actually exist so the report names the
 * tables instead of dumping SQL.
 */
import { databasePackageDir, redact, type Target } from "../env";
import { prismaVersion, runPrisma, schemaPath, type PrismaResult } from "../prisma";
import { tablesTouchedBy } from "../fingerprints/schema";
import { collectSnapshot, digestSnapshot, openReadOnly } from "../fingerprints/tables";
import { heading, line, success, warn, type Context } from "../log";

export const VERIFY_MECHANISM = "prisma migrate diff (read-only)";

/** `migrate diff --exit-code` uses 2 for "not empty". */
export const DRIFT_EXIT = 2;

export interface VerifyOptions {
  readonly target: Target;
  /** Print the SQL Prisma would run to close the gap. */
  readonly showScript: boolean;
  /** Lines of SQL to print when showing the script. */
  readonly sqlLines: number;
}

export interface VerifyOutcome {
  readonly inSync: boolean;
  readonly driftSql: string;
  readonly tables: readonly string[];
  readonly error?: string;
}

/**
 * A plain, human-readable diff. Used as a fallback if `--script` fails, since
 * without `--exit-code` Prisma renders the same comparison as a summary.
 */
function diffArgs(exitCode: boolean, script: boolean): string[] {
  const args = ["migrate", "diff"];
  if (exitCode) args.push("--exit-code");
  args.push("--from-config-datasource", "--to-schema", schemaPath());
  if (script) args.push("--script");
  return args;
}

function childEnv(target: Target): NodeJS.ProcessEnv {
  // Prisma resolves `DATABASE_URL || DIRECT_URL` in prisma.config.ts. Handing
  // it the URL this tool selected makes the two agree by construction.
  return { DATABASE_URL: target.url };
}

export async function inspectSchema(
  options: VerifyOptions,
): Promise<VerifyOutcome> {
  const verdict: PrismaResult = await runPrisma(diffArgs(true, false), {
    env: childEnv(options.target),
  });

  if (verdict.code === 0) {
    return { inSync: true, driftSql: "", tables: [] };
  }
  if (verdict.code !== DRIFT_EXIT) {
    return {
      inSync: false,
      driftSql: "",
      tables: [],
      error:
        `prisma migrate diff exited ${verdict.code} rather than ${DRIFT_EXIT}; ` +
        `the comparison did not run.\n${verdict.output.trim()}`,
    };
  }

  const script = options.showScript
    ? await runPrisma(diffArgs(false, true), { env: childEnv(options.target) })
    : { stdout: "" };

  const tables = await touchedTables(script.stdout, options.target);
  return { inSync: false, driftSql: script.stdout, tables };
}

async function touchedTables(
  sql: string,
  target: Target,
): Promise<readonly string[]> {
  if (sql.trim() === "") return [];
  const client = await openReadOnly(target.url);
  try {
    const snapshot = await collectSnapshot(client);
    return tablesTouchedBy(
      sql,
      snapshot.tables.map((t) => t.name),
    );
  } catch {
    // Naming the tables is a nicety; the authoritative answer is the exit
    // code, so a failed introspection must not mask the drift.
    return [];
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runVerify(ctx: Context, options: VerifyOptions): Promise<void> {
  console.log(
    `[migrate] target ${options.target.kind} ${redact(options.target.url)} ` +
      `(${options.target.source})`,
  );
  console.log(`[migrate] prisma ${prismaVersion()} at ${databasePackageDir()}`);

  const outcome = await inspectSchema(options);

  const client = await openReadOnly(options.target.url);
  try {
    const snapshot = await collectSnapshot(client);
    heading("digests");
    line(`  live schema: ${digestSnapshot(snapshot)}`);
  } finally {
    await client.end().catch(() => undefined);
  }

  if (outcome.error !== undefined) {
    throw new Error(outcome.error);
  }

  if (outcome.inSync) {
    success(ctx, "the live schema matches schema.prisma exactly");
    return;
  }

  heading("drift");
  if (outcome.tables.length > 0) {
    line(`  tables Prisma wants to change: ${outcome.tables.join(", ")}`);
  } else {
    warn("could not attribute the drift to named tables");
  }
  if (options.showScript && outcome.driftSql.trim() !== "") {
    const sqlLines = outcome.driftSql.split(/\r?\n/).slice(0, options.sqlLines);
    heading(`SQL Prisma would run (first ${sqlLines.length} lines, not executed)`);
    for (const l of sqlLines) line(`  ${l}`);
    if (outcome.driftSql.split(/\r?\n/).length > sqlLines.length) {
      line("  ...");
    }
  }
  throw new Error(
    "the live schema does not match schema.prisma. Review the diff above, " +
      "then either commit a migration for it or run `baseline` if the ledger " +
      "is what is out of step. Nothing was written.",
  );
}
