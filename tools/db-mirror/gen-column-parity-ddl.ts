/**
 * Column-level parity DDL: adds columns the primary has and the failsafe lacks.
 *
 * `require-backup` is satisfied by table parity, but `mirror.ts` copies rows by
 * column name, so a table present on both sides with different columns still
 * breaks the copy. `check-column-parity.ts` reports the gap; this emits the fix
 * from the primary's own information_schema, so the result is a snapshot match
 * rather than a guess about which migration introduced a column.
 *
 * Append to — never replace — the failsafe-parity.sql batch, and run after it:
 * `User.status` is typed by the "UserStatus" enum that batch creates.
 */
import { Client } from "pg";
import { writeFileSync } from "node:fs";
import { loadEnv, requireEnv, supabaseUrl } from "./env";

loadEnv();

interface Column {
  table: string;
  name: string;
  udt: string;
  nullable: boolean;
  def: string | null;
  len: string | null;
  prec: string | null;
  scale: string | null;
}

async function columns(url: string): Promise<Map<string, Column[]>> {
  const c = new Client({
    connectionString: url.replace(":6543/", ":5432/"),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await c.connect();
  const { rows } = await c.query<Column>(
    `SELECT table_name AS "table", column_name AS "name", udt_name AS "udt",
            is_nullable = 'YES' AS "nullable", column_default AS "def",
            character_maximum_length AS "len",
            numeric_precision AS "prec", numeric_scale AS "scale"
     FROM information_schema.columns
     WHERE table_schema='public'
     ORDER BY table_name, ordinal_position`,
  );
  const map = new Map<string, Column[]>();
  for (const r of rows) {
    const list = map.get(r.table) ?? [];
    list.push(r);
    map.set(r.table, list);
  }
  await c.end();
  return map;
}

/** udt_name is Postgres' internal type name; map the ones that differ from SQL. */
function sqlType(col: Column): string {
  switch (col.udt) {
    case "text":
      return "TEXT";
    case "int4":
      return "INTEGER";
    case "int8":
      return "BIGINT";
    case "bool":
      return "BOOLEAN";
    case "jsonb":
      return "JSONB";
    case "json":
      return "JSON";
    case "uuid":
      return "UUID";
    case "timestamp":
      return "TIMESTAMP(3)";
    case "timestamptz":
      return "TIMESTAMPTZ(3)";
    case "date":
      return "DATE";
    case "numeric":
      return `NUMERIC(${col.prec ?? 0}, ${col.scale ?? 0})`;
    case "varchar":
      return `VARCHAR(${col.len ?? 255})`;
    default:
      // Enums and any other user-defined type: quote the udt name.
      return `"${col.udt}"`;
  }
}

const primary = await columns(requireEnv("DATABASE_URL"));
const failsafe = await columns(supabaseUrl());

const stmts: string[] = [];
let added = 0;
const setNotNull: string[] = [];

for (const [table, pcols] of [...primary].sort()) {
  const fcols = new Set((failsafe.get(table) ?? []).map((c) => c.name));
  if (fcols.size === 0) continue; // created wholesale by failsafe-parity.sql
  for (const col of pcols) {
    if (fcols.has(col.name)) continue;
    const type = sqlType(col);
    const def = col.def ? ` DEFAULT ${col.def}` : "";
    stmts.push(`ALTER TABLE "${table}" ADD COLUMN "${col.name}" ${type}${def};`);
    added++;
    if (!col.nullable && !col.def) {
      // ADD COLUMN ... NOT NULL with no default fails on a non-empty table, so
      // add it nullable and tighten afterwards. Still fails if rows exist to
      // leave null, which is correct: there is no honest value to invent.
      stmts.push(
        `ALTER TABLE "${table}" ALTER COLUMN "${col.name}" SET NOT NULL;`,
      );
      setNotNull.push(`${table}.${col.name}`);
    }
  }
}

const header = `-- Column-level parity DDL: adds columns present in the primary and absent
-- from the failsafe. Run AFTER failsafe-parity.sql (User.status needs the
-- "UserStatus" enum it creates) and BEFORE re-running tools/db-mirror/mirror.ts.
--
-- Generated from live information_schema by gen-column-parity-ddl.ts.
-- Verified with check-column-parity.ts.
`;
const dest = "tools/db-mirror/failsafe-column-parity.sql";
writeFileSync(dest, header + "\n" + stmts.join("\n") + "\n", "utf8");

console.log(`columns added: ${added}`);
console.log(`tightened to NOT NULL afterwards: ${setNotNull.length ? setNotNull.join(", ") : "none"}`);
console.log(`written: ${dest}`);
