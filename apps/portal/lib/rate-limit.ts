/**
 * Rate limiting module — Redis-backed (Upstash) with in-memory fallback.
 *
 * Adopted from Aerojet Academy's `lib/security/rate-limit.ts`,
 * adapted for Novastar's existing in-memory implementation.
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// ---------------------------------------------------------------------------
// Redis-backed rate limiter (production) with in-memory fallback (dev/CI)
// ---------------------------------------------------------------------------

const hasRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)

const redis = hasRedis
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null

// Pre-configured limiters for common auth operations
const AUTH_LIMITS = {
  login: { limit: 5, windowMs: 5 * 60 * 1000 },
  register: { limit: 3, windowMs: 60 * 60 * 1000 },
  forgotPassword: { limit: 3, windowMs: 60 * 60 * 1000 },
  resetPassword: { limit: 5, windowMs: 60 * 60 * 1000 },
  api: { limit: 100, windowMs: 60 * 1000 },
}

type AuthLimitKey = keyof typeof AUTH_LIMITS

// ---------------------------------------------------------------------------
// In-memory fallback (existing Novastar implementation)
// ---------------------------------------------------------------------------

interface RateLimitResult {
  success: boolean
  remaining: number
  reset: number
}

interface StoreEntry {
  timestamps: number[]
  windowMs: number
}

const inMemoryMap = new Map<string, StoreEntry>()
const MAX_MAP_SIZE = 10000

let sweepTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSweep(windowMs: number): void {
  if (sweepTimer !== null) return
  sweepTimer = setTimeout(() => {
    sweepTimer = null
    const now = Date.now()
    for (const [key, entry] of inMemoryMap) {
      if (entry.timestamps.every((t) => t < now - entry.windowMs)) {
        inMemoryMap.delete(key)
      }
    }
    if (inMemoryMap.size > MAX_MAP_SIZE) {
      const entries = [...inMemoryMap.entries()].sort((a, b) => a[1].timestamps[0] - b[1].timestamps[0])
      const evictCount = Math.floor(MAX_MAP_SIZE * 0.2)
      for (let i = 0; i < evictCount; i++) {
        inMemoryMap.delete(entries[i]?.[0])
      }
    }
  }, windowMs + 1000)
  sweepTimer.unref?.()
}

function inMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  scheduleSweep(windowMs)
  const now = Date.now()
  const cutoff = now - windowMs
  const existing = inMemoryMap.get(key)
  const recent = existing ? existing.timestamps.filter((t) => t > cutoff) : []

  if (recent.length === 0) {
    inMemoryMap.delete(key)
  } else {
    inMemoryMap.set(key, { timestamps: recent, windowMs })
  }

  if (recent.length >= limit) {
    return { success: false, remaining: 0, reset: recent[0] + windowMs }
  }

  recent.push(now)
  inMemoryMap.set(key, { timestamps: recent, windowMs })

  return { success: true, remaining: limit - recent.length, reset: now + windowMs }
}

// ---------------------------------------------------------------------------
// Upstash limiter cache
// ---------------------------------------------------------------------------

const limiterCache = new Map<string, Ratelimit>()

function getUpstashLimiter(limit: number, windowMs: number): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`
  let limiter = limiterCache.get(cacheKey)
  if (!limiter) {
    const windowSeconds = Math.ceil(windowMs / 1000)
    const windowStr = `${windowSeconds} s` as `${number} s`
    limiter = new Ratelimit({
      redis: redis!,
      limiter: Ratelimit.slidingWindow(limit, windowStr),
      prefix: 'novastar:rl',
    })
    limiterCache.set(cacheKey, limiter)
  }
  return limiter
}

// ---------------------------------------------------------------------------
// Public API (replaces Novastar's old checkRateLimit/rateLimit)
// ---------------------------------------------------------------------------

export async function rateLimitAsync(
  key: string,
  limit: number = 10,
  windowMs: number = 60000
): Promise<RateLimitResult> {
  if (!redis) {
    return inMemoryRateLimit(key, limit, windowMs)
  }

  const limiter = getUpstashLimiter(limit, windowMs)
  const result = await limiter.limit(key)
  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  }
}

/** Synchronous rate-limit check (uses in-memory map). */
export function checkRateLimit(
  identifier: string,
  max: number,
  windowMs: number
): RateLimitResult {
  return inMemoryRateLimit(identifier, max, windowMs)
}

export function rateLimit(options: { windowMs: number; max: number }) {
  const { windowMs, max } = options
  return (identifier: string): RateLimitResult => checkRateLimit(identifier, max, windowMs)
}

/** Pre-configured auth rate limits. */
export function rateLimitAuth(action: AuthLimitKey) {
  const config = AUTH_LIMITS[action]
  return inMemoryRateLimit(`auth:${action}`, config.limit, config.windowMs)
}

export function rateLimitByIP(ip: string, limit: number = 20, windowMs: number = 60000) {
  return inMemoryRateLimit(`ip:${ip}`, limit, windowMs)
}

export function rateLimitByUser(userId: string, limit: number = 30, windowMs: number = 60000) {
  return inMemoryRateLimit(`user:${userId}`, limit, windowMs)
}

export async function rateLimitByUserAsync(userId: string, limit: number = 30, windowMs: number = 60000) {
  return rateLimitAsync(`user:${userId}`, limit, windowMs)
}

export async function rateLimitByIPAsync(ip: string, limit: number = 20, windowMs: number = 60000) {
  return rateLimitAsync(`ip:${ip}`, limit, windowMs)
}

// ---------------------------------------------------------------------------
// IP extraction (preserved from Novastar)
// ---------------------------------------------------------------------------

const TRUSTED_PROXY_HOPS = Math.max(0, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10) || 0)

export function clientIdentifier(request: Request): string {
  // When the app is not behind a trusted proxy, the client can set
  // x-real-ip and x-forwarded-for arbitrarily, so trusting them would let an
  // attacker rotate IPs to bypass per-address rate limits. Refuse all
  // proxy-derived identity in that configuration and fall back to 'unknown'.
  if (TRUSTED_PROXY_HOPS === 0) {
    return 'unknown'
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',').map((s) => s.trim()).filter(Boolean)
    if (hops.length > TRUSTED_PROXY_HOPS) {
      return hops[hops.length - 1 - TRUSTED_PROXY_HOPS]!
    }
  }

  return 'unknown'
}

export function getRateLimitInfo(key: string): { count: number; reset: number } | null {
  const entry = inMemoryMap.get(key)
  if (!entry) return null
  const now = Date.now()
  const resetTime = entry.timestamps[0] + entry.windowMs
  if (now > resetTime) {
    inMemoryMap.delete(key)
    return null
  }
  return { count: entry.timestamps.length, reset: resetTime }
}

export function clearRateLimit(key: string): void {
  inMemoryMap.delete(key)
}

/** Clear the rate-limit store and cancel any pending sweep. Intended for tests only. */
export function resetRateLimit(): void {
  inMemoryMap.clear()
  if (sweepTimer !== null) {
    clearTimeout(sweepTimer)
    sweepTimer = null
  }
}
