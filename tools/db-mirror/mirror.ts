#!/usr/bin/env bun
import { loadEnv, supabaseUrl as supabaseConn } from "./env";
/**
 * Neon → Supabase failsafe mirror.
 *
 * Replaces the previous shell/psql implementation, which could never run:
 *   - it referenced snake_case tables that do not exist (Neon uses PascalCase
 *     quoted identifiers: "Tenant", "School", "FeeInvoice")
 *   - it shelled out to `psql`, which is not installed
 *   - its pg_cron variant was never registered and still held a placeholder
 *     password
 *
 * This version drives both databases over `pg` (already a dependency) and
 * derives every table and column name from information_schema, so it cannot
 * drift from the live schema the way a hardcoded list did.
 *
 * Safety properties:
 *   - Neon is opened read-only and never written to.
 *   - Each table is TRUNCATEd then repopulated, so a re-run converges instead
 *     of appending duplicates.
 *   - Only tables present in BOTH databases are mirrored; tables missing on
 *     either side are reported and skipped, never silently dropped.
 *
 * Usage:
 *   bun run tools/db-mirror/mirror.ts              # mirror, then verify
 *   bun run tools/db-mirror/mirror.ts --verify-only
 */
import { Client } from "pg";


loadEnv();

const BATCH = 200;

/** Quotes a Postgres identifier safely. */
const qi = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function connect(url: string, label: string): Promise<Client> {
  // Port 5432 (session pooler) is required for DDL and multi-statement work.
  const direct = url.replace(":6543/", ":5432/");
  const c = new Client({
    connectionString: direct,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await c.connect();
  const host = new URL(direct).hostname;
  console.log(`${label}: connected to ${host}`);
  return c;
}

async function listTables(c: Client): Promise<string[]> {
  const { rows } = await c.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return rows.map((r) => r.table_name);
}

async function listColumns(c: Client, table: string): Promise<string[]> {
  const { rows } = await c.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

/**
 * Orders tables so a table is always inserted after every table it references.
 * Uses the live foreign keys rather than guessing from names.
 */
async function topoSort(c: Client, tables: string[]): Promise<string[]> {
  const { rows } = await c.query<{ child: string; parent: string }>(`
    SELECT child.relname AS child, parent.relname AS parent
    FROM pg_constraint con
    JOIN pg_class child  ON child.oid  = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace
    WHERE con.contype = 'f' AND n.nspname = 'public'
  `);

  const set = new Set(tables);
  const deps = new Map<string, Set<string>>();
  for (const t of tables) deps.set(t, new Set());
  for (const r of rows) {
    // Only care about dependencies inside the mirrored set.
    if (set.has(r.child) && set.has(r.parent) && r.child !== r.parent) {
      deps.get(r.child)!.add(r.parent);
    }
  }

  const ordered: string[] = [];
  const done = new Set<string>();
  let remaining = [...tables];

  // Kahn's algorithm. Repeat passes rather than recurse, so a dependency
  // cycle among these tables degrades to "insert in the given order" instead
  // of throwing.
  while (remaining.length) {
    const ready = remaining.filter((t) =>
      [...deps.get(t)!].every((d) => done.has(d) || !set.has(d))
    );
    if (ready.length === 0) {
      console.warn(
        `  note: foreign key cycle among {${remaining.join(", ")}}; ` +
          "inserting without ordering guarantees",
      );
      ordered.push(...remaining);
      break;
    }
    for (const t of ready) {
      ordered.push(t);
      done.add(t);
    }
    remaining = remaining.filter((t) => !done.has(t));
  }

  return ordered;
}

async function main() {
  const neonUrl = process.env.DATABASE_URL;
  const supabaseUrl = supabaseConn();
  if (!neonUrl || !supabaseUrl) {
    console.error("DATABASE_URL and SUPABASE_DATABASE_URL must both be set");
    process.exit(1);
  }

  const neon = await connect(neonUrl, "Neon (source)");
  const supabase = await connect(supabaseUrl, "Supabase (failsafe)");

  // Force Neon read-only for the duration of this process. If the mirror ever
  // gets a stray write in, Postgres rejects it rather than corrupting prod.
  await neon.query("SET default_transaction_read_only = on");
  console.log("Neon session set to READ ONLY\n");

  const neonTables = await listTables(neon);
  const supaTables = new Set(await listTables(supabase));

  const shared = neonTables.filter((t) => supaTables.has(t));
  const onlyNeon = neonTables.filter((t) => !supaTables.has(t));
  const onlySupa = [...supaTables].filter((t) => !neonTables.includes(t));

  console.log(`Neon tables: ${neonTables.length}`);
  console.log(`Supabase tables: ${supaTables.size}`);
  console.log(`Mirroring: ${shared.length}\n`);
  if (onlyNeon.length) {
    console.log(`Missing on Supabase (skipped): ${onlyNeon.join(", ")}`);
  }
  if (onlySupa.length) {
    console.log(`Missing on Neon (no data): ${onlySupa.join(", ")}\n`);
  }

  if (!process.argv.includes("--verify-only")) {
    // Truncate every shared table in one statement so mutually referencing
    // tables clear together, then insert parents before children. Truncating
    // per-table would cascade away rows a later table still needs to refill.
    await supabase.query(`TRUNCATE TABLE ${shared.map(qi).join(", ")} CASCADE`);

    const order = await topoSort(neon, shared);
    console.log(`Insert order resolved (${order.length} tables)\n`);

    for (const table of order) {
      const cols = await listColumns(neon, table);
      const { rows } = await neon.query(
        `SELECT ${cols.map(qi).join(", ")} FROM ${qi(table)}`
      );

      if (rows.length === 0) continue;

      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const values: unknown[] = [];
        const tuples: string[] = [];
        for (const row of slice) {
          tuples.push(
            `(${cols.map((_, ci) => `$${values.length + ci + 1}`).join(", ")})`
          );
          for (const c of cols) values.push(normalize(row[c]));
        }
        await supabase.query(
          `INSERT INTO ${qi(table)} (${cols.map(qi).join(", ")}) VALUES ${tuples.join(", ")}`,
          values
        );
      }
      process.stdout.write(`  ${table}: ${rows.length} rows\n`);
    }
  }

  console.log("\nVerifying row counts:");
  let mismatches = 0;
  for (const table of shared) {
    const [n, s] = await Promise.all([
      neon.query(`SELECT count(*)::int AS n FROM ${qi(table)}`),
      supabase.query(`SELECT count(*)::int AS n FROM ${qi(table)}`),
    ]);
    const nc = n.rows[0].n as number;
    const sc = s.rows[0].n as number;
    const ok = nc === sc;
    if (!ok) mismatches++;
    if (!ok || nc > 0) {
      console.log(`  ${ok ? "OK " : "MISMATCH"} ${table}: Neon=${nc} Supabase=${sc}`);
    }
  }
  console.log(
    mismatches === 0
      ? "\nMIRROR VERIFIED: all shared tables match."
      : `\n${mismatches} table(s) MISMATCHED.`
  );

  await neon.end();
  await supabase.end();
  process.exit(mismatches === 0 ? 0 : 1);
}

/**
 * Prepares a value read from Neon for binding as a query parameter against
 * Supabase.
 *
 * - JSON/JSONB columns come back as plain objects. node-postgres cannot bind an
 *   object, so serialise it; Postgres casts the text back on insert.
 * - Postgres ARRAY columns come back as JS arrays and must be passed through
 *   untouched. JSON.stringify-ing them double-encodes, and Postgres then
 *   rejects the result with "malformed array literal".
 */
function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || Buffer.isBuffer(v)) return v;
  if (Array.isArray(v)) return v;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

main().catch((e) => {
  console.error("\nMirror failed:", (e as Error).message);
  process.exit(1);
});
