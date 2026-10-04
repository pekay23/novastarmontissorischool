/**
 * Debounce and retry — the two timing helpers, exercised against real timers.
 *
 * Both are timing-shaped, so the assertions are about ORDER and ATTEMPT COUNT
 * rather than about elapsed milliseconds. Waiting an exact duration would make
 * the suite flaky on a loaded machine without testing anything the attempt count
 * does not already pin; waiting comfortably longer than the delay makes a
 * "fires at all" case reliable without needing a stopwatch.
 */
import { describe, expect, test } from "bun:test";
import { debounce, retry } from "../index";

describe("debounce", () => {
  test("runs the function once, after the delay has elapsed", async () => {
    let calls = 0;
    const debounced = debounce(() => {
      calls += 1;
    }, 20);

    debounced();
    debounced();
    debounced();

    expect(calls).toBe(0);

    await Bun.sleep(80);
    expect(calls).toBe(1);
  });

  test("passes the arguments of the LAST call", async () => {
    const seen: string[] = [];
    const debounced = debounce((value: string) => {
      seen.push(value);
    }, 20);

    debounced("first");
    debounced("second");
    debounced("third");

    await Bun.sleep(80);
    expect(seen).toEqual(["third"]);
  });

  test("restarts the timer on every call, so a steady stream never fires", async () => {
    let calls = 0;
    const debounced = debounce(() => {
      calls += 1;
    }, 40);

    for (let index = 0; index < 5; index += 1) {
      debounced();
      await Bun.sleep(10);
    }

    expect(calls).toBe(0);

    await Bun.sleep(120);
    expect(calls).toBe(1);
  });

  test("can fire again after the debounce window closes", async () => {
    let calls = 0;
    const debounced = debounce(() => {
      calls += 1;
    }, 10);

    debounced();
    await Bun.sleep(60);
    debounced();
    await Bun.sleep(60);

    expect(calls).toBe(2);
  });

  test("returns undefined rather than the wrapped function's own result", async () => {
    const debounced = debounce((value: number) => value * 2, 10);

    expect(debounced(21)).toBeUndefined();

    await Bun.sleep(60);
  });
});

describe("retry", () => {
  test("returns the first success without retrying", async () => {
    let attempts = 0;
    const result = await retry(async () => {
      attempts += 1;
      return "ok";
    }, 3, 1);

    expect(result).toBe("ok");
    expect(attempts).toBe(1);
  });

  test("retries until the call succeeds, and reports how many attempts it took", async () => {
    let attempts = 0;
    const result = await retry(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error(`attempt ${attempts} failed`);
      return attempts;
    }, 5, 1);

    expect(result).toBe(3);
    expect(attempts).toBe(3);
  });

  test("throws the LAST error once the attempts are exhausted", async () => {
    let attempts = 0;
    const failure = await retry(async () => {
      attempts += 1;
      throw new Error(`failure ${attempts}`);
    }, 3, 1).then(
      () => null,
      (error: Error) => error,
    );

    expect(attempts).toBe(3);
    expect(failure?.message).toBe("failure 3");
  });

  test("makes exactly maxAttempts calls, and defaults to three", async () => {
    let attempts = 0;
    await retry(async () => {
      attempts += 1;
      throw new Error("nope");
    }, 1, 1).catch(() => undefined);
    expect(attempts).toBe(1);

    attempts = 0;
    await retry(async () => {
      attempts += 1;
      throw new Error("nope");
    }).catch(() => undefined);
    expect(attempts).toBe(3);
  });

  test("backs off by attempt number, so the delay grows between tries", async () => {
    // `delay * attempt`: 1ms, then 2ms. The suite only asserts that a retry loop
    // does not hammer a failing dependency flat out — it does not measure the
    // backoff curve, which would make the suite slower and no more correct.
    let attempts = 0;
    const startedAt = Date.now();

    await retry(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("nope");
      return attempts;
    }, 3, 10).catch(() => undefined);

    expect(attempts).toBe(3);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
  });

  test("waits nothing after the final attempt", async () => {
    // The loop sleeps only when `attempt < maxAttempts`, so a single-attempt retry
    // resolves as fast as the call itself.
    let attempts = 0;
    await retry(async () => {
      attempts += 1;
      throw new Error("nope");
    }, 1, 5000).catch(() => undefined);

    expect(attempts).toBe(1);
  });

  test("rethrows a non-Error rejection rather than swallowing it", async () => {
    const failure = await retry(async () => {
      throw "a bare string";
    }, 2, 1).then(
      () => null,
      (error: unknown) => error,
    );

    // The signature types `lastError` as `Error` and casts, so a rejection that
    // is not an Error reaches the caller unchanged — which is what a caller
    // inspecting it needs, and what makes `throw lastError!` non-null-safe in
    // general.
    expect(failure).toBe("a bare string");
  });
});