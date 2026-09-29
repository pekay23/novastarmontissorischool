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
  // Don't keep the process alive waiting for the sweep timer.
  sweepTimer.unref?.()
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
 * Number of trusted proxy hops. When set to a non-negative integer, the last
 * N entries of `x-forwarded-for` are considered proxy-appended and ignored.
 * The trusted client IP is the entry at index `hops.length - 1 - N`.
 *
 * Defaults to 1 (one trusted edge proxy, e.g. Vercel/CDN). Set to 0 if the
 * app receives requests directly (no proxy in front), in which case both
 * `x-forwarded-for` and `x-real-ip` are treated as untrusted and the
 * identifier collapses to 'unknown'.
 */
const TRUSTED_PROXY_HOPS = Math.max(0, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10) || 0)

/**
 * Extract a client identifier from the request.
 *
 * Security model:
 * - When TRUSTED_PROXY_HOPS > 0, the app is behind a trusted proxy that sets
 *   `x-real-ip` and/or appends to `x-forwarded-for`. We use the hop at index
 *   `hops.length - 1 - TRUSTED_PROXY_HOPS`, which is the client IP the proxy
 *   observed.
 * - When TRUSTED_PROXY_HOPS === 0 (direct exposure), both XFF and x-real-ip
 *   are client-settable and must be treated as untrusted. The identifier
 *   collapses to 'unknown' — a shared bucket — rather than silently trusting
 *   an attacker-controlled value.
 */
export function clientIdentifier(request: Request): string {
  if (TRUSTED_PROXY_HOPS === 0) {
    return 'unknown'
  }

  // Prefer x-real-ip: set by the trusted edge (Vercel, nginx real_ip module),
  // not by the client. This is the most reliable signal.
  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  // Fall back to XFF: only trust it when there are more hops than the trusted
  // proxy count. The client IP is the entry at index
  // `hops.length - 1 - TRUSTED_PROXY_HOPS`.
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',').map(s => s.trim()).filter(Boolean)
    if (hops.length > TRUSTED_PROXY_HOPS) {
      return hops[hops.length - 1 - TRUSTED_PROXY_HOPS]!
    }
  }

  return 'unknown'
}
