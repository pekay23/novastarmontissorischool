/**
 * Strips .env.local down to the keys that genuinely differ from .env.
 *
 * The two files overlap on 19 keys, but only 2 differ:
 *   DATABASE_URL    .env points at the pooled Neon endpoint, .env.local at the
 *                   direct one
 *   NEXTAUTH_URL    .env has the production origin, .env.local localhost:3001
 *
 * Those two are real local overrides and are kept. The other 17 are identical
 * in both files, so leaving them in .env.local is duplication that can drift.
 *
 * The script snapshots the effective value of every key under the real load
 * order (.env then .env.local, local winning), rewrites .env.local, then
 * re-snapshots and fails if any value changed. A cleanup that alters
 * behaviour is not a cleanup.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envPath = resolve(root, ".env");
const localPath = resolve(root, ".env.local");

/** Effective configuration, matching tools/db-mirror/env.ts load order. */
function effective(): Map<string, string> {
  const merged = new Map<string, string>();
  for (const path of [envPath, localPath]) {
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf-8").split(/\r?\n/)) {
      if (raw.trim().startsWith("#")) continue;
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      merged.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return merged;
}

const before = effective();

/** The .env baseline, before .env.local overrides anything. */
function baseValues(): Map<string, string> {
  const base = new Map<string, string>();
  if (!existsSync(envPath)) return base;
  for (const raw of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    if (raw.trim().startsWith("#")) continue;
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    base.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
  }
  return base;
}

const base = baseValues();

/** Which keys must stay in .env.local, and their exact original lines. */
const keep: string[] = [];
const keptLines = new Map<string, string>();
const localRaw = existsSync(localPath)
  ? readFileSync(localPath, "utf-8").split(/\r?\n/)
  : [];

for (const raw of localRaw) {
  const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  const key = m[1];
  const value = m[2].trim().replace(/^["']|["']$/g, "");
  if (base.get(key) !== value) {
    // Differs from the .env baseline, so it is a genuine local override.
    keptLines.set(key, raw);
    keep.push(key);
  }
}

if (keep.length === 0) {
  console.log(".env.local holds no real overrides; it could be deleted outright.");
  process.exit(0);
}

const lines = [
  "# Local development overrides.",
  "#",
  "# Loaded after .env, so these win. Only genuine differences belong here:",
  "# anything identical to .env is duplication and will drift. Every key in",
  "# the project must still be unique within each file.",
  "",
  ...keep.map((k) => keptLines.get(k)!),
];

writeFileSync(localPath, lines.join("\n") + "\n", "utf-8");
console.log(`.env.local now holds ${keep.length} override(s): ${keep.join(", ")}`);

const after = effective();
const changed: string[] = [];
for (const [key, value] of before) {
  if (after.get(key) !== value) changed.push(key);
}
for (const key of after.keys()) {
  if (!before.has(key)) changed.push(key);
}

if (changed.length > 0) {
  console.error(`\nFAILED: effective values changed for: ${changed.join(", ")}`);
  process.exit(1);
}
console.log(`Verified: all ${before.size} effective values are unchanged.`);
