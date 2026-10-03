/**
 * Column-level parity report between the primary and the failsafe.
 *
 * check-schema-drift.ts compares table names only. `require-backup` is
 * satisfied by table parity, but mirror.ts copies rows by column name, so a
 * table that exists on both sides with different columns still breaks the
 * copy. This reports that gap.
 */
import { Client } from "pg";
import { loadEnv, requireEnv, supabaseUrl } from "./env";

loadEnv();

async function columns(url: string) {
  const c = new Client({
    connectionString: url.replace(":6543/", ":5432/"),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await c.connect();
  const { rows } = await c.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='public'
     ORDER BY table_name, ordinal_position`,
  );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.table_name) ?? [];
    list.push(r.column_name);
    map.set(r.table_name, list);
  }
  await c.end();
  return map;
}

const primary = await columns(requireEnv("DATABASE_URL"));
const failsafe = await columns(supabaseUrl());

let issues = 0;
for (const [table, pcols] of [...primary].sort()) {
  const fcols = new Set(failsafe.get(table) ?? []);
  if (fcols.size === 0) continue;
  const missing = pcols.filter((c) => !fcols.has(c));
  const extra = [...fcols].filter((c) => !pcols.includes(c));
  if (missing.length === 0 && extra.length === 0) continue;
  issues++;
  console.log(`${table}:`);
  if (missing.length) console.log(`   failsafe MISSING: ${missing.join(", ")}`);
  if (extra.length) console.log(`   failsafe EXTRA:   ${extra.join(", ")}`);
}
console.log(issues === 0 ? "column parity: complete" : `\ntables with column drift: ${issues}`);

const fc = new Client({
  connectionString: requireEnv("SUPABASE_DIRECT_URL"),
  ssl: { rejectUnauthorized: false },
});
await fc.connect();
const counts = await fc.query(
  `SELECT relname, n_live_tup FROM pg_stat_user_tables
   WHERE relname IN ('GradingLevel','Subject','SubjectLevel','Permission','User','AuditLog','SystemConfig')
   ORDER BY relname`,
);
console.log("\nfailsafe row estimates after the aborted run:");
for (const r of counts.rows) console.log(`  ${r.relname}: ~${r.n_live_tup}`);
await fc.end();
