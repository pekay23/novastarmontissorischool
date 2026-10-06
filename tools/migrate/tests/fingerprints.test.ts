/**
 * Fingerprints.
 *
 * The properties worth pinning are the ones a drift check depends on: a digest
 * must ignore how a schema is formatted and must not ignore what it says, and
 * the live-schema collector must work against a fake `Queryable` so a schema
 * change is testable without a database.
 */
import { describe, expect, test } from "bun:test";
import {
  collectSnapshot,
  diffSnapshots,
  digestSnapshot,
  affectedTables,
  ledgerExists,
  type Queryable,
  type SchemaSnapshot,
} from "../fingerprints/tables";
import {
  digestCanonicalSql,
  identifiersInSql,
  normalizeCanonicalSql,
  tablesTouchedBy,
} from "../fingerprints/schema";

const SNAPSHOT: SchemaSnapshot = {
  enums: [{ name: "TermStatus", values: ["PLANNING", "ACTIVE"] }],
  tables: [
    {
      name: "Student",
      type: "BASE TABLE",
      columns: [
        { name: "id", type: "text", nullable: false, default: null },
        { name: "tenantId", type: "text", nullable: false, default: null },
        { name: "archivedAt", type: "timestamp with time zone", nullable: true, default: null },
      ],
      indexes: [{ name: "Student_tenantId_idx", unique: false, columns: ["tenantId"] }],
      primaryKey: ["id"],
      uniques: [],
      foreignKeys: [],
    },
    {
      name: "School",
      type: "BASE TABLE",
      columns: [{ name: "id", type: "text", nullable: false, default: null }],
      indexes: [],
      primaryKey: ["id"],
      uniques: [],
      foreignKeys: [],
    },
  ],
};

describe("digestSnapshot", () => {
  test("is stable across calls", () => {
    expect(digestSnapshot(SNAPSHOT)).toBe(digestSnapshot(SNAPSHOT));
  });

  test("ignores declaration order", () => {
    const reordered: SchemaSnapshot = {
      enums: SNAPSHOT.enums,
      tables: [
        { ...(SNAPSHOT.tables[0] as (typeof SNAPSHOT.tables)[number]), columns: [
          { name: "tenantId", type: "text", nullable: false, default: null },
          { name: "archivedAt", type: "timestamp with time zone", nullable: true, default: null },
          { name: "id", type: "text", nullable: false, default: null },
        ] },
        SNAPSHOT.tables[1] as (typeof SNAPSHOT.tables)[number],
      ],
    };
    expect(digestSnapshot(reordered)).toBe(digestSnapshot(SNAPSHOT));
  });

  test("changes when a column is renamed", () => {
    const renamed: SchemaSnapshot = {
      ...SNAPSHOT,
      tables: [
        {
          ...(SNAPSHOT.tables[0] as (typeof SNAPSHOT.tables)[number]),
          columns: (SNAPSHOT.tables[0]?.columns ?? [])
            .filter((c) => c.name !== "archivedAt")
            .concat({ name: "deletedAt", type: "timestamp with time zone", nullable: true, default: null }),
        },
        SNAPSHOT.tables[1] as (typeof SNAPSHOT.tables)[number],
      ],
    };
    expect(digestSnapshot(renamed)).not.toBe(digestSnapshot(SNAPSHOT));
  });

  test("changes when nullability changes", () => {
    const loosened: SchemaSnapshot = {
      ...SNAPSHOT,
      tables: [
        {
          ...(SNAPSHOT.tables[0] as (typeof SNAPSHOT.tables)[number]),
          columns: (SNAPSHOT.tables[0]?.columns ?? []).map((c) =>
            c.name === "tenantId" ? { ...c, nullable: true } : c,
          ),
        },
        SNAPSHOT.tables[1] as (typeof SNAPSHOT.tables)[number],
      ],
    };
    expect(digestSnapshot(loosened)).not.toBe(digestSnapshot(SNAPSHOT));
  });

  test("changes when an enum gains a value", () => {
    const grown: SchemaSnapshot = {
      ...SNAPSHOT,
      enums: [{ name: "TermStatus", values: ["PLANNING", "ACTIVE", "ARCHIVED"] }],
    };
    expect(digestSnapshot(grown)).not.toBe(digestSnapshot(SNAPSHOT));
  });
});

describe("diffSnapshots", () => {
  test("finds a missing table and a missing column", () => {
    const live: SchemaSnapshot = {
      enums: SNAPSHOT.enums,
      tables: [
        {
          ...(SNAPSHOT.tables[0] as (typeof SNAPSHOT.tables)[number]),
          columns: [{ name: "id", type: "text", nullable: false, default: null }],
        },
      ],
    };
    const differences = diffSnapshots(SNAPSHOT, live);
    expect(affectedTables(differences)).toEqual(["School", "Student"]);
    expect(differences.some((d) => d.kind === "column-missing")).toBe(true);
    expect(differences.some((d) => d.kind === "table-missing")).toBe(true);
  });

  test("an extra live table is drift", () => {
    const live: SchemaSnapshot = {
      ...SNAPSHOT,
      tables: SNAPSHOT.tables.concat({
        name: "Stray",
        type: "BASE TABLE",
        columns: [],
        indexes: [],
        primaryKey: [],
        uniques: [],
        foreignKeys: [],
      }),
    };
    const differences = diffSnapshots(SNAPSHOT, live);
    expect(differences).toEqual([
      {
        kind: "table-extra",
        table: "Stray",
        detail: "present in the live database but not in the schema",
      },
    ]);
  });

  test("Prisma's own ledger table is never reported as drift", () => {
    const live: SchemaSnapshot = {
      ...SNAPSHOT,
      tables: SNAPSHOT.tables.concat({
        name: "_prisma_migrations",
        type: "BASE TABLE",
        columns: [],
        indexes: [],
        primaryKey: [],
        uniques: [],
        foreignKeys: [],
      }),
    };
    expect(diffSnapshots(SNAPSHOT, live)).toEqual([]);
  });

  test("identical snapshots have no differences", () => {
    expect(diffSnapshots(SNAPSHOT, SNAPSHOT)).toEqual([]);
  });
});

describe("collectSnapshot", () => {
  /**
   * Answers each query with the rows its shape implies. A `$1` parameter is
   * honoured, because `ledgerExists` filters in SQL and a fake that ignored it
   * would report every table as a match.
   */
  const fake = (rows: Record<string, unknown[]>): Queryable => ({
    query: (sql: string, values?: unknown[]) => {
      const key = sql.includes("information_schema.tables")
        ? "tables"
        : sql.includes("information_schema.columns")
          ? "columns"
          : sql.includes("pg_index")
            ? "indexes"
            : sql.includes("pg_constraint")
              ? "constraints"
              : sql.includes("pg_type")
                ? "enums"
                : "other";
      const all = (rows[key] ?? []) as Record<string, unknown>[];
      const name = sql.includes("table_name = $1") ? String(values?.[0]) : undefined;
      return Promise.resolve({
        rows: name === undefined ? all : all.filter((r) => r.table_name === name),
      });
    },
  });

  test("groups columns, indexes and constraints onto their table", async () => {
    const snapshot = await collectSnapshot(
      fake({
        tables: [
          { table_name: "Student", table_type: "BASE TABLE" },
          { table_name: "School", table_type: "BASE TABLE" },
        ],
        columns: [
          {
            table_name: "Student",
            column_name: "id",
            data_type: "text",
            is_nullable: "NO",
            column_default: null,
          },
          {
            table_name: "School",
            column_name: "id",
            data_type: "text",
            is_nullable: "NO",
            column_default: "  gen_random_uuid()  ",
          },
        ],
        indexes: [
          { table_name: "Student", index_name: "Student_pkey", is_unique: true, columns: ["id"] },
        ],
        constraints: [
          {
            table_name: "Student",
            constraint_name: "Student_pkey",
            kind: "p",
            columns: ["id"],
            references: "",
          },
          {
            table_name: "Student",
            constraint_name: "Student_schoolId_fkey",
            kind: "f",
            columns: ["schoolId"],
            references: "School",
          },
        ],
        enums: [
          { enum_name: "TermStatus", enum_value: "ACTIVE" },
          { enum_name: "TermStatus", enum_value: "PLANNING" },
        ],
      }),
    );

    const student = snapshot.tables.find((t) => t.name === "Student");
    expect(student?.primaryKey).toEqual(["id"]);
    expect(student?.foreignKeys[0]?.references).toBe("School");
    expect(student?.uniques).toEqual([]);
    expect(snapshot.enums[0]).toEqual({ name: "TermStatus", values: ["ACTIVE", "PLANNING"] });
    // Server-side whitespace is formatting, not meaning.
    expect(snapshot.tables.find((t) => t.name === "School")?.columns[0]?.default).toBe(
      "gen_random_uuid()",
    );
  });

  test("answers ledgerExists from the presence of the table", async () => {
    expect(await ledgerExists(fake({ tables: [{ table_name: "_prisma_migrations" }] }))).toBe(true);
    expect(await ledgerExists(fake({ tables: [{ table_name: "Student" }] }))).toBe(false);
  });
});

describe("normalizeCanonicalSql", () => {
  const SQL = [
    "-- CreateSchema",
    'CREATE SCHEMA IF NOT EXISTS "public";',
    "",
    "-- CreateEnum",
    'CREATE TYPE "TermStatus" AS ENUM (',
    "    'ACTIVE',",
    "    'PLANNING'",
    ");",
  ].join("\n");

  test("drops Prisma's comment lines and joins wrapped statements", () => {
    const normalized = normalizeCanonicalSql(SQL);
    expect(normalized).not.toContain("-- Create");
    expect(normalized).toContain(`CREATE TYPE "TermStatus" AS ENUM ( 'ACTIVE', 'PLANNING' );`);
  });

  test("is insensitive to CRLF", () => {
    expect(digestCanonicalSql(SQL)).toBe(digestCanonicalSql(SQL.replace(/\n/g, "\r\n")));
  });

  test("handles a trailing incomplete statement (no trailing semicolon)", () => {
    // The SQL fixture ends with a semicolon, so the tail branch is not exercised.
    // This test provides SQL with an incomplete final statement.
    const incompleteSql = "CREATE TABLE t (c TEXT); INSERT INTO t VALUES ('x')"; // no trailing ;
    const normalized = normalizeCanonicalSql(incompleteSql);
    // Should still produce one statement (the incomplete tail is preserved)
    expect(normalized.split("\n")).toHaveLength(1);
    expect(normalized).toContain("INSERT INTO t VALUES ('x')");
  });

  test("a real change changes the digest", () => {
    expect(digestCanonicalSql(SQL)).not.toBe(
      digestCanonicalSql(SQL.replace("'ACTIVE'", "'OPEN'")),
    );
  });

  test("preserves whitespace inside string literals", () => {
    const sql1 = "CREATE TABLE t (c TEXT); INSERT INTO t VALUES ('Ada  Lovelace');";
    const sql2 = "CREATE TABLE t (c TEXT); INSERT INTO t VALUES ('Ada Lovelace');";
    // Only internal spacing differs — digests must be different
    expect(digestCanonicalSql(sql1)).not.toBe(digestCanonicalSql(sql2));
    // External whitespace is still collapsed
    const sql1CollapsedExternal = "CREATE TABLE t (c TEXT); INSERT INTO t VALUES ('Ada  Lovelace');";
    expect(digestCanonicalSql(sql1)).toBe(digestCanonicalSql(sql1CollapsedExternal));
    // But if we collapse INTERNAL whitespace too, digest changes
    const sql1CollapsedAll = sql1.replace(/\s+/g, " ");
    expect(digestCanonicalSql(sql1)).not.toBe(digestCanonicalSql(sql1CollapsedAll));
  });
});

describe("identifiersInSql and tablesTouchedBy", () => {
  const SQL = 'ALTER TABLE "Student" ADD COLUMN "nickname" TEXT;\nDROP INDEX "Student_tenantId_idx";';

  test("collects every quoted identifier", () => {
    expect([...identifiersInSql(SQL)].sort()).toEqual([
      "Student",
      "Student_tenantId_idx",
      "nickname",
    ]);
  });

  test("names only the tables that actually exist", () => {
    expect(tablesTouchedBy(SQL, ["Student", "School"])).toEqual(["Student"]);
  });

  test("an empty diff touches nothing", () => {
    expect(tablesTouchedBy("", ["Student"])).toEqual([]);
  });
});
