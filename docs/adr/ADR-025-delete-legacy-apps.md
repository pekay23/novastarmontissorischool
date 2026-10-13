# ADR-025: Complete ADR-024 — delete the legacy apps (`apps/portal`, `apps/super-admin`, `apps/public-site`)

**Status:** Accepted
**Date:** 2026-10-12
**Deciders:** project owner
**Tags:** architecture, deployment, dead-code, vercel, next.js

## Context

ADR-024 (2026-10-08) consolidated the public site, the portal and the
admin console into one app, `apps/web`, and moved every route into it. The
decision was implemented as a **merge, not a delete**: the three legacy apps
stayed in the workspace, and `apps/web` grew a copy of each route.

Left that way, the merge bought none of what it was for. A 3-persona audit
of the codebase (docs/audit-reports/2026-10-12-codebase-audit-council.md)
found the concrete cost:

- **Every root task paid for them.** Root scripts run bare
  `turbo run <task>` with no `--filter`, so `build`, `lint`, `typecheck` and
  `test` compile, lint, typecheck and test 396 files of app nothing
  deploys — and one earlier suite run was aborted by a dead module inside
  them.
- **Two deploy paths disagreed.** `.github/workflows/ci.yml` deployed only
  `apps/web`, while `scripts/ci/deploy-vercel.ts` (the TeamCity entry)
  deployed the legacy trio and omitted `web` entirely. Which code was live
  depended on which pipeline an operator trusted.
- **The copies had already diverged.**
  `apps/web/app/admin/api/tenants/route.ts` and its `apps/super-admin`
  twin were byte-identical, while the announcements pages differed in
  three places — including the fetch path (`/portal/api/...` vs
  `/api/...`) — and a test copied from the portal asserted the old path
  and failed against the merged app.

## Decision

Delete `apps/portal`, `apps/super-admin` and `apps/public-site`. `apps/web`
is the single app: public site at `/`, portal under `/portal/*`, admin
console under `/admin/*`, deployed by one pipeline and built by one
Dockerfile.

Concretely:

- The three directories are removed; their routes, already present in
  `apps/web`, stay there.
- Every operational reference is swept: root scripts, `turbo.json`,
  `playwright.config.ts` and the e2e suite (which boot `apps/web`),
  `Dockerfile.web` (rewritten as a non-standalone `next start` image,
  matching what `apps/web/next.config.ts` actually builds),
  `docker-compose.yml`, `scripts/ci/deploy-vercel.ts` and
  `scripts/ci/docker.ts` (both now target `apps/web`), `.teamcity/**`,
  and the active guidance in `AGENTS.md`.
- Historical documents under `docs/` are left as dated records; this ADR
  and the audit report are the current state.

## Consequences

**Good**

- Root `turbo run` builds, lints, typechecks and tests one app and the
  packages. CI's four gates (lint/typecheck, test, build, e2e) no longer
  pay for code nothing deploys.
- One deployment story: CI, TeamCity and Docker all build `apps/web`.
- The duplicated code that had already diverged is gone, and the tests
  that asserted the pre-merge paths now assert the merged app's routes.

**Costs / accepted**

- `git log` will not show the legacy apps' routes moving into `apps/web`
  as renames; the move is ADR-024's history, and this deletion is a
  separate change. `git show ADR-024^:apps/portal/...` remains the way to
  read the old copies.
- The web test suite had to become order-independent to be trustworthy
  after the merge (several files' `mock.module` doubles now leak across
  files in one process, and one order hangs the run for ever). The web
  package's `test` script runs each file in its own process
  (`apps/web/tests/run-files.mjs`), which makes the load order
  irrelevant; that runner documents the reasoning and the `--filter`
  escape hatch.

## Alternatives considered

1. **Keep the apps, exclude them from the pipeline.** `turbo.json`
   `ignore` or per-task filters would stop the build cost, but leaves
   ~2,000 lines of duplicated routes on disk with no owner, no tests and
   no deploy — the drift that prompted this in the first place.
2. **Keep `apps/super-admin` as a separate deployment.** Its console is
   cross-tenant; serving it from the same origin as the school portal
   widens the blast radius of a portal XSS. Rejected: the console
   authenticates a *different population* (platform operators) with a
   separate cookie and its own auth, and the audit found no route in it
   that `apps/web` does not already serve. The shared-origin risk is
   accepted and recorded here rather than discovered later.
3. **Delete only the duplicated copies, keep the app shells.** Leaves
   three near-empty apps whose only content is config; deleting the
   directories is less to maintain than gutting them.
