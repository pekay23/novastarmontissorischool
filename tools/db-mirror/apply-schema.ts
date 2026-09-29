/**
 * Creates the full Prisma schema on the Supabase failsafe database.
 *
 * The DDL is generated with `prisma migrate diff --from-empty`, reviewed
 * (it is all CREATE/ALTER, no DROP/TRUNCATE/DELETE), then sent to Postgres as
 * a single simple-query batch. Postgres wraps a multi-statement simple query
 * in an implicit transaction, so it applies atomically: either the whole
 * schema lands or none of it does.
 *
 * This only ever writes to SUPABASE_DATABASE_URL. The Neon primary is only
 * ever read.
 *
 * Usage: bun run tools/db-mirror/apply-schema.ts
 */
import { Client } from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf-8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

loadEnv();

const ddlPath = process.argv[2] ?? resolve(process.env.TEMP!, "schema-ddl.sql");

async function main() {
  if (!existsSync(ddlPath)) {
    console.error(`DDL file not found: ${ddlPath}`);
    process.exit(1);
  }
  const ddl = readFileSync(ddlPath, "utf-8");

  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (!supabaseUrl) {
    console.error("SUPABASE_DATABASE_URL is not set");
    process.exit(1);
  }

  // Session pooler (5432) is required for DDL; 6543 is transaction-pooled.
  const direct = supabaseUrl.replace(":6543/", ":5432/");

  const client = new Client({
    connectionString: direct,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();

  const host = new URL(direct).hostname;
  console.log(`Target: ${host}`);
  if (!/supabase/i.test(host)) {
    console.error(
      `Refusing to run: target host does not look like Supabase (${host})`,
    );
    await client.end();
    process.exit(1);
  }

  // Never write to a database that already has tables without saying so.
  const { rows: before } = await client.query(`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  console.log(`Tables before: ${before[0].n}`);
  if (before[0].n > 0 && !process.argv.includes("--allow-nonempty")) {
    console.error(
      "Refusing to run: public schema is not empty. Pass --allow-nonempty to override.",
    );
    await client.end();
    process.exit(1);
  }

  console.log(`Applying ${ddl.split("\n").length} lines of DDL...\n`);
  try {
    await client.query(ddl);
  } catch (err) {
    console.error("Schema apply FAILED:", (err as Error).message);
    console.error("The implicit transaction rolled back; nothing applied.");
    await client.end();
    process.exit(1);
  }

  const { rows: after } = await client.query(`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  console.log(`Tables after: ${after[0].n}`);

  await client.end();
  console.log("\nSchema created on the Supabase failsafe.");
}

main().catch((e) => {
  console.error("Failed:", (e as Error).message);
  process.exit(1);
});
