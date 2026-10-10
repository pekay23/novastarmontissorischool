/**
 * The short-lived cookie that carries the school code across an OAuth round trip.
 *
 * Signing in with Google or Microsoft sends the browser to that provider and
 * back, and nothing in the provider's callback says which school the visitor was
 * trying to reach — the school code only ever existed in the login form.
 * `User.tenantId` is non-nullable and email uniqueness is `@@unique([tenantId,
 * email])`, so the same address can legitimately exist in two schools, and a
 * resolution that did not know which school was meant would be a cross-tenant
 * read. This cookie is how that answer survives the round trip.
 *
 * A cookie rather than anything the provider echoes back, deliberately: the
 * school code is a tenant selector, not a secret, and the visitor can type it
 * themselves, so there is nothing here an attacker could not already supply. It
 * carries no authority on its own — `resolveSsoAccount` still has to find a
 * pre-created account at that school whose address the provider verified.
 *
 * `SameSite=Lax` is required, not decorative. The provider returns by a
 * top-level GET redirect, and a `Strict` cookie is withheld from exactly that
 * navigation, so every sign-in would come back with "no school code".
 *
 * Client-safe: no server-only imports, so the sign-in page can write the cookie
 * and the server callback can read it from the same definition.
 */

/** The cookie name, shared by the writer on the login page and the reader in `signIn`. */
export const SSO_SCHOOL_CODE_COOKIE = 'novastar_sso_school'

/**
 * How long the school code stays available to the callback, in seconds.
 *
 * Ten minutes is long enough to walk through a provider's consent screen and a
 * two-factor prompt, and short enough that a browser left open on a shared
 * machine does not still be holding yesterday's school selection.
 */
export const SSO_SCHOOL_CODE_MAX_AGE_SECONDS = 600

/**
 * The longest string accepted as a school code.
 *
 * `resolveSchool` matches either a `School.id` or a `School.code`. Nothing longer
 * than this is either, so the bound is what keeps an arbitrary query parameter
 * from becoming an unbounded database probe.
 */
export const SCHOOL_CODE_MAX_LENGTH = 100

/**
 * A school code in the form the lookup accepts, or `null`.
 *
 * Trims, then refuses anything carrying a control character or over the length
 * bound. A refusal here and a refusal from the lookup produce the same outcome,
 * so this is a cheaper place to reject a string that could never name a school.
 */
export function normalizeSchoolCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.length > SCHOOL_CODE_MAX_LENGTH) return null
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null

  return trimmed
}

/**
 * Decode and normalise a school code as it arrives from the cookie.
 *
 * A malformed percent-encoding is a refusal rather than a `decodeURIComponent`
 * throw: this is read inside the `signIn` callback, and an exception there
 * becomes an opaque `?error=` the visitor cannot act on.
 */
export function schoolCodeFromCookie(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw === '') return null

  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }

  return normalizeSchoolCode(decoded)
}

/**
 * Record the school code so the OAuth callback can read it after the redirect.
 *
 * Called from the sign-in page immediately before handing over to the provider.
 * A code that does not survive `normalizeSchoolCode` writes nothing, which leaves
 * the callback to report the refusal rather than sending an unusable value
 * through a redirect to a third party.
 */
export function rememberSchoolCodeForSso(code: string): void {
  if (typeof document === 'undefined') return

  const value = normalizeSchoolCode(code)
  if (!value) return

  // `Secure` only on https, so local development over plain http still carries
  // the cookie instead of the browser dropping it and every sign-in failing.
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''

  document.cookie =
    `${SSO_SCHOOL_CODE_COOKIE}=${encodeURIComponent(value)}; Path=/; ` +
    `Max-Age=${SSO_SCHOOL_CODE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
}