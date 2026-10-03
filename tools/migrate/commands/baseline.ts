/**
 * `baseline` — record history for a database that has none.
 *
 * This is the highest-risk command in the tool and the one that makes the CI
 * deploy gate safe to open. `prisma migrate resolve --applied <name>` writes a
 * row into `_prisma_migrations` asserting that a migration ran. If the live
 * schema does not actually match that migration, the ledger now lies, every
 * future `migrate deploy` skips it, and the divergence is invisible until
 * something breaks in production. There is no undo: the honest reversal is
 * `migrate resolve --rolled-back`, which `rollback` prints.
 *
 * Therefore:
 *
 *   - **Dry run is the default.** `--apply` is required to write anything, and
 *     even then a confirmation is required.
 *   - `verify` is the recommended pre-check, not a post-check. Run it first.
 *   - The guards run before the preview: an uncommitted schema, or no restore
 *     point, stops the command before it prints a plan to execute.
 *   - A production host needs `--allow-production`, same as `deploy`.
 */
import { databasePackageDir, redact, type Target } from "../env";
import { migrationsDir, prismaVersion, runPrismaOrThrow } from "../prisma";
import { openReadOnly } from "../fingerprints/tables";
import { assertCleanTree, DEFAULT_SCOPE, requireCleanTree } from "../guards/require-clean-tree";
import { assertBackup, requireBackup } from "../guards/require-backup";
import { assertProductionAllowed, type TargetLabel } from "../guards/refuse-production";
import { confirm } from "../guards/confirm";
import { heading, line, skipped, success, warn, type Context } from "../log";
import { compareLedger, migrationsOnDisk, readLedger } from "./status";

export const BASELINE_MECHANISM = "prisma migrate resolve --applied";

export interface BackupGuardOptions {
  readonly maxAgeHours: number;
  readonly mirrorSyncedAt?: string;
  readonly requireAge: boolean;
}

export interface BaselineOptions {
  readonly target: Target;
  /** Explicit `--migration` names. Empty means "everything unsettled". */
  readonly migrations: readonly string[];
  /** `--apply`. Without it, this command only prints. */
  readonly apply: boolean;
  readonly yes: boolean;
  readonly declared?: TargetLabel;
  readonly allowProduction: boolean;
  readonly backup: BackupGuardOptions;
  /** Skips the two guards that shell out. Used by tests. */
  readonly skipGuards?: boolean;
}

export interface BaselinePlan {
  /** On disk, oldest first. */
  readonly onDisk: readonly string[];
  /** Settled already, so `resolve` would be a no-op or a conflict. */
  readonly settled: readonly string[];
  /** What `--apply` would resolve, in order. */
  readonly toResolve: readonly string[];
}

/**
 * Works out what `resolve --applied` would write. Pure, so the plan can be
 * tested and printed before anything is executed.
 */
export function planBaseline(
  onDisk: readonly string[],
  ledger: Parameters<typeof compareLedger>[1],
  requested: readonly string[],
): BaselinePlan {
  const comparison = compareLedger(onDisk, ledger);
  const settled = new Set(comparison.settled);

  const unknownRequested = requested.filter((n) => !onDisk.includes(n));
  if (unknownRequested.length > 0) {
    throw new Error(
      `no such migration on disk: ${unknownRequested.join(", ")}.\n` +
        `Checked: ${onDisk.join(", ") || "(none)"}`,
    );
  }

  return {
    onDisk,
    settled: [...settled].sort(),
    toResolve:
      requested.length > 0 ? [...requested].sort() : onDisk.filter((n) => !settled.has(n)),
  };
}

/** The exact row `migrate resolve --applied` creates, for the preview. */
function describeLedgerWrite(names: readonly string[]): void {
  heading(`_prisma_migrations rows that will be added (${names.length})`);
  for (const name of names) {
    line(`  migration_name       = ${name}`);
    line(`  started_at           = <now>`);
    line(`  finished_at          = <now>`);
    line(`  rolled_back_at       = NULL`);
    line(`  applied_steps_count  = <as recorded by Prisma>`);
    line(`  logs                 = NULL`);
    line("");
  }
}

export async function runBaseline(ctx: Context, options: BaselineOptions): Promise<void> {
  console.log(
    `[migrate] target ${options.target.kind} ${redact(options.target.url)} ` +
      `(${options.target.source})`,
  );
  console.log(`[migrate] prisma ${prismaVersion()} at ${databasePackageDir()}`);

  if (!options.apply) {
    warn("dry run: this command will print the plan and write nothing. Pass --apply to execute it.");
  }

  const onDisk = migrationsOnDisk();
  if (onDisk.length === 0) {
    throw new Error(
      `no migrations found in ${migrationsDir()}. There is nothing to baseline.`,
    );
  }

  const client = await openReadOnly(options.target.url);
  let plan: BaselinePlan;
  try {
    plan = planBaseline(onDisk, await readLedger(client), options.migrations);
  } finally {
    await client.end().catch(() => undefined);
  }

  heading("plan");
  line(`  migrations on disk: ${plan.onDisk.length} (${plan.onDisk.join(", ")})`);
  line(`  already recorded:   ${plan.settled.length}${plan.settled.length > 0 ? ` (${plan.settled.join(", ")})` : ""}`);
  line(`  to resolve:         ${plan.toResolve.length}`);

  if (plan.toResolve.length === 0) {
    success(ctx, "every migration on disk is already recorded; nothing to baseline");
    return;
  }

  // Reported, never enforced, on a dry run: a dirty schema is exactly what an
  // operator needs to be told about while reading the plan, and a dry run
  // writes nothing so it has nothing to protect.
  if (!options.apply) {
    const clean = await requireCleanTree();
    if (clean.state === "dirty") {
      warn(
        `${DEFAULT_SCOPE} has uncommitted changes: ${clean.files.join(", ")}. ` +
          "Baselining against an uncommitted schema records the wrong thing.",
      );
    } else if (clean.state === "skipped") {
      skipped("require-clean-tree", clean.reason ?? "unknown");
    }
  }

  describeLedgerWrite(plan.toResolve);
  heading("commands");
  for (const name of plan.toResolve) {
    line(`  DATABASE_URL=<target> prisma migrate resolve --applied ${name}`);
  }

  if (!options.apply) {
    success(ctx, `dry run: ${plan.toResolve.length} migration(s) would be recorded, nothing written`);
    return;
  }

  // Guards gate the write, and run before it. A dry run needs none of them:
  // demanding `--allow-production --yes` just to read a plan is friction that
  // gets people to skip the dry run, which is the thing being protected.
  if (!options.skipGuards) {
    assertCleanTree(await requireCleanTree());

    assertBackup(await requireBackup(options.target, ctx.env, options.backup));

    await assertProductionAllowed(options.target, {
      declared: options.declared,
      escapeHatch: ctx.env.SKIP_PRODUCTION_GUARD === "1",
      allowProduction: options.allowProduction,
      yes: options.yes,
      honourEscapeHatch: true,
      confirm: () =>
        confirm(
          `Record ${plan.toResolve.length} migration(s) as already applied to ` +
            `${options.target.host}? The live schema is NOT changed.`,
          { yes: options.yes },
        ),
    });
  } else {
    skipped("baseline guards", "skipped by --skip-guards");
  }

  const confirmed = await confirm(
    `Write ${plan.toResolve.length} ledger row(s) to ${options.target.host}?`,
    { yes: options.yes },
  );
  if (!confirmed) {
    throw new Error("baseline was not confirmed; nothing was written");
  }

  for (const name of plan.toResolve) {
    // Sequential and fail-fast: a resolve that fails must not be followed by
    // more, or the ledger records history that never happened in that order.
    await runPrismaOrThrow(["migrate", "resolve", "--applied", name], {
      env: { DATABASE_URL: options.target.url },
    });
    line(`  resolved ${name}`);
  }

  success(ctx, `${plan.toResolve.length} migration(s) recorded via ${BASELINE_MECHANISM}`);
}
