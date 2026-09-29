/**
 * Compares the Prisma schema's models against the tables actually present in
 * both databases. Read-only.
 *
 * Supabase is included because parity between the primary and the failsafe
 * is the whole point of having one. `_prisma_migrations` is queried only when
 * the table exists: both databases were built with `prisma db push` /
 * `db execute`, which never creates it, and an unguarded query there used to
 * abort the run before the Supabase comparison printed.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { loadEnv, redact, supabaseUrl } from "./env";

loadEnv();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Side {
  label: string;
  connectionString: string;
}

async function tablesOf(side: Side): Promise<Set<string>> {
  const client = new Client({
    connectionString: side.connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);

    if (rows.some((r) => r.table_name === "_prisma_migrations")) {
      const { rows: mig } = await client.query(`
        SELECT migration_name, finished_at
        FROM _prisma_migrations
        ORDER BY started_at
      `);
      console.log(`\n${side.label} applied migrations: ${mig.length}`);
      for (const m of mig) {
        console.log(`  ${m.migration_name} finished=${m.finished_at ?? "NO"}`);
      }
    } else {
      console.log(
        `\n${side.label} applied migrations: unknown (no _prisma_migrations table;` +
          ` schema was pushed with db push/db execute, so there is no history)`
      );
    }

    return new Set(rows.map((r) => r.table_name));
  } finally {
    await client.end();
  }
}

async function main() {
  const schemaPath = resolve(root, "packages/database/prisma/schema.prisma");
  if (!existsSync(schemaPath)) {
    throw new Error(`Schema not found at ${schemaPath}`);
  }
  const schema = readFileSync(schemaPath, "utf-8");
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
  const tenantScoped = new Set(
    [...schema.matchAll(/^model\s+(\w+)\s*\{([^}]*)\}/gm)]
      .filter((m) => /\btenantId\b/.test(m[2]))
      .map((m) => m[1])
  );

  const sides: Side[] = [
    { label: "Neon primary", connectionString: process.env.DATABASE_URL! },
    { label: "Supabase failsafe", connectionString: supabaseUrl() },
  ];

  console.log(`Prisma models: ${models.length}`);
  console.log(`Tenant-scoped models: ${tenantScoped.size}`);

  let drift = 0;
  for (const side of sides) {
    console.log(`\n=== ${side.label} (${redact(side.connectionString)}) ===`);
    const actual = await tablesOf(side);

    const missing = models.filter((m) => !actual.has(m));
    const extra = [...actual].filter((t) => !models.includes(t));

    console.log(`Tables: ${actual.size}`);
    console.log(`\nIn schema but NOT present (${missing.length}):`);
    for (const m of missing) console.log(`  ${m}`);
    console.log(`\nPresent but NOT in schema (${extra.length}):`);
    for (const t of extra) console.log(`  ${t}`);
    console.log(
      `\nTenant-scoped models present: ${[...tenantScoped].filter((m) =>
        actual.has(m)
      ).length}/${tenantScoped.size}`
    );

    if (missing.length > 0) drift += missing.length;
  }

  if (drift > 0) {
    console.log(`\nSCHEMA DRIFT: ${drift} missing table(s)`);
    process.exit(1);
  }
  console.log("\nSCHEMA PARITY: every Prisma model is present in both databases.");
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
