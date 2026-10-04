/**
 * The query deadline.
 *
 * What is pinned here is the behaviour at the edges, because a deadline only
 * earns its place when the database is the thing that has gone wrong: a query
 * that never answers has to reject rather than hold a request open, a driver
 * failure has to reach the caller as itself instead of as "timed out", and no
 * value a caller can pass as a timeout may leave the query unbounded. Nothing
 * in this file contacts a database — the work is a promise the test owns.
 *
 * Three of the properties are properties of the process rather than of a
 * return value, so they are asserted by running a child `bun` process: a
 * deadline the caller never handled must not take the process down, and the
 * timer must not be left holding the event loop open on either path where the
 * query wins or fails. Both fail the same way in production — a crash, or a
 * serverless instance that will not freeze.
 *
 * `bun test` runs every file in one process, so the fake timers in the
 * default-deadline test are handed back in a `finally` rather than left for
 * whichever file runs next.
 */
import { describe, expect, jest, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DB_QUERY_TIMEOUT_MS,
  DbTimeoutError,
  isDbTimeout,
  withDbTimeout,
} from "../db-timeout";

/** A promise nobody ever settles: the database that accepts and stops answering. */
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

/**
 * A `PrismaPromise`-shaped thenable, which is what a Prisma query hands over:
 * a value that has not started executing and only runs when it is awaited.
 */
function prismaPromise<T>(value: T, onStart: () => void): PromiseLike<T> {
  return {
    then: (onFulfilled, onRejected) => {
      onStart();
      return Promise.resolve(value).then(onFulfilled, onRejected);
    },
  };
}

/** Lets the promise callbacks that fake-timer advancement woke up run to completion. */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

/**
 * The rejection from a race, or `null` if the work won instead.
 *
 * Typed `Error | null`, not `DbTimeoutError | null`: `withDbTimeout` rethrows
 * the driver's own error untouched, so narrowing this to `DbTimeoutError` makes
 * the tests below untypeable and hides the pass-through they exist to pin.
 */
async function rejection(promise: PromiseLike<unknown>): Promise<Error | null> {
  return promise.then(
    () => null,
    (error: unknown) => error as Error,
  );
}

/**
 * The rejection from a race that is expected to be a timeout, narrowed so the
 * `query` and `timeoutMs` fields are reachable.
 *
 * Narrows through `isDbTimeout` rather than `instanceof` because that is the
 * guard the module documents for callers it cannot trust `instanceof` with, and
 * it fails the test by throwing here instead of silently handing back a
 * non-timeout error for the assertions below to misreport.
 */
async function timeoutRejection(promise: PromiseLike<unknown>): Promise<DbTimeoutError> {
  const caught = await rejection(promise);
  if (!isDbTimeout(caught)) {
    throw new Error(`expected a DbTimeoutError, got ${String(caught)}`);
  }
  return caught;
}

const MODULE_URL = pathToFileURL(join(import.meta.dir, "..", "db-timeout.ts")).href;

/**
 * Runs `body` in a child `bun` process against the real module, and reports how
 * long the process took to exit.
 *
 * `elapsedMs` is the assertion that matters for the timer tests: a deadline left
 * armed keeps the loop alive for its full ten seconds, so the difference between
 * "exited" and "exited ten seconds later" is the difference between the property
 * holding and not. `timeout` bounds a regression to a failure rather than a hang.
 */
function runInChild(body: string): { exitCode: number; stdout: string; elapsedMs: number } {
  const script = `const { withDbTimeout } = await import(${JSON.stringify(MODULE_URL)});\n${body}\n`;
  const startedAt = performance.now();
  const child = Bun.spawnSync([process.execPath, "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  return {
    exitCode: child.exitCode,
    stdout: child.stdout.toString(),
    elapsedMs: performance.now() - startedAt,
  };
}

describe("a query that answers inside the deadline", () => {
  test("resolves with the driver's own value, not a copy of it", async () => {
    const row = { id: "user_1", email: "head@novastar.test" };

    expect(await withDbTimeout(Promise.resolve(row), "user.findUnique", 1_000)).toBe(row);
  });

  test("starts a thenable that has not run yet, because awaiting it is what runs the query", async () => {
    let starts = 0;
    const row = { id: "user_1" };

    const answered = await withDbTimeout(
      prismaPromise(row, () => {
        starts += 1;
      }),
      "user.findUnique",
      1_000,
    );

    expect(answered).toBe(row);
    expect(starts).toBeGreaterThan(0);
  });

  test("a failure from the database reaches the caller as itself, not as a timeout", async () => {
    const refused = new Error("P1001: Can't reach database server at the host");

    const caught = await rejection(withDbTimeout(Promise.reject(refused), "user.findUnique", 1_000));

    // Identity, not equality: a caller that logs and rethrows must hand back the
    // driver's own error object, not a reconstruction of it.
    expect(caught).toBe(refused);
    expect(isDbTimeout(caught)).toBe(false);
  });

  test("a failure that arrives mid-flight is still not relabelled as a timeout", async () => {
    const refused = new Error("P1001: Can't reach database server at the host");
    const work = Bun.sleep(20).then(() => {
      throw refused;
    });

    // The deadline is still armed 20ms in, so this also pins that the query is
    // still being waited on at the point the driver gives up.
    const caught = await rejection(withDbTimeout(work, "session.findUnique", 5_000));

    expect(caught).toBe(refused);
    expect(isDbTimeout(caught)).toBe(false);
  });
});

describe("a query that never answers", () => {
  test("rejects instead of resolving, so the caller stops holding the request", async () => {
    await expect(withDbTimeout(never(), "user.findUnique", 10)).rejects.toBeInstanceOf(DbTimeoutError);
  });

  test("the rejection names the query and the deadline it exceeded", async () => {
    const caught = await timeoutRejection(withDbTimeout(never(), "session.findUnique", 25));

    expect(caught).toBeInstanceOf(Error);
    expect(caught.name).toBe("DbTimeoutError");
    // As values, not only inside the message: a handler that logs the query it
    // gave up on must not have to parse the message to find out.
    expect(caught.query).toBe("session.findUnique");
    expect(caught.timeoutMs).toBe(25);
    expect(caught.message).toContain("session.findUnique");
    expect(caught.message).toContain("25ms");
  });

  test("a caller recognises the rejection with isDbTimeout, without instanceof", async () => {
    const caught = await rejection(withDbTimeout(never(), "user.findUnique", 10));

    // The guard is the only thing a caller across a module boundary can rely on,
    // so the two halves are asserted together: the wrapper produces something
    // the guard claims, and the guard claims nothing else.
    expect(isDbTimeout(caught)).toBe(true);
    expect(isDbTimeout(new Error("P1001"))).toBe(false);
  });
});

describe("the abandoned query", () => {
  test("keeps running, because a write the caller was told timed out may still commit", async () => {
    let committed = false;
    const work = Bun.sleep(30).then(() => {
      committed = true;
    });

    const caught = await rejection(withDbTimeout(work, "payment.create", 1));
    expect(isDbTimeout(caught)).toBe(true);
    // Not finished at the moment the caller was told it had timed out...
    expect(committed).toBe(false);

    await Bun.sleep(60);
    // ...and not cancelled afterwards. A caller that read the deadline as "the
    // write did not happen" is wrong, which is why this is pinned rather than
    // left as an assumption.
    expect(committed).toBe(true);
  });

  test("a failure nobody is waiting for does not take the process down", () => {
    // The deadline wins, and the query then fails while nobody holds it.
    // `Promise.race` has already subscribed to that query, so the failure has a
    // handler and the process survives. Without that subscription the same
    // script exits 1 with the error printed — which is what this asserts
    // against, and why it runs in a child rather than in this process.
    const child = runInChild(
      [
        'const work = Bun.sleep(25).then(() => { throw new Error("connection reset by peer"); });',
        'await withDbTimeout(work, "session.findUnique", 1).catch(() => console.log("gave up"));',
        'await Bun.sleep(60);',
        'console.log("survived");',
      ].join("\n"),
    );

    expect(child.stdout).toContain("gave up");
    expect(child.stdout).toContain("survived");
    expect(child.exitCode).toBe(0);
  });
});

describe("nothing is left holding the process open", () => {
  test("a query that answers leaves no timer behind", () => {
    // No timeout argument, so the armed deadline is the full ten seconds. Left
    // uncleared on this path, it would keep the event loop alive for all of it.
    const child = runInChild(
      ['await withDbTimeout(Promise.resolve(1), "user.findUnique");', 'console.log("done");'].join(
        "\n",
      ),
    );

    expect(child.stdout).toContain("done");
    expect(child.exitCode).toBe(0);
    // Start-up plus a resolved promise is a few hundred milliseconds; the
    // deadline is 10_000. Anything near the latter is the timer still armed.
    expect(child.elapsedMs).toBeLessThan(4_000);
  });

  test("a query that fails leaves no timer behind either", () => {
    // The same open handle on the failure path, where the deadline never fires
    // and so is still live when the caller's error propagates.
    const child = runInChild(
      [
        'await withDbTimeout(Promise.reject(new Error("boom")), "user.findUnique").catch(() => {});',
        'console.log("done");',
      ].join("\n"),
    );

    expect(child.stdout).toContain("done");
    expect(child.exitCode).toBe(0);
    expect(child.elapsedMs).toBeLessThan(4_000);
  });
});

describe("the deadline a caller can pass", () => {
  test("is ten seconds by default, which is a value and not an omission", () => {
    expect(DB_QUERY_TIMEOUT_MS).toBe(10_000);
    expect(Number.isInteger(DB_QUERY_TIMEOUT_MS)).toBe(true);
    expect(DB_QUERY_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test("the default is that same constant, so a caller omitting it gets one deadline", async () => {
    // Crossed with fake timers because the real default is ten seconds and this
    // suite is not going to spend ten seconds on it. If the default parameter
    // were a second literal that drifted from the constant, nothing would have
    // rejected by the time the constant is reached and the last assertion fails.
    jest.useFakeTimers();
    try {
      let outcome = "pending";
      const settled = withDbTimeout(never<string>(), "user.findUnique").then(
        () => {
          outcome = "resolved";
        },
        () => {
          outcome = "rejected";
        },
      );

      jest.advanceTimersByTime(DB_QUERY_TIMEOUT_MS - 1);
      await drainMicrotasks();
      expect(outcome).toBe("pending");

      jest.advanceTimersByTime(1);
      await drainMicrotasks();
      expect(outcome).toBe("rejected");
      await settled;
    } finally {
      jest.useRealTimers();
    }
  });

  test("a deadline can beat a query that is still running", async () => {
    // The ordering the wrapper exists for, with a wide margin so it is the
    // deadline doing it and not a slow machine: a query that answers in a
    // quarter of a second against a five-millisecond deadline.
    const work = Bun.sleep(250).then(() => "answered too late");

    const caught = await timeoutRejection(withDbTimeout(work, "session.findUnique", 5));

    expect(caught).toBeInstanceOf(DbTimeoutError);
    expect(caught.timeoutMs).toBe(5);
  });

  test.each([0, -1, -5_000])(
    "a deadline of %ims gives up on a query that never answers",
    async (timeoutMs) => {
      // Raced against work that never settles on purpose: the property is that
      // the deadline fires at all, and a query that could answer on its own
      // would make that a race with the machine rather than a statement about
      // the deadline. (Bun also defers a negative `setTimeout` while it emits
      // its warning, which is exactly the kind of timing an ordering assertion
      // here would be reporting on.)
      const caught = await timeoutRejection(withDbTimeout(never(), "user.findUnique", timeoutMs));

      expect(caught).toBeInstanceOf(DbTimeoutError);
      // Reported as asked for, so the error says which deadline was exceeded
      // rather than the clamped value the timer actually used.
      expect(caught.timeoutMs).toBe(timeoutMs);
    },
  );

  test("a zero deadline still returns work that has already settled", async () => {
    // The boundary, not a bug to fix: `setTimeout(fn, 0)` fires on the next
    // macrotask and an already-resolved value settles in a microtask, so a
    // deadline of zero means "do not wait" rather than "fail everything". Pinned
    // because it is the one case where the deadline loses to work nobody waited
    // for.
    expect(await withDbTimeout(Promise.resolve("answered"), "user.findUnique", 0)).toBe("answered");
  });

  test.each([
    ["not a number", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["too large for a timer field", 2 ** 31],
  ])("%s as a deadline still gives up on a query that never answers", async (_label, timeoutMs) => {
    // The timer coerces each of these to roughly a millisecond, which is the
    // outcome worth pinning: a deadline computed to `NaN`, or written as
    // `Infinity` because someone meant "no deadline", still bounds the query.
    // The failure mode guarded against is the opposite one — an unrecognised
    // deadline quietly becoming an unbounded wait, which is the condition this
    // module exists to remove.
    const caught = await timeoutRejection(withDbTimeout(never(), "user.findUnique", timeoutMs));

    expect(caught).toBeInstanceOf(DbTimeoutError);
    // Carried through unaltered, so the error names the deadline the caller
    // asked for rather than the clamped value the timer used.
    expect(caught.timeoutMs).toBe(timeoutMs);
  });
});