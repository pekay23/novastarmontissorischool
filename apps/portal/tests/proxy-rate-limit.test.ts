import { describe, it, expect, beforeEach } from 'bun:test'

/**
 * The credential endpoints are rate limited.
 *
 * `withAuth` keeps its own `doesNotRequireAuth` list — `/api/auth`, `/api/health`,
 * `/_next` and the sign-in page — and answers those paths itself, returning
 * `NextResponse.next()` WITHOUT calling the handler it wraps. A limiter living
 * inside that handler therefore never ran for `/api/auth/*`, so `AUTH_RATE_LIMIT`
 * was dead code and `/api/auth/totp` and the passkey registration pair were
 * reachable at unlimited rate from any address — while the proxy's own header
 * comment claimed the limiter ran ahead of that short-circuit.
 *
 * These tests pin the fixed arrangement: the exported proxy limits before it hands
 * off to `withAuth`, so the short-circuit cannot skip the limiter.
 */

const ORIGIN = 'https://portal.example.test'
const SESSION_COOKIE = '__Secure-next-auth.session-token'
const AUTH_RATE_LIMIT = 20

process.env.NEXTAUTH_SECRET = 'proxy-rate-limit-test-secret-not-real'
process.env.NEXTAUTH_URL = ORIGIN

const { encode } = await import('next-auth/jwt')
const { resetRateLimit } = await import('@/lib/rate-limit')
const proxy = (await import('@/proxy')).default

const session = await encode({
  token: {
    sub: 'user-1',
    role: 'HEADMASTER',
    tenantId: 'tenant-1',
    schoolId: 'school-1',
    isActive: true,
  },
  secret: process.env.NEXTAUTH_SECRET!,
})

interface FakeUrl {
  pathname: string
  search: string
  href: string
  searchParams: URLSearchParams
  clone: () => FakeUrl
  toString: () => string
}

function fakeUrl(href: string): FakeUrl {
  const url = new URL(href)
  return {
    pathname: url.pathname,
    search: url.search,
    href: url.href,
    searchParams: url.searchParams,
    clone: () => fakeUrl(url.href),
    toString: () => url.href,
  }
}

function callProxy(path: string, ip: string) {
  const url = new URL(path, ORIGIN)
  const cookieJar: Record<string, string> = { [SESSION_COOKIE]: session }

  return proxy(
    {
      url: url.href,
      method: 'GET',
      cookies: {
        get: (name: string) => (cookieJar[name] ? { name, value: cookieJar[name] } : undefined),
        getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
        ...cookieJar,
      },
      headers: new Headers({ 'x-real-ip': ip }),
      nextUrl: fakeUrl(url.href),
    } as never,
    {} as never
  )
}

beforeEach(() => {
  resetRateLimit()
})

describe('the credential surface is actually rate limited', () => {
  it('answers /api/auth/totp with 429 once AUTH_RATE_LIMIT is passed', async () => {
    const ip = '198.51.100.77'

    // The budget itself is not throttled — otherwise this test could pass for the
    // wrong reason, by never reaching the limiter at all.
    for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
      const res = await callProxy('/api/auth/totp', ip)
      expect(res?.status).not.toBe(429)
    }

    const res = await callProxy('/api/auth/totp', ip)
    expect(res?.status).toBe(429)
    expect(res?.headers.get('retry-after')).toBeTruthy()
  })

  it('does not throttle the general API harder than the credential budget', async () => {
    // API_RATE_LIMIT is higher than AUTH_RATE_LIMIT, so crossing the auth budget
    // must not already have exhausted a general-API caller at the same address.
    const ip = '198.51.100.78'
    for (let i = 0; i < AUTH_RATE_LIMIT + 1; i++) {
      await callProxy('/api/auth/totp', ip)
    }
    const res = await callProxy('/api/students', ip)
    expect(res?.status).not.toBe(429)
  })

  it('counts per client address, so one throttled caller does not throttle another', async () => {
    const noisy = '198.51.100.79'
    for (let i = 0; i < AUTH_RATE_LIMIT + 1; i++) {
      await callProxy('/api/auth/totp', noisy)
    }
    expect((await callProxy('/api/auth/totp', noisy))?.status).toBe(429)

    const quiet = await callProxy('/api/auth/totp', '203.0.113.5')
    expect(quiet?.status).not.toBe(429)
  })
})
