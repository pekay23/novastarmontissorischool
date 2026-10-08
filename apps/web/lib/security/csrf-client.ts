/**
 * Client half of the CSRF double-submit pair.
 *
 * The portal has no shared API client: ~48 mutating `fetch` calls are spread
 * across 25 `'use client'` files under `app/(portal)/`, `app/(auth)/`,
 * `app/login/` and `components/`. Editing each one to add a header is exactly
 * the kind of change that silently misses a call site and leaves an endpoint
 * unwriteable, so instead of a wrapper nobody adopted, this patches
 * `window.fetch` once at the client root.
 *
 * Every one of those call sites is a client component, and none of them fetch
 * from the server, so a single install covers all of them. The patch is
 * deliberately narrow: same-origin `/api/*` writes only, minus `/api/auth/*`
 * (sign-in has no token to present) and minus anything that already carries the
 * header. Reads, external hosts and `/_next` asset loads pass straight through.
 *
 * Wire it by importing this module once from the client root (app/providers.tsx).
 */

import {
  CSRF_HEADER_NAME,
  evaluateCsrf,
  readCsrfTokenFromCookieString,
} from '@/lib/security/csrf'

/**
 * The patched function keeps `typeof fetch` intact — including `preconnect`, which
 * Next's runtime types require — and adds one marker property so a second
 * install after hot reload is a no-op.
 */
type CsrfPatchedFetch = typeof fetch & { csrfTokenPatched?: true }

/**
 * Returns the arguments `fetch` should actually be called with, header added
 * where required and otherwise untouched (including the caller's own `init`
 * object, which is copied rather than mutated).
 */
function withCsrfToken(
  input: RequestInfo | URL,
  init?: RequestInit
): [input: RequestInfo | URL, init: RequestInit | undefined] {
  const isRequest = typeof Request !== 'undefined' && input instanceof Request
  const rawUrl = typeof input === 'string' ? input : isRequest ? input.url : input.toString()
  const method = (init?.method ?? (isRequest ? input.method : 'GET')).toUpperCase()

  let url: URL
  try {
    url = new URL(rawUrl, window.location.href)
  } catch {
    return [input, init]
  }

  if (url.origin !== window.location.origin) return [input, init]

  // The cookie value is deliberately used as BOTH the cookie and the header input
  // to `evaluateCsrf`: the server compares those two for equality, so feeding it
  // the same value asks exactly the question the server will ask. A missing or
  // malformed cookie comes back denying, and attaching a header that could not
  // pass anyway would only be noise.
  const token = readCsrfTokenFromCookieString(document.cookie)
  if (!token) return [input, init]
  const decision = evaluateCsrf({ method, pathname: url.pathname, cookieToken: token, headerToken: token })
  if (!decision.allow || decision.reason !== 'valid-token') return [input, init]

  if (isRequest) {
    if (input.headers.has(CSRF_HEADER_NAME)) return [input, init]
    const headers = new Headers(input.headers)
    headers.set(CSRF_HEADER_NAME, token)
    return [new Request(input, { headers }), init]
  }

  const headers = new Headers(init?.headers)
  if (headers.has(CSRF_HEADER_NAME)) return [input, init]
  headers.set(CSRF_HEADER_NAME, token)
  return [input, { ...init, headers }]
}

let installed = false

/**
 * Replace `window.fetch` with a wrapper that attaches the CSRF token.
 *
 * Idempotent, and safe to run on the server: the `typeof window` guard means the
 * module-scope call below is a no-op during SSR. The `csrfTokenPatched` marker
 * on the function is what makes a second install a no-op after hot reload, where
 * this module is re-evaluated but `window.fetch` already carries the old patch.
 */
export function installCsrfTokenFetcher(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return

  const currentFetch = window.fetch as CsrfPatchedFetch
  if (currentFetch.csrfTokenPatched) {
    installed = true
    return
  }

  const originalFetch = window.fetch.bind(window)
  const patchedFetch = ((input, init) =>
    originalFetch(...withCsrfToken(input, init))) as CsrfPatchedFetch
  patchedFetch.csrfTokenPatched = true

  window.fetch = patchedFetch
  installed = true
}

installCsrfTokenFetcher()