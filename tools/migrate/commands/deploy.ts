/**
 * `deploy` — `prisma migrate deploy`, with a chain of checks in front of it.
 *
 * The order is cheapest-and-most-dangerous first, so a run that is going to be
 * refused is refused before it has touched anything:
 *
 *   1. production guard  (a host check; no I/O)
 *   2. clean tree        (one `git status` on the schema directory)
 *   3. status            (read-only ledger inspection)
 *   4. restore point     (failsafe reachable and complete)
 *   5. `prisma migrate deploy`
 *   6. `verify`          (read-only; the ledger agreeing is not the schema agreeing)
 *
 * Any failure stops the chain. **A failed deploy is never rolled back
 * automatically.** A migration that stopped halfway has left the database in a
 * state only a human has seen; the tool prints the failing migration, its
 * ledger row, and the `rollback` command, and stops.
 */
import { databasePackageDir, redact, type Target } from "../env";
import { prismaVersion, runPrisma } from "../prisma";
import { openReadOnly } from "../fingerprints/tables";
import { assertCleanTree, requireCleanTree } from "../guards/require-clean-tree";
import { assertBackup, requireBackup, type BackupOptions } from "../guards/require-backup";
import { assertProductionAllowed, type TargetLabel } from "../guards/refuse-production";
import { confirm } from "../guards/confirm";
import { heading, line, skipped, success, type Context } from "../log";
import { inspectStatus, type StatusOptions } from "./status";
import { runVerify, type VerifyOptions } from "./verify";

export const DEPLOY_MECHANISM = "prisma migrate deploy";

export interface DeployOptions {
  readonly target: Target;
  readonly yes: boolean;
  readonly declared?: TargetLabel;
  readonly allowProduction: boolean;
  readonly status: StatusOptions;
  readonly verify: Omit<VerifyOptions, "target">;
  readonly backup: BackupOptions;
  /** Skips the git and mirror guards. Never set outside tests. */
  readonly skipGuards?: boolean;
}

/**
 * The ledger row for a migration that did not finish, read back after a failed
 * deploy. `started_at` with no `finished_at` is how a half-applied migration
 * presents, and it is the single most useful fact to print at that moment.
 */
async function failedLedgerReport(target: Target, names: readonly string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const client = await openReadOnly(target.url);
  try {
    const { rows } = await client.query(
      `SELECT migration_name, started_at, finished_at, rolled_back_at, logs
         FROM _prisma_migrations
        WHERE migration_name = ANY($1::text[])
        ORDER BY migration_name`,
      [names],
    );
    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      const at = (v: unknown): string =>
        v instanceof Date ? v.toISOString() : v === null ? "NULL" : String(v);
      return (
        `  ${String(r.migration_name)} started=${at(r.started_at)} ` +
        `finished=${at(r.finished_at)} rolled_back=${at(r.rolled_back_at)}\n` +
        (r.logs ? `    logs: ${String(r.logs).trim()}\n` : "")
      );
    });
  } catch {
    return [];
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runDeploy(ctx: Context, options: DeployOptions): Promise<void> {
  console.log(
    `[migrate] target ${options.target.kind} ${redact(options.target.url)} ` +
      `(${options.target.source})`,
  );
  console.log(`[migrate] prisma ${prismaVersion()} at ${databasePackageDir()}`);

  // 1. Production guard.
  await assertProductionAllowed(options.target, {
    declared: options.declared,
    escapeHatch: ctx.env.SKIP_PRODUCTION_GUARD === "1",
    allowProduction: options.allowProduction,
    yes: options.yes,
    honourEscapeHatch: true,
    confirm: () =>
      confirm(`Apply pending migrations to ${options.target.host}?`, {
        yes: options.yes,
      }),
  });

  // 2. Clean tree.
  if (options.skipGuards) {
    skipped("require-clean-tree", "skipped by --skip-guards");
    skipped("require-backup", "skipped by --skip-guards");
  } else {
    assertCleanTree(await requireCleanTree());

    // 3. Status, before anything is written. A half-applied migration must be
    // resolved by a human before another deploy is attempted.
    const status = await inspectStatus(ctx, options.status);
    if (status.failed) {
      throw new Error(
        `pre-flight status failed, so nothing was deployed:\n  - ` +
          `${status.problems.join("\n  - ")}`,
      );
    }

    // 4. Restore point.
    assertBackup(await requireBackup(options.target, ctx.env, options.backup));
  }

  // 5. The deploy itself.
  heading(`deploying via ${DEPLOY_MECHANISM}`);
  const result = await runPrisma(["migrate", "deploy"], {
    env: { DATABASE_URL: options.target.url },
  });
  if (result.output.trim() !== "") line(result.output.trim());

  if (result.code !== 0) {
    heading("deploy failed");
    const rows = await failedLedgerReport(options.target, migrationsNamedIn(result.output));
    if (rows.length > 0) {
      heading("_prisma_migrations");
      for (const r of rows) line(r);
    }
    throw new Error(
      `${DEPLOY_MECHANISM} exited ${result.code}.\n` +
        "Nothing was rolled back automatically: a migration that stopped partway " +
        "leaves a state only a human has seen. Inspect the row above, then run " +
        "`bun run --cwd tools/migrate rollback` for the manual options.",
    );
  }

  // 6. Verify, read-only. The ledger can agree while the schema does not.
  await runVerify(ctx, { ...options.verify, target: options.target });

  success(ctx, "migrations applied and the live schema matches schema.prisma");
}

/** Best-effort extraction of migration names from Prisma's failure output. */
export function migrationsNamedIn(output: string): string[] {
  const found = new Set<string>();
  for (const match of output.matchAll(/(\d{14}_[A-Za-z0-9_-]+)/g)) {
    if (match[1] !== undefined) found.add(match[1]);
  }
  return [...found].sort();
}
