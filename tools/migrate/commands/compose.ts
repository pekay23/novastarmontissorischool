/**
 * `compose` — do the migration files on disk compose to `schema.prisma`?
 *
 * `verify` answers a different question. It runs
 *
 *     prisma migrate diff --exit-code --from-config-datasource --to-schema schema.prisma
 *
 * and `--from-config-datasource` is the **live database**, so `verify` says
 * whether the database matches the datamodel. It never opens the migration
 * directory. Those are two questions, and only the second one is what `baseline`
 * asserts: `baseline` writes a `_prisma_migrations` row per migration, meaning
 * *this migration ran*, and a ledger that claims a migration ran when the files
 * on disk do not even compose is a ledger that lies. So this command asks the
 * question `verify` cannot:
 *
 *     prisma migrate diff --exit-code \
 *       --from-migrations packages/database/prisma/migrations \
 *       --to-schema packages/database/prisma/schema.prisma \
 *       --shadow-database-url <url>
 *
 * Exit 0 means the files compose exactly. Exit 2 means they do not, and the
 * `--script` re-run names the object that differs.
 *
 * WHY A SHADOW DATABASE, AND WHY IT IS NOT OPTIONAL
 * -------------------------------------------------
 * `--from-migrations` has to *build* a database from the migration files before
 * it can compare anything, and the only place it may build one is the throwaway
 * database named by `--shadow-database-url`. Prisma resets that database and
 * replays every migration into it, so the URL is not a reading location: it is
 * the destination of a full DDL replay.
 *
 * Which is why there is no default and no fallback. A sensible-looking default
 * (`DIRECT_URL`, or the primary) would execute every migration against the live
 * database, where each statement fails because the object already exists — and
 * the ledger records the attempt. So:
 *
 *   - the URL is **required**, and the refusal names how to obtain one;
 *   - a URL that resolves to any configured live database is refused outright,
 *     before anything runs;
 *   - `SKIP_PRODUCTION_GUARD` is deliberately **not** honoured here
 *     (`honourEscapeHatch: false`), exactly as in `reset`: a variable in the
 *     environment is not a decision a person made, and this command resets a
 *     database;
 *   - the URL is passed as an argv element, so it is visible in the process
 *     table for the duration of the run. Use a throwaway credential.
 *
 * The natural target is a Neon **branch** of the same project: `packages/database`
 * speaks SQL-over-HTTP through `@prisma/adapter-neon`, so a local `postgres:16`
 * container cannot serve this schema, and a Neon branch is an empty database of
 * the right engine on the right provider, created in two clicks and deleted
 * afterwards.
 */
import { asPostgresUrl, databasePackageDir, hostOf, redact } from "../env";
import { migrationsDir, prismaVersion, runPrisma, schemaPath } from "../prisma";
import { DEFAULT_SCOPE, requireCleanTree } from "../guards/require-clean-tree";
import {
  assertProductionAllowed,
  type GuardTarget,
  type TargetLabel,
} from "../guards/refuse-production";
import { confirm } from "../guards/confirm";
import { heading, line, success, warn, type Context } from "../log";
import { migrationsOnDisk } from "./status";
import { DRIFT_EXIT } from "./verify";

export const COMPOSE_MECHANISM =
  "prisma migrate diff --from-migrations --shadow-database-url (replays every migration into the shadow)";

/** The flag that carries the throwaway target. Named in every refusal. */
export const SHADOW_FLAG = "--shadow-database-url";

export interface ComposeOptions {
  readonly shadow: GuardTarget;
  readonly declared?: TargetLabel;
  readonly allowProduction: boolean;
  readonly yes: boolean;
  /** Re-render the diverging SQL on failure. */
  readonly showScript: boolean;
  readonly sqlLines: number;
}

export interface DbLocation {
  readonly host: string;
  readonly database: string;
}

/**
 * Host and database name, or `undefined` when the URL cannot be read that way.
 *
 * Host and database are both required for an identity comparison: the same
 * database name on a different host is a different database (that is exactly
 * what a Neon branch is), and the same host with a different name is a different
 * database too.
 */
export function dbLocation(url: string): DbLocation | undefined {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ""),
      database: decodeURIComponent(parsed.pathname).replace(/^\/+/, ""),
    };
  } catch {
    return undefined;
  }
}

/**
 * Whether two URLs name the same database. `false` when either cannot be read,
 * because "cannot prove they are the same" is not "they are the same".
 *
 * Scope, stated so the gap is not mistaken for coverage: the Neon pooler and the
 * Neon direct endpoint are different hostnames for the same database, so this
 * only catches a shadow URL that matches a *configured* URL verbatim. Both forms
 * are normally configured here, so naming the direct endpoint is caught by the
 * `DIRECT_URL` comparison; naming the pooler is caught by `DATABASE_URL`. The
 * production classification below covers the case where neither is configured.
 */
export function sameDatabase(a: string, b: string): boolean {
  const left = dbLocation(a);
  const right = dbLocation(b);
  if (left === undefined || right === undefined) return false;
  return left.host === right.host && left.database === right.database;
}

/** Every live connection string in the environment, with the name it came from. */
function liveDatabases(env: NodeJS.ProcessEnv): readonly (readonly [string, string])[] {
  const found: (readonly [string, string])[] = [];
  for (const [name, value] of [
    ["DATABASE_URL", env.DATABASE_URL],
    ["DIRECT_URL", env.DIRECT_URL],
    ["SUPABASE_DATABASE_URL", env.SUPABASE_DATABASE_URL],
  ] as const) {
    if (value !== undefined && value.trim() !== "") found.push([name, value]);
  }
  return found;
}

/**
 * Validates the operator's shadow URL and refuses to hand back anything that
 * could be the live database. Pure, so the refusal is testable without a socket.
 *
 * Throws rather than warns: there is no useful way to continue, and a warning
 * would put the operator in the position of having to notice it before a full
 * DDL replay.
 */
export function resolveShadowTarget(
  raw: string | undefined,
  env: NodeJS.ProcessEnv,
): GuardTarget {
  const given = raw?.trim() ?? "";
  if (given === "") {
    throw new Error(
      `${SHADOW_FLAG} is required. This check replays every migration file into ` +
        "the database it names and resets it first, so there is no default: a " +
        "default that pointed at the primary would execute DDL against the live " +
        "database.\n" +
        "Use a throwaway database — a Neon branch of the same project is the " +
        "natural choice, because this schema speaks SQL-over-HTTP and a local " +
        "postgres container cannot serve it.\n" +
        `  bun run --cwd tools/migrate compose ${SHADOW_FLAG} <branch-url> --dev`,
    );
  }

  const url = asPostgresUrl(given, SHADOW_FLAG);
  const host = hostOf(url);
  if (host === "<unparseable>" || host === "") {
    // Fail closed: a URL this tool cannot read is a URL it cannot compare with
    // the live database, and the next statement runs DDL. `postgresql://` parses
    // as a URL with an empty hostname, so an empty host is the same failure as
    // an unparseable one and is refused the same way.
    throw new Error(
      `${SHADOW_FLAG} has no readable host (got "${given.slice(0, 32)}"), so it ` +
        "cannot be checked against the live database: refusing to replay migrations " +
        "into an unreadable target.",
    );
  }

  const target: GuardTarget = { url, source: SHADOW_FLAG, host };
  for (const [name, liveUrl] of liveDatabases(env)) {
    if (sameDatabase(url, liveUrl)) {
      throw new Error(
        `refusing: ${SHADOW_FLAG} names the same database as ${name} ` +
          `(${host}). Prisma would reset it and replay every migration into the ` +
          `live database.\nPoint ${SHADOW_FLAG} at a throwaway database instead — ` +
          "a Neon branch of the same project is the natural choice.",
      );
    }
  }
  return target;
}

function composeArgs(shadowUrl: string, exitCode: boolean, script: boolean): string[] {
  const args = ["migrate", "diff"];
  if (exitCode) args.push("--exit-code");
  args.push(
    "--from-migrations",
    migrationsDir(),
    "--to-schema",
    schemaPath(),
    "--shadow-database-url",
    shadowUrl,
  );
  if (script) args.push("--script");
  return args;
}

export async function runCompose(ctx: Context, options: ComposeOptions): Promise<void> {
  const onDisk = migrationsOnDisk();
  console.log(
    `[migrate] shadow ${options.shadow.host} ${redact(options.shadow.url)} ` +
      `(${options.shadow.source})`,
  );
  console.log(`[migrate] prisma ${prismaVersion()} at ${databasePackageDir()}`);
  console.log(`[migrate] migrations on disk: ${onDisk.length}`);

  heading("what this will do");
  line(
    "  Reset the shadow database, replay every migration file into it, and\n" +
      "  compare the result with schema.prisma. The live database is neither\n" +
      "  read nor written. The shadow is reset, so it must be throwaway.",
  );

  // Reported, never enforced. This command writes to the shadow and not to the
  // repository, so a dirty tree is worth naming and not worth refusing: the
  // honest reading of a dirty `prisma/` is that the answer describes a schema
  // nobody else has, which is the operator's call to make.
  const clean = await requireCleanTree();
  if (clean.state === "dirty") {
    warn(
      `${DEFAULT_SCOPE} has uncommitted changes: ${clean.files.join(", ")}. ` +
        "This check answers for the files on disk, not for what is committed.",
    );
  } else if (clean.state === "skipped") {
    warn(`require-clean-tree could not run: ${clean.reason ?? "unknown"}`);
  }

  /**
   * One question, asked at most once. `assertProductionAllowed` asks it for a
   * production-classified shadow; the explicit call below covers every other
   * case. Without the memo a production shadow would prompt twice for the same
   * decision.
   */
  let asked: boolean | undefined;
  const confirmOnce = async (): Promise<boolean> => {
    if (asked !== undefined) return asked;
    asked = await confirm(
      `Reset ${options.shadow.host} and replay ${onDisk.length} migration(s) into it?`,
      { yes: options.yes },
    );
    return asked;
  };

  await assertProductionAllowed(options.shadow, {
    declared: options.declared,
    escapeHatch: ctx.env.SKIP_PRODUCTION_GUARD === "1",
    allowProduction: options.allowProduction,
    yes: options.yes,
    // Not honoured: this resets a database. See the file header.
    honourEscapeHatch: false,
    confirm: confirmOnce,
  });

  if (!(await confirmOnce())) {
    throw new Error("compose was not confirmed; nothing was replayed");
  }

  const verdict = await runPrisma(composeArgs(options.shadow.url, true, false));

  if (verdict.code === 0) {
    success(
      ctx,
      `${onDisk.length} migration file(s) compose to schema.prisma exactly ` +
        `(${options.shadow.host} was reset and used as a throwaway)`,
    );
    return;
  }

  if (verdict.code !== DRIFT_EXIT) {
    throw new Error(
      `prisma migrate diff exited ${verdict.code} rather than ${DRIFT_EXIT}, so the ` +
        `comparison did not complete. The shadow is at ${options.shadow.host}.\n` +
        `${verdict.output.trim()}`,
    );
  }

  heading("the migration files do not compose to schema.prisma");
  if (options.showScript) {
    const script = await runPrisma(composeArgs(options.shadow.url, false, true));
    const shown = script.stdout.split(/\r?\n/).slice(0, options.sqlLines);
    heading(
      `SQL that would close the gap (first ${shown.length} lines, not executed)`,
    );
    for (const l of shown) line(`  ${l}`);
    if (script.stdout.split(/\r?\n/).length > shown.length) line("  ...");
  } else {
    line("  (--no-script was passed, so the diverging SQL was not rendered)");
  }
  throw new Error(
    `the ${onDisk.length} migration file(s) in ${migrationsDir()} do not compose to ` +
      "schema.prisma.\nDo NOT run `baseline`: recording history for files that do not " +
      "compose writes a ledger that lies, and `migrate deploy` then skips them " +
      "silently. Fix the files or add the missing one first — `create` delegates to " +
      "`prisma migrate dev --create-only`.",
  );
}
