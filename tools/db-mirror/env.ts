/**
 * Environment loading for the database tooling.
 *
 * Plain dotenv. Load order is `.env` then `.env.local`, both with override,
 * so the local file wins and CI environment variables are never clobbered:
 * in CI neither file exists, so both calls are no-ops and the workflow
 * secrets pass straight through.
 *
 * Keep every key unique within each file. A duplicate inside one file is not
 * an error in dotenv, it just resolves to the last declaration, which is how
 * this tool previously ended up pointing at an unreachable Supabase host.
 * The same key in both files is fine and intentional: .env.local wins.
 * tools/db-mirror/check-env-duplicates.ts guards the first case.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

/** The package root, so the tools work from the repo root or from here. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

config({ path: resolve(root, ".env"), override: true, quiet: true });
config({ path: resolve(root, ".env.local"), override: true, quiet: true });

export function loadEnv(): void {}

/** Resolves a connection string for DDL work: session mode, never the pooler. */
export function directUrl(url: string): string {
  return url.replace(":6543/", ":5432/");
}

/**
 * The Supabase endpoint. `SUPABASE_DATABASE_URL` points at the transaction
 * pooler, which is the only host that accepts connections from this network;
 * the direct `db.*.supabase.co` host does not resolve here.
 */
export function supabaseUrl(): string {
  return requireEnv("SUPABASE_DATABASE_URL");
}

/** Hides credentials for logging. */
export function redact(url: string): string {
  return url.replace(/:\/\/[^@]*@/, "://***@");
}

/**
 * Reads a required environment variable.
 *
 * TypeScript cannot narrow `process.env.X` across a function boundary, so
 * every tool would otherwise need a local `if (!url) process.exit(1)` guard
 * purely to satisfy the compiler. This throws instead, which is both narrower
 * and a better error message.
 */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set. Load .env or export it.`);
  }
  return v;
}
