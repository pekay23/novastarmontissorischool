import { loadEnv, requireEnv } from "./env";
/**
 * Applies a reviewed DDL file to a chosen database.
 *
 * The DDL is generated with `prisma migrate diff`, reviewed, then sent to
 * Postgres as a single simple-query batch. Postgres wraps a multi-statement
 * simple query in an implicit transaction, so it applies atomically: either
 * the whole thing lands or none of it does.
 *
 * Usage:
 *   bun run tools/db-mirror/apply-schema.ts <ddl-file> supabase
 *   bun run tools/db-mirror/apply-schema.ts <ddl-file> neon
 *
 * Flags:
 *   --allow-nonempty   permit a target that already has tables (required for
 *                      additive migrations against a populated database)
 *   --dry-run          report what would run, then exit without writing
 */
import { Client } from "pg";
import { readFileSync, existsSync } from "node:fs";


loadEnv();

const raw = process.argv.slice(2);
const flags = new Set(raw.filter((a) => a.startsWith("--")));
const args = raw.filter((a) => !a.startsWith("--"));

const ddlPath = args[0];
const target = (args[1] ?? "supabase").toLowerCase();

if (!ddlPath) {
  console.error(
    "Usage: bun run tools/db-mirror/apply-schema.ts <ddl-file> [supabase|neon]"
  );
  process.exit(1);
}
if (!existsSync(ddlPath)) {
  console.error(`DDL file not found: ${ddlPath}`);
  process.exit(1);
}

const envVar =
  target === "neon"
    ? "DATABASE_URL"
    : target === "supabase"
      ? "SUPABASE_DIRECT_URL"
      : null;
if (!envVar) {
  console.error(`Unknown target '${target}'. Use 'neon' or 'supabase'.`);
  process.exit(1);
}

const url = requireEnv(envVar);

const ddl = readFileSync(ddlPath, "utf-8");

/** Statements that would destroy existing data. */
const destructive = ddl.match(
  /^\s*(DROP\s+(TABLE|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)/gim
);

async function main() {
  // Session pooler (5432) is required for DDL; 6543 is transaction-pooled.
  const direct = url.replace(":6543/", ":5432/");
  const host = new URL(direct).hostname;

  const expected = target === "neon" ? /neon/i : /supabase/i;
  if (!expected.test(host)) {
    console.error(
      `Refusing to run: '${target}' was requested but the host is ${host}`
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: direct,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();

  const { rows: who } = await client.query("SELECT current_user AS u");
  const { rows: before } = await client.query(`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const { rows: rowsBefore } = await client.query(`
    SELECT coalesce(sum(n_live_tup),0)::bigint AS n FROM pg_stat_user_tables
  `);

  console.log(`Target:      ${host}  (${target})`);
  console.log(`Admin role:  ${who[0].u}`);
  console.log(`Tables:      ${before[0].n}`);
  console.log(`Live rows:   ${rowsBefore[0].n}`);
  console.log(`DDL:         ${ddlPath} (${ddl.split("\n").length} lines)`);
  console.log(`Destructive: ${destructive ? destructive.length + " statement(s)!" : "none"}`);

  if (flags.has("--dry-run")) {
    await client.end();
    console.log("\n--dry-run: nothing written.");
    return;
  }

  if (before[0].n > 0 && !flags.has("--allow-nonempty")) {
    console.error(
      "\nRefusing: public schema is not empty. Pass --allow-nonempty if this is an additive migration."
    );
    await client.end();
    process.exit(1);
  }

  try {
    await client.query(ddl);
  } catch (err) {
    console.error("\nFAILED:", (err as Error).message);
    console.error("The implicit transaction rolled back; nothing applied.");
    await client.end();
    process.exit(1);
  }

  const { rows: after } = await client.query(`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const { rows: pol } = await client.query(`
    SELECT count(*)::int AS n FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
  `);

  console.log(`\nTables after: ${after[0].n}  (+${after[0].n - before[0].n})`);
  console.log(`tenant_isolation policies: ${pol[0].n}`);

  await client.end();
  console.log(`Applied to ${target}.`);
}

main().catch((e) => {
  console.error("Failed:", (e as Error).message);
  process.exit(1);
});
