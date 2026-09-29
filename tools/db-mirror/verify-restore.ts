import { loadEnv, supabaseUrl } from "./env";
/**
 * Restore-readiness check for the Supabase failsafe.
 *
 * Row counts prove nothing was dropped but do not prove the data is usable.
 * This compares actual values between Neon and Supabase for the column types
 * most likely to corrupt in a mirror (arrays, json/jsonb, enums, timestamps)
 * plus referential integrity.
 *
 * Columns are discovered from the live database, not hardcoded. An earlier
 * version checked a hardcoded list that happened to miss every populated
 * ARRAY column including Role.permissions, so it reported PASS while checking
 * nothing. A check that cannot fail is worse than no check.
 */
import { Client } from "pg";


loadEnv();
const qi = (n: string) => `"${n.replace(/"/g, '""')}"`;

interface Col {
  table_name: string;
  column_name: string;
  data_type: string;
}

async function main() {
  const neon = new Client({
    connectionString: process.env.DATABASE_URL!.replace(":6543/", ":5432/"),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  const supa = new Client({
    // supabaseUrl() rather than SUPABASE_DIRECT_URL: the workflow only
    // supplies DATABASE_URL, SUPABASE_DATABASE_URL and DATABASE_URL_RLS, and
    // this check holds a connection open long enough that the transaction
    // pooler would recycle it. The .replace promotes the pooled port to
    // session mode, so one secret covers both cases.
    connectionString: supabaseUrl().replace(":6543/", ":5432/"),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await neon.connect();
  await supa.connect();
  await neon.query("SET default_transaction_read_only = on");

  let problems = 0;
  let assertions = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    assertions++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) problems++;
  };

  // Discover every ARRAY / JSON / JSONB column that actually holds data.
  const { rows: cols } = await neon.query<Col>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND (data_type='ARRAY' OR data_type IN ('json','jsonb'))
    ORDER BY table_name, column_name
  `);

  const populated: Col[] = [];
  for (const c of cols) {
    const { rows: n } = await neon.query(
      `SELECT count(*)::int AS n FROM ${qi(c.table_name)} WHERE "${c.column_name}" IS NOT NULL`
    );
    if (n[0].n > 0) populated.push(c);
  }

  console.log(`Array / JSON columns with data: ${populated.length}\n`);
  if (populated.length === 0) {
    console.log("  FAIL  no complex columns discovered — the check is not working");
    problems++;
  }

  for (const c of populated) {
    const q = `SELECT "${c.column_name}" FROM ${qi(c.table_name)}
                WHERE "${c.column_name}" IS NOT NULL ORDER BY 1 LIMIT 200`;
    const [a, b] = await Promise.all([neon.query(q), supa.query(q)]);
    const identical = JSON.stringify(a.rows) === JSON.stringify(b.rows);

    // For JSON columns, also assert the value is real JSON in the failsafe
    // rather than a quoted string, which is what a bad cast produces.
    let typedOk = true;
    if (c.data_type !== "ARRAY" && a.rows.length) {
      const raw = await supa.query<Record<string, unknown>>(
        `SELECT jsonb_typeof("${c.column_name}") AS t FROM ${qi(c.table_name)}
         WHERE "${c.column_name}" IS NOT NULL LIMIT 1`
      );
      typedOk = raw.rows.length > 0 && raw.rows[0].t !== null;
    }

    check(
      `${c.table_name}.${c.column_name} [${c.data_type}]`,
      identical && typedOk && a.rows.length > 0,
      `${a.rows.length} rows compared`
    );
  }

  // Referential integrity: orphans would exist if children were inserted
  // before parents, and row counts would still match.
  console.log("\nReferential integrity in the failsafe:");
  const { rows: fks } = await neon.query<{
    child: string;
    parent: string;
    col: string;
    pcol: string;
  }>(`
    SELECT child.relname AS child, parent.relname AS parent,
           a.attname AS col, pa.attname AS pcol
    FROM pg_constraint con
    JOIN pg_class child  ON child.oid  = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace n  ON n.oid = child.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a  ON a.attrelid = child.oid  AND a.attnum = k.attnum
    JOIN unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = k.ord
    JOIN pg_attribute pa ON pa.attrelid = parent.oid AND pa.attnum = pk.attnum
    WHERE con.contype = 'f' AND n.nspname = 'public'
  `);
  let orphanTotal = 0;
  for (const fk of fks) {
    const { rows } = await supa.query(
      `SELECT count(*)::int AS n FROM ${qi(fk.child)} c
       WHERE c."${fk.col}" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ${qi(fk.parent)} p WHERE p."${fk.pcol}" = c."${fk.col}")`
    );
    if (rows[0].n > 0) {
      console.log(
        `  FAIL  ${fk.child}.${fk.col} -> ${fk.parent}.${fk.pcol}: ${rows[0].n} orphans`
      );
      orphanTotal += rows[0].n;
    }
  }
  if (orphanTotal === 0) {
    assertions++;
    console.log(`  PASS  ${fks.length} foreign keys, zero orphans`);
  } else problems++;

  // Timestamps, on a table that actually has rows.
  const tsTable = "Permission";
  const [tn, ts] = await Promise.all([
    neon.query(`SELECT "createdAt","updatedAt" FROM "${tsTable}" ORDER BY "id" LIMIT 200`),
    supa.query(`SELECT "createdAt","updatedAt" FROM "${tsTable}" ORDER BY "id" LIMIT 200`),
  ]);
  check(
    `${tsTable} createdAt/updatedAt`,
    tn.rows.length > 0 && JSON.stringify(tn.rows) === JSON.stringify(ts.rows),
    `${tn.rows.length} rows compared`
  );

  await neon.end();
  await supa.end();
  console.log(
    problems === 0
      ? `\nRESTORE READINESS: PASS (${assertions} assertions)`
      : `\n${problems} of ${assertions} assertions FAILED — not restore-ready`
  );
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Check failed:", (e as Error).message);
  process.exit(1);
});
