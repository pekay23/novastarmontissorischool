/**
 * The path to land on after a `signIn('credentials', { redirect: false })`.
 *
 * next-auth answers with an absolute URL built from `NEXTAUTH_URL` — one
 * fixed, configured origin. A device that reached the sign-in page by
 * another name — a LAN IP, a custom domain — would be sent to that
 * configured host instead, where the page does not exist for it. Keep
 * the path and search of the answer and navigate relative, so sign-in
 * always completes on the domain the page was loaded from, whatever
 * that domain is.
 *
 * The base matters only for a relative `url`, which next-auth does not
 * return but a caller could pass; resolving it against the current page
 * keeps the same-domain guarantee in that case too.
 */
export function signInLandingPath(url: string | undefined, fallback: string): string {
  if (!url) return fallback
  try {
    const parsed = new URL(url, window.location.href)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}
