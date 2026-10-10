import { Providers } from './providers'

/**
 * The portal section layout, and the only mount point for the
 * client providers.
 *
 * `Providers` carries three things the portal cannot work without,
 * and it has to wrap the whole subtree — the authenticated
 * `(portal)` pages and the `(auth)` recovery pages alike, because
 * the sign-in page is where a session starts:
 *
 * - `SessionProvider` with `basePath="/portal/api/auth"`. In
 *   next-auth v4 the client helpers (`signIn`, `getProviders`,
 *   `getCsrfToken`, session polling) resolve their base path from
 *   the mounted provider's `basePath` prop and fall back to
 *   `/api/auth` when no provider is mounted. The NextAuth
 *   catch-all lives at `app/portal/api/auth/[...nextauth]`, so
 *   without this mount the sign-in form POSTs to
 *   `/api/auth/callback/credentials` and reads
 *   `/api/auth/providers` — both 404 — and nobody can sign in.
 * - The CSRF double-submit installer (`lib/security/csrf-client.ts`),
 *   which attaches the token to same-origin API writes. The proxy
 *   refuses mutating requests that lack the header, so every portal
 *   write — attendance, grades, enrolment — fails without it.
 * - `next-themes`' `ThemeProvider`.
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <Providers>{children}</Providers>
}
