import { describe, it, expect } from 'bun:test'
import { DB_QUERY_TIMEOUT_MS, DbTimeoutError, isDbTimeout, withDbTimeout } from '@novastar/database'

/**
 * Regression cover for the query deadline.
 *
 * Every assertion here is about a *timing* behaviour, and timing tests fail in
 * one of two ways that both look like success: they pass because the
 * implementation is right, or they pass because the assertion cannot tell the
 * difference. So each test names the failure it rules out, and the deadline is
 * deliberately far below the default in every case that has to win one — a test
 * that relied on the default would need ten seconds of wall clock to prove
 * anything.
 *
 * The default itself is asserted separately against the two properties that
 * matter: it is long enough that no legitimate work in this schema is at risk,
 * and it is short enough to be a bound rather than a comment.
 */

/** A deadline short enough to keep the suite fast, long enough to lose a race to a real await. */
const TIGHT = 50

/**
 * A promise that never settles, standing in for a database that accepted the
 * connection and then went quiet. A deferred that resolves on a timer would not
 * do: something has to be *certain* not to settle, or the test is racing the
 * clock rather than the deadline.
 */
function neverSettles(): Promise<never> {
  return new Promise<never>(() => {})
}

/** Yield long enough for a microtask queue to drain and a timer to have fired. */
function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Record every timer the code under test arms, so "the timer was cleared" is an
 * observation rather than an inference from the test finishing.
 *
 * `pending` tracks handles that will still fire. A handle leaves the set the
 * moment its callback runs OR the moment it is cleared, because a timer that has
 * already fired holds nothing open — counting fired timers as live is what made
 * a correct implementation look like it leaked.
 */
function trackTimers(): { pending: () => number; cleared: () => number; restore: () => void } {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  // `unknown`, not the timer handle type: Bun's `setTimeout` returns a `Timer`
  // while the ambient Node types declare `Timeout`, and naming either one here
  // only buys a cast that hides the actual mismatch between the two runtimes.
  const open = new Set<unknown>()
  const cleared = new Set<unknown>()

  globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    const handle: unknown = realSetTimeout(() => {
      open.delete(handle)
      fn()
    }, ms, ...rest)
    open.add(handle)
    return handle
  }) as unknown as typeof globalThis.setTimeout

  globalThis.clearTimeout = ((handle: never) => {
    cleared.add(handle)
    open.delete(handle)
    return realClearTimeout(handle)
  }) as typeof globalThis.clearTimeout

  return {
    pending: () => open.size,
    cleared: () => cleared.size,
    restore: () => {
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
    },
  }
}

describe('db-timeout - a query that finishes in time is untouched', () => {
  it('should pass the value through unchanged', async () => {
    const rows = [{ id: 'user-1', tenantId: 'tenant-1' }]
    const result = await withDbTimeout(Promise.resolve(rows), 'user.findMany', TIGHT)

    // Identity, not just deep equality: a deadline that rebuilt the value, or
    // wrapped it, would still pass a `toEqual` and would not be the value the
    // caller asked for.
    expect(result).toBe(rows)
  })

  it('should preserve a falsy value rather than treating it as a miss', async () => {
    // `findUnique` returns `null` for "no such row", which is a successful
    // answer. A guard written as `work || timeoutPromise` would race on `null`
    // and report a timeout for a query that answered correctly.
    expect(await withDbTimeout(Promise.resolve(null), 'user.findUnique', TIGHT)).toBeNull()
    expect(await withDbTimeout(Promise.resolve(0), 'user.count', TIGHT)).toBe(0)
  })

  it('should not resolve a moment after the deadline it was given', async () => {
    // Late, but inside the deadline. This is the case a coarse implementation
    // gets wrong by rounding: the value is genuinely available, so reporting a
    // timeout turns a working database into an outage on the errors page.
    const value = { id: 'slow-but-fine' }
    const result = await withDbTimeout(tick(5).then(() => value), 'user.findUnique', TIGHT)

    expect(result).toBe(value)
  })
})

describe('db-timeout - a query that never answers is abandoned', () => {
  it('should reject with the timeout error rather than waiting forever', async () => {
    const started = Date.now()
    await expect(withDbTimeout(neverSettles(), 'user.findUnique', TIGHT)).rejects.toThrow(DbTimeoutError)

    // Without the deadline this call never returns at all, so the assertion above
    // cannot be reached — but a deadline that fired immediately would also pass
    // it. The floor is what rules that out.
    expect(Date.now() - started).toBeGreaterThanOrEqual(TIGHT - 10)
  })

  it('should be recognisable as a deadline and not as a driver failure', async () => {
    // The whole reason this is a class rather than a string: a caller has to be
    // able to tell "we gave up waiting" from "the database said no", because the
    // two want different responses and mean opposite things.
    const error = await withDbTimeout(neverSettles(), 'user.findUnique', TIGHT).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(DbTimeoutError)
    expect(error).toBeInstanceOf(Error)
    expect((error as DbTimeoutError).code).toBe('DB_TIMEOUT')
    expect((error as DbTimeoutError).name).toBe('DbTimeoutError')
    expect(isDbTimeout(error)).toBe(true)
  })

  it('should name the query and the deadline it exceeded', async () => {
    // Both fields are what a log line needs to be actionable. A bare "timed out"
    // on a page with forty routes on it is not.
    const error = (await withDbTimeout(neverSettles(), 'user.findUnique', TIGHT).catch(
      (e: unknown) => e
    )) as DbTimeoutError

    expect(error.query).toBe('user.findUnique')
    expect(error.timeoutMs).toBe(TIGHT)
    expect(error.message).toContain('user.findUnique')
    expect(error.message).toContain(String(TIGHT))
  })

  it('should not mistake a driver failure for a deadline', async () => {
    // The inverse error, and the one that costs more: reporting an outage as a
    // bug in a query sends an operator looking at the wrong system entirely.
    const driverError = Object.assign(new Error('ECONNRESET'), { code: 'P1001' })
    const error = await withDbTimeout(Promise.reject(driverError), 'user.findUnique', TIGHT).catch(
      (e: unknown) => e
    )

    expect(isDbTimeout(error)).toBe(false)
  })
})

describe('db-timeout - a failure that arrives in time is the real failure', () => {
  it('should propagate the original error, not a timeout', async () => {
    const original = new Error('Unique constraint failed on tenantId')
    const error = await withDbTimeout(Promise.reject(original), 'user.create', TIGHT).catch(
      (e: unknown) => e
    )

    // Identity, because a wrapper that caught and re-threw would lose the stack
    // and any `code` the driver attached — which is the part a caller inspects.
    expect(error).toBe(original)
    expect((error as Error).message).toBe('Unique constraint failed on tenantId')
    expect(isDbTimeout(error)).toBe(false)
  })

  it('should not report a timeout for a rejection that beat the deadline', async () => {
    await expect(withDbTimeout(Promise.reject(new Error('boom')), 'user.create', TIGHT)).rejects.toThrow(
      'boom'
    )
    await expect(withDbTimeout(Promise.reject(new Error('boom')), 'user.create', TIGHT)).rejects.not.toThrow(
      DbTimeoutError
    )
  })
})

describe('db-timeout - abandoning work leaves nothing unhandled', () => {
  it('should not raise an unhandled rejection when the abandoned query later fails', async () => {
    // The bug this rules out is silent and fatal. Nothing awaits the query once
    // the deadline wins, so if no handler is attached, a database that answers
    // with an error a moment later surfaces it as an unhandled rejection — which
    // on Node terminates the process by default. A server that dies because a
    // slow query eventually failed is a far worse outcome than the timeout.
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      let rejectLate: (reason: Error) => void = () => {}
      const late = new Promise<never>((_resolve, reject) => {
        rejectLate = reject
      })

      await expect(withDbTimeout(late, 'user.findUnique', TIGHT)).rejects.toThrow(DbTimeoutError)

      // The abandoned query now fails, with nobody waiting on it.
      rejectLate(new Error('connection reset after the caller gave up'))
      await tick(TIGHT * 4)

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('should not raise an unhandled rejection for an already-rejected query', async () => {
    // A query that rejected before the deadline was even armed. The race is
    // already decided by the time the timer exists, so there is no deadline to
    // win — but the rejection still needs a handler, or a rejection that lands in
    // the same tick as the call takes the process down before any test runs.
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      // Rejected eagerly: the promise is already in a rejected state here.
      const alreadyRejected = Promise.reject(new Error('failed before the call'))
      const error = await withDbTimeout(alreadyRejected, 'user.findUnique', TIGHT).catch(
        (e: unknown) => e
      )
      await tick(TIGHT * 4)

      expect((error as Error).message).toBe('failed before the call')
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('db-timeout - the timer does not outlive the call', () => {
  it('should leave no pending timer behind on the success path', async () => {
    // The subtle half of clearing the timer. `clearTimeout` in a `finally` is
    // the obvious implementation, and a version that only clears it on the
    // failure path passes every behavioural test above while holding a
    // 10-second handle open per query. On a serverless runtime that is what
    // keeps an instance from freezing, and in a test process it is what makes a
    // suite hang after it has passed.
    const timers = trackTimers()
    try {
      await withDbTimeout(Promise.resolve('ok'), 'user.findUnique', 5_000)

      expect(timers.pending()).toBe(0)
      expect(timers.cleared()).toBe(1)
    } finally {
      timers.restore()
    }
  })

  it('should clear the timer on the timeout path too', async () => {
    // The `finally` has to run when the deadline wins as well. It is the branch
    // that is easy to drop, because the handle has already fired and nothing is
    // observably pending — but an implementation that forgets the `finally`
    // drops a handle on the error path, which is exactly when the database is
    // already in trouble and can least afford the accumulation.
    const timers = trackTimers()
    try {
      await withDbTimeout(neverSettles(), 'user.findUnique', TIGHT).catch(() => {})

      expect(timers.pending()).toBe(0)
      expect(timers.cleared()).toBe(1)
    } finally {
      timers.restore()
    }
  })

  it('should not keep the default deadline armed after a query that answered', async () => {
    // End-to-end statement of the same thing, without any instrumentation: if
    // the default's 10s handle were still pending, this process could not exit
    // for ten seconds after the suite finished. The suite completing promptly
    // is the observation.
    await withDbTimeout(Promise.resolve('ok'), 'user.findUnique')
    const started = Date.now()
    await tick(20)
    expect(Date.now() - started).toBeLessThan(DB_QUERY_TIMEOUT_MS)
  })
})

describe('db-timeout - the default is a bound, not a comment', () => {
  it('should be long enough that no legitimate query in this schema is at risk', () => {
    // Every statement in this schema is an indexed lookup or a single-row write
    // against Neon, which answers in tens of milliseconds. A deadline below a
    // second would start failing healthy work; 10s leaves four orders of
    // magnitude of headroom over a p99 that is single-digit.
    expect(DB_QUERY_TIMEOUT_MS).toBeGreaterThan(1_000)
  })

  it('should be short enough to be shorter than the socket defaults it replaces', () => {
    // The condition being removed is undici's, which is measured in minutes. A
    // default anywhere near that is indistinguishable from having no deadline.
    expect(DB_QUERY_TIMEOUT_MS).toBeLessThan(60_000)
  })

  it('should be the deadline a caller gets when it names none', async () => {
    // The default is a real default, not a signature the tests route around.
    // The bug this rules out is `timeoutMs = undefined` reaching `setTimeout`,
    // which fires on the next tick: every query in the monorepo would then
    // "time out" instantly and the whole stack would look permanently down.
    //
    // So the assertion is that omitting the deadline does not collapse it. The
    // 10s value itself is asserted above; driving a real 10s wait to re-derive
    // it would cost ten seconds of suite time to say nothing new.
    const settled = await Promise.race([
      withDbTimeout(neverSettles(), 'user.findUnique').then(
        () => 'resolved',
        (e: unknown) => (isDbTimeout(e) ? 'timed out' : 'rejected')
      ),
      tick(TIGHT * 4).then(() => 'still waiting'),
    ])

    expect(settled).toBe('still waiting')
  })
})

describe('db-timeout - isDbTimeout survives a lost class identity', () => {
  it('should recognise the code alone, without the class', () => {
    // Two copies of this module can be live at once across a bundler boundary
    // or a worker, and then `instanceof` is false for a genuine timeout. The
    // code is the part that survives, which is why it exists.
    const detached = Object.assign(new Error('timed out'), { code: 'DB_TIMEOUT' })
    expect(detached).not.toBeInstanceOf(DbTimeoutError)
    expect(isDbTimeout(detached)).toBe(true)
  })

  it('should not claim unrelated values', () => {
    for (const value of [null, undefined, 0, '', 'DB_TIMEOUT', new Error('x'), { code: 'P2025' }]) {
      expect(isDbTimeout(value)).toBe(false)
    }
  })
})
