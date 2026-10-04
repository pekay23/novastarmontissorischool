/**
 * `push` — `prisma db push`, restricted to local databases only.
 *
 * `db push` applies DDL directly to the database without writing to
 * `_prisma_migrations`. In a production or remote database this creates a
 * permanent divergence between the migration files and the live schema:
 * the next `migrate deploy` fails with "already exists" on every object
 * the push touched.
 *
 * This command therefore hard-refuses any non-local host. The guard is
 * not a confirmation or an acknowledgement — it is a structural refusal.
 * A local developer's machine is the only place `db push` is safe;
 * production must use `migrate deploy`.
 *
 * No ledger check runs here on purpose: the ledger is not relevant to a
 * local development database and `prisma db push` never writes to it.
 *
 * Two things this command deliberately does NOT do:
 *
 * - It does not pass `--accept-data-loss`. Prisma's own refusal, with its own
 *   message about which change is destructive, is more informative than a
 *   blanket "yes" supplied by a wrapper. Stdout is inherited and stdin is not,
 *   so a run that would drop data fails instead of silently doing it.
 * - It does not offer a confirmation flag. `reset` has two locks because it
 *   drops everything; `push` only needs the host check, and a second lock
 *   would just be a way to talk past the first one.
 */
import { databasePackageDir, isLocalHost, redact, type Target } from "../env";
import { prismaVersion, runPrismaOrThrow } from "../prisma";
import { success, type Context } from "../log";

export const PUSH_MECHANISM = "prisma db push";

export interface PushOptions {
  readonly target: Target;
}

/**
 * The host check, separated from the Prisma call so it can be tested without
 * spawning a subprocess. Throws with the reason; returns nothing on success.
 *
 * Aware that this is one guard and not a boundary: someone with shell access
 * can still run `prisma db push` themselves. See ADR-023 — the enforceable
 * version of this rule is a runtime database role without DDL rights.
 */
export function assertLocalPushTarget(target: Target): void {
  if (isLocalHost(target.host)) return;
  throw new Error(
    `refusing to run prisma db push against ${target.host}: it is not a local address.\n` +
      "db push applies DDL without writing to _prisma_migrations, so it leaves the\n" +
      "migration files permanently out of step with the live schema and the next\n" +
      "migrate deploy fails on every object it touched. It is for a developer's\n" +
      "own machine only. To change a real database, generate a migration and run:\n" +
      "  bun run db:migrate:deploy",
  );
}

export async function runPush(ctx: Context, options: PushOptions): Promise<void> {
  const { target } = options;

  console.log(
    `[migrate] target ${target.kind} ${redact(target.url)} (${target.source})`,
  );
  console.log(`[migrate] prisma ${prismaVersion()} at ${databasePackageDir()}`);

  assertLocalPushTarget(target);

  console.log(`[migrate] target is local (${target.host}); running prisma db push`);

  /**
   * The explicit `DATABASE_URL` is not optional. `prisma db push` reads the
   * datasource from the environment, and `--target direct` can resolve
   * `DIRECT_URL` while `DATABASE_URL` still names something else — so without
   * this the guard would have inspected one host and Prisma written to
   * another. This is the rule `env.ts` states for every Prisma child.
   */
  await runPrismaOrThrow(["db", "push"], {
    inherit: true,
    env: { DATABASE_URL: target.url },
  });

  success(ctx, "schema pushed to local database");
}
