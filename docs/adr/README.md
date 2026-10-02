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

| ID | Title | Phase | Status |
|----|-------|-------|--------|
| ADR-001 | Monorepo Structure: Turborepo + Bun Workspaces | 0 | Accepted |
| ADR-016 | Packages Consumed as TypeScript Source | 0 | Accepted |
| ADR-017 | Fork Portal to SchoolPortalSystem (Reusable SaaS) | 0 | Proposed |
| ADR-022 | Adopt Aerojet Academy Passkey & Security/Auth Patterns | 1 | Proposed |

## Planned ADRs (To Be Created During Implementation)

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

---

## How to Create an ADR

1. Copy the template above
2. Name file: `ADR-XXX-descriptive-title.md` (next number in sequence)
3. Fill in all sections
4. Set status to **Proposed** for review, **Accepted** when agreed
5. Link from related issues/PRs

## Superseded ADRs

When a decision is overturned, mark the old ADR as **Superseded** and link to the new one.