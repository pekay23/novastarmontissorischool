import { describe, expect, it } from 'bun:test'
import { csrfCookieOptions } from '@/lib/security/csrf'
import { sectionContentSecurityPolicy } from '@/lib/security/csp'

describe('section CSP transport', () => {
  it.each(['http://localhost:3100', 'http://127.0.0.1:3100', 'http://[::1]:3100'])(
    'keeps local HTTP assets usable at %s', origin => {
      const policy = sectionContentSecurityPolicy('/portal', 'test-nonce', new URL(origin))
      expect(csrfCookieOptions(true, new URL(origin)).secure).toBe(false)
      expect(policy).not.toContain('upgrade-insecure-requests')
      expect(policy).toContain("'nonce-test-nonce'")
      expect(policy).toContain("'strict-dynamic'")
    },
  )
  it.each(['https://school.example', 'http://school.example', 'https://localhost:3100'])(
    'preserves transport hardening at %s', origin => {
      expect(csrfCookieOptions(true, new URL(origin)).secure).toBe(true)
      expect(sectionContentSecurityPolicy('/admin', 'test-nonce', new URL(origin)))
        .toContain('upgrade-insecure-requests')
    },
  )
})
