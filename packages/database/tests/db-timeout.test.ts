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
 * Spawns `script` in a child `bun` process and reports how long it took to exit.
 *
 * `timeout` bounds a regression to a failure rather than a hang. This is the
 * only place a process is started, so both the plain and the instrumented runs
 * below are spawned identically and differ only in what the script does.
 */
function spawnInChild(script: string): { exitCode: number; stdout: string; elapsedMs: number } {
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

/**
 * Runs `body` in a child `bun` process against the real module.
 *
 * `elapsedMs` on its own means little — it is dominated by what spawning `bun`
 * costs on the day — so it is only ever read as a difference, against a control
 * process that pays the same start-up without arming a deadline. A deadline left
 * armed keeps the loop alive for its full ten seconds, and that is the whole
 * excess over start-up.
 */
function runInChild(body: string): { exitCode: number; stdout: string; elapsedMs: number } {
  return spawnInChild(`const { withDbTimeout } = await import(${JSON.stringify(MODULE_URL)});\n${body}\n`);
}

/**
 * How long a child may keep its own event loop alive after its work has finished.
 *
 * This is the quantity that is actually being asserted, and it needs no baseline
 * at all: it is measured inside the child, between the moment the awaited work
 * settles and the moment the loop finally drains. Process start-up is not in that
 * interval, so nothing about the machine's speed can enter it.
 *
 * Sized against what it has to tell apart. Measured on this four-core box, the
 * clean case reads 0–1ms both idle and under a saturating load and during a full
 * 52-task gate, because the work is microtask-only and the loop has nothing left
 * to wait for the moment it finishes; a leaked timer reads the full deadline,
 * 10_002ms to 10_035ms across six runs. 2_000 therefore sits four orders of
 * magnitude above the clean reading and five times below the leak, so neither
 * outcome is reachable by accident — the two are not the same magnitude, they
 * differ by the deadline itself.
 */
const DRAIN_SLACK_MS = 2_000;

/**
 * How much slower than its own control a child may be before the excess can only
 * have come from something left armed.
 *
 * Sized from the measurements this suite actually produces, not picked to look
 * tidy. Both terms carry the same scheduling noise, so what reaches the
 * assertion is their difference: sampling ten times during a full `typecheck lint
 * test --force` gate, the widest clean margin seen was +1974ms (and most were
 * negative, the control being the slower of the pair), against +9901ms to
 * +10083ms for a genuinely leaked timer. 4_000 sits above the observed clean
 * noise by ~2x and below the observed leak by ~2.5x.
 *
 * Deliberately not 2_000. At 2_000 the worst clean sample observed left 91ms of
 * headroom, which is the same kind of bet as the 4_000ms absolute bound it
 * replaced, and would have made this a less frequent flake rather than the
 * removal of one.
 *
 * This bound is the weaker of the two assertions, and is kept only because
 * `DRAIN_SLACK_MS` cannot see a regression that made the *work* slow to settle
 * rather than left a handle behind — the drain would still read ~0ms while the
 * process genuinely took far longer than it should. Note also what it costs: the
 * slowest control observed was 12_310ms, longer than the deadline itself, so on
 * its own this comparison could be inflated past a real leak and let one through.
 * It cannot hide anything here only because the drain assertion is checked first
 * and does not depend on a baseline at all.
 */
const STARTUP_SLACK_MS = 4_000;

/**
 * The per-test ceiling for the two timer tests, set above `spawnInChild`'s own
 * 30-second spawn cap on purpose.
 *
 * Bun's default 5-second per-test ceiling is *shorter than the 10-second
 * deadline* that a leaked timer costs, so a leak would kill the test while the
 * child was still exiting and neither assertion below would ever be evaluated.
 * The suite would go red either way, but on the harness's clock rather than on
 * the measurement, which is no evidence that the assertions discriminate
 * anything. Outlasting the spawn cap hands the verdict to the assertions, and the
 * test still terminates, because the cap does.
 */
const TIMER_LEAK_TEST_TIMEOUT_MS = 35_000;

/**
 * Wraps `body` so the child reports how long its event loop stayed alive after
 * the work finished.
 *
 * The timestamp is taken *after* the body, and read inside an `exit` handler,
 * because that is the only interval in which a leftover handle shows up: `exit`
 * fires once the loop has drained, so the gap is exactly the time something kept
 * it open. Written with `writeSync` because a piped stdout is not flushed
 * synchronously and a `console.log` here can be lost.
 */
function withDrainProbe(body: readonly string[]): string {
  return [
    `const { withDbTimeout } = await import(${JSON.stringify(MODULE_URL)});`,
    `const { writeSync } = await import("node:fs");`,
    ...body,
    "const workSettledAt = performance.now();",
    'process.on("exit", () => {',
    '  writeSync(1, "DRAIN=" + Math.round(performance.now() - workSettledAt) + "\\n");',
    "});",
  ].join("\n");
}

/**
 * Reads the drain interval the child reported, failing loudly if it reported
 * nothing.
 *
 * A missing marker means the child died before its handler ran, which is itself
 * a failure worth naming — silently turning it into `NaN` would produce a
 * comparison that passes for the wrong reason.
 */
function drainMs(stdout: string): number {
  const reported = /DRAIN=(\d+)/.exec(stdout);
  if (reported === null) {
    throw new Error(`child never reported how long it stayed alive: ${JSON.stringify(stdout)}`);
  }
  return Number(reported[1]);
}

/**
 * Asserts that a child which armed a deadline through `withDbTimeout` left
 * nothing holding its event loop open.
 *
 * Two assertions, because they fail for different reasons and each covers what
 * the other cannot see. The drain interval is the sharp one: it is measured
 * inside the child, so start-up — unbounded, machine-dependent, and measured in
 * hundreds of milliseconds idle but in seconds under a 52-task gate — is not part
 * of it at all, and a leak cannot hide behind a slow machine because there is no
 * slow-machine term to hide behind. The wall-clock margin then guards the other
 * direction, a wrapper that made the query itself slow to settle, which the
 * drain interval would report as ~0ms.
 *
 * `withoutTimeout` is that same script with the `withDbTimeout` call taken out,
 * which is what makes the wall-clock half relative rather than absolute. It is
 * sampled on both sides of the run under test and the slower reading wins: one
 * sample is either cold or warm and neither is the run being bounded, since the
 * first child pays to fault the module into the filesystem cache and a control
 * taken only afterwards is bounded by whatever the machine did afterwards.
 * Sampling both sides puts the baseline at the moment the run under test actually
 * happened. The controls are separate processes with their own module instances,
 * so nothing is shared with the measurement except the module on disk, and the
 * baseline cannot be inflated by anything the run under test did.
 */
function expectLeavesNoTimerArmed(
  body: readonly string[],
  withoutTimeout: readonly string[],
): void {
  const control = (): number => runInChild(withoutTimeout.join("\n")).elapsedMs;
  const controlBefore = control();
  const child = spawnInChild(withDrainProbe(body));
  const startupMs = Math.max(controlBefore, control());

  expect(child.stdout).toContain("done");
  expect(child.exitCode).toBe(0);
  // First, because it is the one that cannot be argued with: the loop drained
  // immediately, so nothing was left armed, whatever the machine charged for it.
  expect(drainMs(child.stdout)).toBeLessThan(DRAIN_SLACK_MS);
  // Then the whole-process comparison, as a second net under the first.
  const marginMs = child.elapsedMs - startupMs;
  expect(marginMs).toBeLessThan(STARTUP_SLACK_MS);
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
    expectLeavesNoTimerArmed(
      ['await withDbTimeout(Promise.resolve(1), "user.findUnique");', 'console.log("done");'],
      ['await Promise.resolve(1);', 'console.log("done");'],
    );
  }, TIMER_LEAK_TEST_TIMEOUT_MS);

  test("a query that fails leaves no timer behind either", () => {
    // The same open handle on the failure path, where the deadline never fires
    // and so is still live when the caller's error propagates. Its control keeps
    // the rejection and the `.catch` and drops only the wrapper, so the two
    // children differ by the deadline and by nothing else.
    expectLeavesNoTimerArmed(
      [
        'await withDbTimeout(Promise.reject(new Error("boom")), "user.findUnique").catch(() => {});',
        'console.log("done");',
      ],
      ['await Promise.reject(new Error("boom")).catch(() => {});', 'console.log("done");'],
    );
  }, TIMER_LEAK_TEST_TIMEOUT_MS);
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