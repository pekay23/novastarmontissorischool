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
  windowMs: number
}

const store = new Map<string, StoreEntry>()
const MAX_STORE_SIZE = 10000

let sweepTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Periodically prune entries whose hits have all expired, using each entry's
 * own windowMs rather than a process-wide one. Also enforces a soft ceiling
 * on total memory usage.
 */
function scheduleSweep(windowMs: number): void {
  if (sweepTimer !== null) return // already armed
  sweepTimer = setTimeout(() => {
    sweepTimer = null
    const now = Date.now()
    for (const [key, entry] of store) {
      if (entry.timestamps.every(t => t < now - entry.windowMs)) {
        store.delete(key)
      }
    }
    // Evict oldest entries if over the soft cap
    if (store.size > MAX_STORE_SIZE) {
      const sorted = [...store.entries()].sort((a, b) => a[1].timestamps[0] - b[1].timestamps[0])
      const evictCount = Math.floor(MAX_STORE_SIZE * 0.2)
      for (let i = 0; i < evictCount; i++) {
        store.delete(sorted[i]?.[0])
      }
    }
  }, windowMs + 1000)
  // Allow the process to exit without waiting for the timer in Node.js
  if (typeof (sweepTimer as unknown) === 'object' && 'unref' in (sweepTimer as unknown as { unref?: unknown })) {
    (sweepTimer as unknown as { unref: () => void }).unref()
  }
}

function hits(identifier: string, windowMs: number, now: number): number[] {
  const cutoff = now - windowMs
  const existing = store.get(identifier)
  const recent = existing ? existing.timestamps.filter((t) => t > cutoff) : []
  if (recent.length === 0) {
    store.delete(identifier)
  } else {
    store.set(identifier, { timestamps: recent, windowMs })
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
  store.set(identifier, { timestamps: recent, windowMs })

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

/** Clear the rate-limit store and cancel any pending sweep. Intended for tests only. */
export function resetRateLimit(): void {
  store.clear()
  if (sweepTimer !== null) {
    clearTimeout(sweepTimer)
    sweepTimer = null
  }
}

/**
 * Extract a client identifier from the request.
 *
 * Security model:
 * - `x-real-ip` is set by the trusted reverse proxy / platform (e.g. Vercel)
 *   and is the most reliable source of the actual client IP. We prefer it.
 * - `x-forwarded-for` is only consulted for multi-hop chains where the trusted
 *   proxy appends the real client IP. With a single hop the header is entirely
 *   client-controlled, so we discard it and fall through.
 * - If no trusted header is present, we collapse to 'unknown' (a shared bucket)
 *   rather than silently disabling the limit.
 *
 * Deployment note: in a multi-proxy chain where each proxy prepends the peer
 * it observed, the convention is client-first and the trusted hop count must
 * be configured. This function assumes a single trusted edge that appends.
 * For multi-hop setups, set TRUSTED_PROXY_HOPS to index from the right.
 */
export function clientIdentifier(request: Request): string {
  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',').map(s => s.trim()).filter(Boolean)
    // Only trust multi-hop chains where the proxy appended the client IP
    // to the end. A single hop is client-controlled and untrusted.
    if (hops.length > 1) {
      return hops[hops.length - 1]!
    }
  }

  return 'unknown'
}
