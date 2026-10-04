/**
 * The package entry point, as far as it can be exercised without a database.
 *
 * `createPrismaClient` and `createMockPrisma` are both module-private and the
 * real client needs Neon, so what is left to test here is the part of the
 * contract a caller depends on that needs no connection: the deadline is
 * reachable from `@novastar/database` rather than only by a deep import, the
 * module can be imported with no `DATABASE_URL` in the environment, awaiting
 * the client builds nothing, and with no `DATABASE_URL` the client answers with
 * empty results instead of throwing. Every one of those is bought by the lazy
 * `Proxy`, and every one of them stops holding the moment the client is built
 * eagerly, which is what they are pinned against.
 *
 * The order of the tests is load-bearing rather than incidental. The client is
 * cached on `globalThis` for the life of the process, so anything that reaches
 * for a model before the `DATABASE_URL`-less cases would leave a client behind
 * that the later assertions could not see past. `bun test` also runs every file
 * in one process, so `DATABASE_URL` is put back in a `finally` rather than left
 * for whichever file runs next.
 */
import { describe, expect, test } from "bun:test";
import * as entry from "../index";
import * as timeoutModule from "../db-timeout";

/** The one place the client is cached, matching `globalForPrisma` in `index.ts`. */
const cache = globalThis as { prisma?: unknown };

/**
 * Loads a first, independent copy of the entry point. The suffix is assembled
 * at runtime because a specifier the compiler can read is one it tries to
 * resolve on disk, and there is no `index.ts?fresh`.
 */
async function freshWithoutDatabaseUrl(): Promise<typeof import("../index")> {
  const suffix: string = "fresh-without-database-url";
  return (await import(`../index.ts?${suffix}`)) as typeof import("../index");
}

/** Runs `body` with `DATABASE_URL` absent and puts the environment back after. */
async function withoutDatabaseUrl(body: () => Promise<void>): Promise<void> {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await body();
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
}

describe("the entry point", () => {
  test("imports with no DATABASE_URL in the environment, which is the state next build runs in", async () => {
    // A first, separate import with nothing to connect to. The lazy `Proxy` is
    // what buys this: build the client while loading the module and every route
    // in the app fails to prerender.
    await withoutDatabaseUrl(async () => {
      const fresh = await freshWithoutDatabaseUrl();

      expect(typeof fresh.withDbTimeout).toBe("function");
    });
  });

  test("hands out the very same deadline the module exports, so no caller needs a deep import", () => {
    // Not a restatement of the export list: a caller holding an `unknown` from
    // `@novastar/database` cannot match a class it imported from somewhere else
    // in the tree, and the package `main` is this file. A copied class would
    // satisfy `instanceof` inside the copy and fail it in the caller — the
    // bundler case `isDbTimeout` has to work around, and far cheaper not to
    // create in the first place.
    expect(entry.DbTimeoutError).toBe(timeoutModule.DbTimeoutError);
    expect(entry.isDbTimeout).toBe(timeoutModule.isDbTimeout);
    expect(entry.withDbTimeout).toBe(timeoutModule.withDbTimeout);
    expect(entry.DB_QUERY_TIMEOUT_MS).toBe(timeoutModule.DB_QUERY_TIMEOUT_MS);
  });
});

describe("with no database in the environment", () => {
  test("awaiting the client builds nothing, which is what keeps an import from hanging", async () => {
    // A client that is not built on `then` is why `await prisma` — in a route, in
    // a test, anywhere — cannot turn into a connection attempt at import time.
    expect(cache.prisma).toBeUndefined();

    const awaited = await entry.prisma;

    expect(awaited).toBe(entry.prisma);
    // Still nothing, so reading `then` was not what constructed a client.
    expect(cache.prisma).toBeUndefined();
  });

  test("queries answer with empty results and say that they are not real", async () => {
    // Captured rather than printed, because the warning is the assertion: a
    // build that silently answered from a stub would render pages of empty
    // state with nothing in the log to say why.
    const said: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]): void => {
      said.push(args.map(String).join(" "));
    };

    try {
      await withoutDatabaseUrl(async () => {
        delete cache.prisma;
        try {
          // The first read of any model is where the client is built, and with
          // no `DATABASE_URL` that is the stub.
          const stub = entry.prisma;

          expect(await stub.user.findMany()).toEqual([]);
          expect(await stub.user.count()).toBe(0);
          // Any model at all, including one a build has no route for: the stub
          // does not need to know the schema to keep a render from throwing.
          expect(await stub.systemError.findMany()).toEqual([]);
        } finally {
          delete cache.prisma;
        }
      });
    } finally {
      // Restored before anything else can throw, because `console.warn` is
      // process-wide and `bun test` runs every file in one process.
      console.warn = warn;
    }

    // The variable an operator has to set, named in the warning itself.
    expect(said.join("\n")).toContain("DATABASE_URL");
  });
});