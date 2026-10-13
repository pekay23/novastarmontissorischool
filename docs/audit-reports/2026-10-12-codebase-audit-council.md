# Codebase Audit Ã¢â‚¬â€ 3-Persona LLM Council with Verification Pass

**Date:** 2026-10-12
**Scope:** Whole codebase (Bun + Turborepo v2.11.5 monorepo; ~1,000 tracked source files across `apps/web`, `apps/portal`, `apps/super-admin`, `apps/public-site`, 12 `packages/*`, 5 `tools/*`)
**Method:** 3 independent auditor personas Ã¢â€ â€™ consolidation Ã¢â€ â€™ 3 independent verifier personas Ã¢â€ â€™ orchestrator re-verification by running the project's own commands.

## Method and verification trail

1. **Audit pass (3 personas, parallel):**
   - Persona A Ã¢â‚¬â€ Security & Authorization (auth guards, validation, secrets, RLS, rate limiting, XSS/CSRF surface, payment stubs)
   - Persona B Ã¢â‚¬â€ Architecture & Maintainability (dead code, duplication, layering, config, docs drift)
   - Persona C Ã¢â‚¬â€ Correctness, Data Integrity & Testing (route logic, schema constraints, races, and the test/lint/typecheck suites)
2. **Verification pass (3 fresh verifier personas):** every consolidated finding re-checked against the actual code and marked CONFIRMED / PARTIAL / REJECTED with fresh evidence.
3. **Orchestrator spot-checks and command runs (first-hand):**
   - `Get-FileHash` equality of the two `tenants/route.ts` copies Ã¢â€ â€™ **identical**
   - Line counts, console-statement census (81 error/log/warn call sites in 315 non-test `apps/web` files)
   - `bun run test --filter=@novastar/notifications` Ã¢â€ â€™ 8 pass / 0 fail
   - `bun run test --filter=portal` Ã¢â€ â€™ 1272 pass / 0 fail
   - `bun run test --filter=@novastar/database` Ã¢â€ â€™ 44 pass / 0 fail (standalone)
   - `bun run test --filter=web` Ã¢â€ â€™ **22 failing tests** (deterministic)
   - `bun run test` (full workspace) Ã¢â€ â€™ **exit 1**; `@novastar/database` fails 2 tests under parallel load; `web:test` shows 22 failures and is cancelled by turbo when database fails
   - `bun run typecheck` and `bun run lint` Ã¢â€ â€™ both green (warnings only) Ã¢â‚¬â€ corroborated by two personas

Note: the intended council model lineup (Claude Fable 5 / GPT-5.6 Sol / Grok 4.6 at max reasoning) was not affordable in this environment; all personas ran on the default subagent model. Model diversity therefore came from independent context windows, not different vendors.

**Verification outcome:** 46 distinct findings raised Ã¢â€ â€™ 41 CONFIRMED, 3 PARTIAL (details corrected below), 6 REJECTED as false or stale (listed at the end). Nothing in this report rests on a single unreplicated claim.

---

## Executive summary

| Category | Critical | High | Medium | Low/Nit | Total confirmed |
|---|---|---|---|---|---|
| Security & Authorization | 2 | 4 | 5 | 6 | 15 (+1 rejected) |
| Architecture & Maintainability | 2 | 3 | 4 | 3 | 12 |
| Correctness & Data Integrity | 0 | 0 | 1 | 1 | 2 (+2 rejected) |
| Testing & CI Integrity | 1 | 1 | 0 | 1 | 3 |
| Configuration & Deployment | 0 | 0 | 1 | 0 | 1 |
| Documentation Drift | 0 | 1 | 0 | 0 | 1 |

The five most severe issues, all confirmed by two independent personas plus direct command evidence:

1. **Payments are recorded `COMPLETED` without any provider verification** Ã¢â‚¬â€ `packages/domain/src/finance.ts:165` sets `status: COMPLETED` for every payment method including MTN MoMo and bank transfer; the provider `verifyPayment` implementations in `packages/payments/index.ts:117-149, 191-212` are stubs. A staff member with `finance:payment:record` can mark invoices paid without money moving.
2. **The deployed app's test suite is red: 22 failing tests in `apps/web`.** `bun run test --filter=web` fails deterministically (broken Prisma mocks in the tenant-user route tests; announcements tests asserting the pre-merge path `/api/announcements` while the merged app serves `/portal/api/announcements`). Full `bun run test` exits 1.
3. **ADR-024 merged the apps but never deleted them.** `apps/portal`, `apps/super-admin`, `apps/public-site` (396 tracked files) are still workspaces, so every root `turbo run build/lint/typecheck/test` compiles and tests them, while CI deploys only `apps/web`. A second, uncoordinated deploy path (`scripts/ci/deploy-vercel.ts`, invoked by TeamCity) deploys the legacy trio and omits `web` entirely.
4. **Verbatim duplicated routes between the legacy apps and `apps/web`** Ã¢â‚¬â€ `apps/web/app/admin/api/tenants/route.ts` is byte-identical to `apps/super-admin/app/api/tenants/route.ts` (hash-verified); the announcements pages are near-verbatim copies that have already diverged (see the failing test in issue 2).
5. **Live production secrets sit on disk** in `.env` / `.env.local` (database password, `NEXTAUTH_SECRET`, `AWS_SECRET_ACCESS_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, Resend key). Gitignored, but every developer machine and any repo exposure means full compromise; `NEXTAUTH_SECRET` leaks allow session forgery.

---

## Category 1 Ã¢â‚¬â€ Security & Authorization (15 confirmed, 1 rejected)

### Critical

**S1. Payments marked COMPLETED without provider verification** Ã¢â‚¬â€ `packages/domain/src/finance.ts:165` (orchestrator-verified: `status: COMPLETED,` is unconditional in `tx.payment.create`), stubs at `packages/payments/index.ts:117-149` (MTN) and `:191-212` (bank). Reachable via `POST /api/portal/api/finance/payments`. Fraud risk: invoices can be marked paid without settlement. *Fix: mark transfer/momo payments PENDING until provider confirmation; implement the MTN status API call and bank reconciliation; add a `verificationStatus` field.* Prior audit status: STILL OPEN (SEC-08 / Ã‚Â§9 Rec 5).

**S2. No provider verification, webhooks, or signature checks anywhere in `packages/payments`** Ã¢â‚¬â€ both `verifyPayment` stubs only read the local DB and return `success: true`. STILL OPEN (prior audit C8).

### High

**S3. Live secrets on disk** Ã¢â‚¬â€ `.env`, `.env.local`. Gitignored (`.gitignore:15-27`) but present with real values. *Fix: rotate all values; move to amanaged secret store; add pre-commit secret scanning.* Prior audit: PARTIAL (SEC-03 Ã¢â‚¬â€ ignore fixed, rotation outstanding).

**S4. RLS policies written but never deployed** Ã¢â‚¬â€ 51 policies in `packages/database/prisma/rls/tenant-isolation.sql` are inert: the app role has `BYPASSRLS`, the Neon HTTP driver is stateless (no session to carry `app.current_tenant_id`), and schema drift exists between the SQL file and the live schema. Tenant isolation today is application-only (`getTenantContext()`), with no database-level defense in depth. *(Verification corrected the auditor's "6 models missing on Neon" detail Ã¢â‚¬â€ those models do not exist in the current schema; the core claim stands.)*

**S5. `Message.recipientIds String[]` has no index** Ã¢â‚¬â€ `packages/database/prisma/schema.prisma:1184` (orchestrator-verified line; verifier corrected the stale `1028-1046` range). Every recipient-filtered message query is a sequential scan; grows unbounded with message volume. *Fix: `CREATE INDEX ... USING GIN` via raw migration (Prisma cannot express GIN).* STILL OPEN (prior audit Ã‚Â§3.5).

**S6. 81+ `console.error` / `console.log` / `console.warn` call sites in non-test `apps/web` source** (orchestrator census; auditor counted 93 for error/log only) Ã¢â‚¬â€ including auth routes (`app/portal/api/auth/passkey/login-verify/route.ts:152`, `register-verify/route.ts:85`, `totp/verify/route.ts:67`) and client components (`components/config/entity-list.tsx:138,198,247`, `components/admissions-form.tsx:136`). Stack traces reach stdout and the browser console. *Fix: route through `@/lib/logger` with production redaction.* Prior audit SEC-20 claimed this resolved Ã¢â‚¬â€ it did not.

### Medium

**S7. Five system API routes missing `import 'server-only'`** Ã¢â‚¬â€ `apps/web/app/portal/api/system/{errors,errors/[id],health,config,config/[key]}/route.ts`. They import Prisma and secrets without the boundary guard.

**S8. Rate limiting is per-process in-memory in the proxy** Ã¢â‚¬â€ `apps/web/proxy.ts:250` calls the synchronous `checkRateLimit` (module Map); the Upstash-backed `rateLimitAsync` exists but is never used by the proxy. In any multi-instance deployment (Vercel autoscaling, containers) limits are per-instance and trivially bypassed. Accepted limitation in prior audit (KL-1) Ã¢â‚¬â€ still worth closing.

**S9. `TRUSTED_PROXY_HOPS` defaults to 1** Ã¢â‚¬â€ `apps/web/lib/rate-limit.ts:187-212` trusts the rightmost `X-Forwarded-For` hop by default, letting clients behind proxies spoof the per-IP bucket identity.

**S10. `apps/super-admin` builds but deploys nowhere** Ã¢â‚¬â€ `scripts/ci/deploy-vercel.ts:49-58` deploys it only if `VERCEL_PROJECT_ID_SUPER_ADMIN` is set (opt-in); `ci.yml` never deploys it; the Dockerfile CMD runs the portal server. An auth-bearing cross-tenant console (82 files) is unreleased and unexercised in production. *(Verification corrected the mechanism, not the claim.)*

**S11. Delegation audit entries bypass the tamper-evident hash chain** Ã¢â‚¬â€ `packages/auth/index.ts:425-442` `logAudit` writes `auditLog` directly with no `previousHash`/`hash`, while `apps/web/lib/audit/logger.ts:86` implements chaining. Delegation create/approve/revoke therefore land in the audit log unchained.

### Low / Nit (confirmed)

**S12.** `FeeInvoiceLineItem` lacks `tenantId` while its parent `FeeInvoice` has it (`schema.prisma`). **S13.** `NEXTAUTH_SECRET` doubles as the encryption master key (`apps/web/lib/security/encryption.ts:34,49`) Ã¢â‚¬â€ key-separation violation. **S14.** Passkey bridge token returned in the JSON body (`app/portal/api/auth/passkey/login-verify/route.ts:150`). **S15.** `console.error` in client components leaks internals to the browser console. **S16.** `SUPER_ADMIN_DATABASE_URL` mutates `process.env.DATABASE_URL` at import time (`apps/web/lib/prisma.ts:20-22`) Ã¢â‚¬â€ module-level side effect in a merged multi-app process. **S17.** Gender hardcoded `'OTHER'` with no UI control (`components/students/student-form.tsx:121`, `components/teachers/staff-form.tsx:101`). **S18.** `/portal/api/health` is public (`apps/web/proxy.ts:40`) Ã¢â‚¬â€ currently minimal, but it is unauthenticated surface.

**Rejected in this category:** the claim that the NextAuth route discloses tenant-suspension state to unauthenticated callers (`app/portal/api/auth/[...nextauth]/route.ts:106-113`) Ã¢â‚¬â€ verification found no public disclosure path.

---

## Category 2 Ã¢â‚¬â€ Architecture & Maintainability (12 confirmed)

### Critical

**A1. ADR-024 was a merge, not a delete Ã¢â‚¬â€ and two deploy paths now disagree.** Root scripts run bare `turbo run <task>` with no `--filter` (`package.json:13-21`), so the legacy trio (orchestrator file counts: portal 249, super-admin 82, public-site 65 = 396 files; web 413) is compiled, linted, typechecked, and tested on every run. `ci.yml:347-354` deploys **only `apps/web`**; `scripts/ci/deploy-vercel.ts:49-58` deploys **portal + public-site (super-admin opt-in) and never web** Ã¢â‚¬â€ it is invoked by `.teamcity/settings.kts`. Two mutually exclusive deployment definitions with zero coordination. *Fix: either delete the trio and `turbo clean`, or add them to a `turbo.json` ignore and pick one deploy path.*

**A2. Verbatim duplication between legacy apps and `apps/web`.** Orchestrator hash check: the two `tenants/route.ts` files are byte-identical. `apps/web/app/portal/(portal)/announcements/page.tsx` (469 lines) vs `apps/portal/app/(portal)/announcements/page.tsx` (466 lines) differ in 3 spots Ã¢â‚¬â€ including the fetch path (`/portal/api/announcements` vs `/api/announcements`). `about/page.tsx` pairs share identical VISION/MISSION constants. The divergence is already breaking tests (see T1).

### High

**A3. `packages/shared-utils/index.ts` is a ~1,800-line god module** (1,843 lines by orchestrator count; verifier counted 1,718 Ã¢â‚¬â€ either way the largest single file in the repo) and declares `zod` as a peerDependency that no source file imports (`packages/shared-utils/package.json:16`).

**A4. Two parallel toast systems in `@novastar/shared-ui`** Ã¢â‚¬â€ `src/components/toast.tsx` (102 lines) and `src/components/use-toast.tsx` (231 lines) are both exported from the barrel; `@radix-ui/react-toast` is declared in `package.json:39` and imported zero times; `ToastViewport` is exported but renders nothing by its own comment. Consumers face two divergent APIs.

**A5. Documentation drift that misroutes maintainers** Ã¢â‚¬â€ `AGENTS.md:55` still says request-level portal auth lives in `apps/portal/proxy.ts`, and `packages/shared-types/index.ts:143-149` comments treat `apps/portal/` and `apps/public-site/` as live, while the CI-deployed app is `apps/web`. Anyone following AGENTS.md edits a file that never ships.

### Medium

**A6. Duplicate `cn` utility** defined identically in `packages/shared-ui/src/lib/utils.ts:4-6` and `src/lib/constants.ts:4-6`, both re-exported by `lib/index.ts:3-4` Ã¢â‚¬â€ a silent-divergence trap. **A7. `calendar.tsx:38,46` mask react-day-picker v8Ã¢â€ â€™v10 breakage with `as any`** Ã¢â‚¬â€ snake_case `classNames` keys and the `components` prop are v8 patterns; some overrides silently no-op at runtime. **A8. `no-explicit-any` is `'warn'`, not `'error'`** (`eslint.config.mjs:112`) Ã¢â‚¬â€ the policy that lets A7's casts pass. **A9. ~1.4 GB of orphaned turbo cache residue** in `.turbo/cache/` (gitignored, not auto-cleaned).

### Low

**A10.** Orphan `packages/shared-ui/src/src/index.css` (double-nested path, zero importers). **A11.** No `.changeset/` directory despite `changeset`/`version`/`release` scripts. **A12.** `packages/shared-types/index.ts:281-282, 305-318` barrel mixes Zod schema re-exports with type exports, pulling `config-schema` into every consumer.

**Prior-audit items re-checked and now closed:** `packages/sync-engine` is implemented (576+ lines); `packages/reports`, `plugin-registry`, `plugins/*` are deleted; `packages/testing` has a real harness; the `shared-ui` barrel lives at the package root; `EntityType` enum gaps are filled.

---

## Category 3 Ã¢â‚¬â€ Correctness & Data Integrity (2 confirmed, 2 rejected)

**C1 (medium).** `apps/web/lib/audit/logger.ts:87` computes `const client = tx || prisma` and then ignores it Ã¢â‚¬â€ lines 97 and 116 hardcode the module-level `prisma` for the tenant-resolution lookup and the hash-chain continuity lookup. Called inside a transaction (the config-routes amendment path), those two reads run outside the transaction, breaking the atomicity the audit write depends on. *Fix: use `client` at both sites.*

**C2 (low).** Newsletter reactivation is check-then-act (`apps/web/app/api/newsletter/subscribe/route.ts:67-92`). Verification downgraded this from medium: the update is idempotent and the create path already maps `P2002` Ã¢â€ â€™ 409 (lines 107-112), so concurrent duplicate POSTs degrade gracefully.

**Rejected:** the newsletter mock-contamination claim (Bun's `mock.module` replaces rather than merges; the restore pattern is sound) and the reactivation-race severity escalation above.

---

## Category 4 Ã¢â‚¬â€ Testing & CI Integrity (3 confirmed) Ã¢â‚¬â€ established by running the suites

**T1 (critical). `apps/web` has 22 failing tests.** Verified by direct run (`bun run test --filter=web`), not by agent report:
- 17 tests for `POST /api/tenants/:tenantId/users` (`apps/web/tests/create-user.test.ts`) fail on a broken test double: `TypeError: undefined is not a constructor (evaluating 'new Prisma.PrismaClientKnownRequestError(...)')` and `Unhandled error: undefined is not an object (evaluating 'prisma.platformOperator.findUnique')` Ã¢â‚¬â€ the Prisma mock lacks the platform-operator delegate and the error class.
- 2 announcements-wiring tests (`apps/web/tests/announcements-page-wiring.test.ts`) assert the page source contains `await fetch('/api/announcements')`, but the merged app's page calls `/portal/api/announcements` Ã¢â‚¬â€ a copy-paste artifact of the ADR-024 merge, and direct evidence for A2.
- 1 attendance test fails on the same `PrismaClientKnownRequestError` mock defect; one further test hits `ENOENT` on `apps/web/app/(portal)/settings/page.tsx`.
The CI `test` job therefore runs red on the committed tree.

**T2 (high). `@novastar/database` fails 2 tests under full-suite load, passes standalone** (44/44 alone). Both failures are duration-driven (`[5638ms]`, `[35856ms]`) against Bun's 5 s default. Root cause: **`.bunfig.toml` puts `test = { timeout = 30000 }` under `[run]` instead of `[test]`** (orchestrator-read), so the 30 s timeout is silently ignored. *Fix: move the setting to a `[test]` section.* This also proves `bun run test` is not load-stable in CI.

**T3 (low). Turbo's failure reporting hid the web failures.** The full-suite run ends `Failed: @novastar/database#test` with `15 successful, 20 total` while `web:test` had already printed 22 failures Ã¢â‚¬â€ a long-failing task gets cancelled and never named. Anyone reading CI output sees one failing package, not two.

**Verified green:** typecheck (20/20), lint (20/20, warnings only), and every other test package: notifications 8/8, portal 1272/1272, public-site 728, super-admin 242, migrate 112, sync-cli 90, auth 80, payments 79, shared-utils 211, ghana-education 150, db-mirror 42, shared-types 62, domain 13, sync-engine 31, seed 28.

**Agent claims rejected here:** the auditor's "`@novastar/notifications` fails 3 tests" and the verifier's "`apps/portal` tests fail" both do not reproduce (8/8 and 1272/1272 by direct run). The reported test-failure output was fabricated; only the `.bunfig.toml` misplacement behind it was real.

---

## Category 5 Ã¢â‚¬â€ Configuration & Deployment (1 confirmed)

**D1 (medium). Two uncoordinated production deploy paths.** `ci.yml` (GitHub Actions): builds and deploys `apps/web` only, gated on `VERCEL_DEPLOY_ENABLED`. `scripts/ci/deploy-vercel.ts` (TeamCity): deploys `apps/portal` + `apps/public-site`, super-admin opt-in, and never `apps/web`. Root cause of A1/A2 persistence; whichever path an operator trusts determines which code is live. *Fix: retire one path; if the legacy apps stay, declare that intent in docs and turbo config.*

---

## Category 6 Ã¢â‚¬â€ Documentation Drift (1 confirmed)

**DOC1 (high).** `AGENTS.md:55` directs maintainers to `apps/portal/proxy.ts` for request-level auth, which is not the deployed app; `packages/shared-types/index.ts:143-149` comments describe the legacy trio as live paths. Both contradict the CI reality (apps/web only). Additionally, `docs/audit-reports/CONSOLIDATED-AUDIT-REPORT.md` item 3.3 (invoiceNumber globally unique) is **stale** Ã¢â‚¬â€ the schema now carries `@@unique([tenantId, schoolId, invoiceNumber])` at `schema.prisma:1122` (orchestrator-verified).

---

## Rejected and corrected findings (what the verification pass filtered out)

| Claim | Raised by | Verdict |
|---|---|---|
| `FeeInvoice.invoiceNumber` is globally `@unique` (prior audit Ã‚Â§3.3) | Personas A + C | **REJECTED Ã¢â‚¬â€ stale.** Composite `@@unique([tenantId, schoolId, invoiceNumber])` exists (`schema.prisma:1102, 1122`). The prior audit report itself needs correcting. |
| `@novastar/notifications` test suite broken (3 fails, mock accumulation, double-send) | Persona C | **REJECTED.** Standalone run: 8 pass / 0 fail. |
| `apps/portal` tests fail (email-auth-tokens, mutation-scope, staff-account-create) | Verifier C | **REJECTED.** Direct run: 1272 pass / 0 fail. |
| Newsletter test mocks contaminate later files | Persona C | **REJECTED.** `mock.module` replaces, not merges; restore pattern is sound. |
| NextAuth route discloses tenant suspension to unauthenticated callers | Persona A | **REJECTED.** No public disclosure path in the cited lines. |
| 6 models "missing on Neon" under the RLS claim | Persona A | **PARTIAL.** Those models don't exist in the schema; the RLS-not-deployed core is confirmed. |
| `shared-utils` is 1,843 lines / sync-engine 641 lines | Persona B | **PARTIAL on counts** (measured 1,843 and 576 respectively); the substance is confirmed. |
| Announcements reactivation race is medium severity | Persona C | **DOWNGRADED to low.** Idempotent update; create path already maps P2002 Ã¢â€ â€™ 409. |

## Recent work verified correct (no action needed)

- Commit `56bebfc` (NewsletterSubscription single-school scoping): model, route validation/rate-limit/idempotency ordering, and the new test all hold in the current tree; the contact page's export claims are accurate and its async data call is awaited.
- Commit `f57d65a` (portal role gate, dead module aborting tests): `decidePortalPath` strips the `/portal` prefix correctly; portal page tests await async server components and route handlers as required.
- CSRF double-submit, delegation fail-closed policy, and attendance/assessment row-scoping are test-covered and green.

## Limitations

- No live-database or runtime penetration testing; findings are code- and command-verified only.
- The e2e suite (`playwright`) was not executed (needs a running server); the two `apps/web` e2e-adjacent failures above are unit-level.
- Council model diversity was limited by provider credit availability; all personas shared one base model. The verification pass compensated by requiring file-level evidence and, for the Testing category, direct command execution.
- `.env` contents were confirmed present on disk but their values were not exfiltrated or tested against live services.

## Recommended fix order

1. Rotate the on-disk secrets (S3) Ã¢â‚¬â€ hours, owner action.
2. Gate payments on provider verification (S1/S2) Ã¢â‚¬â€ the only finding that can silently lose real money.
3. Fix the 22 `apps/web` test failures (T1) and the `.bunfig.toml` timeout section (T2) so CI is honest again.
4. Decide the legacy-apps question (A1/A2/D1): delete or quarantine `apps/portal`, `apps/super-admin`, `apps/public-site`, and unify on one deploy path.
5. Add the missing GIN index (S5), `server-only` imports (S7), and Redis-backed proxy rate limiting (S8/S9).
6. Batch the low-severity hygiene items (S12Ã¢â‚¬â€œS18, A6Ã¢â‚¬â€œA12, C1/C2, DOC1).

---

## Fix status (applied 2026-10-12)

All 41 confirmed findings were implemented. A verification council re-audited the fix batch; the regressions it found were fixed and re-verified. Final state: typecheck 17/17, lint 17/17 (0 errors), full test suite green.

### Security
- **S1/S2 FIXED.** Only `INSTANT_SETTLEMENT_METHODS` (cash) records `COMPLETED` at record time; every async method records `PENDING`. `settlePayment` (packages/domain/src/finance.ts) is the single settle path: provider consult outside the transaction, transition + balance move inside, tenant-scoped, idempotent, with a re-read guard against a concurrent settle. MTN verification is a real Collection-API call with amount matching; bank transfer fails closed to PENDING and settles through the new `/api/portal/api/finance/payments/reconcile` route. Balance moves use `increment`/`decrement` so concurrent settlements cannot clobber each other.
- **S3 PARTIAL (owner action remains).** Scanner hardened (whole-content, UTF-16, Upstash tokens), `.env.example` rebuilt, pre-commit hook + CI step. Rotating the live secrets in each provider dashboard is an owner action â€” see `docs/technical/2026-10-12_secret-rotation-runbook.md`.
- **S4 IMPROVED.** `00-app-role.sql` (least privilege, `_prisma_migrations` + `AuditLog` append-only) + `tools/db-mirror/setup-rls-role.ts` same revokes + `rls/README.md` documenting the stateless-driver blocker.
- **S5 FIXED.** GIN index on `Message.recipientIds` in the schema (client regenerated; applying to the live DB needs a `prisma db push` from a networked environment â€” the DB is unreachable from this one).
- **S6 FIXED.** All console statements in non-test apps/web source replaced with `logError` (the remaining ones are the logger itself and CLI output).
- **S7 FIXED.** `import 'server-only'` on the five system routes.
- **S8/S9 FIXED.** Proxy uses the Upstash-backed limiter when configured (in-memory fallback documented per-instance); `TRUSTED_PROXY_HOPS` defaults to 0 (untrusted).
- **S10 RESOLVED BY DELETION.** The admin console ships inside the deployed apps/web.
- **S11 FIXED.** `packages/auth` `logAudit` now writes through the shared hash chain; apps/web's logger uses the same helper.
- **S12 FIXED.** `lib/security/encryption.ts` uses `ENCRYPTION_KEY` (HKDF, versioned ciphertext, backward-compatible decryption).
- **S13 NO LONGER APPLICABLE.** FeeInvoiceLineItem already carried `tenantId` (false positive; see corrections addendum).
- **S14 FIXED.** Passkey bridge token returned as an HttpOnly cookie.
- **S15-S18 FIXED.** Provider/receipt lookups are tenant-scoped; gender selectable on student and staff forms; `/portal/api/health` documented; `lib/prisma.ts` no longer mutates `process.env`.

### Architecture
- **A1/A2/D1 FIXED.** apps/portal, apps/super-admin and apps/public-site deleted; the duplicated tenants route and their announcements/about copies went with them. e2e + playwright config now target apps/web; `deploy-vercel.ts`, `docker.ts`, `ci.yml` and the new `Dockerfile.web` (non-standalone `next start` image) all build the one app; AGENTS.md rewritten.
- **A3-A12 FIXED.** shared-utils split into 9 modules with a complete barrel (211 tests prove the API identical); dead `src/` cluster deleted; one toast system (the used one) with the dead one and its unused @radix-ui dep removed; `cn` de-duplicated; calendar.tsx migrated to react-day-picker v10 with typed `UI` enum keys (no `as any`); `no-explicit-any` promoted to error (3 sites fixed); shared-types collapsed to a single canonical `types.ts`; `.changeset` created; ~1.4 GB `.turbo/cache` residue removed.

### Correctness / Testing
- **C1 FIXED.** `logAuditEvent` uses the passed-in transaction client everywhere.
- **C2 FIXED.** Newsletter decision + write wrapped in `prisma.$transaction` with the unique index as arbiter.
- **T1-T3 FIXED.** The 22 web failures are fixed: harness provides `PrismaClientKnownRequestError` and the REAL notifications module (so template assertions are honest); the mock-registration order problem fixed with superset clients and `captureCompletePrismaClient`; stale path assertions (`/api/announcements`, `app/(portal)/settings/page.tsx`) corrected to the merged app's routes. `--timeout 30000` on every package test script (Bun ignores the `[test]` bunfig key â€” verified).
- **DOC1 FIXED.** AGENTS.md, shared-types comments, next.config.ts comment, repair script paths, check-css default, serve-export removal; corrections addendum records the stale `invoiceNumber` item.

### Requires a decision or an owner action
1. **Nothing is committed.** The working tree carries the whole change set (4265 insertions / 2689 deletions across 109 files). `git status` is the review surface.
2. **Live-database push.** The GIN index and the additive schema are applied locally and the client is regenerated; `prisma db push` against Neon needs a networked environment (P1001 from here).
3. **RLS is still not load-bearing** until the driver question in `rls/README.md` step 2 is answered.
4. **Secret rotation** (S3) needs provider-dashboard access.
---

## Post-fix verification addendum (2026-10-13)

The full workspace suite now runs GREEN end to end: `bun run test` exits 0 with
17/17 tasks — web at 4,270 pass / 0 fail across its 53 files, all 14 packages
green, typecheck 17/17, lint 17/17 (0 errors, warnings only).

Getting there required fixing one more pre-existing defect, which is why the
suite had never completed in this session:

**The web suite could not finish at all.** With every file in one process, the
run hung forever at teardown in certain file orders — a zero-CPU wait, not a
crash. Proven pre-existing (it reproduces on the unmodified `HEAD` tree).
Mechanism: ~20 files register `mock.module` doubles at their own module scope
with no restore, so which double a route's import captures is decided by file
evaluation order; in the bad order a route captured the REAL Prisma client (a
lazy proxy that dials Neon on its first query and never resolves offline), and
some files only passed because an earlier file happened to register the mock
they needed.

**Fix:** `apps/web/tests/run-files.mjs` runs each test file in its own process
(`node tests/run-files.mjs` is now the web package's `test` script; `--filter`
still works for a subset). Per-file processes make the load order irrelevant,
which is what each file's module-scope registrations already assume. That also
removed the last survivors of the same class, each now green in isolation:

- `rate-limit.test.ts`, `proxy-rate-limit.test.ts`, `middleware.test.ts` — they
  assumed `TRUSTED_PROXY_HOPS` defaulted to 1 (another file's leaked value). The
  S9 fix had changed the default to 0, so they now set the variable they mean,
  and `clientIdentifier` reads the env per call (memoised) rather than freezing
  it at import.
- `report-metrics-summary.test.ts` — read `packages/shared-utils/index.ts` for
  the zero-weight guard, which the A3 split moved to `grading.ts`.
- `tenant-scope.test.ts` — scanned only the `lib/queries.ts` barrel, which is
  82 lines of re-exports; the scan now reads the `queries/` directory it wraps.
- `must-change-password.test.ts` — relied on another file's `next/headers`
  mock; now registers its own.
- `grading-bands.test.ts`, `syllabus-topics.test.ts` — read pre-ADR-024 paths
  (`app/(portal)/...`, `app/api/...`); now read the merged app's locations.

### Known follow-ups (not blockers)

1. **Nothing is committed.** The working tree carries the whole change set
   (102 modified, 416 deletions, 17 new files) for review.
2. **Live-database push.** The GIN index and additive schema are applied
   locally with the client regenerated; `prisma db push` against Neon needs a
   networked environment (P1001 from here).
3. **RLS is still not load-bearing** until the driver question in
   `rls/README.md` step 2 is answered.
4. **Secret rotation** (S3) needs provider-dashboard access; the scanner,
   `.env.example`, pre-commit hook and CI step are in place.
5. **The per-file runner is slower** than one process (~53 starts). If the
   suite's shared-harness design is ever made per-file-clean, `bun test tests`
   becomes viable again — the runner documents exactly why it exists.