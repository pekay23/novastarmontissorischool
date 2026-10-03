#!/usr/bin/env bun
/**
 * `@novastar/migrate` — the operator entry point for schema changes.
 *
 * This is a wrapper and a safety layer, not a second migration system. Every
 * command either delegates to the Prisma CLI that already owns the migration
 * directory, or does something Prisma genuinely has no command for: comparing
 * three sources that can disagree, baselining a database that has no history,
 * and refusing to run at all when the preconditions are not met.
 *
 * Exit codes:
 *   0  success
 *   1  the command ran and failed, or a guard refused
 *   2  usage error — unknown command, missing or malformed flag
 *
 * `--help` works with no database and no arguments, and nothing is loaded
 * before it runs.
 */
import { loadEnv, MissingEnvError, resolveTarget, type TargetKind } from "./env";
import { prismaVersion } from "./prisma";
import { announce, failure, type Context } from "./log";
import type { TargetLabel } from "./guards/refuse-production";
import type { BackupGuardOptions } from "./commands/baseline";
import { runStatus } from "./commands/status";
import { runVerify } from "./commands/verify";
import { runDeploy } from "./commands/deploy";
import { runBaseline } from "./commands/baseline";
import { runRollback } from "./commands/rollback";
import { runReset } from "./commands/reset";
import { runMirror } from "./commands/mirror";
import { runCreate } from "./commands/create";

const COMMANDS = [
  "status",
  "create",
  "deploy",
  "baseline",
  "verify",
  "rollback",
  "mirror",
  "reset",
] as const;
type Command = (typeof COMMANDS)[number];

const USAGE = `migrate — schema change entry point for @novastar/database

usage: bun run tools/migrate/index.ts <command> [flags]

  status     read-only: migrations on disk vs _prisma_migrations vs live schema
  create     delegate to \`prisma migrate dev --name <name>\`
  deploy     guarded \`prisma migrate deploy\`, then verify
  baseline   record existing history (\`prisma migrate resolve --applied\`), dry run first
  verify     read-only: does the live schema match schema.prisma?
  rollback   guided, manual, writes nothing
  mirror     delegate to @novastar/db-mirror
  reset      drop and rebuild a LOCAL database. Requires --dev-only.

global flags
  --yes                 never prompt; required for any write in CI
  --help                this text; works with no database
  --version             the Prisma version that would run
  --                    pass everything after this to the subcommand

target flags
  --target <primary|direct|mirror>   which connection to act on (default: primary)
                                     primary: DATABASE_URL || DIRECT_URL
                                     direct:  DIRECT_URL || DATABASE_URL
                                     mirror:  SUPABASE_DATABASE_URL

write flags (deploy, baseline)
  --prod | --dev        declare what the target is. Absent, a non-local host
                        is treated as production.
  --allow-production    acknowledge a production target
  --max-mirror-age-hours <n>       failsafe age limit (default 24)
  --mirror-synced-at <iso>         attest when the failsafe was last confirmed
  --require-mirror-age  refuse when the failsafe age cannot be established

command flags
  status     --allow-pending        a pending migration is a warning, not a failure
             --schema               also hash schema.prisma (offline)
  create     --name <name>          required
             --create-only          write the migration, touch no database
  baseline   --apply                leave the dry run (default: dry run)
             --migration <name>     repeatable; default: everything unsettled
  verify     --sql-lines <n>        lines of SQL to print (default 40)
             --no-script            do not render the drift SQL
  rollback   --migration <name>     default: the most recently applied
             --limit <n>            how many applied migrations to list (default 10)
  reset      --dev-only             required. --seed opts back into the seed.
  mirror     --verify-only          compare without writing

environment
  DATABASE_URL, DIRECT_URL            the primary
  SUPABASE_DATABASE_URL               the failsafe
  MIGRATE_SKIP_DOTENV=1               ignore .env / .env.local entirely
  SKIP_PRODUCTION_GUARD=1             skip the deploy/baseline confirmation.
                                      Ignored by reset, always.

This tool owns no migration SQL. Prisma does.`;

export interface Parsed {
  readonly command: Command | undefined;
  readonly help: boolean;
  readonly version: boolean;
  readonly yes: boolean;
  readonly flags: ReadonlyMap<string, readonly string[]>;
  readonly passthrough: readonly string[];
}

export class UsageError extends Error {}

/**
 * Flags that take no value. Listed rather than inferred, because inference
 * from the next token breaks the moment a boolean is followed by a positional,
 * and a boolean that silently swallows the following argument is worse than a
 * usage error.
 */
const BOOLEAN_FLAGS = new Set([
  "allow-pending",
  "allow-production",
  "apply",
  "create-only",
  "dev",
  "dev-only",
  "dry-run",
  "h",
  "help",
  "no-script",
  "prod",
  "require-mirror-age",
  "schema",
  "seed",
  "verify-only",
  "version",
  "yes",
]);

/**
 * A small flag reader: `--flag`, `--flag value`, `--flag=value`, `--no-flag`,
 * repeatable, and a bare `--` for pass-through. Anything unrecognised is a
 * usage error rather than something silently ignored.
 */
export function parse(argv: readonly string[]): Parsed {
  const flags = new Map<string, string[]>();
  const passthrough: string[] = [];
  let command: Command | undefined;
  let i = 0;

  for (; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) break;

    if (token === "--") {
      passthrough.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("-")) {
      if (command !== undefined) {
        throw new UsageError(`unexpected argument "${token}" after command "${command}"`);
      }
      if (!isCommand(token)) {
        throw new UsageError(
          `unknown command "${token}". Expected one of: ${COMMANDS.join(", ")}`,
        );
      }
      command = token;
      continue;
    }

    const [name, inline] = splitOnce(token.replace(/^--?/, ""), "=");
    if (name === undefined || name === "") throw new UsageError(`malformed flag "${token}"`);

    let value: string;
    if (inline !== undefined) {
      value = inline;
    } else if (BOOLEAN_FLAGS.has(name) || name.startsWith("no-")) {
      value = "true";
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`flag --${name} needs a value`);
      }
      value = next;
      i += 1;
    }
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }

  return {
    command,
    help: flagValue(flags, "help") === "true" || flagValue(flags, "h") === "true",
    version: flagValue(flags, "version") === "true",
    yes: flagValue(flags, "yes") === "true",
    flags,
    passthrough,
  };
}

function flagValue(flags: ReadonlyMap<string, readonly string[]>, name: string): string | undefined {
  const values = flags.get(name);
  return values === undefined ? undefined : values[values.length - 1];
}

function isCommand(token: string): token is Command {
  return (COMMANDS as readonly string[]).includes(token);
}

function splitOnce(text: string, separator: string): [string, string] | [string, undefined] {
  const at = text.indexOf(separator);
  if (at < 0) return [text, undefined];
  return [text.slice(0, at), text.slice(at + 1)];
}

const one = (parsed: Parsed, name: string): string | undefined => {
  const values = parsed.flags.get(name);
  return values === undefined ? undefined : values[values.length - 1];
};

const many = (parsed: Parsed, name: string): string[] => [...(parsed.flags.get(name) ?? [])];

const number = (parsed: Parsed, name: string, fallback: number): number => {
  const raw = one(parsed, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new UsageError(`--${name} needs a non-negative number, got "${raw}"`);
  }
  return value;
};

const bool = (parsed: Parsed, name: string, fallback: boolean): boolean => {
  const values = parsed.flags.get(name);
  if (values === undefined) return fallback;
  const last = values[values.length - 1];
  if (last === "true") return true;
  if (last === "false") return false;
  throw new UsageError(`--${name} needs true or false, got "${last}"`);
};

const kind = (parsed: Parsed): TargetKind => {
  const value = one(parsed, "target");
  if (value === undefined) return "primary";
  if (value === "primary" || value === "direct" || value === "mirror") return value;
  throw new UsageError(`--target must be primary, direct or mirror, got "${value}"`);
};

const declared = (parsed: Parsed): TargetLabel | undefined => {
  if (bool(parsed, "prod", false)) return "prod";
  if (bool(parsed, "dev", false)) return "dev";
  return undefined;
};

const backupGuard = (parsed: Parsed): BackupGuardOptions => ({
  maxAgeHours: number(parsed, "max-mirror-age-hours", 24),
  ...(one(parsed, "mirror-synced-at") !== undefined
    ? { mirrorSyncedAt: one(parsed, "mirror-synced-at") }
    : {}),
  requireAge: bool(parsed, "require-mirror-age", false),
});

/** The allowed flag names, so a typo is an error rather than a no-op. */
const ALLOWED: Record<Command, readonly string[]> = {
  status: ["target", "allow-pending", "schema"],
  create: ["target", "name", "create-only"],
  deploy: [
    "target",
    "prod",
    "dev",
    "allow-production",
    "allow-pending",
    "max-mirror-age-hours",
    "mirror-synced-at",
    "require-mirror-age",
    "sql-lines",
    "no-script",
  ],
  baseline: [
    "target",
    "prod",
    "dev",
    "allow-production",
    "apply",
    "dry-run",
    "migration",
    "max-mirror-age-hours",
    "mirror-synced-at",
    "require-mirror-age",
  ],
  verify: ["target", "sql-lines", "no-script"],
  rollback: ["target", "migration", "limit", "sql-lines"],
  mirror: ["verify-only"],
  reset: ["target", "dev-only", "seed"],
};

function rejectUnknownFlags(parsed: Parsed, command: Command): void {
  const allowed = new Set([...ALLOWED[command], "yes", "help", "h", "version"]);
  for (const name of parsed.flags.keys()) {
    if (!allowed.has(name)) {
      throw new UsageError(
        `unknown flag --${name} for "${command}". Known: ${[...ALLOWED[command]].join(", ")}`,
      );
    }
  }
}

async function dispatch(parsed: Parsed): Promise<number> {
  const command = parsed.command;
  if (command === undefined) {
    console.log(USAGE);
    return 0;
  }
  rejectUnknownFlags(parsed, command);
  await loadEnv();

  const env = process.env;
  const targetKind = kind(parsed);

  /**
   * Announces the mechanism, runs the command, and reports the failure through
   * the same reporter. One place, so "which mechanism did this?" is answered
   * identically on the success and the failure path.
   */
  const run = async (
    mechanism: string,
    body: (ctx: Context) => Promise<void>,
  ): Promise<number> => {
    const ctx: Context = {
      command,
      mechanism,
      yes: parsed.yes,
      dryRun: false,
      env,
    };
    announce(ctx);
    try {
      await body(ctx);
      return 0;
    } catch (err) {
      if (err instanceof UsageError) {
        console.error(`[migrate] ${err.message}`);
        return 2;
      }
      if (err instanceof MissingEnvError) {
        console.error(`\n[migrate] ${command} FAILED via ${mechanism}`);
        console.error(`[migrate] ${err.message}`);
        return 1;
      }
      return failure(ctx, err);
    }
  };

  switch (command) {
    case "status":
      return run("read-only ledger + information_schema (writes nothing)", (ctx) =>
        runStatus(ctx, {
          target: resolveTarget(targetKind, env),
          allowPending: bool(parsed, "allow-pending", false),
          showSchema: bool(parsed, "schema", false),
        }),
      );

    case "verify":
      return run("prisma migrate diff --exit-code (read-only)", (ctx) =>
        runVerify(ctx, {
          target: resolveTarget(targetKind, env),
          showScript: !bool(parsed, "no-script", false),
          sqlLines: number(parsed, "sql-lines", 40),
        }),
      );

    case "create":
      return run("prisma migrate dev", (ctx) =>
        runCreate(ctx, {
          target: resolveTarget(targetKind, env),
          name: one(parsed, "name") ?? "",
          yes: parsed.yes,
          createOnly: bool(parsed, "create-only", false),
          interactive: false,
        }),
      );

    case "deploy": {
      const label = declared(parsed);
      const sqlLines = number(parsed, "sql-lines", 40);
      const allowPending = bool(parsed, "allow-pending", false);
      const allowProduction = bool(parsed, "allow-production", false);
      return run("prisma migrate deploy, then verify", (ctx) => {
        // Resolved inside the callback so a missing URL is reported against
        // this command's mechanism rather than from a bare top-level throw.
        const target = resolveTarget(targetKind, env);
        return runDeploy(ctx, {
          target,
          yes: parsed.yes,
          ...(label !== undefined ? { declared: label } : {}),
          allowProduction,
          status: { target, allowPending },
          verify: { showScript: !bool(parsed, "no-script", false), sqlLines },
          backup: backupGuard(parsed),
        });
      });
    }

    case "baseline": {
      const apply = bool(parsed, "apply", false);
      if (bool(parsed, "dry-run", false) && apply) {
        throw new UsageError("--dry-run and --apply contradict each other; pick one");
      }
      const label = declared(parsed);
      const migrations = many(parsed, "migration");
      const allowProduction = bool(parsed, "allow-production", false);
      const backup = backupGuard(parsed);
      return run("prisma migrate resolve --applied", async (ctx) => {
        const target = resolveTarget(targetKind, env);
        await runBaseline({ ...ctx, dryRun: !apply }, {
          target,
          migrations,
          apply,
          yes: parsed.yes,
          ...(label !== undefined ? { declared: label } : {}),
          allowProduction,
          backup,
        });
      });
    }

    case "rollback": {
      const migration = one(parsed, "migration");
      return run("read-only ledger inspection (writes nothing)", (ctx) =>
        runRollback(ctx, {
          target: resolveTarget(targetKind, env),
          ...(migration !== undefined ? { migration } : {}),
          limit: number(parsed, "limit", 10),
          sqlLines: number(parsed, "sql-lines", 60),
        }),
      );
    }

    case "mirror":
      return run("@novastar/db-mirror (tools/db-mirror/mirror.ts)", (ctx) =>
        runMirror(ctx, {
          verifyOnly: bool(parsed, "verify-only", false),
          passthrough: parsed.passthrough,
        }),
      );

    case "reset": {
      const devOnly = bool(parsed, "dev-only", false);
      const seed = bool(parsed, "seed", false);
      return run("prisma migrate reset --force", (ctx) =>
        runReset(ctx, {
          target: resolveTarget(targetKind, env),
          devOnly,
          yes: parsed.yes,
          skipSeed: !seed,
          status: { allowPending: false },
        }),
      );
    }
  }
}

async function main(): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parse(process.argv.slice(2));
  } catch (err) {
    console.error(`[migrate] ${(err as Error).message}`);
    console.error("");
    console.error(USAGE);
    return 2;
  }

  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  if (parsed.version) {
    console.log(`prisma ${prismaVersion()} (resolved from packages/database)`);
    return 0;
  }
  if (parsed.command === undefined) {
    console.log(USAGE);
    return 0;
  }

  try {
    return await dispatch(parsed);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`[migrate] ${err.message}`);
      return 2;
    }
    return failure(
      { command: parsed.command, mechanism: "see the line above", yes: parsed.yes, dryRun: false, env: process.env },
      err,
    );
  }
}

process.exit(await main());
