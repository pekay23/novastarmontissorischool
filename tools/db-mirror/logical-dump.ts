/**
 * Logical backup of every populated table in the primary, as SQL INSERTs.
 *
 * Stands in for `pg_dump`, which is not installed on this machine. With a few
 * hundred rows a data-only dump is small enough to review by eye, which is the
 * property that actually matters for a restore point.
 *
 * Reads the primary with SELECT only; writes one .sql file.
 */
import { Client } from "pg";
import { writeFileSync } from "node:fs";
import { loadEnv, requireEnv } from "./env";

loadEnv();
const url = requireEnv("DATABASE_URL");

const c = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await c.connect();

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (Buffer.isBuffer(v)) return `'\\x${v.toString("hex")}'::bytea`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const tables = (
  await c.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
     ORDER BY table_name`,
  )
).rows.map((r) => r.table_name as string);

const out: string[] = [
  "-- Logical backup of the Neon primary.",
  `-- generated ${new Date().toISOString()} by tools/db-mirror logical dump`,
  "-- Data only. Schema is owned by prisma/migrations; recreate it before loading.",
  "-- Restore: psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f this-file.sql",
  "",
  "BEGIN;",
  "",
];
const counts: string[] = [];

for (const t of tables) {
  const cols = (
    await c.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [t],
    )
  ).rows.map((r) => r.column_name as string);
  if (cols.length === 0) continue;

  const rows = (await c.query(`SELECT * FROM "${t}"`)).rows;
  if (rows.length === 0) continue;

  const colList = cols.map((n) => `"${n}"`).join(", ");
  out.push(`-- ${t}: ${rows.length} row(s)`);
  for (const r of rows) {
    const vals = cols.map((n) => lit(r[n])).join(", ");
    out.push(`INSERT INTO "${t}" (${colList}) VALUES (${vals});`);
  }
  out.push("");
  counts.push(`${t}=${rows.length}`);
}

out.push("COMMIT;", "");
await c.end();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = `C:\\Users\\Pekay\\AppData\\Local\\Temp\\kilo\\neon-backup-${stamp}.sql`;
writeFileSync(file, out.join("\n"), "utf8");

console.log(`tables dumped: ${counts.length}`);
console.log(counts.join(", "));
console.log(`file: ${file}`);