/**
 * `compose` — the check that asks the question `verify` cannot.
 *
 * What is worth pinning here is the refusal path, not the diff. `compose` shells
 * out to Prisma and replays every migration into a shadow database, so a test
 * that exercised the happy path would need a live database to exist — which is
 * exactly the kind of test that does not get run. The property that matters is
 * that the command *cannot* be talked into replaying DDL without a target it
 * was given, and cannot be given the live one.
 */
import { describe, expect, test } from "bun:test";
import { dbLocation, resolveShadowTarget, sameDatabase, SHADOW_FLAG } from "../commands/compose";

const BRANCH = "postgresql://u:p@ep-cool-name-branch.us-east-2.aws.neon.tech/neondb?sslmode=require";
const PRIMARY = "postgresql://u:secret@ep-cool-name-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const DIRECT = "postgresql://u:secret@ep-cool-name.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("resolveShadowTarget", () => {
  test("refuses without a shadow URL, and never invents one", () => {
    expect(() => resolveShadowTarget(undefined, { DATABASE_URL: PRIMARY })).toThrow(
      /--shadow-database-url is required/,
    );
    // Blank and whitespace are the same absence: an operator who types the flag
    // and forgets the value must not fall through to a default.
    expect(() => resolveShadowTarget("", { DATABASE_URL: PRIMARY })).toThrow(SHADOW_FLAG);
    expect(() => resolveShadowTarget("   ", { DATABASE_URL: PRIMARY })).toThrow(SHADOW_FLAG);
  });

  test("the refusal says why there is no default and what to use instead", () => {
    let message = "";
    try {
      resolveShadowTarget(undefined, {});
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("no default");
    expect(message).toContain("Neon branch");
    expect(message).toContain("SQL-over-HTTP");
  });

  test("accepts a branch of the same project", () => {
    const shadow = resolveShadowTarget(BRANCH, { DATABASE_URL: PRIMARY, DIRECT_URL: DIRECT });
    expect(shadow.host).toBe("ep-cool-name-branch.us-east-2.aws.neon.tech");
    expect(shadow.source).toBe(SHADOW_FLAG);
  });

  test("refuses the live primary, named by either URL form", () => {
    expect(() => resolveShadowTarget(PRIMARY, { DATABASE_URL: PRIMARY })).toThrow(
      /same database as DATABASE_URL/,
    );
    expect(() => resolveShadowTarget(DIRECT, { DATABASE_URL: PRIMARY, DIRECT_URL: DIRECT })).toThrow(
      /same database as DIRECT_URL/,
    );
    expect(() =>
      resolveShadowTarget("postgresql://u:p@mirror.example.com:5432/postgres", {
        DATABASE_URL: PRIMARY,
        SUPABASE_DATABASE_URL: "postgresql://u:p@mirror.example.com:5432/postgres",
      }),
    ).toThrow(/same database as SUPABASE_DATABASE_URL/);
  });

  test("the live-database refusal interpolates the flag name rather than printing it", () => {
    // A literal "${SHADOW_FLAG}" in operator-facing text is the kind of defect
    // that survives review because it is in a string, not in the logic.
    let message = "";
    try {
      resolveShadowTarget(PRIMARY, { DATABASE_URL: PRIMARY });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("${");
    expect(message).toContain(SHADOW_FLAG);
  });

  test("a credential difference does not hide the identity", () => {
    // Same database, different password: still the live one.
    expect(() =>
      resolveShadowTarget(PRIMARY.replace("u:secret", "other-user:other-secret"), {
        DATABASE_URL: PRIMARY,
      }),
    ).toThrow(/same database as DATABASE_URL/);
  });

  test("refuses a URL with no readable host, because it cannot then compare it", () => {
    // `postgresql://` parses as a URL with an empty hostname, so this is the
    // realistic form of the mistake rather than a syntactically broken string.
    expect(() => resolveShadowTarget("postgresql://", { DATABASE_URL: PRIMARY })).toThrow(
      /no readable host/,
    );
    expect(() => resolveShadowTarget("postgresql://u:p@", { DATABASE_URL: PRIMARY })).toThrow(
      /no readable host/,
    );
  });

  test("refuses a non-postgres URL rather than guessing the protocol", () => {
    expect(() => resolveShadowTarget("file:./dev.db", {})).toThrow(/not a PostgreSQL URL/);
  });

  test("works with no live URL configured at all", () => {
    // Nothing to compare against, so nothing to refuse. The production guard in
    // runCompose is what covers this case, not this function.
    expect(resolveShadowTarget(BRANCH, {}).host).toBe(
      "ep-cool-name-branch.us-east-2.aws.neon.tech",
    );
  });
});

describe("sameDatabase", () => {
  test("a Neon branch is a different database from its parent", () => {
    expect(sameDatabase(BRANCH, PRIMARY)).toBe(false);
    expect(sameDatabase(BRANCH, DIRECT)).toBe(false);
  });

  test("the pooler and the direct endpoint are different hostnames, so not equal", () => {
    // Stated rather than assumed: the pooler proxy and the direct endpoint are
    // two hostnames for one database, and this comparison does not join them.
    expect(sameDatabase(PRIMARY, DIRECT)).toBe(false);
  });

  test("query strings and credentials are irrelevant", () => {
    expect(sameDatabase(`${PRIMARY}&foo=bar`, PRIMARY.replace("u:secret", "u:other"))).toBe(true);
  });

  test("a different database name on the same host is a different database", () => {
    expect(sameDatabase(DIRECT, "postgresql://u:p@ep-cool-name.us-east-2.aws.neon.tech/other")).toBe(
      false,
    );
  });

  test("an unreadable URL is not evidence of sameness", () => {
    expect(sameDatabase("nonsense", PRIMARY)).toBe(false);
    expect(sameDatabase(PRIMARY, "nonsense")).toBe(false);
  });
});

describe("dbLocation", () => {
  test("reads host and database, case-folded and bracket-stripped", () => {
    expect(dbLocation("postgresql://u:p@[::1]:5432/NeonDB?sslmode=require")).toEqual({
      host: "::1",
      database: "NeonDB",
    });
    expect(dbLocation("postgresql://u:p@EP-Cool.Example.COM:5432/neondb")).toEqual({
      host: "ep-cool.example.com",
      database: "neondb",
    });
  });

  test("a missing database name is an empty string, not an undefined location", () => {
    expect(dbLocation("postgresql://u:p@db.example.com")).toEqual({
      host: "db.example.com",
      database: "",
    });
  });

  test("returns undefined rather than throwing", () => {
    expect(dbLocation("://")).toBeUndefined();
  });
});
