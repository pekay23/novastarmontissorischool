/**
 * Builds the failsafe-parity DDL.
 *
 * The Supabase failsafe is missing 7 tables that exist in the primary, so
 * `require-backup` refuses every write command. Prisma 7 dropped
 * `migrate diff --from-url`, and the repo's prisma.config.ts declares a single
 * unnamed datasource, so the usual two-live-database diff is not available.
 *
 * The migration SQL is the authoritative source for those tables, so this
 * extracts the relevant statements from it rather than hand-writing DDL.
 *
 * ONE-SHOT. Statements are emitted verbatim (plain CREATE, no IF NOT EXISTS)
 * because a partial-idempotent file is worse than an honest one. apply-schema
 * sends the file as a single simple-query batch, which Postgres wraps in an
 * implicit transaction, so a repeat attempt fails atomically and changes
 * nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";

const MIGRATIONS = [
  "20261002103000_platform_config",
  "20261003000000_unifiedtransform_port_wave0",
  "20261003164500_platform_operator",
];

const TABLES = [
  "PlatformOperator",
  "Syllabus",
  "Passkey",
  "PasskeyChallenge",
  "SystemConfig",
  "SystemError",
  "LogEntry",
];
const ENUMS = ["UserStatus", "ErrorSeverity", "LogLevel"];

/** Strips `--` comments so matching sees code, not rationale. */
const codeOf = (stmt: string): string =>
  stmt
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .trim();

const keep = (code: string): boolean => {
  if (ENUMS.some((e) => new RegExp(`CREATE\\s+TYPE\\s+"${e}"`, "i").test(code))) return true;
  return TABLES.some((t) => code.includes(`"${t}"`));
};

interface Stmt {
  migration: string;
  text: string;
  code: string;
}

/** Every statement in the three migrations, in file order. */
function statements(): Stmt[] {
  const all: Stmt[] = [];
  for (const m of MIGRATIONS) {
    const path = `packages/database/prisma/migrations/${m}/migration.sql`;
    const lines = readFileSync(path, "utf8").split("\n");
    let buf: string[] = [];
    for (const line of lines) {
      buf.push(line);
      if (line.trimEnd().endsWith(";")) {
        const text = buf.join("\n").trim();
        buf = [];
        const code = codeOf(text);
        if (code.length > 0) all.push({ migration: m, text, code });
      }
    }
  }
  return all;
}

const all = statements();
const picked = new Set(all.filter((s) => keep(s.code)));

/**
 * Second pass: a kept foreign key is only satisfiable if the column it names
 * exists on the target table. `platform_operator` adds
 * `AuditLog.operatorId` in one statement and constrains it in another, and
 * only the second mentions a table we care about — so a name-only filter
 * emits a constraint against a column it never creates. That is not a
 * hypothetical: it is how the first attempt failed.
 */
/**
 * `ALTER TABLE "<local>" ... FOREIGN KEY ("<col>") REFERENCES "<remote>"`.
 * The local column belongs to the ALTER target, not to the referenced table —
 * conflating the two is what made the first attempt emit a constraint against
 * a column it never created.
 */
const FK_RE = /ALTER\s+TABLE\s+"([^"]+)"[^;]*?FOREIGN\s+KEY\s*\(\s*"([^"]+)"\s*\)\s*REFERENCES\s+"([^"]+)"/gi;

const fks = (code: string) => [...code.matchAll(FK_RE)].map((m) => ({
  localTable: m[1],
  localColumn: m[2],
  remoteTable: m[3],
}));

let addedDeps = 0;
for (const stmt of [...picked]) {
  for (const fk of fks(stmt.code)) {
    // Created earlier in this same batch? Then it needs no dependency.
    const createdHere = [...picked].some(
      (p) => new RegExp(`CREATE\\s+TABLE\\s+"${fk.localTable}"`, "i").test(p.code),
    );
    if (createdHere) continue;
    const dep = all.find(
      (s) =>
        new RegExp(
          `ALTER\\s+TABLE\\s+"${fk.localTable}"\\s+ADD\\s+COLUMN\\s+"${fk.localColumn}"`,
          "i",
        ).test(s.code) && !picked.has(s),
    );
    if (dep) {
      picked.add(dep);
      addedDeps++;
    }
  }
}

const ordered0 = all.filter((s) => picked.has(s));

/** Local columns every kept FK depends on, for the pre-flight existence check. */
const fkColumns = ordered0.flatMap((s) =>
  fks(s.code).map((fk) => ({ table: fk.localTable, column: fk.localColumn })),
);

const ordered = all.filter((s) => picked.has(s));
const body = ordered.map((s) => `-- ${s.migration}\n${s.text}\n`).join("\n");

const header = `-- Failsafe parity DDL: brings the Supabase failsafe up to the primary's
-- table set so tools/migrate's require-backup guard stops refusing writes.
--
-- Missing tables at generation time (7): ${TABLES.join(", ")}
-- Missing enums at generation time (3): ${ENUMS.join(", ")}
--
-- Generated from packages/database/prisma/migrations by gen-parity-ddl.ts.
-- ONE-SHOT, applied atomically by tools/db-mirror/apply-schema.ts.
`;

const out = header + "\n" + body;
const dest = "tools/db-mirror/failsafe-parity.sql";
writeFileSync(dest, out, "utf8");

const count = (re: RegExp) => ordered.filter((p) => re.test(p.code)).length;
console.log(`statements: ${ordered.length}`);
console.log(`  CREATE TYPE:   ${count(/CREATE\s+TYPE/i)}`);
console.log(`  CREATE TABLE:  ${count(/CREATE\s+TABLE/i)}`);
console.log(`  ALTER TABLE:   ${count(/ALTER\s+TABLE/i)} (${addedDeps} pulled in as FK dependencies)`);
console.log(`  CREATE INDEX:  ${count(/CREATE\s+(UNIQUE\s+)?INDEX/i)}`);
console.log(`  ADD CONSTRAINT:${count(/ADD\s+CONSTRAINT/i)}`);
console.log(`written: ${dest}`);
console.log("FK local-column pre-flight (each must already exist in the failsafe):");
for (const { table, column } of fkColumns) {
  console.log(`  ${table}.${column}`);
}
