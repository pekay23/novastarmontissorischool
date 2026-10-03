/**
 * `reset` — drop the database and re-apply every migration. Development only.
 *
 * This is the command that destroys production if someone is careless, so it
 * has two independent locks and both must open:
 *
 *   1. `--dev-only` must be passed. There is no default and no inference.
 *   2. The resolved host must be a local address. `localhost`, `127.0.0.0/8`,
 *      `::1`, `*.localhost`, `host.docker.internal`. Nothing else. A managed
 *      database's hostname is not local, and a `--target dev` declaration does
 *      not change what the host resolves to.
 *
 * `SKIP_PRODUCTION_GUARD` is deliberately **not** honoured here. It exists for
 * the guarded deploy, where a human has already decided. A variable in the
 * environment is not a decision, and it must not be able to unlock a schema
 * drop.
 *
 * DDL is still delegated: `prisma migrate reset` owns it. This command owns the
 * refusal.
 */
import { databasePackageDir, isLocalHost, redact, type Target } from "../env";
import { prismaVersion, runPrisma } from "../prisma";
import { confirm } from "../guards/confirm";
import { heading, line, success, type Context } from "../log";
import { inspectStatus } from "./status";

export const RESET_MECHANISM = "prisma migrate reset --force";

export interface ResetOptions {
  readonly target: Target;
  /** `--dev-only`. */
  readonly devOnly: boolean;
  readonly yes: boolean;
  /** Skip the configured seed. Default true: a reset is not a request to reseed. */
  readonly skipSeed: boolean;
  readonly status: { allowPending: boolean };
}

/** Both locks, in one testable place. Throws with the reason. */
export function assertDevOnlyTarget(target: Target, devOnly: boolean): void {
  if (!devOnly) {
    throw new Error(
      "reset drops and rebuilds the schema. It refuses to run without " +
        "--dev-only, and there is no way to infer that intent.",
    );
  }
  if (!isLocalHost(target.host)) {
    throw new Error(
      `refusing to reset ${target.host}: it is not a local address.\n` +
        "reset is only ever allowed against localhost. To migrate a real " +
        "database use `deploy`.",
    );
  }
}

export async function runReset(ctx: Context, options: ResetOptions): Promise<void> {
  console.log(
    `[migrate] target ${options.target.kind} ${redact(options.target.url)} ` +
      `(${options.target.source})`,
  );
  console.log(`[migrate] prisma ${prismaVersion()} at ${databasePackageDir()}`);

  assertDevOnlyTarget(options.target, options.devOnly);

  if (ctx.env.SKIP_PRODUCTION_GUARD === "1") {
    // Stated rather than silently ignored, so nobody later reads a successful
    // reset as evidence the escape hatch was respected.
    line("  SKIP_PRODUCTION_GUARD is set and is ignored by reset; the host check above still applies.");
  }

  const args = ["migrate", "reset", "--force"];
  if (options.skipSeed) args.push("--skip-seed");

  heading("about to run");
  line(`  DATABASE_URL=<target> prisma ${args.join(" ")}`);
  line("  Every table in the public schema is dropped. There is no undo here.");

  const confirmed = await confirm(
    `Drop and rebuild the schema on ${options.target.host}?`,
    { yes: options.yes },
  );
  if (!confirmed) {
    throw new Error("reset was not confirmed; nothing was dropped");
  }

  const result = await runPrisma(args, { env: { DATABASE_URL: options.target.url } });
  if (result.output.trim() !== "") line(result.output.trim());
  if (result.code !== 0) {
    throw new Error(`prisma migrate reset exited ${result.code}`);
  }

  const after = await inspectStatus(ctx, { ...options.status, target: options.target });
  success(
    ctx,
    `schema rebuilt on ${options.target.host}; ledger now has ` +
      `${after.comparison.applied.length} applied, ${after.comparison.pending.length} pending`,
  );
}
