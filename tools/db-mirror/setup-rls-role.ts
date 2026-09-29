import { loadEnv, requireEnv } from "./env";
/**
 * Creates the RLS-enforcing application role and installs tenant policies.
 *
 * Why this exists: both providers hand out a role with rolbypassrls = true
 * (neondb_owner on Neon, postgres on Supabase). A BYPASSRLS role ignores row
 * level security entirely, so policies are inert no matter how carefully they
 * are written. The fix is a role that is deliberately NOT privileged:
 *
 *     NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
 *
 * The application connects as this role, so every query is filtered by policy.
 *
 * What this script does NOT do: change which role the application uses. That
 * cutover also requires the client to set `app.current_tenant_id` on every
 * connection, and the current driver (Neon's stateless HTTP adapter) has no
 * session to set it on. Until that is done, switching the app over would make
 * every query return zero rows. See docs/audit-reports section 3.1.
 *
 * Usage:
 *   bun run tools/db-mirror/setup-rls-role.ts neon
 *   bun run tools/db-mirror/setup-rls-role.ts supabase
 */
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";


loadEnv();

const ROLE = "novastar_app";
const target = (process.argv[2] ?? "").toLowerCase();
// For Supabase use the direct host (db.*.supabase.co), not the pooler.
// PgBouncer authenticates roles against the pooler's own hostname and rejects
// a custom role with "no tenant identifier provided (external_id or
// sni_hostname required)".
const envVar =
  target === "neon"
    ? "DATABASE_URL"
    : target === "supabase"
      ? "SUPABASE_DATABASE_URL"
      : null;

if (!envVar) {
  console.error("Usage: bun run tools/db-mirror/setup-rls-role.ts [neon|supabase]");
  process.exit(1);
}
const url = requireEnv(envVar);

const qi = (n: string) => `"${n.replace(/"/g, '""')}"`;

async function main() {
  const direct = url.replace(":6543/", ":5432/");
  const host = new URL(direct).hostname;
  const client = new Client({
    connectionString: direct,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();

  const { rows: who } = await client.query(
    "SELECT current_user AS u, current_user = 'postgres' AS is_pg",
  );
  console.log(`Target: ${host} (${target})`);
  console.log(`Admin role: ${who[0].u}\n`);

  // A fresh password each run, so this is safe to re-run after any suspected
  // disclosure. The role already exists in that case, so reset its password.
  const password = randomBytes(24).toString("base64url");

  // Parameterised DDL is not possible for CREATE ROLE, so the identifier and
  // literal are quoted/escaped explicitly. The password is base64url, which
  // contains no quote characters, and the generated value is asserted below.
  if (!/^[A-Za-z0-9_-]+$/.test(password)) {
    throw new Error("Generated password contains unexpected characters");
  }

  const { rows: existing } = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname = $1",
    [ROLE]
  );
  if (existing.length) {
    console.log(`Role ${ROLE} exists; resetting password.`);
    await client.query(`ALTER ROLE ${qi(ROLE)} WITH LOGIN PASSWORD '${password}'`);
  } else {
    console.log(`Creating role ${ROLE}...`);
    await client.query(`
      CREATE ROLE ${qi(ROLE)} WITH
        LOGIN PASSWORD '${password}'
        NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT
    `);
  }

  // Confirm the critical attribute actually took, rather than assuming.
  const { rows: attrs } = await client.query(
    "SELECT rolsuper, rolbypassrls, rolcreatedb FROM pg_roles WHERE rolname = $1",
    [ROLE]
  );
  const a = attrs[0];
  console.log(
    `  rolsuper=${a.rolsuper} rolbypassrls=${a.rolbypassrls} rolcreatedb=${a.rolcreatedb}`
  );
  if (a.rolsuper || a.rolbypassrls || a.rolcreatedb) {
    throw new Error(
      `${ROLE} still has bypass privileges; policies would be inert`
    );
  }

  console.log("\nGranting privileges...");
  await client.query(`GRANT USAGE ON SCHEMA public TO ${qi(ROLE)}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${qi(ROLE)}`
  );
  await client.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${qi(ROLE)}`
  );
  // Default privileges so tables added later are covered without a rerun.
  await client.query(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${qi(ROLE)}
  `);
  // The RLS helper functions are owned by the admin role; the app must be
  // able to execute them or every policy errors at query time.
  await client.query(`GRANT USAGE ON SCHEMA app TO ${qi(ROLE)}`);
  await client.query(
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO ${qi(ROLE)}`
  );

  const { rows: granted } = await client.query(
    `SELECT count(*)::int AS n
     FROM information_schema.role_table_grants
     WHERE grantee = $1 AND table_schema = 'public'
       AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')`,
    [ROLE]
  );
  console.log(`  ${granted[0].n} table grants issued`);

  // Persist the connection string for the cutover. .env is gitignored.
  const newUrl = direct.replace(
    new RegExp(`//[^@]*@`),
    `//${ROLE}:${password}@`
  );
  const envPath = resolve(process.cwd(), ".env");
  const key =
    target === "neon" ? "DATABASE_URL_RLS" : "SUPABASE_DATABASE_URL_RLS";
  let content = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const line = `${key}=${JSON.stringify(newUrl)}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  content = re.test(content)
    ? content.replace(re, line)
    : `${content.replace(/\n*$/, "\n")}${line}\n`;
  writeFileSync(envPath, content);
  console.log(`\nWrote ${key} to .env (gitignored).`);

  await client.end();
  console.log(`\n${ROLE} ready on ${target}.`);
}

main().catch((e) => {
  console.error("Failed:", (e as Error).message);
  process.exit(1);
});
