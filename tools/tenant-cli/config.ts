/**
 * Environment loading and database access for the tenant CLI.
 *
 * Only the command modules import this file. `index.ts` reaches them through a
 * dynamic import, so `--help` never loads dotenv, never touches `@novastar/database`
 * and therefore works with no `DATABASE_URL` at all.
 *
 * The `requireEnv` / `redact` convention is copied from `tools/db-mirror/env.ts`:
 * a missing variable throws rather than being defaulted, and no connection string
 * is ever printed.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";
import { prisma } from "@novastar/database";
import type { PrismaClient } from "@novastar/database";

/** The repository root, so the tool behaves the same from the root or from here. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let envLoaded = false;

/**
 * Plain dotenv, `.env` then `.env.local`, both with `override`, so the local file
 * wins and CI variables are never clobbered: in CI neither file exists, so both
 * calls are no-ops and the workflow secrets pass straight through.
 *
 * Lazy and idempotent. Importing this module must not read the filesystem, so a
 * `--help` run that never reaches a command pays nothing.
 */
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  loadDotenvFile({ path: resolve(repoRoot, ".env"), override: true, quiet: true });
  loadDotenvFile({ path: resolve(repoRoot, ".env.local"), override: true, quiet: true });
}

/**
 * Reads a required environment variable.
 *
 * Throws instead of returning a sentinel: `DATABASE_URL` has no safe default and
 * the only correct answer when it is missing is to stop. The message names the
 * variable and never echoes a value.
 */
export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Load the repository .env or export it before running this command.`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  loadEnv();
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** Hides credentials for logging. */
export function redact(url: string): string {
  return url.replace(/:\/\/[^@]*@/, "://***@");
}

/**
 * Confirms a database is configured and returns a log-safe description of it.
 *
 * The value is returned for connection purposes only and is never written to
 * stdout; `redactDatabase` is what any log line should use.
 */
export function requireDatabaseUrl(): string {
  const url = requireEnv("DATABASE_URL");
  try {
    // Neon refuses connections from unknown hosts; failing here with a named
    // variable beats failing later inside the driver with a stack trace.
    void new URL(url);
  } catch {
    throw new Error("DATABASE_URL is set but is not a valid URL. Check the value in .env.");
  }
  return url;
}

export function redactDatabase(): string {
  return redact(requireDatabaseUrl());
}

/**
 * The host the tool is about to write to, or `<unparseable>`.
 *
 * `requireDatabaseUrl` has already proved the value parses, so this never throws
 * in practice; the placeholder keeps the type total rather than throwing from a
 * function whose result is only ever used in a message.
 */
export function databaseHost(): string {
  try {
    return new URL(requireDatabaseUrl()).hostname;
  } catch {
    return "<unparseable>";
  }
}

/**
 * Hosts that are unambiguously this developer's own machine.
 *
 * The set is deliberately narrow and matches `isLocalHost` in
 * `tools/migrate/env.ts`: an unrecognised host counts as remote, and remote means
 * guarded. It is duplicated as a literal rather than imported because
 * `@novastar/migrate` is a separate tool with its own `Context` and env
 * conventions, and importing one tool's internals from another couples two
 * command surfaces that are otherwise independent -- the same trade
 * `commands/operator.ts` makes for `MIN_OPERATOR_PASSWORD_LENGTH`, and for the
 * same reason.
 *
 * The consequence is stated plainly, because it is the whole reason
 * `commands/setup-link.ts` gates on an acknowledgement flag instead: the Prisma
 * client speaks Neon's SQL-over-HTTP protocol (`.env.example`, "Database"), so a
 * local `postgres` cannot serve this schema and `DATABASE_URL` is *always* a
 * managed host in practice. A local-host-only gate would therefore never open,
 * which makes it a gate that always refuses.
 */
export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  if (h === "host.docker.internal") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** The lazily-constructed shared Prisma client. */
export function getPrisma(): PrismaClient {
  requireDatabaseUrl();
  return prisma;
}

/** The tenant code used by `show`, `config *` and `suspend` when `--tenant` is omitted. */
export function defaultTenantCode(): string {
  return requireEnv("TENANT_CODE");
}