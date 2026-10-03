/**
 * A deadline for a single database round trip.
 *
 * Nothing above this layer bounds a query. `@prisma/adapter-neon` takes only
 * `{ schema?, onPoolError?, onConnectionError? }` — there is no timeout option —
 * so a query is otherwise bounded by undici's socket defaults, which are measured
 * in minutes. A database that accepts the connection and then stops answering
 * holds the request for all of it, and a request nobody finishes is a request
 * nobody monitors either.
 *
 * That matters most on the session path, which runs a lookup on every request
 * and is also the lookup that fails during the outage the error log exists to
 * record: an unbounded hang there means the error never surfaces at all.
 *
 * Ten seconds. Long enough that no legitimate query in this schema comes near
 * it — every statement here is an indexed lookup or a single-row write against
 * Neon, which answers in tens of milliseconds and whose own p99 for a hot row is
 * still single-digit milliseconds — and short enough that a caller is still
 * holding a request nobody is watching only briefly, rather than until a
 * platform-level socket timeout. Anything longer is indistinguishable from no
 * timeout at all, which is the condition this exists to remove.
 */
export const DB_QUERY_TIMEOUT_MS = 10_000

/**
 * A query that was abandoned by the caller, not refused by the database.
 *
 * A dedicated class rather than a string on a generic error, so a caller can
 * tell "we gave up waiting" from "the database said no". The two mean opposite
 * things: a timeout is a symptom of an outage or of a slow query and usually
 * wants a 503 and a retry, while a driver error is a statement about the
 * statement itself. Conflated, an outage is reported as a bug in the query.
 *
 * The `code` is a duplicate of the class identity for the callers that only
 * have an `unknown` in hand — a caught error crossing a `throw` boundary, or one
 * that has been serialised into a log line.
 */
export class DbTimeoutError extends Error {
  /** Stable identifier, for callers holding an `unknown`. */
  readonly code = 'DB_TIMEOUT'

  /** What was being waited on, e.g. `user.findUnique`. */
  readonly query: string

  /** The deadline that was exceeded, in milliseconds. */
  readonly timeoutMs: number

  constructor(query: string, timeoutMs: number) {
    super(`Database query timed out after ${timeoutMs}ms: ${query}`)
    this.name = 'DbTimeoutError'
    this.query = query
    this.timeoutMs = timeoutMs
  }
}

/**
 * Await `work` under a hard deadline, abandoning it if the deadline wins.
 *
 * Losing the race rejects with `DbTimeoutError`, so the abandoned work is
 * reported rather than silently dropped — the caller has to decide whether a
 * query it stopped waiting for is a 500 or a 503.
 *
 * The abandoned work keeps running, so it must not be able to take the process
 * down when it eventually fails. It cannot: `Promise.race` subscribes to every
 * promise it is given, so the abandoned query already has a rejection handler
 * attached by the time the deadline wins, and its late failure is delivered to
 * that handler and discarded. No extra `catch` is attached here for that, and
 * adding one would be a line that does nothing — the two unhandled-rejection
 * tests in `tests/db-timeout.test.ts` were insensitive to its removal, which is
 * how it was established that the race is what is doing the work.
 *
 * The timer is always cleared, including on the paths where `work` wins: an
 * uncleared 10-second timer is an open handle that keeps the process alive and,
 * on a serverless runtime, delays the instance from freezing.
 *
 * `work` is `PromiseLike` rather than `Promise` because Prisma returns a
 * `PrismaPromise` from a query — a thenable that has not started executing yet.
 * Awaiting it is what starts it, so a caller that hands one over has its query
 * run exactly as it would have without the deadline.
 */
export async function withDbTimeout<T>(
  work: PromiseLike<T>,
  query: string,
  timeoutMs: number = DB_QUERY_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DbTimeoutError(query, timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Whether an error is a deadline this module imposed.
 *
 * `instanceof` alone is not enough across a bundler boundary or a worker, where
 * two copies of this module can both be live, so the `code` is checked too.
 */
export function isDbTimeout(error: unknown): error is DbTimeoutError {
  return (
    error instanceof DbTimeoutError ||
    (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'DB_TIMEOUT')
  )
}
