import { describe, it, expect, beforeEach } from 'bun:test'
import { NextRequest } from 'next/server'

// Keep this route test on the local limiter. Bun loads developer `.env*` files
// automatically, and shared Upstash state cannot be reset by unit tests.
process.env.UPSTASH_REDIS_REST_URL = ''
process.env.UPSTASH_REDIS_REST_TOKEN = ''

const [{ GET }, { resetRateLimit }] = await Promise.all([
  import('@/app/api/search/route'),
  import('@/lib/rate-limit'),
])

/**
 * Cover for `GET /api/search` anti-scraping rate limiting.
 *
 * The limiter is the real one (`apps/web/lib/rate-limit.ts`). Each test gets
 * a distinct client identifier so shared Redis state cannot leak across runs.
 */
let testClientIp = ''

beforeEach(() => {
  resetRateLimit()
  // Give each test its own bucket. CI environments can provide a shared Redis
  // limiter, which resetRateLimit() cannot clear; a unique client key keeps
  // this integration test independent of earlier runs and other workers.
  process.env.TRUSTED_PROXY_HOPS = '1'
  testClientIp = crypto.randomUUID()
})

function request(q: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/search?q=${encodeURIComponent(q)}`, {
    headers: { 'x-real-ip': testClientIp },
  })
}

describe('GET /api/search rate limiting', () => {
  it('answers 200 for search results within the budget', async () => {
    for (let i = 0; i < 30; i++) {
      const res = await GET(request('academics'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.query).toBe('academics')
      expect(Array.isArray(body.results)).toBe(true)
    }
  })

  it('answers 429 with retry-after once the per-minute budget is exceeded', async () => {
    for (let i = 0; i < 30; i++) {
      expect((await GET(request('academics'))).status).toBe(200)
    }

    const res = await GET(request('academics'))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/)
  })

  it('still answers 200 with an empty result set for an empty query', async () => {
    const res = await GET(request(''))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      results: [],
      query: '',
      terms: [],
      total: 0,
    })
  })
})
