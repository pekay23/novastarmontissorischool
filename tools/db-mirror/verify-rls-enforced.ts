import { loadEnv, requireEnv } from "./env";
/**
 * Proves tenant RLS actually enforces, by connecting as the non-bypass
 * application role and checking what each tenant can see.
 *
 * This is the test that matters. Earlier validation connected as the admin
 * role, which has rolbypassrls = true, so policies were inert and every
 * probe returned the same row count no matter what tenant was set. A policy
 * that is never evaluated is not a policy.
 *
 * Read-only. Sets session GUCs on its own connection only.
 *
 * Usage: bun run tools/db-mirror/verify-rls-enforced.ts [neon|supabase]
 */
import { Client } from "pg";


loadEnv();

const target = (process.argv[2] ?? "neon").toLowerCase();
const envVar =
  target === "neon" ? "DATABASE_URL_RLS" : "SUPABASE_DATABASE_URL_RLS";
if (!process.env[envVar]) {
  console.error(
    `${envVar} is not set. Run setup-rls-role.ts for ${target} first.`
  );
  process.exit(1);
}
const url = requireEnv(envVar);

const TABLES = ["School", "User", "Student", "Permission", "Role"];

async function main() {
  const direct = url.replace(":6543/", ":5432/");
  const app = new Client({
    connectionString: direct,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await app.connect();

  const { rows: who } = await app.query(
    "SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass"
  );
  console.log(`Target: ${new URL(url).hostname} (${target})`);
  console.log(`Role:   ${who[0].u}  rolbypassrls=${who[0].bypass}\n`);

  if (who[0].bypass) {
    console.error("Connected as a BYPASSRLS role; the test proves nothing.");
    await app.end();
    process.exit(1);
  }

  // Read the ground truth over a separate ADMIN connection. Querying it as
  // the app role returns nothing by design, which would make every assertion
  // below pass vacuously against an empty tenant list.
  const adminUrl =
    target === "neon"
      ? process.env.DATABASE_URL
      : process.env.SUPABASE_DATABASE_URL;
  if (!adminUrl) {
    console.error("Admin connection string missing; cannot establish ground truth.");
    await app.end();
    process.exit(1);
  }
  const admin = new Client({
    connectionString: adminUrl.replace(":6543/", ":5432/"),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await admin.connect();

  const { rows: tenants } = await admin.query(
    `SELECT DISTINCT "tenantId" AS t FROM "School"`
  );
  const real = tenants.map((r) => r.t as string);
  console.log(`Distinct tenants with data (from admin): ${real.length}`);

  if (real.length === 0) {
    console.error(
      "\nNo tenants to test against. Every assertion below would pass on an\n" +
        "empty set, which proves nothing. Aborting."
    );
    await app.end();
    await admin.end();
    process.exit(1);
  }

  let failures = 0;
  let assertions = 0;
  const expect = (label: string, got: number, want: number) => {
    assertions++;
    const ok = got === want;
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: got ${got}, want ${want}`);
  };

  for (const table of TABLES) {
    console.log(`\n${table}:`);
    const { rows: truth } = await admin.query(
      `SELECT count(*)::int AS n FROM "${table}"`
    );
    const total = truth[0].n as number;

    await app.query(`SELECT set_config('app.current_tenant_id', '', false)`);
    const none = await app.query(`SELECT count(*)::int AS n FROM "${table}"`);
    expect("no tenant context -> 0 rows", none.rows[0].n, 0);

    await app.query(
      `SELECT set_config('app.current_tenant_id', 'no-such-tenant-xyz', false)`
    );
    const bogus = await app.query(`SELECT count(*)::int AS n FROM "${table}"`);
    expect("unknown tenant -> 0 rows", bogus.rows[0].n, 0);

    // With the single real tenant set, the app must see every row, because
    // that is the tenant that owns all of them. Anything less means the
    // policy is hiding legitimate data; anything more means a leak.
    await app.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [
      real[0],
    ]);
    const scoped = await app.query(`SELECT count(*)::int AS n FROM "${table}"`);
    expect(`real tenant sees all its rows`, scoped.rows[0].n, total);
  }

  await app.end();
  await admin.end();
  console.log(
    failures === 0
      ? `\nRLS ENFORCEMENT VERIFIED: ${assertions} assertions, policies isolate tenants for a non-bypass role.`
      : `\n${failures} of ${assertions} assertions FAILED — RLS is not enforcing correctly.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Check failed:", (e as Error).message);
  process.exit(1);
});
