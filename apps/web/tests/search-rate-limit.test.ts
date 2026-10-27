import { describe, it, expect } from 'bun:test'
import { NextRequest } from 'next/server'

// Keep this route test on the local limiter. Bun loads developer `.env*` files
// automatically, and shared Upstash state cannot be reset by unit tests.
process.env.UPSTASH_REDIS_REST_URL = ''
process.env.UPSTASH_REDIS_REST_TOKEN = ''
process.env.DATABASE_URL = ''

const { GET } = await import('@/app/api/search/route')

/**
 * Cover for `GET /api/search` anti-scraping rate limiting.
 *
 * The limiter is the real one (`apps/web/lib/rate-limit.ts`). Each test gets
 * a distinct client identifier so shared Redis state cannot leak across runs.
 */
// Each test owns its bucket so concurrent tests and shared Redis state cannot
// interfere. The route reads the trusted-hop setting on every request.
process.env.TRUSTED_PROXY_HOPS = '1'

function request(q: string, clientIp: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/search?q=${encodeURIComponent(q)}`, {
    headers: { 'x-real-ip': clientIp },
  })
}

describe('GET /api/search rate limiting', () => {
  it('answers 200 for search results within the budget', async () => {
    const clientIp = crypto.randomUUID()
    for (let i = 0; i < 30; i++) {
      const res = await GET(request('academics', clientIp))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.query).toBe('academics')
      expect(Array.isArray(body.results)).toBe(true)
    }
  })

  it('answers 429 with retry-after once the per-minute budget is exceeded', async () => {
    const clientIp = crypto.randomUUID()
    for (let i = 0; i < 30; i++) {
      expect((await GET(request('academics', clientIp))).status).toBe(200)
    }

    const res = await GET(request('academics', clientIp))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/)
  })

  it('still answers 200 with an empty result set for an empty query', async () => {
    const res = await GET(request('', crypto.randomUUID()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      results: [],
      query: '',
      terms: [],
      total: 0,
    })
  })
})
