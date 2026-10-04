import { loadEnv, requireEnv } from "./env";
import { createInterface } from "node:readline";
import { decideProductionAck, type ApplyTarget } from "./guards/production-ack";
/**
 * Applies a reviewed DDL file to a chosen database.
 *
 * The DDL is generated with `prisma migrate diff`, reviewed, then sent to
 * Postgres as a single simple-query batch. Postgres wraps a multi-statement
 * simple query in an implicit transaction, so it applies atomically: either
 * the whole thing lands or none of it does.
 *
 * Usage:
 *   bun run tools/db-mirror/apply-schema.ts <ddl-file> supabase
 *   bun run tools/db-mirror/apply-schema.ts <ddl-file> neon
 *
 * Flags:
 *   --allow-nonempty       permit a target that already has tables (required for
 *                          additive migrations against a populated database)
 *   --dry-run              report what would run, then exit without writing
 *   --allow-production     acknowledge that the neon target is production;
 *                          required for neon, or the command will prompt at a TTY
 *                          or fail in CI
 */
import { Client } from "pg";
import { readFileSync, existsSync } from "node:fs";


loadEnv();

const raw = process.argv.slice(2);
const flags = new Set(raw.filter((a) => a.startsWith("--")));
const args = raw.filter((a) => !a.startsWith("--"));

const ddlPath = args[0];
const targetArg = (args[1] ?? "supabase").toLowerCase();

if (!ddlPath) {
  console.error(
    "Usage: bun run tools/db-mirror/apply-schema.ts <ddl-file> [supabase|neon]"
  );
  process.exit(1);
}
if (!existsSync(ddlPath)) {
  console.error(`DDL file not found: ${ddlPath}`);
  process.exit(1);
}

/**
 * The two targets, and where each one's connection string comes from.
 *
 * A lookup rather than a conditional so that an unknown target is a refusal at
 * this line rather than a silently mislabelled one further down: `target` is
 * typed `ApplyTarget` from here, which is what makes the guard below total.
 */
const ENV_VAR: Record<ApplyTarget, string> = {
  neon: "DATABASE_URL",
  supabase: "SUPABASE_DIRECT_URL",
};

function parseTarget(value: string): ApplyTarget {
  if (value === "neon" || value === "supabase") return value;
  console.error(`Unknown target '${value}'. Use 'neon' or 'supabase'.`);
  process.exit(1);
}

const target = parseTarget(targetArg);

const url = requireEnv(ENV_VAR[target]);

const ddl = readFileSync(ddlPath, "utf-8");

/** Statements that would destroy existing data. */
const destructive = ddl.match(
  /^\s*(DROP\s+(TABLE|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)/gim
);

async function main() {
  // Session pooler (5432) is required for DDL; 6543 is transaction-pooled.
  const direct = url.replace(":6543/", ":5432/");
  const host = new URL(direct).hostname;

  // The host match and the production acknowledgement are one decision, in
  // ./guards/production-ack.ts, so they can be tested without a database.
  const verdict = decideProductionAck({
    target,
    host,
    allowProduction: flags.has("--allow-production"),
    hasTty: process.stdin.isTTY === true,
  });

  if (!verdict.proceed) {
    console.error(`\nRefusing to run: ${verdict.reason}`);
    process.exit(1);
  }

  if (verdict.how === "flag" && target === "neon") {
    console.log(
      `[apply-schema] PRODUCTION target acknowledged via --allow-production: ${host}`,
    );
  }

  if (verdict.how === "prompt") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolvePromise) => {
      const timer = setTimeout(() => {
        rl.close();
        resolvePromise("");
      }, 120_000);
      rl.question(
        `\nYou are about to apply DDL to a PRODUCTION database (${host}).\n` +
          `Type "yes" to proceed: `,
        (a) => {
          clearTimeout(timer);
          rl.close();
          resolvePromise(a.trim().toLowerCase());
        },
      );
    });
    if (answer !== "yes") {
      console.error("Refused. Nothing applied.");
      process.exit(1);
    }
    console.log(
      `[apply-schema] PRODUCTION target confirmed at the terminal: ${host}`,
    );
  }

  const client = new Client({
    connectionString: direct,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();

  const { rows: who } = await client.query("SELECT current_user AS u");
  const { rows: before } = await client.query(`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const { rows: rowsBefore } = await client.query(`
    SELECT coalesce(sum(n_live_tup),0)::bigint AS n FROM pg_stat_user_tables
  `);

  console.log(`Target:      ${host}  (${target})`);
  console.log(`Admin role:  ${who[0].u}`);
  console.log(`Tables:      ${before[0].n}`);
  console.log(`Live rows:   ${rowsBefore[0].n}`);
  console.log(`DDL:         ${ddlPath} (${ddl.split("\n").length} lines)`);
  console.log(`Destructive: ${destructive ? destructive.length + " statement(s)!" : "none"}`);

  if (flags.has("--dry-run")) {
    await client.end();
    console.log("\n--dry-run: nothing written.");
    return;
  }

  if (before[0].n > 0 && !flags.has("--allow-nonempty")) {
    console.error(
      "\nRefusing: public schema is not empty. Pass --allow-nonempty if this is an additive migration."
    );
    await client.end();
    process.exit(1);
  }

  try {
    await client.query(ddl);
  } catch (err) {
    console.error("\nFAILED:", (err as Error).message);
    console.error("The implicit transaction rolled back; nothing applied.");
    await client.end();
    process.exit(1);
  }

  const { rows: after } = await client.query(`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const { rows: pol } = await client.query(`
    SELECT count(*)::int AS n FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
  `);

  console.log(`\nTables after: ${after[0].n}  (+${after[0].n - before[0].n})`);
  console.log(`tenant_isolation policies: ${pol[0].n}`);

  await client.end();
  console.log(`Applied to ${target}.`);
}

main().catch((e) => {
  console.error("Failed:", (e as Error).message);
  process.exit(1);
});
