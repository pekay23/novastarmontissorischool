/**
 * Target resolution for `@novastar/migrate`.
 *
 * Two rules, both load-bearing:
 *
 * 1. **A missing connection string throws. It never warns and never falls back
 *    to a placeholder.** This tool runs DDL. `packages/database/index.ts` can
 *    hand back a mock client when `DATABASE_URL` is absent because that path
 *    only exists so `next build` works; there is no such allowance here. The
 *    error names the variable so the operator knows what to export.
 *
 * 2. **Precedence matches `packages/database/prisma.config.ts` exactly**, which
 *    is `DATABASE_URL || DIRECT_URL`. Every Prisma subprocess is therefore
 *    given an explicit `DATABASE_URL` in its child environment holding the
 *    value this module selected, so Prisma and this tool can never disagree
 *    about which database is being migrated.
 *
 * The environment is a parameter rather than a global read so that resolution
 * is a pure function and `tests/env.test.ts` needs no mutation of
 * `process.env`.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Thrown when a required connection string is absent. Names the variable. */
export class MissingEnvError extends Error {
  constructor(readonly variable: string) {
    super(
      `${variable} is not set. Export it or put it in the repo root .env — ` +
        "refusing to run migrations against an unknown database.",
    );
    this.name = "MissingEnvError";
  }
}

export type TargetKind = "primary" | "direct" | "mirror";

export interface Target {
  readonly kind: TargetKind;
  readonly url: string;
  /** Which variable supplied it, for logging. */
  readonly source: string;
  readonly host: string;
}

/** The repository root, so the tool works from the repo root or from here. */
export const repoRoot = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `packages/database` — the only place a Prisma CLI and the schema live. */
export const databasePackageDir = (): string => resolve(repoRoot(), "packages/database");

/**
 * Loads the repo root `.env` and `.env.local` with **no override**, so the
 * shell wins over the file. `prisma.config.ts` gets this for free from
 * `import "dotenv/config"`; matching it here is what keeps the child process
 * and the parent agreeing.
 *
 * Note that Bun loads a cwd-relative `.env` by itself before any of this runs,
 * so a value already in `process.env` may have come from there rather than from
 * the shell. That is harmless: `override: false` means the file cannot displace
 * a value that is already set, and every command prints the resolved host on
 * its first line, so a surprise is visible immediately.
 *
 * `MIGRATE_SKIP_DOTENV=1` skips the files entirely — for CI, where the secrets
 * are already in the environment and a `.env` baked into an image must not be
 * able to point a DDL run at a different host. Bun's own opt-out is
 * `--no-env-file`.
 *
 * A missing `dotenv` is a warning, not a failure. The tool's hard requirement
 * is the connection string, not the convenience loader; refusing to run
 * because a file could not be read would only hide the honest error, which is
 * `DATABASE_URL is not set`.
 */
export async function loadEnv(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.MIGRATE_SKIP_DOTENV === "1") return;
  const root = repoRoot();
  try {
    const mod = await import("dotenv");
    const dotenv = (mod.default ?? mod) as {
      config(o: Record<string, unknown>): unknown;
    };
    dotenv.config({ path: resolve(root, ".env"), override: false, quiet: true });
    dotenv.config({ path: resolve(root, ".env.local"), override: false, quiet: true });
  } catch (err) {
    console.warn(
      `[migrate] could not load the repo root .env (${(err as Error).message}). ` +
        "Continuing with the process environment only.",
    );
  }
}

/** The host of a connection string, or `<unparseable>` rather than a throw. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "<unparseable>";
  }
}

/** Hides credentials for logging. */
export function redact(url: string): string {
  return url.replace(/:\/\/[^@]*@/, "://***@");
}

/**
 * Hosts that are unambiguously a developer's own machine.
 *
 * `reset` and the production guard both key off this, so the set is
 * deliberately narrow: an unrecognised host is treated as remote, and remote
 * means guarded.
 */
export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  if (h === "host.docker.internal") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** Reads a non-empty variable, or undefined. Blank counts as unset. */
function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name];
  return v && v.trim() !== "" ? v : undefined;
}

/** Validates that a value is a Postgres URL before it reaches a DDL command. */
export function asPostgresUrl(url: string, source: string): string {
  const scheme = /^postgres(ql)?:\/\//.test(url) ? url : undefined;
  if (!scheme) {
    throw new Error(
      `${source} is not a PostgreSQL URL (got "${url.slice(0, 12)}..."). ` +
        "A migration tool will not guess the protocol or the target database.",
    );
  }
  return url;
}

function target(kind: TargetKind, url: string, source: string): Target {
  return { kind, url: asPostgresUrl(url, source), source, host: hostOf(url) };
}

/**
 * The primary: `DATABASE_URL || DIRECT_URL`, byte for byte the precedence in
 * `packages/database/prisma.config.ts`.
 */
export function resolvePrimary(env: NodeJS.ProcessEnv = process.env): Target {
  const db = read(env, "DATABASE_URL");
  if (db) return target("primary", db, "DATABASE_URL");
  const direct = read(env, "DIRECT_URL");
  if (direct) return target("primary", direct, "DIRECT_URL (DATABASE_URL unset)");
  throw new MissingEnvError("DATABASE_URL (or DIRECT_URL)");
}

/**
 * The direct, non-pooler connection, for work that a pooler cannot do.
 * Prefers `DIRECT_URL`; falls back to `DATABASE_URL` and says so, because a
 * pooler URL under the name "direct" would be a lie an operator cannot see.
 */
export function resolveDirect(env: NodeJS.ProcessEnv = process.env): Target {
  const direct = read(env, "DIRECT_URL");
  if (direct) return target("direct", direct, "DIRECT_URL");
  const db = read(env, "DATABASE_URL");
  if (db) return target("direct", db, "DATABASE_URL (DIRECT_URL unset)");
  throw new MissingEnvError("DIRECT_URL (or DATABASE_URL)");
}

/** The Supabase failsafe. Optional: only `require-backup` and `mirror` need it. */
export function resolveMirror(env: NodeJS.ProcessEnv = process.env): Target | undefined {
  const url = read(env, "SUPABASE_DATABASE_URL");
  return url ? target("mirror", url, "SUPABASE_DATABASE_URL") : undefined;
}

/** Resolves a `--target` value, defaulting to the primary. */
export function resolveTarget(
  kind: TargetKind,
  env: NodeJS.ProcessEnv = process.env,
): Target {
  if (kind === "primary") return resolvePrimary(env);
  if (kind === "direct") return resolveDirect(env);
  const mirror = resolveMirror(env);
  if (!mirror) throw new MissingEnvError("SUPABASE_DATABASE_URL");
  return mirror;
}

/** True when the file exists; used to fail with a path, not an ENOENT stack. */
export function mustExist(path: string, what: string): string {
  if (!existsSync(path)) throw new Error(`${what} not found at ${path}`);
  return path;
}
