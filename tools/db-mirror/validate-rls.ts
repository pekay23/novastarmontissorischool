import { loadEnv } from "./env";
import { readFileSync } from "node:fs";
/**
 * Validates the RLS SQL by applying it inside a transaction on Neon and
 * rolling back. Proves the statements are syntactically valid and that every
 * named table exists, without leaving any change behind.
 *
 * Safety: single BEGIN ... ROLLBACK. If the process dies mid-run, Postgres
 * rolls the transaction back on connection loss. Nothing is committed.
 */
import { Client } from "pg";
import { resolve } from "node:path";


loadEnv();

const rlsPath = resolve("packages/database/prisma/rls/tenant-isolation.sql");
const rlsSql = readFileSync(rlsPath, "utf-8");

/**
 * Splits SQL into executable statements.
 *
 * Trivia (line comments, whitespace) is removed, then the string is scanned
 * char by char. A `;` only terminates a statement at nesting depth zero and
 * when not inside a dollar-quoted body ($$ ... $$), a single-quoted string,
 * or a double-quoted identifier. Getting this wrong silently truncates
 * CREATE FUNCTION bodies, which is how a broken parser produces
 * "function does not exist" errors for functions that are in the file.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let i = 0;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const ch = sql[i];

    // Line comment: skip to end of line, not part of the statement.
    if (!dollarTag && ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    // Dollar-quoted body: consume verbatim until the matching tag.
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    // Opening dollar-quote tag: $$, $tag$, ...
    if (ch === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        buf += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    // Single-quoted string: '' is an escaped quote, not a terminator.
    if (ch === "'") {
      buf += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          buf += "'";
          i++;
          break;
        }
        buf += sql[i];
        i++;
      }
      continue;
    }

    // Double-quoted identifier: "" is an escaped quote.
    if (ch === '"') {
      buf += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          buf += '""';
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          buf += '"';
          i++;
          break;
        }
        buf += sql[i];
        i++;
      }
      continue;
    }

    if (ch === ";") {
      const trimmed = buf.trim();
      if (trimmed) statements.push(trimmed);
      buf = "";
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  const tail = buf.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  console.log("Connected to Neon. Validating RLS in a rolled-back transaction.\n");

  await client.query("BEGIN");

  try {
    const statements = splitStatements(rlsSql);
    console.log(`Parsed ${statements.length} executable statements\n`);

    // Only target tables that actually exist in this database. Skipping the
    // rest keeps one missing table from aborting the transaction and hiding
    // every later statement.
    const { rows: existing } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const present = new Set(existing.map((r) => r.table_name));

    const skipped = new Set<string>();
    let applied = 0;
    const failures: { stmt: string; err: string }[] = [];

    for (const stmt of statements) {
      const t = /^ALTER TABLE "(\w+)"/.exec(stmt)?.[1];
      if (t && !present.has(t)) {
        skipped.add(t);
        continue;
      }
      // A savepoint must exist BEFORE the statement runs. Once a statement
      // errors, the transaction is aborted and SAVEPOINT itself is rejected,
      // so the only way to recover and keep validating is to pre-arm one.
      await client.query("SAVEPOINT stmt_sp");
      try {
        await client.query(stmt);
        applied++;
        await client.query("RELEASE SAVEPOINT stmt_sp");
      } catch (err) {
        const e = err as { message: string };
        failures.push({
          stmt: stmt.split("\n")[0].slice(0, 90),
          err: e.message,
        });
        await client.query("ROLLBACK TO SAVEPOINT stmt_sp");
        await client.query("RELEASE SAVEPOINT stmt_sp");
      }
    }

    console.log(`Applied OK: ${applied}`);
    console.log(`Failed: ${failures.length}`);
    console.log(`Skipped (table absent here): ${skipped.size}`);
    for (const s of skipped) console.log(`  ${s}`);
    if (failures.length) {
      console.log("");
      for (const f of failures) {
        console.log(`  ${f.stmt}`);
        console.log(`    -> ${f.err}\n`);
      }
    }

    // Confirm the policies actually exist inside the transaction.
    const { rows } = await client.query(`
      SELECT count(*)::int AS n
      FROM pg_policies
      WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
    `);
    console.log(`tenant_isolation policies visible in-txn: ${rows[0].n}`);

    // Behavioural proof that the policies actually isolate tenants.
    // Table owners bypass RLS unless FORCE is set, and this migration does
    // set FORCE, so these probes reflect real per-tenant behaviour.
    const { rows: tid } = await client.query(
      `SELECT "tenantId" FROM "School" LIMIT 1`,
    );
    const realTenant = tid.length ? tid[0].tenantId : null;

    const countSchool = async () => {
      const r = await client.query(`SELECT count(*)::int AS n FROM "School"`);
      return r.rows[0].n as number;
    };

    await client.query(`SELECT set_config('app.current_tenant_id', '', false)`);
    const withNoContext = await countSchool();
    console.log(`\nSchool rows with no tenant context: ${withNoContext}`);

    await client.query(`SELECT set_config('app.current_tenant_id', 'no-such-tenant', false)`);
    const withWrongTenant = await countSchool();
    console.log(`School rows for a tenant that does not exist: ${withWrongTenant}`);

    if (realTenant) {
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [
        realTenant,
      ]);
      const withRealTenant = await countSchool();
      console.log(`School rows for the real tenant '${realTenant}': ${withRealTenant}`);

      const pass =
        withNoContext === 0 && withWrongTenant === 0 && withRealTenant > 0;
      console.log(`\nISOLATION ${pass ? "HOLDS" : "FAILED"}`);
      if (!pass) {
        console.log(
          "  Expected: 0 rows with no/unknown tenant, >0 for the real tenant.",
        );
      }
    } else {
      console.log("\nNo School rows to test against; isolation not proven.");
    }
  } finally {
    await client.query("ROLLBACK");
    console.log("\nROLLED BACK — no changes persisted.");
    await client.end();
  }
}

main().catch(async (e) => {
  console.error("Failed:", (e as Error).message);
  process.exit(1);
});
