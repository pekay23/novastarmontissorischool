# Architecture Decision Records (ADR) Index

This folder captures key architectural decisions made during the project. Each ADR follows the format: `ADR-XXX-title.md`

## ADR Template

```markdown
# ADR-XXX: [Title]

**Status:** Proposed | Accepted | Superseded | Deprecated
**Date:** YYYY-MM-DD
**Deciders:** [Names]
**Tags:** [technical, business, security, etc.]

## Context
What is the issue that we're seeing that is motivating this decision or change?

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult to do because of this change?

### Positive
- 

### Negative
- 

### Neutral
- 

## Alternatives Considered
- Option 1: Pros/Cons
- Option 2: Pros/Cons

## Related
- ADR-XXX
- Issue #XXX
```

---

## ADR Index

Every row below points at a file that exists in this directory. Verified
2026-10-04: five ADRs written, eighteen planned, and the two lists are disjoint.

| ID | Title | Phase | Status | Verified 2026-10-04 |
|----|-------|-------|--------|---------------------|
| ADR-001 | Monorepo Structure: Turborepo + Bun Workspaces | 0 | Accepted | Decision holds. Two Neutral consequences are stale (the five "placeholder" directories are all real members now) and one mandatory rule - no cross-package relative paths - is being violated by `packages/database`'s `db:seed`. See its verification note. |
| ADR-016 | Packages Consumed as TypeScript Source | 0 | Accepted | Decision holds in direction; **rules 1, 2, 3 and 5 are violated by `packages/shared-ui`**, which now declares `main`, `module` and `types` all pointing into `dist/`. Needs a decision: finish the move, or supersede this ADR. See its verification note. |
| ADR-017 | Fork Portal to SchoolPortalSystem (Reusable SaaS) | 0 | Proposed | **Status is stale: the fork exists** at `C:\Projects\schoolportalsystem` with one commit. Decisions 1-3 executed; 4-6 have no implementation. Four Context inventory claims are false, including "sync-engine is 100% stubs". See its verification note. |
| ADR-022 | Adopt Aerojet Academy Passkey & Security/Auth Patterns | 1 | Proposed | Seven of ten mapping rows are BUILT. Three are wrong as written: the audit table is `AuditLog` not `AuditAction`, the RBAC primitive is `hasPermission()` not `requirePermission()`, and the CSP is allowlist-based while a comment claims it is nonce-based. See its verification note. |
| ADR-023 | Production DDL must arrive through `migrate deploy`, never `db push` | 0 | Accepted | Production DDL enters via `migrate deploy`; `db push` is dev-only and hard-refused on remotes; CI verify gated on credentials; `apply-schema.ts` neon target guarded; see ADR-023 for full rationale. |

### One ADR is referenced but does not exist here

`C:\Projects\schoolportalsystem\docs\adr\` contains
**`ADR-023-super-admin-as-separate-app.md`**, which is not in this repository and
has no row above. The source repo's `apps/super-admin` *is* built, so ADR-023
probably records a real decision taken for it. Either back-port the file into
`docs/adr/` and add a row, or record deliberately that the ADR set is maintained
per-repo and diverges.

## Planned ADRs (To Be Created During Implementation)

**None of the following files exists.** They are numbered slots, not records.

| ID | Title | Phase | Status |
|----|-------|-------|--------|
| ADR-002 | Multi-Tenancy: Shared DB with RLS vs Schema-per-Tenant | 0 | Planned |
| ADR-003 | Configuration-First: Dynamic Entities vs Hardcoded Enums | 1 | Planned |
| ADR-004 | Database: Neon Primary + Supabase Mirror via pg_cron | 0 | Planned |
| ADR-005 | Offline-First: Yjs + IndexedDB + CRDT Sync | 9 | Planned |
| ADR-006 | Authentication: Auth.js v5 + Dynamic RBAC + Delegation | 3 | Planned |
| ADR-007 | Payments: Provider Abstraction (MoMo, Bank, Cash) | 6 | Planned |
| ADR-008 | Localization: English + Twi with next-intl | 2 | Planned |
| ADR-009 | Report Generation: React-PDF Templates vs Server-Side | 8 | Planned |
| ADR-010 | Plugin Architecture: Dynamic Loading vs Static Imports | 10 | Planned |
| ADR-011 | Local Deployment: Docker Compose on Mini PC | 9 | Planned |
| ADR-012 | Sync Conflict Resolution: Last-Write-Wins vs Manual Queue | 9 | Planned |
| ADR-013 | File Storage: MinIO Local + Supabase Cloud | 0 | Planned |
| ADR-014 | Real-time: Supabase Realtime vs Custom WebSocket | 7 | Planned |
| ADR-015 | Testing: Vitest Unit + Playwright E2E + MSW Mocking | 0 | Planned |
| ADR-018 | Subscription Gating: Middleware Layer vs Per-Endpoint Checks | 1 | Planned |
| ADR-019 | Tenant Routing: Subdomain + Custom Domain + Query Param Resolution | 1 | Planned |
| ADR-020 | AI Gateway: Per-Tenant API Keys with Global Fallback | 2 | Planned |
| ADR-021 | Billing: Stripe + Provider Abstraction for Local Payments | 2 | Planned |

### Three planned slots are already decided by the code

A planned ADR that the codebase has already answered is worse than no ADR,
because the next reader trusts the slot instead of the code.

- **ADR-015 (Vitest)** - there are zero `from 'vitest'` imports repo-wide. Every
  test uses `bun:test`, and `bun` is the declared test runner. The decision has
  been made. Write ADR-015 to record `bun test`, or renumber the slot as
  superseded. ADR-001 and ADR-016 both link to it as "Planned".
- **ADR-006 (Auth.js v5)** - the portal runs `next-auth` **v4**
  (`apps/portal/lib/auth.ts` imports `Credentials` from
  `next-auth/providers/credentials`; `proxy.ts:30` uses `withAuth`). The v5 part
  of the title is already contradicted. The dynamic-RBAC half of the title is
  real and large.
- **ADR-008 (next-intl)** - `apps/public-site/lib/navigation.ts:8-12` records that
  static export rules out next-intl's middleware routing, and `messages/en.json`
  is statically imported. `messages/tw.json` is still on disk and unreferenced.
  Bilingual-with-next-intl is not the shipped design.

### Two more slots the code has moved past

- **ADR-004 (pg_cron mirror)** - no pg_cron function or schedule exists. The
  mirror is `tools/db-mirror/` driven by `.github/workflows/db-mirror.yml` on
  `cron: '17 */6 * * *'`. The slot's title names the mechanism that was chosen
  *against*.
- **ADR-005 (Yjs CRDT)** - `packages/sync-engine` implements an injectable
  `SyncStorage` with `MemorySyncStorage` and `IndexedDbSyncStorage` and a
  last-write-wins-shaped conflict path. Whether Yjs is inside those storage
  classes was not established; if it is not, the slot's title is wrong.

---

## How to Create an ADR

1. Copy the template above
2. Name file: `ADR-XXX-descriptive-title.md` (next number in sequence)
3. Fill in all sections
4. Set status to **Proposed** for review, **Accepted** when agreed
5. Link from related issues/PRs

## Superseded ADRs

When a decision is overturned, mark the old ADR as **Superseded** and link to the new one.
