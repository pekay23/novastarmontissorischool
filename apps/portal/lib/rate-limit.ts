/**
 * In-memory sliding-window rate limiter.
 *
 * NOTE: this store is per-process, so limits are not shared across instances.
 * In production, replace the Map with a shared store such as Redis or Upstash
 * so the limit is enforced globally.
 */

export interface RateLimitResult {
  success: boolean
  remaining: number
  /** Epoch milliseconds at which the window frees up a slot. */
  reset: number
}

interface StoreEntry {
  timestamps: number[]
}

const store = new Map<string, StoreEntry>()
const MAX_STORE_SIZE = 10000

/** Periodically prune entries whose hits have all expired. */
let sweepScheduled = false
function scheduleSweep(windowMs: number): void {
  if (sweepScheduled) return
  sweepScheduled = true
  setTimeout(() => {
    sweepScheduled = false
    const cutoff = Date.now() - windowMs
    for (const [key, entry] of store) {
      if (entry.timestamps.every(t => t < cutoff)) {
        store.delete(key)
      }
    }
    if (store.size > MAX_STORE_SIZE) {
      // Evict oldest entries to bound memory
      const sorted = [...store.entries()].sort((a, b) => a[1].timestamps[0] - b[1].timestamps[0])
      for (let i = 0; i < Math.floor(MAX_STORE_SIZE * 0.2); i++) {
        store.delete(sorted[i]?.[0])
      }
    }
  }, windowMs + 1000)
}

function hits(identifier: string, windowMs: number, now: number): number[] {
  const cutoff = now - windowMs
  const existing = store.get(identifier)
  const recent = existing ? existing.timestamps.filter((t) => t > cutoff) : []
  if (recent.length === 0) {
    store.delete(identifier)
  } else {
    store.set(identifier, { timestamps: recent })
  }
  return recent
}

export function checkRateLimit(
  identifier: string,
  max: number,
  windowMs: number
): RateLimitResult {
  scheduleSweep(windowMs)
  const now = Date.now()
  const recent = hits(identifier, windowMs, now)

  if (recent.length >= max) {
    return {
      success: false,
      remaining: 0,
      reset: recent[0] + windowMs,
    }
  }

  recent.push(now)
  store.set(identifier, { timestamps: recent })

  return {
    success: true,
    remaining: max - recent.length,
    reset: now + windowMs,
  }
}

/** Build a checker bound to a fixed window size and attempt budget. */
export function rateLimit(options: { windowMs: number; max: number }) {
  const { windowMs, max } = options
  return (identifier: string): RateLimitResult =>
    checkRateLimit(identifier, max, windowMs)
}

/** Clear the rate-limit store. Intended for tests only. */
export function resetRateLimit(): void {
  store.clear()
  sweepScheduled = false
}

/**
 * Extract a client identifier from the request.
 *
 * In a reverse-proxy deployment the proxy appends the real client IP to the
 * END of x-forwarded-for, so we read the last hop (not the first, which is
 * client-controlled and trivially spoofable). When x-forwarded-for is absent
 * or has a single element, fall back to x-real-ip (also set by trusted
 * proxies). If neither header is present the identifier collapses to
 * 'unknown', which intentionally shares a single bucket rather than silently
 * disabling the limit.
 */
export function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',').map(s => s.trim()).filter(Boolean)
    if (hops.length > 1) {
      // Multiple hops: last is the original client (appended by the trusted proxy)
      return hops[hops.length - 1]!
    }
    if (hops.length === 1) {
      return hops[0]!
    }
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }
  return 'unknown'
}
