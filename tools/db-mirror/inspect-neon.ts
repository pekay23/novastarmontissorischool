/**
 * Read-only inspection of the primary Neon database: table naming, row
 * counts, and whether the mirror prerequisites (psql in compute) are real.
 * Makes no writes.
 */
import { Client } from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf-8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function main() {
  await client.connect();
  console.log("Connected to Neon primary\n");

  const { rows: tables } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log(`Tables in public schema: ${tables.length}`);
  for (const t of tables) console.log(`  ${t.table_name}`);

  // Does the mirror's snake_case assumption match reality?
  const snake = tables.filter((t) =>
    /^[a-z0-9_]+$/.test(t.table_name),
  );
  console.log(
    `\nLowercase/snake_case tables: ${snake.length} of ${tables.length}`,
  );
  if (snake.length === 0 && tables.length > 0) {
    console.log(
      "  => mirror.ts and setup-pg-cron.sql reference snake_case names that do NOT exist",
    );
  }

  const { rows: counts } = await client.query(`
    SELECT relname, n_live_tup
    FROM pg_stat_user_tables
    WHERE schemaname = 'public' AND n_live_tup > 0
    ORDER BY n_live_tup DESC
  `);
  console.log(`\nNon-empty tables: ${counts.length}`);
  for (const c of counts.slice(0, 20)) {
    console.log(`  ${c.relname}: ${c.n_live_tup}`);
  }

  // pg_cron job status
  try {
    const { rows: jobs } = await client.query(
      "SELECT jobname, schedule, active FROM cron.job",
    );
    console.log(`\ncron jobs: ${jobs.length}`);
    for (const j of jobs) {
      console.log(`  ${j.jobname} (${j.schedule}) active=${j.active}`);
    }
  } catch {
    console.log("\ncron.job not queryable (pg_cron not enabled?)");
  }

  // Is the mirror function present, and does it still hold a placeholder?
  try {
    const { rows } = await client.query(`
      SELECT prosrc FROM pg_proc WHERE proname = 'mirror_to_supabase'
    `);
    if (rows.length) {
      const src = rows[0].prosrc;
      const placeholder = /YOUR_PASSWORD|db\.xxx\.supabase\.co/.test(src);
      console.log(
        `\nmirror_to_supabase() exists; placeholder credentials still in it: ${placeholder}`,
      );
    } else {
      console.log("\nmirror_to_supabase() does not exist — cron never set up");
    }
  } catch {
    console.log("\ncould not read pg_proc for mirror function");
  }

  // COPY ... TO PROGRAM requires a psql binary inside the database compute.
  try {
    const { rows } = await client.query("SELECT version()");
    console.log(`\n${rows[0].version}`);
  } catch {}

  await client.end();
}

main().catch(async (err) => {
  console.error("Inspection failed:", err.message);
  await client.end().catch(() => {});
  process.exit(1);
});
