/**
 * Compares the Prisma schema's models against the tables actually present
 * in the Neon primary. Read-only.
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

async function main() {
  const schema = readFileSync(
    resolve("packages/database/prisma/schema.prisma"),
    "utf-8",
  );
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(
    (m) => m[1],
  );
  const tenantScoped = new Set(
    [...schema.matchAll(/^model\s+(\w+)\s*\{([^}]*)\}/gm)]
      .filter((m) => /\btenantId\b/.test(m[2]))
      .map((m) => m[1]),
  );

  const client = new Client({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();

  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const actual = new Set(rows.map((r) => r.table_name));

  const missing = models.filter((m) => !actual.has(m));
  const extra = [...actual].filter((t) => !models.includes(t));

  console.log(`Prisma models: ${models.length}`);
  console.log(`Neon tables:   ${actual.size}`);
  console.log(`\nIn schema but NOT in Neon (${missing.length}):`);
  for (const m of missing) console.log(`  ${m}`);
  console.log(`\nIn Neon but NOT in schema (${extra.length}):`);
  for (const t of extra) console.log(`  ${t}`);

  console.log(`\nTenant-scoped models: ${tenantScoped.size}`);
  console.log(
    `Tenant-scoped models present in Neon: ${
      [...tenantScoped].filter((m) => actual.has(m)).length
    }`,
  );

  // The init migration is checked in but has it ever been applied?
  const { rows: mig } = await client.query(`
    SELECT migration_name, finished_at
    FROM _prisma_migrations
    ORDER BY started_at
  `);
  console.log(`\nApplied migrations: ${mig.length}`);
  for (const m of mig) {
    console.log(`  ${m.migration_name} finished=${m.finished_at ?? "NO"}`);
  }

  await client.end();
}

main().catch(async (e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
