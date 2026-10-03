import { http, HttpResponse } from 'msw'
import { studentFixtures } from '../fixtures/students'
import { invoiceFixtures } from '../fixtures/invoices'

const AUTH_BASE = '/api/auth'

export const authHandlers = [
  // NextAuth CSRF token
  http.get(`${AUTH_BASE}/csrf`, () => {
    return HttpResponse.json({ csrfToken: 'test-csrf-token' })
  }),

  // NextAuth session
  http.get(`${AUTH_BASE}/session`, ({ request }) => {
    const url = new URL(request.url)
    const callbackUrl = url.searchParams.get('callbackUrl')
    return HttpResponse.json({
      user: null,
      expires: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    })
  }),

  // NextAuth providers
  http.get(`${AUTH_BASE}/providers`, () => {
    return HttpResponse.json({
      credentials: {
        id: 'credentials',
        name: 'credentials',
        type: 'credentials',
        signinUrl: `${AUTH_BASE}/signin/credentials`,
        callbackUrl: `${AUTH_BASE}/callback/credentials`,
      },
    })
  }),

  // Credentials sign-in (POST /api/auth/callback/credentials)
  http.post(`${AUTH_BASE}/callback/credentials`, async ({ request }) => {
    const formData = await request.formData()
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const schoolCode = formData.get('schoolCode') as string | null

    // Mock successful login for test credentials
    if (email === 'test@example.com' && password === 'password123') {
      return HttpResponse.json({
        user: {
          id: 'test_user_1',
          email: 'test@example.com',
          name: 'Test User',
          role: 'HEADMASTER',
          schoolId: 'test_school_1',
          schoolName: 'Test School',
          tenantId: 'test_tenant_1',
          mustChangePassword: false,
        },
        expires: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      })
    }

    // Invalid credentials
    return HttpResponse.json(
      { error: 'Invalid email or password' },
      { status: 401 }
    )
  }),

  // Sign out
  http.post(`${AUTH_BASE}/signout`, () => {
    return HttpResponse.json({ url: '/login' })
  }),

  // 2FA endpoints
  http.post(`${AUTH_BASE}/totp`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    if (body.totpCode === '123456') {
      return HttpResponse.json({ success: true })
    }
    return HttpResponse.json({ error: 'Invalid 2FA code' }, { status: 401 })
  }),

  // Passkey endpoints (minimal stubs)
  http.post(`${AUTH_BASE}/passkey/register-options`, () => {
    return HttpResponse.json({ challenge: 'test-challenge', rp: { name: 'Test' } })
  }),
  http.post(`${AUTH_BASE}/passkey/register-verify`, () => {
    return HttpResponse.json({ success: true })
  }),
  http.post(`${AUTH_BASE}/passkey/login-options`, () => {
    return HttpResponse.json({ challenge: 'test-challenge' })
  }),
  http.post(`${AUTH_BASE}/passkey/login-verify`, () => {
    return HttpResponse.json({ success: true })
  }),

  // Unknown auth routes return 404-shaped body
  http.all(`${AUTH_BASE}/*`, () => {
    return HttpResponse.json(
      { error: 'Not found', code: 'AUTH_ROUTE_NOT_FOUND' },
      { status: 404 }
    )
  }),
]