import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { NextRequest } from 'next/server'
import proxy from '@/proxy'
import { resetRateLimit } from '@/lib/rate-limit'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/lib/security/csrf'

const origin = 'https://portal.example.test'
const token = 'a'.repeat(64)
const originalHops = process.env.TRUSTED_PROXY_HOPS

beforeEach(() => {
  resetRateLimit()
  process.env.TRUSTED_PROXY_HOPS = '1'
})

afterEach(() => {
  resetRateLimit()
  if (originalHops === undefined) delete process.env.TRUSTED_PROXY_HOPS
  else process.env.TRUSTED_PROXY_HOPS = originalHops
})

function request(path: string, method = 'GET', withToken = false) {
  const headers = new Headers({ 'x-real-ip': '203.0.113.4' })
  if (withToken) {
    headers.set('cookie', `${CSRF_COOKIE_NAME}=${token}`)
    headers.set(CSRF_HEADER_NAME, token)
  }
  return new NextRequest(`${origin}${path}`, { method, headers })
}

describe('proxy security boundaries', () => {
  it('issues a CSRF cookie on the unauthenticated portal login page', async () => {
    const response = await proxy(request('/portal/login/'), {} as never)
    expect(response.cookies.get(CSRF_COOKIE_NAME)?.value).toMatch(/^[0-9a-f]{64}$/)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it.each(['/portal/forgot-password/', '/portal/reset-password/', '/portal/verify-email/', '/portal/set-password/'])(
    'allows the recovery page %s without a session', async (path) => {
      const response = await proxy(request(path), {} as never)
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('x-middleware-next')).toBe('1')
    },
  )

  it('lets an unauthenticated operator submit the real login endpoint with a CSRF token', async () => {
    const response = await proxy(request('/admin/api/auth/login/', 'POST', true), {} as never)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('protects custom public auth APIs before withAuth can skip them', async () => {
    const response = await proxy(request('/portal/api/auth/forgot-password/', 'POST'), {} as never)
    expect(response.status).toBe(403)
  })

  it('leaves native credential form CSRF validation to NextAuth', async () => {
    const response = await proxy(request('/portal/api/auth/callback/credentials/', 'POST'), {} as never)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('does not treat an auth-prefix lookalike as a public API', async () => {
    const response = await proxy(request('/admin/api/auth/login-extra/', 'POST', true), {} as never)
    expect(response.headers.get('location')).toContain('/admin/login')
  })

  it('does not spend the authentication budget on page navigation', async () => {
    for (let i = 0; i < 25; i++) await proxy(request('/portal/login/'), {} as never)
    const response = await proxy(request('/portal/api/auth/session/'), {} as never)
    expect(response.status).not.toBe(429)
  })
})
