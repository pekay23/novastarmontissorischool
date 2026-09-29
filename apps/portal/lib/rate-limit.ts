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

const store = new Map<string, number[]>()

function hits(identifier: string, windowMs: number, now: number): number[] {
  const cutoff = now - windowMs
  const recent = (store.get(identifier) ?? []).filter((t) => t > cutoff)
  if (recent.length === 0) {
    store.delete(identifier)
  } else {
    store.set(identifier, recent)
  }
  return recent
}

export function checkRateLimit(
  identifier: string,
  max: number,
  windowMs: number
): RateLimitResult {
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
  store.set(identifier, recent)

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

export function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip')
  return ip || 'unknown'
}

export function resetRateLimit(): void {
  store.clear()
}
