/**
 * Telling a deadline apart from a database that said no.
 *
 * The two failures mean opposite things. A deadline is a symptom — an outage, or
 * a query too slow to wait on — and wants a 503 and a retry. A driver error is a
 * statement about the statement itself and wants a fix. Conflated, an outage is
 * filed as a bug in the query, which is the specific misreading this module
 * exists to prevent, so the property pinned here is that the two can never be
 * mistaken for each other in either direction: a timeout must still be
 * recognisable from a plain `unknown`, from a second copy of the module behind a
 * bundler, and from a log line; and a driver failure must not be absorbed by the
 * guard however much its message sounds like a timeout.
 */
import { describe, expect, test } from "bun:test";
import { DbTimeoutError, isDbTimeout } from "../db-timeout";

/**
 * Loads a second, independent copy of this module — what a bundler boundary or
 * a worker produces, and the case `instanceof` cannot see. The suffix is
 * assembled at runtime because a specifier the compiler can read is a specifier
 * it tries to resolve on disk, and there is no `db-timeout.ts?second-copy`.
 */
async function secondCopy(): Promise<typeof import("../db-timeout")> {
  const suffix: string = "second-copy";
  return (await import(`../db-timeout.ts?${suffix}`)) as typeof import("../db-timeout");
}

describe("DbTimeoutError", () => {
  test("is an Error, so a handler that checks the base class still holds it", () => {
    const error = new DbTimeoutError("user.findUnique", 10_000);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DbTimeoutError);
    // Not `Error`, which would leave a log line unable to say what it was.
    expect(error.name).toBe("DbTimeoutError");
    expect(typeof error.stack).toBe("string");
  });

  test("carries the query and the deadline as values, not only inside the message", () => {
    const error = new DbTimeoutError("session.findUnique", 250);

    // A handler that logs which lookup it gave up on should not have to parse
    // the message to find out.
    expect(error.query).toBe("session.findUnique");
    expect(error.timeoutMs).toBe(250);
    expect(error.message).toContain("session.findUnique");
    expect(error.message).toContain("250ms");
  });

  test("survives a log round trip, because a serialised line is often all that is left", () => {
    const error = new DbTimeoutError("payment.create", 10_000);

    const revived: unknown = JSON.parse(JSON.stringify(error));

    // `message` is non-enumerable and does not survive, which is the point:
    // the `code` is the only identifier a log reader has.
    expect(revived).not.toBeInstanceOf(Error);
    expect(isDbTimeout(revived)).toBe(true);
    expect((revived as DbTimeoutError).query).toBe("payment.create");
  });

  test("narrows an unknown, which is what lets a caller reach the query without a cast", () => {
    const caught: unknown = new DbTimeoutError("user.findUnique", 10_000);

    // The assertion is that this file compiles: the guard has to be a type
    // predicate for `caught.query` to be a `string` at all. A guard that
    // degraded to returning `boolean` would stop the suite compiling, which is
    // the only thing that pins the signature.
    if (!isDbTimeout(caught)) throw new Error("expected a timeout");
    expect(caught.query).toBe("user.findUnique");
    expect(caught.timeoutMs).toBe(10_000);
  });
});

describe("isDbTimeout", () => {
  test("recognises a timeout raised by this copy of the module", () => {
    expect(isDbTimeout(new DbTimeoutError("user.findUnique", 10_000))).toBe(true);
  });

  test("recognises a timeout raised by a second, independently loaded copy of the module", async () => {
    // What a bundler boundary or a worker actually produces: two live copies of
    // this file, so `instanceof` is false for an error the other copy built.
    const other = await secondCopy();

    expect(other.DbTimeoutError).not.toBe(DbTimeoutError);
    const fromTheOtherCopy = new other.DbTimeoutError("user.findUnique", 10_000);
    expect(isDbTimeout(fromTheOtherCopy)).toBe(true);
    // ...and the reverse, because either copy may be the one holding the error.
    expect(other.isDbTimeout(new DbTimeoutError("user.findUnique", 10_000))).toBe(true);
  });

  test("recognises a bare object carrying the code, for an error with no class left in it", () => {
    // What survives crossing a worker boundary or arriving from a structured log:
    // the identifier, with the prototype gone.
    expect(isDbTimeout({ code: "DB_TIMEOUT" })).toBe(true);
    expect(isDbTimeout({ code: "DB_TIMEOUT", query: "user.findUnique" })).toBe(true);
    expect(isDbTimeout(Object.assign(new Error("gave up"), { code: "DB_TIMEOUT" }))).toBe(true);
  });

  test("refuses a driver failure, however much its message sounds like a timeout", () => {
    // The pool timing out is the database refusing, not this module giving up.
    // Absorbing it here would report an outage as a bug in the query.
    expect(isDbTimeout(new Error("P1001: Can't reach database server"))).toBe(false);
    expect(isDbTimeout({ code: "P1001", message: "Timed out fetching a new connection" })).toBe(
      false,
    );
    expect(isDbTimeout(TypeError("fetch failed"))).toBe(false);
    expect(isDbTimeout({ code: "db_timeout" })).toBe(false);
  });

  test("refuses a log line, so a serialised message is not mistaken for the error", () => {
    // A string carrying the code, and a string carrying the message, are both
    // what a grep across a log directory turns up. Neither is an error object,
    // and a guard that matched them would classify arbitrary text as a timeout.
    expect(isDbTimeout("DB_TIMEOUT")).toBe(false);
    expect(isDbTimeout("Database query timed out after 10000ms: user.findUnique")).toBe(false);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 0],
    ["a boolean", true],
    ["an empty object", {}],
    ["a null-prototype object", Object.create(null)],
    ["an array", []],
    ["a function", () => undefined],
    ["a symbol", Symbol.iterator],
  ])("returns false for %s rather than throwing", (_label, value) => {
    // It is typed `(error: unknown) => ...`, so every one of these has to be an
    // answer rather than a `TypeError` from reading a property off `null`.
    expect(() => isDbTimeout(value)).not.toThrow();
    expect(isDbTimeout(value)).toBe(false);
  });
});