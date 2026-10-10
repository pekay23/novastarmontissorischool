import { describe, it, expect, beforeEach } from 'bun:test'
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  csrfCookieOptions,
  evaluateCsrf,
  generateCsrfToken,
  readCsrfTokenFromCookieString,
  validateCsrfToken,
} from '@/lib/security/csrf'

/**
 * The enforcement decision itself: method + path + the two token sources in,
 * pass/fail out. `proxy.ts` only translates `allow: false` into a 403, so this is
 * the whole policy.
 */
describe('evaluateCsrf', () => {
  const token = 'a'.repeat(64)

  it('does not block GET', () => {
    const decision = evaluateCsrf({
      method: 'GET',
      pathname: '/api/students',
      cookieToken: token,
      headerToken: null,
    })
    expect(decision.allow).toBe(true)
  })

  it('does not block HEAD or OPTIONS', () => {
    for (const method of ['HEAD', 'OPTIONS']) {
      expect(
        evaluateCsrf({ method, pathname: '/api/students', cookieToken: null, headerToken: null }).allow
      ).toBe(true)
    }
  })

  it('blocks POST with no cookie', () => {
    const decision = evaluateCsrf({
      method: 'POST',
      pathname: '/api/students',
      cookieToken: null,
      headerToken: token,
    })
    expect(decision.allow).toBe(false)
    expect(decision.allow === false && decision.reason).toBe('missing-cookie')
  })

  it('blocks POST with a cookie but no header', () => {
    const decision = evaluateCsrf({
      method: 'POST',
      pathname: '/api/students',
      cookieToken: token,
      headerToken: null,
    })
    expect(decision.allow).toBe(false)
    expect(decision.allow === false && decision.reason).toBe('missing-header')
  })

  it('blocks POST with a mismatched token', () => {
    const other = 'b'.repeat(64)
    const decision = evaluateCsrf({
      method: 'POST',
      pathname: '/api/students',
      cookieToken: token,
      headerToken: other,
    })
    expect(decision.allow).toBe(false)
    expect(decision.allow === false && decision.reason).toBe('invalid-token')
  })

  it('allows POST with a matching token', () => {
    const decision = evaluateCsrf({
      method: 'POST',
      pathname: '/api/students',
      cookieToken: token,
      headerToken: token,
    })
    expect(decision.allow).toBe(true)
    expect(decision.allow && decision.reason).toBe('valid-token')
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks an unauthenticated %s', (method) => {
    expect(
      evaluateCsrf({ method, pathname: '/api/students/1', cookieToken: null, headerToken: null }).allow
    ).toBe(false)
  })

  it('exempts NextAuth routes so sign-in still works', () => {
    for (const pathname of ['/api/auth/signin', '/api/auth/callback/credentials', '/api/auth/session']) {
      const decision = evaluateCsrf({ method: 'POST', pathname, cookieToken: null, headerToken: null })
      expect(decision.allow).toBe(true)
      expect(decision.allow && decision.reason).toBe('exempt-path')
    }
  })

  it('does not exempt custom public auth routes under /api/auth', () => {
    for (const pathname of [
      '/api/auth/forgot-password',
      '/api/auth/reset-password',
      '/api/auth/verify-email',
      '/api/auth/verify-email/resend',
      '/api/auth/set-password',
      '/api/auth/invite',
    ]) {
      const decision = evaluateCsrf({ method: 'POST', pathname, cookieToken: null, headerToken: null })
      expect(decision.allow).toBe(false)
      expect(decision.allow === false && decision.reason).toBe('missing-cookie')
    }
  })

  it('does not exempt a path that merely starts with the same characters', () => {
    // `/api/authenticators` is not `/api/auth`; a loose prefix match would let a
    // real endpoint through unchecked.
    const decision = evaluateCsrf({
      method: 'POST',
      pathname: '/api/authenticators',
      cookieToken: null,
      headerToken: null,
    })
    expect(decision.allow).toBe(false)
  })

  it('leaves non-API writes alone', () => {
    const decision = evaluateCsrf({
      method: 'POST',
      pathname: '/some/form',
      cookieToken: null,
      headerToken: null,
    })
    expect(decision.allow).toBe(true)
    expect(decision.allow && decision.reason).toBe('not-api')
  })

  it('fails closed on an unexpected method rather than passing it', () => {
    const decision = evaluateCsrf({
      method: 'PROPFIND',
      pathname: '/api/students',
      cookieToken: null,
      headerToken: null,
    })
    expect(decision.allow).toBe(false)
  })

  it('accepts a lower-cased method, since HTTP methods are case-insensitive', () => {
    const decision = evaluateCsrf({
      method: 'post',
      pathname: '/api/students',
      cookieToken: token,
      headerToken: token,
    })
    expect(decision.allow).toBe(true)
  })
})

describe('generateCsrfToken / validateCsrfToken', () => {
  it('issues 32 bytes of randomness as 64 hex characters', () => {
    const token = generateCsrfToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('issues a different token each time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateCsrfToken()))
    expect(tokens.size).toBe(50)
  })

  it('accepts a token against itself', () => {
    const token = generateCsrfToken()
    expect(validateCsrfToken(token, token)).toBe(true)
  })

  it('rejects a different token', () => {
    const a = generateCsrfToken()
    const b = generateCsrfToken()
    expect(validateCsrfToken(a, b)).toBe(false)
  })

  it('rejects empty values', () => {
    expect(validateCsrfToken('', '')).toBe(false)
    expect(validateCsrfToken(generateCsrfToken(), '')).toBe(false)
    expect(validateCsrfToken('', generateCsrfToken())).toBe(false)
  })

  it('rejects two identical non-hex strings', () => {
    // The original implementation hex-decoded both sides and passed the buffers
    // to crypto.timingSafeEqual, which only throws on a LENGTH mismatch.
    // Buffer.from('not-hex', 'hex') is empty, so two empty buffers compared equal
    // and this returned true. As an enforcement gate that was a fail-open.
    expect(validateCsrfToken('not-hex', 'not-hex')).toBe(false)
    expect(validateCsrfToken('zzzz', 'zzzz')).toBe(false)
  })

  it('rejects a well-formed token of the wrong length', () => {
    expect(validateCsrfToken('ab', 'ab')).toBe(false)
  })

  it('rejects a truncated token against its own prefix', () => {
    const token = generateCsrfToken()
    expect(validateCsrfToken(token.slice(0, 63), token)).toBe(false)
  })
})

describe('readCsrfTokenFromCookieString', () => {
  it('reads the token out of a document.cookie-style string', () => {
    expect(readCsrfTokenFromCookieString(`theme=light; ${CSRF_COOKIE_NAME}=abc123; other=1`)).toBe('abc123')
  })

  it('reads the token when it is the only cookie', () => {
    expect(readCsrfTokenFromCookieString(`${CSRF_COOKIE_NAME}=abc123`)).toBe('abc123')
  })

  it('returns null when the cookie is absent or empty', () => {
    expect(readCsrfTokenFromCookieString('theme=light')).toBeNull()
    expect(readCsrfTokenFromCookieString(`${CSRF_COOKIE_NAME}=`)).toBeNull()
    expect(readCsrfTokenFromCookieString('')).toBeNull()
    expect(readCsrfTokenFromCookieString(null)).toBeNull()
    expect(readCsrfTokenFromCookieString(undefined)).toBeNull()
  })

  it('does not match a cookie whose name merely ends with the token name', () => {
    expect(readCsrfTokenFromCookieString(`x-${CSRF_COOKIE_NAME}=abc123`)).toBeNull()
  })
})

describe('csrfCookieOptions', () => {
  it('is readable by client JavaScript, which double-submit requires', () => {
    expect(csrfCookieOptions(false).httpOnly).toBe(false)
  })

  it('sets Secure only in production', () => {
    expect(csrfCookieOptions(false).secure).toBe(false)
    expect(csrfCookieOptions(true).secure).toBe(true)
  })

  it('scopes the cookie to the whole site with SameSite=Lax', () => {
    const options = csrfCookieOptions(true)
    expect(options.path).toBe('/')
    expect(options.sameSite).toBe('lax')
  })
})

describe('round trip', () => {
  it('accepts a freshly issued token echoed back exactly as the client would', () => {
    // The whole mechanism in one assertion: the proxy issues, the client reads
    // it from document.cookie and sends it as the header, the proxy compares.
    const issued = generateCsrfToken()
    const fromDocumentCookie = readCsrfTokenFromCookieString(
      `${CSRF_COOKIE_NAME}=${issued}; __Secure-next-auth.session-token=irrelevant`
    )
    const decision = evaluateCsrf({
      method: 'POST',
      pathname: '/api/students',
      cookieToken: issued,
      headerToken: fromDocumentCookie,
    })
    expect(decision.allow).toBe(true)
  })
})

describe('exported names', () => {
  it('keeps the header the client sends the same one the proxy reads', () => {
    expect(CSRF_HEADER_NAME.toLowerCase()).toBe('x-csrf-token')
    expect(new Headers({ [CSRF_HEADER_NAME]: 'x' }).get(CSRF_HEADER_NAME)).toBe('x')
  })
})

// ---------------------------------------------------------------------------
// The proxy wiring: that the decision above is actually what answers the request
// ---------------------------------------------------------------------------

// `withAuth` reads both off the environment: no secret, and the `__Secure-` cookie
// name that an https `NEXTAUTH_URL` selects. Module scope, because the proxy can
// only be imported once the secret is in place.
process.env.NEXTAUTH_SECRET = 'csrf-proxy-test-secret-not-real'
process.env.NEXTAUTH_URL = 'https://portal.example.test'

const ORIGIN = 'https://portal.example.test'
const SESSION_COOKIE = '__Secure-next-auth.session-token'

const { encode } = await import('next-auth/jwt')
const { resetRateLimit } = await import('@/lib/rate-limit')
const proxy = (await import('@/proxy')).default

// A HEADMASTER session, because the write below has to get past role
// authorisation to prove the CSRF verdict is what answered it.
const session = await encode({
  token: { id: 'user-1', role: 'HEADMASTER', schoolId: 'school-1' },
  secret: process.env.NEXTAUTH_SECRET!,
  maxAge: 8 * 60 * 60,
})

describe('proxy enforces the decision', () => {
  beforeEach(() => {
    resetRateLimit()
  })

  function callProxyUrl(href: string) {
    const url = new URL(href)
    return {
      basePath: '',
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      href: url.href,
      searchParams: url.searchParams,
      clone: () => callProxyUrl(url.href),
      toString: () => url.href,
    }
  }

  function callProxy(
    path: string,
    { method = 'GET', csrfCookie, csrfHeader }: { method?: string; csrfCookie?: string; csrfHeader?: string } = {}
  ) {
    const url = new URL(path, ORIGIN)
    const cookieJar: Record<string, string> = { [SESSION_COOKIE]: session }
    if (csrfCookie) cookieJar[CSRF_COOKIE_NAME] = csrfCookie

    const headers = new Headers({ 'x-real-ip': '198.51.100.30' })
    if (csrfHeader) headers.set(CSRF_HEADER_NAME, csrfHeader)

    return proxy(
      {
        url: url.href,
        method,
        cookies: {
          get: (name: string) => (cookieJar[name] ? { name, value: cookieJar[name] } : undefined),
          getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
          ...cookieJar,
        },
        headers,
        nextUrl: callProxyUrl(url.href),
      } as never,
      {} as never
    )
  }

  it('answers an unauthenticated-API write with 403, not a redirect', async () => {
    const res = await callProxy('/api/students', { method: 'POST' })

    expect(res?.status).toBe(403)
    expect(res?.headers.get('location')).toBeNull()
    expect(await res?.json()).toMatchObject({ error: 'Invalid CSRF token' })
  })

  it('answers a write carrying a cookie but no header with 403', async () => {
    const token = generateCsrfToken()
    const res = await callProxy('/api/students', { method: 'POST', csrfCookie: token })

    expect(res?.status).toBe(403)
  })

  it('issues a readable token cookie on a safe request', async () => {
    const res = await callProxy('/dashboard')
    const setCookie = res?.headers.get('set-cookie') ?? ''

    expect(res?.status).toBe(200)
    // Double-submit is impossible unless the browser can read it.
    expect(setCookie).toContain(`${CSRF_COOKIE_NAME}=`)
    expect(setCookie).not.toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=lax')
    expect(setCookie).toContain('Path=/')
  })

  it('accepts a write once the issued token is echoed back in the header', async () => {
    // The whole mechanism, end to end: issuance on a GET, then the client's
    // read-and-echo on the POST.
    const issued = /csrf-token=([0-9a-f]{64})/.exec(
      (await callProxy('/dashboard'))?.headers.get('set-cookie') ?? ''
    )?.[1]
    expect(issued).toBeTruthy()

    const res = await callProxy('/api/students', {
      method: 'POST',
      csrfCookie: issued!,
      csrfHeader: issued!,
    })

    expect(res?.status).toBe(200)
  })

  it('does not reissue a token the request already carries', async () => {
    const token = generateCsrfToken()
    const res = await callProxy('/dashboard', { csrfCookie: token })

    expect(res?.headers.get('set-cookie')).toBeNull()
  })

  it('still lets sign-in alone, which is exempt and never reaches the proxy body', async () => {
    // `withAuth` short-circuits the auth path before the handler runs at all, so
    // this asserts the exemption twice over: by policy and by construction.
    expect(await callProxy('/api/auth/session', { method: 'POST' })).toBeUndefined()
  })

  it('still rate limits a write, and does so before the CSRF verdict', async () => {
    resetRateLimit()
    const statuses: number[] = []
    for (let i = 0; i < 102; i++) {
      const res = await callProxy('/api/students', { method: 'POST' })
      statuses.push(res?.status ?? 0)
    }

    // 100/min for a general API path: 100 rejections, then the limiter answers.
    expect(statuses.slice(0, 100)).toEqual(Array(100).fill(403))
    expect(statuses.slice(100)).toEqual([429, 429])
  })
})