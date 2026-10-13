# Audit corrections addendum

**Date:** 2026-10-12
**Relates to:** `2026-10-12-codebase-audit-council.md` (3-persona LLM council + verification pass)

Corrections and resolutions discovered while *implementing* the audit's fixes. The audit report's findings are otherwise accurate.

## False positive: S13 â€” "FeeInvoiceLineItem lacks tenantId"

Not a defect. `packages/database/prisma/schema.prisma:1127` shows the model
carrying `tenantId String` alongside `invoiceId`; the line-item queries inherit
scope through the parent invoice. Verification of this finding said otherwise
because the auditor quoted a line range from the *prior* audit report instead of
reading the current model. No change was made. This is the second stale
cross-reference found in `CONSOLIDATED-AUDIT-REPORT.md` (see below).

## Stale: CONSOLDATED-AUDIT-REPORT.md item 3.3 â€” "invoiceNumber globally unique"

Fixed at some point after that report: the schema now carries
`@@unique([tenantId, schoolId, invoiceNumber])` at `schema.prisma:1122` (with
`invoiceNumber String` at `:1102`, unscoped). The globally-unique collision it
described cannot occur. The old report is a dated record and was not edited;
this addendum is the correction.

## Resolved by deletion: S10 â€” "apps/super-admin builds but deploys nowhere"

The legacy apps (`apps/portal`, `apps/super-admin`, `apps/public-site`) were
deleted as part of the architecture fixes (audit findings A1/A2). The
cross-tenant admin console they carried is served by the merged `apps/web`
under `/admin/*`, which CI deploys. There is no longer a second, unreleased
auth surface to reason about. `docs/adr/ADR-024` records the merge; this
records its completion.

## Additional finding during implementation: test timeout configuration

The audit reported T2 as ".bunfig.toml puts the timeout under `[run]`". During
the fix, that placement was removed and the intended replacement checked
empirically: **Bun does not read `timeout` from the `[test]` section of
bunfig.toml at all** â€” a 6-second test still failed at 5 seconds with
`[test] timeout = 30000` in place, and passed with `--timeout=30000` on the
command line (verified 2026-10-12, against Bun 1.4.0). The 30-second timeout
therefore lives on every package's `test` script (`bun test --timeout 30000`),
which is where Bun actually honours it. The reasoning is recorded in the
comment at the top of `.bunfig.toml`.

## Payments: scope of the fix

The audit's S1/S2 fix also closed a hole adjacent to the reported one: a
payment recorded PENDING (mobile money, bank transfer) no longer reduces the
invoice balance at record time. The balance moves only when
`FinanceService.settlePayment` records a provider-confirmed settlement. See
`packages/domain/tests/settlement.test.ts` for the pinned invariants, including
the concurrent-settle case.

---

## CI validation and commits (2026-10-13)

The audit remediation is committed and pushed to `main` (`d94e6fe` and three
follow-ups: `61c27bb`, `cc107a1`, `89486fd`), and all four CI gates pass:
Lint & Typecheck, Tests, Build, E2E Tests. Docker Build and Deploy stay skipped
by design — each is behind an opt-in repo variable (`DOCKER_BUILD_ENABLED`,
`VERCEL_DEPLOY_ENABLED`).

Getting to a green run surfaced three defects in the workflow itself, all fixed
in `61c27bb`, `cc107a1` and `89486fd`:

1. **The workflow did not parse.** A secret rename in the audit commit left
   `VERCEL_PROJECT_ID_WEB` over-indented inside its `env:` map, so GitHub
   started zero jobs. It parses now (both workflow files validate).
2. **The repository has no `NEXTAUTH_SECRET`.** GitHub renders a missing secret
   as an EMPTY string, which is worse than an absent one: next-auth answers
   every session check with `error=Configuration`, and the app's
   AES-256-GCM layer refuses to derive a key from an empty secret, which 500s
   any route that encrypts (the TOTP enrolment specs failed for exactly this
   reason). CI now defaults it to a suite-only value that the repository secret
   overrides when set; production takes its own value from the Vercel project.
3. **The e2e suite's `NEXTAUTH_URL` was the dev server's.** It inherited
   `http://localhost:3000` while the suite serves on 3100. The job now sets its
   own origin and auth path.

Two environment facts worth recording, because both cost diagnosis time:

- **Neon is unreachable from this workspace.** `prisma db push` fails with
  P1001 against the host in `DATABASE_URL` — the sandbox blocks outbound
  connections to it (npm's registry answers fine). The credential and URL are
  valid; nothing here can apply the GIN index to the live database. That needs
  a machine with database egress, or the project's own deploy path.
- **The RLS "driver decision", stated once.** The policies filter on
  `current_setting('app.current_tenant_id', true)`, which only holds a value if
  something SETs it on the connection. `packages/database/index.ts` builds the
  client with `PrismaNeon` — the stateless HTTP driver — where every query is
  its own HTTP request with no session to carry the setting, so RLS on that
  driver would filter every query to zero rows. The decision is therefore
  binary: keep the HTTP driver and leave RLS written-but-unenforced (tenant
  isolation stays the application's explicit `where: { tenantId }` scoping,
  which is what every domain query already does — this is what is shipped now,
  and the least-privilege role exists so the switch is a URL change), or move
  to a stateful driver (PrismaPg, node-postgres, or Neon's WebSocket driver)
  where `SET LOCAL app.current_tenant_id` inside each unit of work is possible
  — and only then point `DATABASE_URL` at the `novastar_app` role. The step
  ordering in `packages/database/prisma/rls/README.md` exists so nobody flips
  the role before the driver; `00-app-role.sql` is applied, and the app role's
  connection string is documented there but not used anywhere.

The web suite's per-file runner (`apps/web/tests/run-files.mjs`) is what makes
the Tests gate trustworthy: in one process, ~20 files register `mock.module`
doubles at their own module scope with no restore, so a route can capture the
real Prisma client and hang forever against an unreachable Neon, and several
files only pass because an earlier file happened to register the mock they
need. One process per file makes the load order irrelevant; the failure tails
it prints are what made the CI-only failures above diagnosable.