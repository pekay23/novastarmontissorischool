import { expect, it } from 'bun:test'
import { CSRF_HEADER_NAME } from '@/lib/security/csrf'

it('adds CSRF to the effective RequestInit headers for admin mutations', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let capturedHeaders = new Headers()
  const testWindow = {
    location: { href: 'https://school.example/admin/tenants/', origin: 'https://school.example' },
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers)
      return new Response(null)
    },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: `csrf-token=${'a'.repeat(64)}` } })
  try {
    await import('@/lib/security/csrf-client')
    const input = new Request('https://school.example/admin/api/tenants/', { method: 'POST' })
    await testWindow.fetch(input, { headers: { 'content-type': 'application/json' } })
    expect(capturedHeaders.get(CSRF_HEADER_NAME)).toBe('a'.repeat(64))
    expect(capturedHeaders.get('content-type')).toBe('application/json')
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
