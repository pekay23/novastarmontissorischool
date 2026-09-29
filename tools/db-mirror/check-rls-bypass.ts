import { loadEnv } from "./env";
/**
 * Why do the RLS policies not isolate? Checks the connecting role's RLS
 * bypass attributes. Read-only.
 */
import { Client } from "pg";


loadEnv();

async function inspect(label: string, url: string) {
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();

  const { rows } = await client.query(`
    SELECT current_user AS usename,
           r.rolsuper  AS is_superuser,
           r.rolbypassrls AS bypassrls,
           r.rolcreaterole AS createrole
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  const r = rows[0];

  console.log(`\n=== ${label} ===`);
  console.log(`  connected as:  ${r.usename}`);
  console.log(`  rolsuper:      ${r.is_superuser}`);
  console.log(`  rolbypassrls:  ${r.bypassrls}   <-- true means RLS never applies`);

  const { rows: owned } = await client.query(`
    SELECT count(*)::int AS n
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r'
      AND pg_catalog.pg_get_userbyid(c.relowner) = current_user
  `);
  console.log(`  tables owned by this role: ${owned[0].n}`);

  await client.end();
}

async function main() {
  await inspect("Neon primary", process.env.DATABASE_URL!);
  const supa = process.env.SUPABASE_DATABASE_URL!.replace(":6543/", ":5432/");
  await inspect("Supabase failsafe", supa);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
