/**
 * Lists every ARRAY and JSON/JSONB column that actually holds non-null data in
 * the Neon primary, so verify-restore can target the columns worth checking
 * rather than a hardcoded guess.
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
const qi = (n: string) => `"${n.replace(/"/g, '""')}"`;

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL!.replace(":6543/", ":5432/"),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await c.connect();
  await c.query("SET default_transaction_read_only = on");

  const { rows } = await c.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND (data_type='ARRAY' OR data_type IN ('json','jsonb'))
    ORDER BY table_name, column_name
  `);

  console.log("Populated complex-type columns in Neon:\n");
  for (const col of rows) {
    const { rows: n } = await c.query(
      `SELECT count(*)::int AS n FROM ${qi(col.table_name)}
       WHERE "${col.column_name}" IS NOT NULL`
    );
    if (n[0].n > 0) {
      console.log(
        `  ${col.table_name}.${col.column_name} [${col.data_type}] = ${n[0].n} rows`
      );
    }
  }

  // Also: which tables have a timestamp worth comparing.
  const { rows: ts } = await c.query(`
    SELECT c.relname AS t, a.attname AS col
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_stat_user_tables s ON s.relname = c.relname
    WHERE n.nspname='public' AND a.attname IN ('createdAt','updatedAt')
      AND a.attnum > 0 AND NOT a.attisdropped AND s.n_live_tup > 0
    ORDER BY s.n_live_tup DESC LIMIT 5
  `);
  console.log("\nTimestamp columns on populated tables:");
  for (const t of ts) console.log(`  ${t.t}.${t.col}`);

  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
