/**
 * Confirms the running application is not broken by the RLS rollout.
 *
 * The app still connects as the original provider role, which has
 * rolbypassrls = true. That is deliberate: policies are armed but inert for
 * that role, so enabling RLS changed nothing for the live app. This proves
 * that rather than assuming it — an app that suddenly reads zero rows would
 * be an outage, and the whole point of the staged cutover is to avoid one.
 *
 * Read-only.
 */
import { Client } from "pg";
import { loadEnv } from "./env";

loadEnv();

async function probe(label: string, url: string) {
  const c = new Client({
    connectionString: url.replace(":6543/", ":5432/"),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await c.connect();
  const { rows } = await c.query(`
    SELECT current_user AS u,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass,
           (SELECT count(*)::int FROM "School")   AS schools,
           (SELECT count(*)::int FROM "Student")  AS students,
           (SELECT count(*)::int FROM "Permission") AS perms
  `);
  const r = rows[0];
  console.log(`\n${label}`);
  console.log(`  connected as:  ${r.u}  (bypassrls=${r.bypass})`);
  console.log(`  School rows:   ${r.schools}`);
  console.log(`  Student rows:  ${r.students}`);
  console.log(`  Permission:    ${r.perms}`);

  const healthy = r.schools > 0 && r.perms > 0;
  console.log(`  app can read data: ${healthy ? "YES" : "NO — APP WOULD BE BROKEN"}`);
  await c.end();
  return healthy;
}

async function main() {
  const neonOk = await probe("Neon — the app's current DATABASE_URL", process.env.DATABASE_URL!);

  // What the app WOULD see if it switched to the RLS role, with no tenant
  // context set. This is the outage the cutover has to avoid.
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (rlsUrl) {
    const c = new Client({
      connectionString: rlsUrl.replace(":6543/", ":5432/"),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    await c.connect();
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM "School"`
    );
    console.log(`\nNeon — as novastar_app with NO tenant context set`);
    console.log(`  School rows:   ${rows[0].n}`);
    console.log(
      `  => switching the app over today would ${rows[0].n === 0 ? "BREAK it (zero rows)" : "be safe"}`
    );
    await c.end();
  }

  console.log(
    neonOk
      ? "\nAPP UNAFFECTED: the live app still reads data under the old role."
      : "\nWARNING: the app cannot read data."
  );
}

main().catch((e) => {
  console.error("Failed:", (e as Error).message);
  process.exit(1);
});
