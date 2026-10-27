import { describe, it, expect, beforeEach } from 'bun:test'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/search/route'
import { resetRateLimit } from '@/lib/rate-limit'

/**
 * Cover for `GET /api/search` anti-scraping rate limiting.
 *
 * The limiter is the real one (`apps/web/lib/rate-limit.ts`, in-memory
 * fallback — no Upstash in tests). With no trusted proxy hops configured,
   * every client resolves to the same identifier, so the bucket is shared
   * across calls in this file.
 */
beforeEach(() => {
  resetRateLimit()
})

function request(q: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/search?q=${encodeURIComponent(q)}`)
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
