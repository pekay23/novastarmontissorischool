# Novastar Montessori School — Documentation Index

## Folder Structure

```
docs/
├── business/                    # Non-technical, stakeholder-facing documents
│   └── novastar-montessori-business-plan.md    # Executive summary for owner/mediator
├── technical/                   # Technical implementation plans
│   └── 2026-09-24_000000-novastar-montessori-master-plan-final.md
├── wireframes/                  # Excalidraw wireframe files (open at excalidraw.com)
│   ├── system-architecture.excalidraw
│   ├── public-site-wireframes.excalidraw
│   ├── portal-dashboards.excalidraw
│   ├── portal-student-management.excalidraw
│   ├── portal-academic-workflows.excalidraw
│   ├── portal-finance.excalidraw
│   └── portal-communication-reports.excalidraw
├── architecture/                # Architecture Decision Records & diagrams
│   └── (ADR files will be added during implementation)
├── adr/                         # Architecture Decision Records
│   └── (ADR files will be added during implementation)
└── api/                         # OpenAPI/Swagger specs
    └── (API specs will be added during implementation)
```

## Quick Links

### For School Owner / Mediator (Non-Technical)
- **[Business Plan](business/novastar-montessori-business-plan.md)** — Start here. Human-readable, covers what the system does, costs, timeline, decisions.

### For Technical Review
- **[Master Technical Plan](technical/2026-09-24_000000-novastar-montessori-master-plan-final.md)** — Complete implementation plan with schemas, code structure, tech stack.
- **[CI/CD Setup](technical/2026-10-02_193000-ci-cd-teamcity-docker-vercel.md)** — GitHub Actions, TeamCity, Docker and Vercel: who deploys what, build caching, and the secrets to supply.

### For UI/UX Review
Open these `.excalidraw` files at **[excalidraw.com](https://excalidraw.com)** → "Open from file":

| File | Description |
|------|-------------|
| `system-architecture.excalidraw` | High-level system diagram: public site, portal, database, sync |
| `public-site-wireframes.excalidraw` | Public website: Home, Admissions, Application (desktop + mobile) |
| `portal-dashboards.excalidraw` | Role-based dashboards: Headmaster, Teacher, Bursar |
| `portal-student-management.excalidraw` | Student list, 360° profile view |
| `portal-academic-workflows.excalidraw` | Assessment entry, review, promotion, timetable builder |
| `portal-finance.excalidraw` | Fee management, MoMo reconciliation, parent portal, reports |
| `portal-communication-reports.excalidraw` | Communication hub, broadcast, reports center, mobile views |

## Document Status

| Document | Version | Status | Last Updated |
|----------|---------|--------|--------------|
| Business Plan | 1.0 | ✅ Ready for review | 2026-09-25 |
| Technical Plan | 4.1 | ✅ Final | 2026-09-25 |
| Wireframes | 1.0 | ✅ Complete | 2026-09-24 |
| CI/CD Setup | 1.0 | ⚠️ Wired, Docker build unverified | 2026-10-02 |
| ADR-017 (Fork Decision) | 1.0 | ✅ Accepted | 2026-10-01 |

## SPS & Aerojet Academy Security Patterns

| Document | Location |
|----------|----------|
| ADR-022 (Security Patterns) | `docs/adr/ADR-022-adopt-aerojet-security-patterns.md` |
| NMS Core Business Rules | `docs/business/2026-10-02-nms-core-business-rules-onboarding.md` |
| NMS Super-Admin Build Plan | `docs/technical/2026-10-02-build-plan-nms-super-admin.md` |
| Phase 7 Security Audit (addendum) | `docs/audit-reports/phase7-security.md` (see "Aerojet Academy Security Patterns" section) |

Security patterns from Aerojet Academy (`C:\Projects\aerojet-academy`) are
being adopted for **both** Novastar and its SPS fork. This includes passkeys
(WebAuthn), TOTP 2FA, account lockout, session revalidation, audit logging,
rate limiting, and strict CSP/security headers. See ADR-022 for the full
decision rationale and mapping table.

## Next Steps

1. **Mediator/Owner** reviews `docs/business/novastar-montessori-business-plan.md`
2. **Feedback collected** → incorporated into technical plan
3. **Phase 0 begins** — monorepo initialization, design system, free tier setup
4. **ADRs created** in `docs/adr/` as key decisions are made during implementation
5. **API specs** generated in `docs/api/` during Phase 3+

---

*All documents are living artifacts — they will be updated as the project progresses.*