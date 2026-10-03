/**
 * A structural digest of a live PostgreSQL schema.
 *
 * Structural, not content: table names, column names, types, nullability,
 * indexes, constraints and enum values. No rows are ever read, so the digest
 * can be computed against production without moving data and without the
 * result changing when someone signs up.
 *
 * Every connection is opened with `default_transaction_read_only = on`. That
 * is not a comment about `status` being careful — it is Postgres refusing a
 * write. The read-only promise of this tool is enforced by the server.
 */
import { createHash } from "node:crypto";
import type { Client } from "pg";

/** The minimum surface this module needs, so tests need no database. */
export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface ColumnSpec {
  readonly name: string;
  /** `information_schema.data_type`, e.g. `character varying`, `ARRAY`. */
  readonly type: string;
  readonly nullable: boolean;
  readonly default: string | null;
}

export interface IndexSpec {
  readonly name: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
}

export interface ConstraintSpec {
  readonly name: string;
  readonly columns: readonly string[];
  /** `"public"."Child"` for a foreign key, empty otherwise. */
  readonly references: string;
}

export interface TableSpec {
  readonly name: string;
  readonly type: string;
  readonly columns: readonly ColumnSpec[];
  readonly indexes: readonly IndexSpec[];
  readonly primaryKey: readonly string[];
  readonly uniques: readonly ConstraintSpec[];
  readonly foreignKeys: readonly ConstraintSpec[];
}

export interface EnumSpec {
  readonly name: string;
  readonly values: readonly string[];
}

export interface SchemaSnapshot {
  readonly tables: readonly TableSpec[];
  readonly enums: readonly EnumSpec[];
}

export interface Difference {
  readonly kind: "table-missing" | "table-extra" | "column-missing" | "column-extra";
  readonly table: string;
  readonly detail: string;
}

/**
 * Prisma's bookkeeping, not application schema. It exists in the live database
 * only after `migrate deploy` or `baseline`, and never in the SQL Prisma emits
 * from `schema.prisma`, so naming it as drift would be a false positive.
 */
export const LEDGER_TABLE = "_prisma_migrations";

/**
 * Opens a connection that cannot write.
 *
 * `pg` is imported lazily so `--help` and the missing-environment error path
 * work before `bun install` has ever resolved this package's dependencies.
 */
export async function openReadOnly(url: string): Promise<Client> {
  const { Client: PgClient } = (await import("pg")) as typeof import("pg");
  const client = new PgClient({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
    // A statement that hangs is a stuck pipeline; the server-side statement
    // timeout stops it without a second watchdog process.
    statement_timeout: 30_000,
  });
  await client.connect();
  await client.query("SET default_transaction_read_only = on");
  return client;
}

interface RawTable {
  readonly table_name: string;
  readonly table_type: string;
}
interface RawColumn {
  readonly table_name: string;
  readonly column_name: string;
  readonly data_type: string;
  readonly is_nullable: string;
  readonly column_default: string | null;
}
interface RawIndex {
  readonly table_name: string;
  readonly index_name: string;
  readonly is_unique: boolean;
  readonly columns: string[] | null;
}
interface RawConstraint {
  readonly table_name: string;
  readonly constraint_name: string;
  readonly kind: string;
  readonly columns: string[] | null;
  readonly references: string | null;
}
interface RawEnum {
  readonly enum_name: string;
  readonly enum_value: string;
}

const TABLES_SQL = `
  SELECT table_name, table_type
    FROM information_schema.tables
   WHERE table_schema = 'public'
   ORDER BY table_name`;

const COLUMNS_SQL = `
  SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema = 'public'
   ORDER BY table_name, ordinal_position`;

const ENUMS_SQL = `
  SELECT t.typname AS enum_name, e.enumlabel AS enum_value
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public'
   ORDER BY t.typname, e.enumsortorder`;

const INDEXES_SQL = `
  SELECT t.relname AS table_name,
         i.relname AS index_name,
         ix.indisunique AS is_unique,
         (SELECT array_agg(a.attname ORDER BY u.ord)
            FROM unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
         ) AS columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND NOT ix.indisprimary
   ORDER BY t.relname, i.relname`;

const CONSTRAINTS_SQL = `
  SELECT rel.relname AS table_name,
         c.conname AS constraint_name,
         c.contype AS kind,
         (SELECT array_agg(a.attname ORDER BY u.ord)
            FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
         ) AS columns,
         CASE WHEN c.contype = 'f' THEN c.confrelid::regclass::text ELSE '' END AS references
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
   WHERE n.nspname = 'public'
     AND c.contype IN ('p', 'u', 'f')
   ORDER BY rel.relname, c.conname`;

/** Reads the whole public schema. Read-only by construction. */
export async function collectSnapshot(q: Queryable): Promise<SchemaSnapshot> {
  const [tables, columns, indexes, constraints, enums] = await Promise.all([
    q.query(TABLES_SQL),
    q.query(COLUMNS_SQL),
    q.query(INDEXES_SQL),
    q.query(CONSTRAINTS_SQL),
    q.query(ENUMS_SQL),
  ]);

  const columnsByTable = new Map<string, ColumnSpec[]>();
  for (const raw of columns.rows as RawColumn[]) {
    const list = columnsByTable.get(raw.table_name) ?? [];
    list.push({
      name: raw.column_name,
      type: raw.data_type,
      nullable: raw.is_nullable === "YES",
      // Defaults are compared as text, but whitespace from the server is
      // formatting, not meaning.
      default: raw.column_default === null ? null : raw.column_default.trim(),
    });
    columnsByTable.set(raw.table_name, list);
  }

  const indexesByTable = new Map<string, IndexSpec[]>();
  for (const raw of indexes.rows as RawIndex[]) {
    const list = indexesByTable.get(raw.table_name) ?? [];
    list.push({
      name: raw.index_name,
      unique: raw.is_unique,
      columns: [...(raw.columns ?? [])].sort(),
    });
    indexesByTable.set(raw.table_name, list);
  }

  const pkByTable = new Map<string, string[]>();
  const uniquesByTable = new Map<string, ConstraintSpec[]>();
  const fksByTable = new Map<string, ConstraintSpec[]>();
  for (const raw of constraints.rows as RawConstraint[]) {
    const spec: ConstraintSpec = {
      name: raw.constraint_name,
      columns: [...(raw.columns ?? [])].sort(),
      references: raw.references ?? "",
    };
    if (raw.kind === "p") {
      pkByTable.set(raw.table_name, [...(raw.columns ?? [])].sort());
    } else if (raw.kind === "u") {
      uniquesByTable.set(raw.table_name, [...(uniquesByTable.get(raw.table_name) ?? []), spec]);
    } else {
      fksByTable.set(raw.table_name, [...(fksByTable.get(raw.table_name) ?? []), spec]);
    }
  }

  const byName = (a: { name: string }, b: { name: string }): number =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

  const tableSpecs: TableSpec[] = (tables.rows as RawTable[]).map((raw) => ({
    name: raw.table_name,
    type: raw.table_type,
    columns: (columnsByTable.get(raw.table_name) ?? []).sort(byName),
    indexes: (indexesByTable.get(raw.table_name) ?? []).sort(byName),
    primaryKey: pkByTable.get(raw.table_name) ?? [],
    uniques: (uniquesByTable.get(raw.table_name) ?? []).sort(byName),
    foreignKeys: (fksByTable.get(raw.table_name) ?? []).sort(byName),
  }));

  const enumMap = new Map<string, string[]>();
  for (const raw of enums.rows as RawEnum[]) {
    const list = enumMap.get(raw.enum_name) ?? [];
    list.push(raw.enum_value);
    enumMap.set(raw.enum_name, list);
  }
  const enumSpecs: EnumSpec[] = [...enumMap.entries()]
    .map(([name, values]) => ({ name, values }))
    .sort(byName);

  return { tables: tableSpecs.sort(byName), enums: enumSpecs };
}

/**
 * A stable digest.
 *
 * Every collection is sorted by name *here* rather than trusting the caller to
 * have done it, so the digest is a pure function of structure no matter which
 * path produced the snapshot. Re-ordering declarations in `schema.prisma` does
 * not change the hash; renaming a column does.
 */
export function digestSnapshot(snapshot: SchemaSnapshot): string {
  const byName = (a: { name: string }, b: { name: string }): number =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  const canonical = {
    enums: snapshot.enums
      .map((e) => ({ name: e.name, values: [...e.values] }))
      .sort(byName),
    tables: snapshot.tables.map((t) => ({
      columns: t.columns
        .map((c) => ({
          default: c.default,
          name: c.name,
          nullable: c.nullable,
          type: c.type,
        }))
        .sort(byName),
      foreignKeys: t.foreignKeys
        .map((f) => ({ columns: [...f.columns], name: f.name, references: f.references }))
        .sort(byName),
      indexes: t.indexes
        .map((i) => ({ columns: [...i.columns], name: i.name, unique: i.unique }))
        .sort(byName),
      name: t.name,
      primaryKey: [...t.primaryKey],
      type: t.type,
      uniques: t.uniques
        .map((u) => ({ columns: [...u.columns], name: u.name }))
        .sort(byName),
    })).sort(byName),
  };
  return sha256(JSON.stringify(canonical));
}

/** Names the structural differences. Used to make a drift report actionable. */
export function diffSnapshots(
  expected: SchemaSnapshot,
  actual: SchemaSnapshot,
): Difference[] {
  const differences: Difference[] = [];
  const actualByName = new Map(actual.tables.map((t) => [t.name, t]));

  for (const table of expected.tables) {
    const found = actualByName.get(table.name);
    if (!found) {
      differences.push({
        kind: "table-missing",
        table: table.name,
        detail: "expected but not present in the live database",
      });
      continue;
    }
    const foundColumns = new Set(found.columns.map((c) => c.name));
    for (const column of table.columns) {
      if (!foundColumns.has(column.name)) {
        differences.push({
          kind: "column-missing",
          table: table.name,
          detail: `column ${column.name} ${column.type} is not present`,
        });
      }
    }
  }

  const expectedByName = new Set(expected.tables.map((t) => t.name));
  for (const table of actual.tables) {
    if (table.name === LEDGER_TABLE) continue;
    if (!expectedByName.has(table.name)) {
      differences.push({
        kind: "table-extra",
        table: table.name,
        detail: "present in the live database but not in the schema",
      });
    }
  }
  return differences;
}

/** Names the tables named in `differences`, for one-line reporting. */
export function affectedTables(differences: readonly Difference[]): string[] {
  return [...new Set(differences.map((d) => d.table))].sort();
}

/** Whether a table exists. Used to tell "no ledger" from "empty ledger". */
export async function ledgerExists(q: Queryable): Promise<boolean> {
  const { rows } = await q.query(
    `SELECT 1 AS present FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    [LEDGER_TABLE],
  );
  return rows.length > 0;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}
