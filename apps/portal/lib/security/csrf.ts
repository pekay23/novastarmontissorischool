import 'server-only'
import crypto from 'crypto'

/**
 * CSRF token generation and validation.
 *
 * Adopted from Aerojet Academy's `lib/security/csrf.ts`.
 * Tokens are cryptographically random and compared with timing-safe equal.
 */

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function validateCsrfToken(token: string, storedToken: string): boolean {
  if (!token || !storedToken) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(storedToken, 'hex'))
  } catch {
    return false
  }
}
