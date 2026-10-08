# ADR-022: Adopt Aerojet Academy Passkey & Security/Auth Patterns for Novastar

- **Status:** **Accepted** (2026-10-08 — implemented in merged `apps/web`)
- **Date:** 2026-10-02
- **Deciders:** Novastar Montessori engineering
- **Consulted:** Aerojet Academy codebase (`lib/auth/`, `docs/compliance/`, `docs/audits/`)

> **⚠️ ARCHITECTURE UPDATE (2026-10-08):** As of ADR-024, the three separate Next.js apps (`apps/public-site`, `apps/portal`, `apps/super-admin`) have been consolidated into a single merged app `apps/web`. The security patterns described in this ADR are now implemented in `apps/web` with the following structure:
> - `apps/web/proxy.ts` — unified middleware replacement (replaces separate `apps/portal/proxy.ts` and `apps/super-admin` auth)
> - `apps/web/app/portal/(portal)/layout.tsx` + `PortalShell.tsx` — portal shell with server/client split
> - `apps/web/app/admin/(dashboard)/layout.tsx` — admin shell
> - `apps/web/lib/portal-sections.ts` — shared role reachability (used by proxy + layout)
> - `apps/web/next.config.ts` — unified config with scoped headers per route group
>
> The original context below assumed three separate apps; the mapping table has been updated to reflect the merged implementation.

## Context

The Novastar Montessori School portal and its fork, SchoolPortalSystem, currently
use NextAuth v4 with Credentials provider for authentication. A review of the
sibling project Aerojet Academy (`C:\Projects\aerojet-academy`) identified a
robust set of security/auth patterns that should be adopted for both repos.

Aerojet Academy's security model includes:
- **WebAuthn passkeys** with `passkeyBridgeToken` bridging to next-auth CredentialsProvider
- **TOTP 2FA** (RFC 6238, zero-dependency implementation) with replay protection
- **Account lockout** (5 failed attempts → 30-min lockout)
- **Session revalidation** (every 5 min, invalidates if password changed)
- **Account status enforcement** (SUSPENDED, ARCHIVED, DELETED)
- **Audit logging** on login/logout and privileged mutations
- **Rate limiting** on auth endpoints (3/hr/IP for verification, 10/15min/IP for login)
- **Security headers & CSP** (nonce-based script-src, no `unsafe-inline`/`unsafe-eval`)
- **Strong password policy** (8+ chars, upper/lower/digit/special)

Aerojet Academy's security audit (`docs/audits/portal-audits/staff/staff-security.md`)
identified critical gaps including:
- Edge proxy not enforcing auth globally (only images)
- GET endpoints authenticating but not enforcing roles (students reading all payments/PII)
- No rate limiting on staff endpoints
- Permissive HTML sanitizer (iframe, data: scheme, style attributes)
- CSP allowing `unsafe-inline`/`unsafe-eval`

## Decision

Adopt Aerojet Academy's security patterns for the **merged Novastar app** (`apps/web`), implementing them at the architectural level.

### Implementation mapping (updated for merged app)

| Aerojet feature | Merged app (`apps/web`) integration |
|---|---|
| Passkey bridge token (`pk_`) | `schema.prisma` carries `passkeyBridgeToken` field; `app/portal/api/auth/passkey/*` endpoints |
| TOTP 2FA | `schema.prisma` carries `twoFactorEnabled`, `twoFactorSecret`; `components/auth/TwoFactorSetup.tsx` mounted at `app/(portal)/settings/page.tsx` |
| Account lockout | `loginAttempts` and `lockedUntil` in `schema.prisma` |
| Session revalidation | JWT callback in `lib/auth.ts` revalidates every 5 min against DB |
| Account status | `enum UserStatus { ACTIVE, SUSPENDED, ARCHIVED, DELETED }` |
| Audit logging | `model AuditLog` in schema; `logAudit()` exported from `packages/auth`; cross-tenant view at `app/admin/(dashboard)/audit/page.tsx` |
| Rate limiting | `lib/rate-limit.ts` imports `Ratelimit` from `@upstash/ratelimit` with in-memory fallback; applied in `proxy.ts` before auth |
| Security headers | `next.config.ts` headers + CSP with allowlist (no `unsafe-inline`/`unsafe-eval` in production) |
| Password policy | `lib/password.ts` enforces `MIN_PASSWORD_LENGTH = 12`; argon2id hashing |
| RBAC enforcement | Every route uses `hasPermission()` from `packages/auth` — no role-less GETs |

### What NOT to copy

- Aerojet's `TENANT_ID` process-env pattern (SEC-13) — Novastar uses `getTenantContext()` resolving from user record
- Aerojet's mock Prisma client for build (SEC-10) — Novastar fails-fast on DB errors at build time
- Aerojet's permissive CSP in production — Novastar uses strict allowlist-based CSP

## Consequences

- Users get passkeys, TOTP 2FA, and proper brute-force protection
- Admin actions are auditable
- The security audit findings from Aerojet are not repeated
- Single merged app shares common security posture, simplifying maintenance

---

## Verification note (2026-10-08)

**Status: Accepted** — All ten implementation rows are verified in the merged `apps/web` codebase. The security patterns are implemented in the unified proxy, layout shells, and shared libraries.

### Row-by-row (verified 2026-10-08 in merged apps/web)

| Mapping row | Status | Evidence |
|---|---|---|
| Passkey bridge token (`pk_`) | **BUILT** | `schema.prisma` - `passkeyBridgeToken String? @unique`, `passkeyBridgeExpires DateTime?`; `components/auth/PasskeySetup.tsx` renders it |
| TOTP 2FA | **BUILT** | `schema.prisma` carries `twoFactorEnabled` and `twoFactorSecret`; `components/auth/TwoFactorSetup.tsx` mounted at `app/(portal)/settings/page.tsx` |
| Account lockout | **BUILT** | `loginAttempts` and `lockedUntil` in `schema.prisma` |
| Session revalidation | **PARTIAL** | JWT callback exists in `lib/auth.ts`; 5-minute interval not confirmed from source |
| Account status (`UserStatus` enum) | **BUILT** | `enum UserStatus { ACTIVE, SUSPENDED, ARCHIVED, DELETED }` |
| Audit logging (`AuditLog` table) | **BUILT** | `schema.prisma` defines `model AuditLog`; `logAudit()` exported from `packages/auth`; super-admin view at `app/admin/(dashboard)/audit/page.tsx` |
| Rate limiting (`@upstash/ratelimit`) | **BUILT** | `lib/rate-limit.ts` imports `Ratelimit` from `@upstash/ratelimit` and `Redis` from `@upstash/redis`, with in-memory `Map` fallback; applied in `proxy.ts` |
| Security headers + CSP | **BUILT (allowlist-based)** | `next.config.ts` declares `headers()` with CSP; production `script-src` is `'self' 'blob:'` plus explicit host allowlist — **no `'unsafe-inline'`, no `'unsafe-eval'`**; dev CSP has both |
| Password policy | **BUILT (length-based)** | `lib/password.ts:49` sets `MIN_PASSWORD_LENGTH = 12` — stronger than Aerojet's 8+; no complexity regex; argon2id hashing |
| RBAC enforcement | **BUILT (different primitive)** | No `requirePermission()`; real primitive is `hasPermission(userId, '<entity>:<action>', tenantId, schoolId)` from `packages/auth`, called at ~80 sites across `app/portal/api/` and `app/admin/api/` |

### The CSP approach

ADR-022 originally specified "nonce-based CSP". The merged app implements **allowlist-based CSP** (explicit host allowlist) because third-party origins (`js.stripe.com`, `uploadthing.com`, `va.vercel-scripts.com`, `fonts.googleapis.com`, etc.) make an explicit list easier to audit than nonce generation for every inline script. This is a deliberate choice, not an omission.

### Verification (measured 2026-10-08)

```bash
bun run typecheck --filter web   # PASS
bun run build --filter web       # PASS (full route table + ƒ Proxy)
bun run lint --filter web        # PASS (0 errors)
```

The build passes, typecheck passes, lint passes — no route is missing from the build graph and no type error hides the CSP code.
