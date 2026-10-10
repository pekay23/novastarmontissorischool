import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'

const handler = NextAuth(authOptions)

const CREDENTIALS_ATTEMPTS = 5
const CREDENTIALS_WINDOW_MS = 15 * 60 * 1000

/**
 * The message `authorize()` throws for a suspended tenant, in all three of its
 * credential paths (`lib/auth.ts`). NextAuth carries a thrown message to the
 * client as the `error` query parameter, and that parameter is the whole of how
 * this route recognises its own refusal — see `suspensionRefusal`.
 *
 * The literal is repeated at the three throw sites rather than imported from
 * `lib/auth.ts`, because `tests/tenant-suspension.test.ts` proves the suspension
 * gate by rewriting `lib/auth.ts` to remove those exact statements; a constant
 * would stop matching and leave that proof green while removing nothing.
 * `tests/tenant-suspension-login-status.test.ts` asserts the two agree.
 */
const TENANT_SUSPENDED_REFUSAL = 'Tenant has been suspended'

/**
 * The code the rest of the app already uses for this refusal, so a caller reads
 * one vocabulary: `TenantSuspendedError.name` in `lib/tenant.ts`,
 * `TENANT_SUSPENDED_CODE` in the platform console, and the 403 body of
 * `api/auth/passkey/login-verify`.
 */
const TENANT_SUSPENDED_CODE = 'tenant-suspended'

/**
 * Brute-force protection for the credentials callback.
 *
 * Only sign-in attempts are limited — session, CSRF and other auth routes stay
 * unthrottled so a rate-limited client can still sign out or re-authenticate.
 */
function isCredentialsSignIn(request: Request): boolean {
  // Mounted under /portal in the merged app, so the browser's sign-in
  // POST arrives as /portal/api/auth/callback/credentials. The unprefixed
  // spelling is kept for the direct calls the unit tests make against
  // this handler. Comparing the unprefixed path only meant the credentials
  // rate limit never fired in the merged app.
  return new URL(request.url).pathname.endsWith('/api/auth/callback/credentials')
}

/**
 * Where NextAuth put the failure, if it failed at all.
 *
 * Two shapes, both from `next/utils.js` `toResponse`: a plain form post gets a
 * 302 with a `Location`, and the `json=true` client `next-auth/react` uses gets
 * the same URL in a JSON body with the status preserved. The clone matters — the
 * original response's body is read by whoever returns it, and this only ever
 * peeks.
 */
async function refusalTarget(response: Response): Promise<string | null> {
  const location = response.headers.get('Location')
  if (location) return location

  const contentType = response.headers.get('Content-Type')
  if (!contentType?.includes('application/json')) return null

  try {
    const body = (await response.clone().json()) as { url?: unknown }
    return typeof body.url === 'string' ? body.url : null
  } catch {
    return null
  }
}

/**
 * The 403 a suspended tenant is owed, or `null` for every other outcome.
 *
 * NextAuth v4 cannot be asked for this status from the credentials flow, and the
 * limitation is in its response plumbing rather than in `authorize()`:
 *
 * - `core/routes/callback.js` catches whatever `authorize()` throws and returns a
 *   fixed `status: 401`. A status of its own is not something a thrown error can
 *   carry, and the one branch that does set 403 (`callbacks.signIn` returning
 *   `false`) is reached only after `authorize()` has already returned a user —
 *   which for a suspended tenant would mean returning one.
 * - `next/utils.js` `toResponse` then computes `status = res.redirect ? 302 : ...`,
 *   so the library's own 403 is downgraded to a 302 for a plain form post and
 *   survives only on the `json=true` path.
 *
 * So the refusal is re-expressed here, where the status is this route's to set.
 * `authorize()` is untouched: it still throws, so a suspended tenant is still
 * refused, and every other credential failure — a wrong password above all —
 * passes through byte for byte rather than being re-labelled.
 *
 * The body keeps the `{ url }` shape `next-auth/react` parses, because that
 * client reads `new URL(data.url)` unconditionally and would throw on any other
 * body; only the `error` code is restated in the app's own vocabulary.
 */
async function suspensionRefusal(response: Response, requestUrl: string): Promise<Response | null> {
  const target = await refusalTarget(response)
  if (target === null) return null

  let url: URL
  try {
    url = new URL(target, requestUrl)
  } catch {
    return null
  }

  if (url.searchParams.get('error') !== TENANT_SUSPENDED_REFUSAL) return null

  url.searchParams.set('error', TENANT_SUSPENDED_CODE)
  return new Response(JSON.stringify({ url: url.toString() }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function GET(request: Request, context: { params: Promise<{ nextauth: string[] }> }) {
  return handler(request, context)
}

export async function POST(request: Request, context: { params: Promise<{ nextauth: string[] }> }) {
  if (isCredentialsSignIn(request)) {
    const result = checkRateLimit(
      clientIdentifier(request),
      CREDENTIALS_ATTEMPTS,
      CREDENTIALS_WINDOW_MS
    )

    if (!result.success) {
      const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
      return new Response(
        JSON.stringify({ error: 'Too many sign-in attempts. Please try again later.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(CREDENTIALS_ATTEMPTS),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
          },
        }
      )
    }
  }

  const response = await handler(request, context)
  return (await suspensionRefusal(response, request.url)) ?? response
}
