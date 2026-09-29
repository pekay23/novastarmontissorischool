import { loadEnv, supabaseUrl as supabaseConn } from "./env";
/**
 * Read-only inspection of the Supabase failsafe database.
 * Reports current schema state so RLS can be applied against reality,
 * not assumptions. Makes no writes.
 */
import { Client } from "pg";


loadEnv();

const url = supabaseConn();
if (!url) {
  console.error("SUPABASE_DATABASE_URL not set");
  process.exit(1);
}

// Session pooler (5432) is required for DDL; 6543 is the transaction pooler.
const direct =
  supabaseConn() ?? url.replace(":6543/", ":5432/");

const client = new Client({
  connectionString: direct,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function main() {
  await client.connect();
  console.log("Connected to Supabase failsafe database\n");

  const { rows: tables } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log(`Tables in public schema: ${tables.length}`);
  for (const t of tables) console.log(`  ${t.table_name}`);

  const { rows: rls } = await client.query(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  const enabled = rls.filter((r) => r.rowsecurity);
  console.log(`\nRLS currently enabled on ${enabled.length} table(s):`);
  for (const t of enabled) console.log(`  ${t.tablename}`);

  const { rows: policies } = await client.query(`
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  console.log(`\nExisting policies: ${policies.length}`);
  for (const p of policies) console.log(`  ${p.tablename}: ${p.policyname}`);

  const { rows: counts } = await client.query(`
    SELECT relname, n_live_tup
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY relname
  `);
  console.log("\nRow counts:");
  for (const c of counts) console.log(`  ${c.relname}: ${c.n_live_tup}`);

  const { rows: version } = await client.query("SELECT version()");
  console.log(`\n${version[0].version}`);

  await client.end();
}

main().catch(async (err) => {
  console.error("Inspection failed:", err.message);
  await client.end().catch(() => {});
  process.exit(1);
});
