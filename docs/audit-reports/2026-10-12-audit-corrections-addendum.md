# Audit corrections addendum

**Date:** 2026-10-12
**Relates to:** `2026-10-12-codebase-audit-council.md` (3-persona LLM council + verification pass)

Corrections and resolutions discovered while *implementing* the audit's fixes. The audit report's findings are otherwise accurate.

## False positive: S13 — "FeeInvoiceLineItem lacks tenantId"

Not a defect. `packages/database/prisma/schema.prisma:1127` shows the model
carrying `tenantId String` alongside `invoiceId`; the line-item queries inherit
scope through the parent invoice. Verification of this finding said otherwise
because the auditor quoted a line range from the *prior* audit report instead of
reading the current model. No change was made. This is the second stale
cross-reference found in `CONSOLIDATED-AUDIT-REPORT.md` (see below).

## Stale: CONSOLDATED-AUDIT-REPORT.md item 3.3 — "invoiceNumber globally unique"

Fixed at some point after that report: the schema now carries
`@@unique([tenantId, schoolId, invoiceNumber])` at `schema.prisma:1122` (with
`invoiceNumber String` at `:1102`, unscoped). The globally-unique collision it
described cannot occur. The old report is a dated record and was not edited;
this addendum is the correction.

## Resolved by deletion: S10 — "apps/super-admin builds but deploys nowhere"

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
bunfig.toml at all** — a 6-second test still failed at 5 seconds with
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
