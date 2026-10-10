import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { checkRateLimit, rateLimit, clientIdentifier, resetRateLimit } from '@/lib/rate-limit'

describe('Rate Limiter', () => {
  beforeEach(() => {
    resetRateLimit()
  })

  afterEach(() => {
    resetRateLimit()
  })

  describe('checkRateLimit - basic behavior', () => {
    it('should allow requests under the limit', () => {
      const result = checkRateLimit('192.168.1.1', 5, 60000)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(4)
      expect(result.reset).toBeGreaterThan(Date.now())
    })

    it('should return correct remaining count', () => {
      const max = 5
      const windowMs = 60000
      for (let i = 0; i < max; i++) {
        const result = checkRateLimit('user1', max, windowMs)
        expect(result.success).toBe(true)
        expect(result.remaining).toBe(max - i - 1)
      }
    })

    it('should block after exceeding the limit', () => {
      const max = 3
      const windowMs = 60000

      for (let i = 0; i < max; i++) {
        const result = checkRateLimit('10.0.0.1', max, windowMs)
        expect(result.success).toBe(true)
      }

      const blocked = checkRateLimit('10.0.0.1', max, windowMs)
      expect(blocked.success).toBe(false)
      expect(blocked.remaining).toBe(0)
    })

    it('should return reset time after being blocked', () => {
      const max = 2
      const windowMs = 60000

      checkRateLimit('10.0.0.2', max, windowMs)
      checkRateLimit('10.0.0.2', max, windowMs)
      const blocked = checkRateLimit('10.0.0.2', max, windowMs)

      expect(blocked.success).toBe(false)
      expect(blocked.reset).toBeGreaterThan(Date.now())
      // Reset should be approximately windowMs in the future
      expect(blocked.reset - Date.now()).toBeLessThanOrEqual(windowMs)
    })
  })

  describe('checkRateLimit - isolation between identifiers', () => {
    it('should track different identifiers independently', () => {
      const max = 3
      const windowMs = 60000

      for (let i = 0; i < max; i++) {
        expect(checkRateLimit('client-a', max, windowMs).success).toBe(true)
      }
      expect(checkRateLimit('client-a', max, windowMs).success).toBe(false)

      // client-b should be unaffected
      expect(checkRateLimit('client-b', max, windowMs).success).toBe(true)
    })
  })

  describe('checkRateLimit - sliding window', () => {
    it('should expire hits after the window passes', () => {
      const max = 2
      const windowMs = 100

      checkRateLimit('slider', max, windowMs)
      checkRateLimit('slider', max, windowMs)
      expect(checkRateLimit('slider', max, windowMs).success).toBe(false)

      // Wait for the window to pass
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(checkRateLimit('slider', max, windowMs).success).toBe(true)
          resolve()
        }, 150)
      })
    })
  })

  describe('checkRateLimit - per-entry windowMs sweep correctness', () => {
    it('should not wipe a long-window limiter when a short-window sweep fires', () => {
      const shortWindow = 100
      const longWindow = 60000
      const max = 2

      // Arm a short-window sweep
      checkRateLimit('short', max, shortWindow)
      checkRateLimit('short', max, shortWindow)

      // Now hit a long-window limiter
      checkRateLimit('long', max, longWindow)
      checkRateLimit('long', max, longWindow)
      // Third hit should be blocked
      expect(checkRateLimit('long', max, longWindow).success).toBe(false)

      // Wait past the short window so the sweep fires
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // The long-window counter must still be blocked (sweep shouldn't erase it)
          expect(checkRateLimit('long', max, longWindow).success).toBe(false)
          resolve()
        }, 200)
      })
    })
  })

  describe('clientIdentifier', () => {
    it('should prefer x-real-ip when present (trusted proxy)', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '203.0.113.5, 70.41.3.18, 150.172.238.178',
          'x-real-ip': '198.51.100.42',
        },
      })
      expect(clientIdentifier(request)).toBe('198.51.100.42')
    })

    it('should use hop at index (length-1-TRUSTED_PROXY_HOPS) for multi-hop XFF', () => {
      // Default TRUSTED_PROXY_HOPS=1: client is at index hops.length-2
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.5, 70.41.3.18, 150.172.238.178' },
      })
      // 3 hops, hop at index 1 = '70.41.3.18' (client, not the nearest proxy)
      expect(clientIdentifier(request)).toBe('70.41.3.18')
    })

    it('should discard single-hop x-forwarded-for as untrusted (need > 1 hop for 1 trusted proxy)', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.5' },
      })
      expect(clientIdentifier(request)).toBe('unknown')
    })

    it('should fall back to x-real-ip when x-forwarded-for has insufficient hops', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '203.0.113.5',
          'x-real-ip': '198.51.100.42',
        },
      })
      expect(clientIdentifier(request)).toBe('198.51.100.42')
    })

    it('should return unknown when no IP headers present', () => {
      const request = new Request('http://localhost')
      expect(clientIdentifier(request)).toBe('unknown')
    })

    it('should trim whitespace and ignore empty hops in multi-hop x-forwarded-for', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '  203.0.113.5  , 70.41.3.18,  , 150.172.238.178' },
      })
      // 3 real hops after filtering: [203.0.113.5, 70.41.3.18, 150.172.238.178]
      // hop at index 1 = 70.41.3.18
      expect(clientIdentifier(request)).toBe('70.41.3.18')
    })

    it('should use two-hop x-forwarded-for with 1 trusted proxy', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.5, 70.41.3.18' },
      })
      // 2 hops > 1 trusted proxy, client at index 0
      expect(clientIdentifier(request)).toBe('203.0.113.5')
    })

    it('should return unknown when only the trusted proxy hop is present', () => {
      // Only 1 hop = just the proxy, no client visible
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '70.41.3.18' },
      })
      // hop not > TRUSTED_PROXY_HOPS (1), so fall through
      expect(clientIdentifier(request)).toBe('unknown')
    })
  })

  describe('rateLimit - bound checker', () => {
    it('should create a checker with fixed options', () => {
      const check = rateLimit({ windowMs: 60000, max: 5 })
      const result = check('bound-client')
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(4)
    })

    it('should block when limit is reached', () => {
      const check = rateLimit({ windowMs: 60000, max: 2 })
      expect(check('bound-client-2').success).toBe(true)
      expect(check('bound-client-2').success).toBe(true)
      expect(check('bound-client-2').success).toBe(false)
    })
  })
})
