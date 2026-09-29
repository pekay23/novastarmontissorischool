/**
 * Fails if any environment key is declared more than once WITHIN A SINGLE FILE.
 *
 * This is a guard, not a helper. Duplicate keys in one file are not an error
 * in dotenv or Bun: they silently resolve to the last declaration, so whichever
 * host was listed second won. That is how SUPABASE_DATABASE_URL ended up
 * pointing at `db.*.supabase.co`, which does not resolve from CI, while every
 * local tool using the key failed with ENOTFOUND. Nothing warned about it.
 *
 * A key appearing in both .env and .env.local is NOT a failure: that is the
 * documented override order, and .env.local winning is intended. It is
 * reported for visibility because identical values in both files are
 * duplication that can drift; run consolidate-env-local.ts to remove those.
 *
 * Prints key names and hosts only. Never values.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Declared {
  file: string;
  line: number;
  host: string;
  value: string;
}

const declarations = new Map<string, Declared[]>();
let anyFileRead = false;

for (const file of [".env", ".env.local"]) {
  const path = resolve(root, file);
  if (!existsSync(path)) continue;
  anyFileRead = true;

  readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      if (raw.trim().startsWith("#")) return;
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) return;
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      // Host only, so connection strings do not leak into logs.
      const host = /@([^/:\s]+)/.exec(value)?.[1] ?? "";
      const list = declarations.get(m[1]) ?? [];
      list.push({ file, line: i + 1, host, value });
      declarations.set(m[1], list);
    });
}

if (!anyFileRead) {
  console.log("No .env or .env.local present (as in CI). Nothing to check.");
  process.exit(0);
}

const total = declarations.size;

// Split the two failure modes. Intra-file is a real bug; cross-file is the
// intended override order, reported separately so it is not noise.
const intraFile = [...declarations].filter(([, list]) => {
  const byFile = new Map<string, number>();
  for (const d of list) byFile.set(d.file, (byFile.get(d.file) ?? 0) + 1);
  return [...byFile.values()].some((n) => n > 1);
});

for (const [key, list] of intraFile) {
  console.log(`DUPLICATE IN ONE FILE  ${key}`);
  for (const d of list) console.log(`  ${d.file}:${d.line}${d.host ? `  -> ${d.host}` : ""}`);
}

if (intraFile.length > 0) {
  console.error(
    `\n${intraFile.length} key(s) declared more than once in a single file. ` +
      `The last declaration wins silently.`
  );
  process.exit(1);
}

const crossFile = [...declarations].filter(([, list]) => {
  const files = new Set(list.map((d) => d.file));
  return files.size > 1;
});

// A key in both files is only a legitimate override if the values differ.
// Identical values in both are pure duplication: they drift, and they are what
// consolidate-env-local.ts exists to remove.
const redundant: string[] = [];
const overrides: string[] = [];
for (const [key, list] of crossFile) {
  const values = new Set(list.map((d) => d.value));
  (values.size > 1 ? overrides : redundant).push(key);
}

if (overrides.length > 0) {
  console.log(`\nOverrides, .env.local wins (${overrides.length}):`);
  for (const k of overrides) console.log(`  ${k}`);
}
if (redundant.length > 0) {
  console.log(`\nIdentical in both files, safe to delete from .env.local (${redundant.length}):`);
  for (const k of redundant) console.log(`  ${k}`);
}
console.log(`\nOK  ${total} keys, none declared twice in the same file.`);
