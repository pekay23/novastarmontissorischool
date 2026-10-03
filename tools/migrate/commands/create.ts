/**
 * `create` — delegate migration authoring to `prisma migrate dev`.
 *
 * Prisma owns the decision about whether the datamodel needs a migration, and
 * owns the diff that becomes one. This command adds exactly two things: a
 * mandatory `--name`, and a refusal to let Prisma prompt for a reset in a
 * context where nobody can answer.
 *
 * With `--yes` and no TTY, `--create-only` is forced. `migrate dev` otherwise
 * offers to reset the database when it detects drift, and that prompt is
 * exactly the kind of thing that hangs a pipeline. `--create-only` writes the
 * migration file and stops.
 */
import { databasePackageDir, redact, type Target } from "../env";
import { prismaVersion, runPrisma } from "../prisma";
import { hasTty } from "../guards/confirm";
import { heading, line, success, warn, type Context } from "../log";

export const CREATE_MECHANISM = "prisma migrate dev";

export interface CreateOptions {
  readonly target: Target;
  readonly name: string;
  readonly yes: boolean;
  /** `--create-only`: never touch the database. */
  readonly createOnly: boolean;
  /** Override the TTY detection. Used by tests. */
  readonly interactive: boolean;
}

export async function runCreate(ctx: Context, options: CreateOptions): Promise<void> {
  console.log(
    `[migrate] target ${options.target.kind} ${redact(options.target.url)} ` +
      `(${options.target.source})`,
  );
  console.log(`[migrate] prisma ${prismaVersion()} at ${databasePackageDir()}`);

  if (!options.name.trim()) {
    throw new Error(
      "create needs a migration name: --name add_whatever_this_changes. The " +
        "name becomes the directory in prisma/migrations and is permanent.",
    );
  }

  const interactive = options.interactive || hasTty();
  const args = ["migrate", "dev", "--name", options.name];
  let createOnly = options.createOnly;
  if (!interactive && !createOnly) {
    warn("no TTY: forcing --create-only so `migrate dev` cannot prompt for a reset");
    createOnly = true;
  }
  if (createOnly) args.push("--create-only");

  heading("about to run");
  line(`  DATABASE_URL=<target> prisma ${args.join(" ")}`);

  const result = await runPrisma(args, {
    env: { DATABASE_URL: options.target.url },
    // Only a genuine terminal can be trusted with an interactive prompt, and
    // then stdio is inherited so Prisma's own UI works.
    inherit: interactive,
  });

  if (!interactive && result.output.trim() !== "") line(result.output.trim());
  if (result.code !== 0) {
    throw new Error(`prisma migrate dev exited ${result.code}`);
  }

  if (createOnly) {
    success(ctx, `migration file written for "${options.name}" (database untouched)`);
    return;
  }
  success(ctx, `migration "${options.name}" created and applied`);
}
