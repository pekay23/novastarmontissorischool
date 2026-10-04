/**
 * CSRF token generation, validation, and the double-submit enforcement decision.
 *
 * Adopted from Aerojet Academy's `lib/security/csrf.ts`.
 *
 * Deliberately runtime-agnostic. This module is imported by `proxy.ts`, which
 * Next.js may run on the Edge runtime, and by the browser helper that attaches
 * the token to same-origin API calls. The previous `import 'server-only'` plus
 * `node:crypto` made the second of those impossible to build and the first
 * runtime-dependent, so both are gone: randomness comes from Web Crypto and the
 * comparison is hand-rolled. Nothing here is secret — the token lives in a
 * JS-readable cookie by definition of the pattern — so `server-only` was never
 * protecting anything.
 *
 * The pattern is double-submit. The proxy writes a random token into a
 * non-HttpOnly cookie and requires the identical value back in the
 * `X-CSRF-Token` request header. A cross-site attacker can make the browser send
 * the cookie but cannot read it, so it cannot produce the header.
 *
 * Known limit of the unsigned variant: a sibling subdomain that can write a
 * `csrf-token` cookie for a shared parent domain can win a cookie race, because
 * the token carries no signature. Signing the pair (HMAC over the token with a
 * server secret) closes that; it is not implemented here.
 */

/** Cookie the proxy issues and the browser reads back. Deliberately readable by JS. */
export const CSRF_COOKIE_NAME = 'csrf-token'

/** Request header the client must echo the cookie value in. */
export const CSRF_HEADER_NAME = 'X-CSRF-Token'

const TOKEN_BYTES = 32
const HEX_TOKEN_LENGTH = TOKEN_BYTES * 2
const HEX_TOKEN_PATTERN = /^[0-9a-f]+$/i

/**
 * Paths whose writes are exempt from the double-submit check.
 *
 * NextAuth's own handlers and the portal's credential routes (TOTP, passkeys,
 * SSO, password reset/verification) run before a session exists and have their
 * own per-route protections. Demanding a header there would break sign-in, which
 * is the one flow that cannot present one.
 */
export const CSRF_EXEMPT_PATH_PREFIXES = ['/api/auth']

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface CsrfCookieOptions {
  httpOnly: false
  sameSite: 'lax'
  secure: boolean
  path: '/'
}

/**
 * Cookie attributes for the issued token.
 *
 * `httpOnly: false` is load-bearing: double-submit only works if the client can
 * read the value to echo it. `sameSite: 'lax'` keeps the cookie off cross-site
 * requests while still riding along on the portal's own navigation.
 */
export function csrfCookieOptions(isProduction: boolean): CsrfCookieOptions {
  return { httpOnly: false, sameSite: 'lax', secure: isProduction, path: '/' }
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** 32 bytes of Web Crypto randomness, hex-encoded. */
export function generateCsrfToken(): string {
  return randomHex(TOKEN_BYTES)
}

function isHexToken(token: string): boolean {
  return token.length === HEX_TOKEN_LENGTH && HEX_TOKEN_PATTERN.test(token)
}

/**
 * Length-independent, early-exit-free string comparison.
 *
 * The loop runs to the longer of the two lengths and accumulates differences
 * into a single value, so elapsed time does not depend on where the first
 * mismatch is. `charCodeAt` yields NaN past the end; `|| 0` folds that into the
 * comparison without short-circuiting.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/**
 * Compare a presented token against the stored one.
 *
 * The format guard is not cosmetic. The original implementation hex-decoded both
 * sides and handed the buffers to `crypto.timingSafeEqual`, which throws only on
 * a *length* mismatch — and `Buffer.from('not-hex', 'hex')` decodes to an empty
 * buffer. So any two non-hex strings compared equal: `validateCsrfToken('nope',
 * 'also-nope')` returned true. Rejecting malformed tokens first removes that.
 */
export function validateCsrfToken(token: string, storedToken: string): boolean {
  if (!token || !storedToken) return false
  if (!isHexToken(token) || !isHexToken(storedToken)) return false
  return constantTimeEqual(token, storedToken)
}

/**
 * Pull the CSRF token out of a `Cookie:` header or a `document.cookie` string.
 *
 * Both are `name=value; name=value` shaped, so the browser and the proxy share
 * one parser and the client never has to duplicate cookie handling.
 */
export function readCsrfTokenFromCookieString(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== CSRF_COOKIE_NAME) continue
    const value = part.slice(separator + 1).trim()
    return value.length > 0 ? value : null
  }
  return null
}

export interface CsrfCheckInput {
  method: string
  pathname: string
  cookieToken: string | null | undefined
  headerToken: string | null | undefined
}

export type CsrfDenialReason = 'missing-cookie' | 'missing-header' | 'invalid-token'

export type CsrfDecision =
  | { allow: true; reason: 'safe-method' | 'not-api' | 'exempt-path' | 'valid-token' }
  | { allow: false; reason: CsrfDenialReason }

/**
 * The whole enforcement decision, as a pure function of method + path + the two
 * token sources. `proxy.ts` does nothing but turn this into a 403 or a
 * `NextResponse.next()`, which is what makes the policy testable without a
 * NextRequest.
 *
 * Anything that is not GET/HEAD/OPTIONS is treated as mutating, so an unexpected
 * verb fails closed rather than sailing past the check.
 */
export function evaluateCsrf({ method, pathname, cookieToken, headerToken }: CsrfCheckInput): CsrfDecision {
  if (SAFE_METHODS.has(method.toUpperCase())) return { allow: true, reason: 'safe-method' }
  if (!pathname.startsWith('/api/')) return { allow: true, reason: 'not-api' }

  const exempt = CSRF_EXEMPT_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
  if (exempt) return { allow: true, reason: 'exempt-path' }

  if (!cookieToken) return { allow: false, reason: 'missing-cookie' }
  if (!headerToken) return { allow: false, reason: 'missing-header' }
  if (!validateCsrfToken(headerToken, cookieToken)) return { allow: false, reason: 'invalid-token' }

  return { allow: true, reason: 'valid-token' }
}