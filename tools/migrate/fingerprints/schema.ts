/**
 * A digest of what `schema.prisma` *means*, as opposed to what it says.
 *
 * The canonical form comes from Prisma itself:
 *
 *     prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
 *
 * That command needs no database, writes nothing, and emits the SQL Prisma
 * would run to build the schema from nothing. Hashing its output therefore
 * answers "is this the schema the database is supposed to have?" in a way that
 * is immune to how the datamodel happens to be formatted: comments, field
 * order and blank lines all vanish, while a renamed column does not.
 *
 * This module deliberately does not parse `schema.prisma` itself. A
 * hand-written Prisma parser is a second, wronger implementation of the
 * language, and it would be the first thing to rot.
 */
import { runPrismaOrThrow, schemaPath } from "../prisma";
import { sha256 } from "./tables";

/** The identifier Prisma quotes, plus anything a hand-edited migration adds. */
const IDENTIFIER = /"([^"]+)"/g;

const COMMENT_LINE = /^\s*--.*$/;

/**
 * Reduces Prisma's canonical SQL to something whose hash depends only on
 * structure.
 *
 * Comment lines go: Prisma annotates every statement (`-- CreateTable`), and
 * that is presentational. Statement order does not go: Prisma emits in
 * dependency order, which is itself meaningful. Whitespace inside a statement
 * does go, because it is wrapping.
 */
export function normalizeCanonicalSql(sql: string): string {
  const statements: string[] = [];
  let current: string[] = [];
  for (const raw of sql.split(/\r?\n/)) {
    if (COMMENT_LINE.test(raw)) continue;
    current.push(raw);
    if (raw.trimEnd().endsWith(";")) {
      statements.push(current.join("\n").replace(/\s+/g, " ").trim());
      current = [];
    }
  }
  const tail = current.join("\n").replace(/\s+/g, " ").trim();
  if (tail !== "") statements.push(tail);
  return statements.join("\n");
}

/** The stable digest of a schema's canonical SQL. */
export function digestCanonicalSql(sql: string): string {
  return sha256(normalizeCanonicalSql(sql));
}

/**
 * Every double-quoted identifier in the SQL.
 *
 * A superset of the table names: enum names, index names and constraint names
 * are in there too. That is fine for the only thing it is used for, which is
 * intersecting with the tables that actually exist.
 */
export function identifiersInSql(sql: string): Set<string> {
  const found = new Set<string>();
  for (const match of sql.matchAll(IDENTIFIER)) {
    if (match[1] !== undefined) found.add(match[1]);
  }
  return found;
}

/**
 * The subset of `liveTables` that the SQL refers to — i.e. the tables Prisma
 * wants to change. Turns a wall of reverting SQL into a list of table names.
 */
export function tablesTouchedBy(sql: string, liveTables: readonly string[]): string[] {
  const identifiers = identifiersInSql(sql);
  return liveTables.filter((table) => identifiers.has(table)).sort();
}

export interface SchemaFingerprint {
  /** sha256 of the normalised canonical SQL. */
  readonly digest: string;
  /** How many statements Prisma would run to build the schema. */
  readonly statements: number;
  /** The canonical SQL, kept for diffing. Never logged in full. */
  readonly sql: string;
}

/**
 * Asks Prisma for the canonical SQL of `schema.prisma`. No database involved.
 */
export async function schemaFingerprint(): Promise<SchemaFingerprint> {
  const result = await runPrismaOrThrow([
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema",
    schemaPath(),
    "--script",
  ]);
  const sql = result.stdout;
  return {
    digest: digestCanonicalSql(sql),
    statements: normalizeCanonicalSql(sql).split("\n").filter(Boolean).length,
    sql,
  };
}
