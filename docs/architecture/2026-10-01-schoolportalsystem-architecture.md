# SchoolPortalSystem — Master Architecture (HISTORICAL)

**Date:** 2026-10-01  
**Status:** **SUPERSEDED** — This document describes the *planned* SchoolPortalSystem fork architecture before the Novastar repo consolidation.  
**Author:** Kilo orchestrator (fork architecture from `novastarmontissorischool`)  
**Source of truth (at time of writing):** `C:\Projects\schoolportalsystem` (new repo)  
**Parent decision:** [ADR-017](../adr/ADR-017-fork-portal-to-schoolportalsystem.md)  

> **⚠️ HISTORICAL NOTE (2026-10-08):** This document describes the *intended* fork architecture for SchoolPortalSystem, which assumed the Novastar repo would retain its three-app structure (`apps/public-site`, `apps/portal`, `apps/super-admin`). **As of ADR-024 (2026-10-08), the Novastar repo has been consolidated into a single merged app `apps/web`** containing all three surfaces under route groups. The fork strategy described here would need to be re-evaluated against the new merged architecture. See [ADR-024](../adr/ADR-024-consolidate-web-app.md) and [2026-10-08_003500-merge-portal-admin-public-into-apps-web.md](../technical/2026-10-08_003500-merge-portal-admin-public-into-apps-web.md) for the current state.

---

## 1. Vision

A **reusable, white-label school portal SaaS** that any school can integrate into
their existing website via a single "Portal Login" link. Clicking that link
routes the user through a unified login surface to their specific school's
tenant — a fully branded portal managing staff, students, attendance, grades,
fees, communications, and reports.

The system is offered under a **tiered subscription model** (Monthly, Yearly,
Lifetime, Free/Demo) with per-tenant AI API key management for AI-powered
reporting and natural-language data queries. The developer/operator manages the
entire fleet from a **super-admin dashboard** with cross-tenant visibility into
institutions, subscriptions, errors, and system health.

### Novastar as first deployment

The original repo (`C:\Projects\novastarmontissorischool`) remains the
reference deployment. Novastar's data and branding live as a tenant inside the
SaaS, not as hardcoded values in the product repo.

---

## 2. Project Structure (SchoolPortalSystem Monorepo)

```
schoolportalsystem/
├── .github/
│   └── workflows/           # CI/CD: build, lint, typecheck, test, mirror
├── apps/
│   ├── portal/              # FORKED from apps/portal in novastar-montessori
│   │   ├── app/             #   Next.js 16 App Router (14 sections, 18 API groups)
│   │   ├── components/      #   Shared + config entity UI
│   │   ├── lib/             #   Auth, tenant, prisma, rate-limit, logger
│   │   ├── proxy.ts         #   Next.js 16 middleware (now subscription-aware)
│   │   ├── tests/           #   109 unit tests carry over
│   │   └── e2e/             #   Playwright specs (auth, payments, rbac)
│   ├── super-admin/         # NEW: SaaS operator dashboard
│   │   ├── app/             #   Tenants, subscriptions, AI keys, errors, health
│   │   └── lib/             #   Admin context (separate from portal's tenant.ts)
│   └── marketing/           # NEW: SaaS landing page + signup (replaces public-site)
├── packages/
│   ├── database/            # FORKED: Prisma schema + 57 models (adds Subscription*)
│   ├── shared-types/        # FORKED: Zod schemas (adds Plan/Susbcription types)
│   ├── shared-ui/           # FORKED: Radix + themed design system (brandable)
│   ├── shared-utils/        # FORKED: GHS formatting, Twi, validation
│   ├── auth/                # FORKED: RBAC + delegation (subscription-aware)
│   ├── domain/              # FORKED: BaseService + FinanceService
│   ├── ghana-education/     # FORKED: NaCCA curriculum engine (may prune)
│   ├── subscriptions/       # NEW: Plan catalog, feature flags, gating logic
│   ├── billing/             # NEW: Stripe integration + payment provider abstraction
│   ├── ai-gateway/          # NEW: Per-tenant AI key routing + usage tracking
│   ├── sync-engine/         # Forked (stubs — Phase 9)
│   ├── notifications/       # Forked (wired to billing email layer)
│   └── testing/             # Empty placeholder (consistent with original)
├── tools/
│   ├── seed/                # Forked + expanded (multi-tenant seed)
│   ├── db-mirror/           # Forked (same logic, renamed env keys)
│   ├── tenant-cli/          # NEW (from empty placeholder): tenant provisioning
│   └── migrate/             # Empty placeholder (consistent with original)
├── docs/
│   ├── architecture/        # Architecture diagrams + this doc
│   ├── adr/                 # ADRs (001, 016, 017 carry over; new ones below)
│   ├── technical/           # Build plans
│   ├── api/                 # OpenAPI specs (new)
│   └── wireframes/          # Excalidraw (carry over from novastar)
├── turbo.json
├── package.json
├── tsconfig.base.json
├── biome.json
├── .bunfig.toml
├── AGENTS.md
└── README.md
```

### New ADRs to create during the fork

| ID | Title | Phase |
|----|-------|-------|
| ADR-017 | Fork Portal to SchoolPortalSystem (Reusable SaaS) | 0 |
| ADR-018 | Subscription Gating: Middleware Layer vs Per-Endpoint Checks | 1 |
| ADR-019 | Tenant Routing: Subdomain + Custom Domain + Query Param Resolution | 1 |
| ADR-020 | AI Gateway: Per-Tenant API Keys with Global Fallback | 2 |
| ADR-021 | Billing: Stripe + Provider Abstraction for Local Payments | 2 |

---

## 3. Fork Strategy: Copy / Change / Rewrite

### Copied verbatim (1-to-1)

| Source | Destination | Notes |
|--------|-------------|-------|
| `apps/portal/app/` (14 section dirs + API) | `apps/portal/app/` | Rename `@novastar` imports → `@schoolportalsystem` |
| `apps/portal/components/` | `apps/portal/components/` | Config entity list, student/teacher forms |
| `apps/portal/lib/` | `apps/portal/lib/` | `auth.ts`, `prisma.ts`, `password.ts`, `rate-limit.ts` |
| `apps/portal/proxy.ts` | `apps/portal/proxy.ts` | Will be extended with subscription gate |
| `apps/portal/tests/` | `apps/portal/tests/` | 109 tests, path aliases updated |
| `apps/portal/playwright.config.ts` | repo root | Shared config for portal E2E |
| `packages/database/` | `packages/database/` | 57 models — schema extended with 4 new tables (see §5) |
| `packages/shared-types/` | `packages/shared-types/` | Zod schemas — extended with subscription types |
| `packages/shared-ui/` | `packages/shared-ui/` | Component library — theming extended for white-label |
| `packages/shared-utils/` | `packages/shared-utils/` | Ghana utils, date formatting, ID generators |
| `packages/auth/` | `packages/auth/` | RBAC + delegation — extended with subscription context |
| `packages/domain/` | `packages/domain/` | BaseService + FinanceService |
| `tools/seed/` | `tools/seed/` | Single-tenant seed → multi-tenant seed |
| `tools/db-mirror/` | `tools/db-mirror/` | Mirror logic — env keys renamed |
| `docs/wireframes/` | `docs/wireframes/` | Excalidraw files |
| `docs/adr/ADR-001.md`, `ADR-016.md` | `docs/adr/` | Carry over |
| `AGENTS.md`, `turbo.json`, `tsconfig.base.json`, `biome.json` | root | Monorepo conventions |

### Renamed (find-and-replace `@novastar` → `@schoolportalsystem`)

Every `import ... from '@novastar/...'` in the portal, every `workspace:*`
dependency in a `package.json`, and every `@novastar` reference in test files,
config files, and comments. This is a mechanical sed operation, but it must be
verified by `bun run typecheck` at the end of Phase 0.

### NOT copied (replaced or stubbed)

| Original package | Reason | Replacement |
|------------------|--------|-------------|
| `packages/payments/` | Stubbed — returns `{ success: true, amount: 0 }` | `packages/billing/` (Stripe + provider abstraction) |
| `apps/public-site/` | Novastar-specific marketing | `apps/marketing/` (generic SaaS landing) |
| `apps/super-admin/` | Empty placeholder (planned but not built) | Built from scratch with tenant/subscription management |
| `.env.example` | Novastar-specific values (`DEFAULT_SCHOOL_CODE=NOVASTAR001`) | Generic `DEFAULT_SCHOOL_CODE=demo` |

### What is NOT changed (intentionally preserved)

- **The Prisma schema.** All 57 models are tenant-scoped (`tenantId` +
  `schoolId`). This is the multi-tenancy foundation. The fork adds 4-6 new
  tables (SubscriptionPlan, Subscription, SubscriptionEvent, AiKey,
  SystemError) but does not touch the existing 57.
- **The RBAC system** in `packages/auth/`. `getEffectivePermissions`,
  `createDelegation`, `approveDelegation` all remain. The subscription layer
  wraps them, not replaces them.
- **The entity config engine** in `packages/shared-types/config-schema.ts` and
  `entity-api-config.ts`. This is the "zero hardcoding" promise — all admin-
  editable entities stay exactly as-is.

---

## 4. Tenant Routing & Website Integration

### The integration flow

```
[Parent/Staff member] → clicks "Portal Login" on school's website
                      → browser navigates to schoolportalsystem
                      → unified login screen shown
                      → user logs in
                      → routed to their school's branded portal
                      → sees their dashboard
```

### Resolution strategy (three supported mechanisms)

| Mechanism | Example URL | Resolution |
|-----------|-------------|------------|
| **Subdomain** (primary) | `https://novastar.schoolportalsystem.com/login` | `req.headers.host` → split first label → `tenant.code` |
| **Custom domain** (white-label) | `https://portal.novastarschool.edu.gh/login` | `req.headers.host` → `Tenant.domain` lookup |
| **Query parameter** (simple integration) | `https://portal.schoolportalsystem.com/login?tenant=novastar` | `searchParams.tenant` → `tenant.code` |

### Unified login page

`apps/portal/app/login/page.tsx` is enhanced (not replaced) to support tenant
resolution. If the tenant is already resolved from the hostname, the login
form shows the school's logo and name. If no tenant is resolved, the page
shows a **tenant code input** — the user enters their school's code (delivered
via the parent site's "Portal Login" link, which includes `?tenant={code}`),
or selects from a *discoverable subset* of tenants (e.g., Novastar and any
school that has opted into public discovery). **No unauthenticated enumeration
of all tenants is allowed.**

### Middleware layer (new file: `apps/portal/lib/routing.ts`)

A new `tenantRouting()` function runs at the top of `proxy.ts`. **Important:**
Next.js middleware executes in the Edge Runtime, which cannot run Node/Prisma
(TCP sockets prohibited). The routing layer therefore uses a **Redis cache**
(Upstash, already in the stack) populated at tenant provisioning time:

```ts
// runs in proxy.ts, at the very top — reads from Redis cache, NOT Prisma
const routingResult = await resolveTenant(req) // Upstash Redis GET
if (routingResult instanceof NextResponse) return routingResult // redirect/error

// routingResult = { tenantId, tenant, school }
const tenantContext = { ...routingResult, ...existingSessionData }
```

The cache is a simple `SET` of `tenant:{code} → {tenantId, planKey, domain}`
updated by `tools/tenant-cli` on provision/suspend/delete. Authenticated
users who hit an unknown subdomain fall back to `getTenantContext()` (the
existing `lib/tenant.ts` function that resolves from the user's DB record).

The existing `getTenantContext()` in `lib/tenant.ts` stays for authenticated
routes. The routing layer resolves tenant from the **URL** so an unauthenticated
user still reaches the correct school's login page.

### Reserved subdomain protection

Subdomain routing rejects reserved hostnames to prevent routing conflicts
with Next.js internal routes:

```ts
const RESERVED_SUBDOMAINS = new Set([
  'www', 'localhost', '127', 'api', 'admin', 'billing', 'settings',
  '_next', 'static', 'auth', 'health', 'portal', 'app', 'docs'
])
```

Enforced in `resolveTenant()` and validated at tenant provisioning time.

### Custom domain DNS (with ownership verification)

Schools set a CNAME record pointing `portal.theirschool.edu.gh` →
`custom.schoolportalsystem.com`. The super-admin portal stores the domain in
`Tenant.domain`. Before activation, the school must add a **TXT record**
(`schoolportalsystem-tenant={tenantId}`) to prove DNS ownership. If a tenant
is suspended or deleted, the domain is flagged `orphaned` and the CNAME must be
re-verified before re-assignment — preventing subdomain takeover.
The routing middleware checks the domain table as a fallback after subdomain
lookup.

---

## 5. Database Extensions

### New tables (7 additions + 3 enums to the 57 existing)

The 6 new tables from §5 (SubscriptionPlan, Subscription, AiKey, SystemError,
AiUsage, BillingInvoice) plus `StripeEventLog` for webhook idempotency make 7.

```prisma
// packages/database/prisma/schema.prisma — additions

model SubscriptionPlan {
  id            String   @id @default(cuid())
  key           String   @unique // 'free', 'monthly', 'yearly', 'lifetime'
  name          String   // 'Demo', 'Monthly', 'Yearly', 'Lifetime'
  priceCents    Int      // 0 for free, 2999 for $29.99/month
  interval      SubscriptionInterval // 'month', 'year', 'lifetime'
  features      Json     // feature flags: { maxStudents: 500, maxStaff: 100, ... }
  sortOrder     Int
  isDefault     Boolean  @default(false)
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model Subscription {
  id                   String              @id @default(cuid())
  tenantId             String
  tenant               Tenant              @relation(fields: [tenantId], references: [id])
  planId               String
  plan                 SubscriptionPlan    @relation(fields: [planId], references: [id])
  status               SubscriptionStatus  @default(TRIALING)
  currentPeriodStart   DateTime
  currentPeriodEnd     DateTime?
  cancelAtPeriodEnd    Boolean             @default(false)
  canceledAt           DateTime?
  trialEndsAt          DateTime?
  stripeCustomerId     String?             // for Stripe-managed tenants
  stripeSubscriptionId String?
  featuresOverride     Json?               // per-tenant overrides applied on top of plan
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @default(now())

  @@unique([tenantId, stripeSubscriptionId])
}

model AiKey {
  id            String   @id @default(cuid())
  tenantId      String?  // nullable = global key
  tenant        Tenant?  @relation(fields: [tenantId], references: [id])
  provider      AiProvider  // 'openai', 'anthropic', 'google'
  apiKey        String   // encrypted at rest (see §8.3)
  isEnabled     Boolean  @default(true)
  keyVersion    Int      @default(1) // for rotation
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model SystemError {
  id            String   @id @default(cuid())
  tenantId      String?  // null = cross-tenant/system error
  tenant        Tenant?   @relation(fields: [tenantId], references: [id])
  statusCode    Int
  errorType     String
  message       String
  stackTrace    String?
  userAgent     String?
  endpoint      String?
  userId        String?
  resolvedAt    DateTime?
  createdAt     DateTime @default(now())

  @@index([tenantId, createdAt])
  @@index([createdAt])
}

model AiUsage {
  id            String   @id @default(cuid())
  tenantId      String
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  provider      AiProvider
  requestType   String?  // e.g., 'report_card', 'data_query'
  tokensUsed    Int      @default(0)
  createdAt     DateTime @default(now())

  @@index([tenantId, createdAt])
  @@index([tenantId, createdAt(sort: Desc)]) // for rolling-window usage queries
}

model StripeEventLog {
  id               String   @id @default(cuid())
  stripeEventId      String   @unique  // Stripe's event ID — dedup
  eventType         String
  processedAt       DateTime @default(now())
  result            String   // 'success' | 'error' | 'skipped'
  errorDetails      String?

  @@index([stripeEventId])
}

enum SubscriptionStatus { TRIALING ACTIVE CANCELED EXPIRED PAST_DUE }
enum SubscriptionInterval { MONTH YEAR LIFETIME }
enum AiProvider { OPENAI ANTHROPIC GOOGLE OPENROUTER COHERE MISTRAL }

// Extend Tenant.settings with subscription override fields:
//   { subscriptionPlanKey: "monthly", featuresOverride: {...} }
```

### Feature flag model

Features are defined in `SubscriptionPlan.features` (a JSON column) and
evaluated by `packages/subscriptions/` at runtime. The canonical feature set:

| Feature key | Description | FREE/Demo | Monthly | Yearly | Lifetime |
|-------------|-------------|-----------|---------|--------|----------|
| `max_students` | Max student records | 20 | 500 | 500 | 2000 |
| `max_staff` | Max staff records | 5 | 100 | 100 | 500 |
| `max_terms` | Active academic terms | 1 | 3 | 3 | 10 |
| `max_attachments` | File uploads/month | 5 | 500 | 500 | 5000 |
| `export_reports` | CSV/PDF export | ❌ | ✅ | ✅ | ✅ |
| `custom_domain` | White-label custom domain | ❌ | ✅ | ✅ | ✅ |
| `api_access` | REST API token access | ❌ | ✅ | ✅ | ✅ |
| `ai_reporting` | AI-powered report cards | ❌ (5) | ✅ (100) | ✅ (500) | ✅ (2000) |
| `sms_notifications` | SMS/WhatsApp alerts | ❌ | ✅ | ✅ | ✅ |
| `multi_school` | Manage >1 school | ❌ | ❌ | ✅ | ✅ |
| `priority_support` | Priority support queue | ❌ | ❌ | ✅ | ✅ |

*(5) = 5 AI queries/month on Demo, scaled on paid plans.*

### RLS for new tables + INSERT guard triggers

The existing 51 tenant-scoped RLS policies carry over. The 7 new tables get
matching policies:

- `SubscriptionPlan` — no tenant scope (global, read-only except super-admin)
- `Subscription`, `AiKey` where `tenantId IS NOT NULL`, `SystemError` where
  `tenantId IS NOT NULL`, `AiUsage`, `BillingInvoice`, `StripeEventLog` —
  scoped to `tenantId`
- `AiKey` where `tenantId IS NULL` — global (write for super-admin only)
- `SystemError` with `tenantId IS NULL` — super-admin reads only

**Critical:** RLS filters only SELECT/UPDATE/DELETE. INSERT is not restricted
by `tenantId`-based policies, so a malicious tenant could write a row with
`tenantId = NULL`. A `BEFORE INSERT FOR EACH ROW` trigger enforces:
`IF NEW.tenantId IS NULL THEN RAISE EXCEPTION 'tenantId required'` for all
tenant-scoped tables (except `AiKey` global keys which require the `is_super_admin`
claim). Write this in `packages/database/prisma/rls/`.

---

## 6. Subscription System

### Architecture: `packages/subscriptions/`

A pure-logic package (no UI, no I/O). Exports:

```ts
// packages/subscriptions/index.ts
export { SUBSCRIPTION_PLANS, DEFAULT_FEATURES }
export { getPlan } from './plan'
export { evaluateGate, checkSubscriptionGate } from './gating'
export { enforceLimit } from './limits'
export type { Plan, FeatureSet, GateResult }
```

### Gating flow (single authoritative check per request)

A single `withSubscriptionGate(tenantId, featureKey)` wrapper is the
**only** place gating happens — either in the route handler (via a
HOC/wrapper) or as a single middleware call with request-scoped caching.
**It is NOT called in both places.** The middleware injects the resolved
subscription + features into `request.context` for that request's lifetime;
every route handler reads from that cache instead of re-querying:

```ts
// Single wrapper — used by route handlers, reads request context
export async function withSubscriptionGate(
  ctx: RequestContext,
  featureKey: string,
  fn: () => Promise<NextResponse>
): Promise<NextResponse> {
  const gate = await ctx.subscriptionGate ?? computeGate(ctx.tenantId)
  if (!gate.allowed) return NextResponse.json({ error: gate.reason }, { status: 402 })
  return fn()
}
```

This replaces the old plan of calling `checkSubscriptionGate` in **both**
middleware and every API route. The `packages/subscriptions/` package exports
`evaluateGate(tenantId, plan, featureKey)` as pure logic operating on already-loaded
data, plus `loadSubscription(tenantId)` as the Prisma delegate — keeping I/O
explicit and testable.

### Middleware integration

`proxy.ts` calls `withSubscriptionGate` **once** at the top of the
`withAuth` handler, caching the result in `request.context`. Public routes
(login, health, tenant selection) bypass gating entirely. The request-scoped
cache is read by all downstream route handlers — no second DB query.

### Plans & pricing

| Plan | Price | Interval | Target | Key Limits |
|------|-------|----------|--------|------------|
| Free / Demo | $0 | forever | Schools testing | 20 students, 5 staff, 1 term, demo watermark, 5 AI queries, no export, no custom domain |
| Monthly | $29 | /mo | Small schools | 500 students, 100 staff, export, API, custom domain, 100 AI queries |
| Yearly | $299 ($24.92/mo) | /yr | Schools (2 mo discount) | Same as Monthly |
| Lifetime | $999 | one-time | Schools preferring perpetual | 2000 students, 500 staff, everything included |

Billing supports **Stripe (primary)** with **Paystack** and **Flutterwave** as
regional alternatives for African markets. The provider is selected per-plan
and per-region: Monthly/Yearly default to Stripe; schools in Ghana can opt for
Paystack/Flutterwave/MTN MoMo; Lifetime can use any provider. Non-Stripe
Lifetime payments require **payment proof upload + operator approval with audit
trail** in the super-admin UI.

| Region | Recurring (Monthly/Yearly) | Lifetime alternatives |
|--------|---------------------------|-----------------------|
| Global | Stripe | Stripe |
| Ghana | Stripe + Paystack + Flutterwave | Paystack + Flutterwave + MTN MoMo + Bank Transfer |

### Trial flow

Every non-demo sign-up gets a 14-day trial. `Subscription.status = TRIALING`,
`trialEndsAt = now + 14d`. During trial, all paid-plan features are available.
If no payment is captured before `trialEndsAt`, the subscription
auto-downgrades to `EXPIRED` and the tenant hits the FREE limits.

A **cron job** (daily, Upstash) uses a distributed lock (Redis `SETNX`)
and atomically runs:
```sql
UPDATE "Subscription" SET status = 'EXPIRED'
WHERE status = 'TRIALING' AND "trialEndsAt" < NOW()
RETURNING "tenantId"
```
This is idempotent, concurrency-safe, and does not require a separate consumer.

---

## 7. Billing System (`packages/billing/`)

### Stripe integration

- **Checkout Sessions** — creates the Stripe Checkout flow for Monthly/Yearly.
  Uses `mode: 'subscription'`.
- **Customer Portal** — Stripe-hosted customer portal for plan changes and
  cancellations. Redirect URL: `/settings/billing`.
   - **Webhooks** — `stripe.webhook` route handles `checkout.session.completed`,
     `invoice.payment_succeeded`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `customer.subscription.paused`, etc.
     Updates the local `Subscription` table. **Every event is first checked
     against `StripeEventLog` (unique on `stripeEventId`) to guarantee
     exactly-once processing — duplicates are skipped.

### Provider abstraction (preserving the original pattern)

The original `packages/payments/` had a provider abstraction (MTNMoMoProvider,
BankTransferProvider). The new `packages/billing/` keeps this pattern:

```ts
interface PaymentProvider {
  name: string
  verifyPayment(transactionId: string): Promise<PaymentResult>
  createPaymentIntent(amount: number, currency: string): Promise<string>
}
```

- `StripeProvider` — default for recurring plans (Monthly/Yearly). Full webhook
  support, customer portal, subscription management.
- `PaystackProvider` — alternative payment provider for African markets.
  Supports card + mobile money.
- `FlutterwaveProvider` — alternative payment provider for African markets.
  Supports card + mobile money + bank transfer.
- `MTNMoMoProvider` — MTN Mobile Money (Ghana-specific).
- `BankTransferProvider` — for schools that pay Lifetime via bank transfer.

The provider is selected per-plan and per-tenant-region. Monthly/Yearly default
to Stripe (global reach). Schools in Ghana can opt for Paystack/Flutterwave/MTN
MoMo. Lifetime can use any provider — **non-Stripe Lifetime payments require
payment proof upload + operator approval with audit trail** in the super-admin
UI (not blind "mark paid").

### Invoice model

`packages/database` gains a `BillingInvoice` table tracking Stripe invoice IDs,
amounts, statuses, and the tenant they belong to. The portal's existing
`FeeInvoice` (for school fees) stays untouched — this is for **subscription
billing** only. Webhook event processing is deduplicated via the
`StripeEventLog` table (unique `stripeEventId`).

---

## 8. AI Gateway (`packages/ai-gateway/`)

### Per-tenant key routing

Each tenant can configure AI keys in the `AiKey` table (linked via
`tenantId`). The system resolves keys in priority order:

1. **Tenant-specific key** — if the tenant has configured a key for the
   requested provider, use it.
2. **Global default key** — if no tenant key exists, use the global key from
   `AiKey` where `tenantId IS NULL`.
3. **Deny** — if no key exists at all, AI features return a clear error.

Supported providers: OpenAI, Anthropic, Google, OpenRouter/KiloCode
(OpenAI-compatible proxy), Cohere, Mistral.

### Key storage (with rotation)

- AI keys are encrypted at rest using `AES-256-GCM`. The encryption key is
  **derived** from `AI_ENCRYPTION_KEY` via PBKDF2 (`crypto.subkey`) with a
  fixed salt, ensuring exactly 256 bits — invalid keys fail fast at boot.
- `AI_ENCRYPTION_KEY` length is validated at startup (`>= 32 chars` or
  hex-decoded to 32 bytes).
- `AiKey.keyVersion` (Int, default 1) allows key rotation: the `crypto.ts`
  module stores a version byte prefix on ciphertext. Rotation writes a new
  master key, re-encrypts keys in batches (checkpointed via
  `keyVersion`), and old keys can be retired after all rows are migrated.
- Super-admin UI shows masked keys (first 4 + last 4 chars) — the full key is
  never sent to the browser.

### Usage tracking & limits (atomic enforcement)

| Plan | AI queries/month | Enforcement |
|------|-----------------|-------------|
| Free/Demo | 5 | Hard cap — returns 402 if exceeded |
| Monthly/Yearly | 100/500 | Hard cap |
| Lifetime | 2000 | Hard cap |

Used is tracked in `AiUsage` (tenantId, provider, requestType, tokensUsed,
createdAt). The counter is enforced **atomically**: the gating check uses a
single `UPDATE ... SET used = used + 1 WHERE tenantId = $1 AND used < limit`
with a `CHECK (used <= limit)` constraint, so concurrent requests cannot
overshoot. **Rolling 30-day window** — usage is counted from
`createdAt > now() - 30 days`, not calendar-month reset.

### AI features in the portal

- **AI Report Cards:** Generate narrative assessment comments from score data.
  Triggered from `/reports/[studentId]` with an "AI Summary" button.
- **AI Data Query:** Natural-language questions about school data
  ("How many students failed math this term?"). Available in the dashboard
  search bar when `ai_query` feature is enabled.

---

## 9. Super-Admin Dashboard (`apps/super-admin/`)

### Two-authorisation model

The super-admin is a **separate app** with its own auth model. Operators are
**not** `User` rows in any tenant. They authenticate against a static allowlist
(`SUPER_ADMIN_EMAIL` env var) + a one-time password sent via Resend. This
design is mandated by [ADR-001](../adr/ADR-001-monorepo-turborepo-bun-workspaces.md) in the original repo —
the super-admin must not reuse the portal's `getTenantContext()`.

### Features

| Section | Capabilities |
|---------|-------------|
| **Tenants** | List all tenants with status, plan, student/staff counts, last login. Create (calls `tools/tenant-cli`'s `provisionTenant`), suspend, reactivate, delete. **Suspend deletes the tenant's `Session` rows (next-auth) and triggers a cache invalidation in Redis** to evict the tenant-code→tenantId cache entry. |
| **Subscriptions** | View plan, status, trial end, Stripe customer ID. Cancel, extend trial, grant feature override, refund. |
| **AI Keys** | Manage global keys (add, rotate, delete, test). Per-tenant key assignment. Toggle `ai_enabled` per tenant. |
| **Errors** | Centralized error log from all tenant portals. Filter by tenant, error type, date range. Resolve, assign, add notes. |
| **Health** | Database connectivity check, Stripe webhook status, Supabase mirror freshness, recent deployment info, per-tenant portal uptime (ping). |
| **Usage** | Monthly AI usage per tenant, storage usage, bandwidth. |
| **Feature Flags** | Global toggle for AI, SMS, etc. — overrides per-plan settings. |

### Restricted user access

The super-admin can create **restricted operator accounts** — support staff
with limited access:
- **Support role:** Can view errors and health, cannot manage subscriptions or
  AI keys.
- **Billing role:** Can view and manage subscriptions, cannot see tenant data
  or AI keys.

These are stored in a new `AdminUser` table (email, hashedPassword, role,
createdAt, lastLoginAt, failedAttempts) with a `role` enum
(`OWNER | SUPPORT | BILLING`). Auth uses a dedicated `SUPER_ADMIN_SECRET` JWT,
separate from `NEXTAUTH_SECRET`. JWTs are short-lived (15 min) with a refresh
token; the super-admin shares the portal's `Session` table structure but uses a
separate `AdminSession` table with revocation support.

### Data isolation

The super-admin database role has explicit grants to read all tenants but
**cannot write** tenant data — writes to `Subscription`, `SystemError`,
`AiKey` go through super-admin API endpoints, not direct DB access. This
prevents a compromised super-admin session from altering student records.

---

## 10. System Data Flow

```
                    ┌─────────────────────────────────────────────┐
                    │  School's existing website                   │
                    │  (greenvalley.edu.gh)                        │
                    │  Has a "Portal Login" button                 │
                    └────────────────────┬──────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────────┐
                    │  schoolportalsystem.com                      │
                    │  apps/portal (Next.js 16)                   │
                    │                                             │
                    │  1. Tenant Routing Middleware                │
                    │     subdomain: {code}.schoolportalsystem.com│
                    │     custom domain: stored in Tenant.domain   │
                    │     query param: ?tenant={code}              │
                    │                                             │
                    │  2. tenantRouting() → resolveTenant()        │
                    │     Sets TenantContext                        │
                    │                                             │
                     │  3. proxy.ts (Next.js 16 middleware)         │
                     │     a. Rate limiting (preserved)              │
                     │     b. Single subscription gate (NEW)         │
                     │        → withSubscriptionGate(tenantId, feature)│
                     │        → caches result in request.context     │
                     │        → 402 if over limits                   │
                     │     c. Auth (next-auth)                        │
                     │     d. RBAC (preserved)                     │
                     │                                             │
                     │  4. getTenantContext() (per-request)         │
                     │     Resolves DB user → tenantId               │
                     │                                               │
                     │  5. API Routes (18 groups, preserved)         │
                     │     Reads gate from request.context (no re-query)│
                    │                                             │
                    │  6. Database (Prisma + Neon)                  │
                    │     Tenant-scoped queries via tenantId        │
                    │                                             │
                    │  7. AI Gateway (optional)                    │
                    │     Resolves per-tenant key or global key    │
                    │     Tracks usage in AiUsage table             │
                    └────────────────────┬──────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────────┐
                    │  Database: PostgreSQL (Neon primary)        │
                    │  + Supabase failsafe (mirrored)               │
                    │                                              │
                     │  Shared: 57 tenant-scoped tables             │
                     │  New:    7 subscription/AI/error tables      │
                     └──────────────────────────────────────────────┘

                     ┌─────────────────────────────────────────────┐
                     │  apps/super-admin/                           │
                     │  (operator-facing, separate auth)           │
                     │                                              │
                     │  - Tenant management (provision/suspend)     │
                     │  - Subscription management (Stripe/Paystack) │
                     │  - AI key management (per-tenant + global)   │
                     │  - Error reporting (cross-tenant)            │
                     │  - System health monitoring                  │
                     │  - Usage analytics                           │
                     └──────────────┬───────────────────────────────┘
                                    │
                                    ▼
                     ┌─────────────────────────────────────────────┐
                     │  External Services                           │
                     │  - Stripe (billing + webhooks, primary)      │
                     │  - Paystack (Alternative payment provider)   │
                     │  - Flutterwave (Alternative payment provider)│
                     │  - Resend (emails)                          │
                     │  - OpenAI / Anthropic / Google (AI)          │
                     │  - OpenRouter / KiloCode (OpenAI-compatible) │
                     │  - UploadThing / Supabase Storage /          │
                     │    Cloudflare R2 / Neon S3 (file storage)     │
                     │  - Upstash Redis (rate limiting + caching)   │
                     └──────────────────────────────────────────────┘
```

---

## 11. Branding & White-Label

### Per-tenant theming

`apps/portal/` reads `Branding` from the resolved tenant and applies it as
CSS custom properties. The existing `Branding` table (already in the Prisma
schema) stores: `name`, `logoUrl`, `primaryColor`, `secondaryColor`,
`accentColor`, `motto`, `socialLinks`.

### shared-ui theming

`packages/shared-ui/src/` gains a `BrandProvider` that injects tenant colors
into the Radix theme. The component library was already built with
`tailwind-merge` — the fork extends it to accept a `brand` object.

### Demo watermark

A `DemoWatermark` component renders "DEMO — Upgrade at schoolportalsystem.com"
on every page when the tenant's subscription plan is `free`. This is a config
flag, not a code branch.

---

## 12. Security Model

### Defense in depth (4 layers)

1. **Tenant routing** — URL resolution determines which tenant's data is
   accessible. Cannot escape the tenant without re-resolving.
   Subdomain is the authoritative source; query param is secondary.
2. **Subscription gating** — plan features enforced before RBAC checks.
   Single per-request cache — no re-query.
3. **RBAC + delegation** — existing system, preserved from the fork.
4. **RLS + INSERT guards** — database-level row isolation with `BEFORE INSERT`
   triggers preventing writes to `tenantId IS NULL` rows by non-admin roles.

### AI key security (updated)

- Keys encrypted at rest (AES-256-GCM) with **versioned** encryption
  (`keyVersion` field on `AiKey`), PBKDF2-derived key validated at boot.
- Never sent to browser (super-admin shows masked).
- Rotation: increment `keyVersion`, re-encrypt in batches, old key retained
  until all rows migrated.
- Requests proxied through the portal server (the browser talks to
  `/api/ai/*` which talks to the provider). The provider API key never leaves
  the server.

### Super-admin isolation (updated)

- Separate auth (`SUPER_ADMIN_SECRET`).
- Separate database role (read-only on tenant data tables, write on
  `Subscription`/`SystemError`/`AiKey`/`SubscriptionPlan` only).
- **INSERT guard triggers** enforce that non-admin roles cannot write
  `tenantId IS NULL` rows.
- Separate Next.js app — no shared middleware with portal.

---

## 13. Implementation Phases

| Phase | Weeks | Focus | Key Deliverable |
|-------|-------|-------|-----------------|
| 0 | 1-2 | **Fork** — Copy, rename, verify build | `schoolportalsystem` builds clean, 109 tests pass, schema migrates |
| 0.5 | 2-3 | **Migration validation** — Export/import scripts tested against Novastar DB | Migration script runs against a copy of Novastar's data; 100 records verified |
| 1 | 3-4 | **Tenant routing + subscription model** | Subdomain routing works, 7 new tables, single-layer gating |
| 2 | 5-6 | **Billing + AI gateway** | Stripe checkout + `checkout.session.completed` webhook, AI key management, usage tracking |
| 3 | 7-9 | **Demo mode + marketing site** | Demo tenant with sample data, freemium limits, landing page with signup |
| 4 | 10-12 | **Super-admin dashboard** | Tenants, subscriptions, AI keys, error reporting, health monitoring |
| 5 | 13-14 | **Custom domain + white-label** | CNAME routing + DNS verification, per-tenant theming, demo watermark |
| 6 | 15-16 | **Integration testing + launch** | End-to-end validated |

---

## 14. What Stays in the Original Repo

The `novastarmontissorischool` repo is **not modified** by this fork. It remains
the reference deployment. When schoolportalsystem is ready for Novastar to
migrate, the migration plan is:

1. Export Novastar's tenant data from the old DB.
2. Import into the new `schoolportalsystem` DB.
3. Point `novastar.schoolportalsystem.com` at the new deployment.
4. Shut down the old repo (optional — it can run in parallel during transition).

**Phase 0.5** validates this migration path: export/import scripts are tested
against a copy of Novastar's DB before the fork proceeds to Phase 1.

---

## 15. Risk Register

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Rename `@novastar` → `@schoolportalsystem` misses a reference, breaking builds | Use codemod (jscodeshift) instead of sed. Phase 0 verification: `bun run typecheck` + `bun run build` + grep for `@novastar` in ALL file types |
| R2 | Subscription gating is too coarse and blocks legitimate features | Single-layer gating (`withSubscriptionGate`), request-scoped cache. Feature flags per-key, not per-plan. |
| R3 | Tenant enumeration — attacker probes subdomains to discover schools | Redis-cached routing (no DB hit per request); no unauthenticated tenant selector; reserved subdomain blocklist |
| R4 | AI key encryption — no rotation, no key versioning | `keyVersion` field on `AiKey`; PBKDF2-derived key validated at boot; batch re-encryption with checkpointing |
| R5 | Stripe webhook failure causes double-billing | `StripeEventLog` table (unique `stripeEventId`); webhook handler checks dedup before processing |
| R6 | Trial expiry has no consumer — trials never downgrade | Daily cron with Redis `SETNX` distributed lock; atomic `UPDATE WHERE status=TRIALING AND trialEndsAt < NOW()` |
| R7 | RLS doesn't protect INSERTs — tenant writes global rows | `BEFORE INSERT FOR EACH ROW` trigger rejects `tenantId IS NULL` for non-super-admin roles |
| R8 | Custom domain takeover after tenant deletion | DNS ownership verification (TXT record challenge); orphaned domains flagged, must re-verify |
| R9 | AI usage counter race condition — concurrent requests overshoot cap | Atomic `UPDATE ... SET used = used + 1 WHERE used < limit` with `CHECK` constraint |
| R10 | Edge middleware can't use Prisma (Edge Runtime) | Redis cache for tenant resolution; authenticated fallback to `getTenantContext()` |

---

## 16. Verification Checklist

After Phase 0 (fork):

```bash
# 1. No Novastar references remain (check ALL file types, not just ts/tsx/json)
cd C:\Projects\schoolportalsystem
grep -rn "@novastar" . --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.yml" --include="*.yaml" --include="*.toml" --include="*.env*" --include="Dockerfile*" --include=".dockerignore"
# → 0 matches (except in docs/ acknowledging the source)

# 2. Monorepo builds clean
bun run build  # → exit 0

# 3. All 109 tests pass
bunx turbo run test --filter=portal

# 4. Typecheck passes
bun run typecheck

# 5. Prisma client generates
bun run --cwd packages/database db:generate

# 6. No workspace:* references point to old names
grep -rn "novastar-montessori" packages/*/package.json apps/*/package.json
# → 0 matches
```

---

## 17. Expansion Points (Beyond This Planning Doc)

The full architecture doc with cross-platform distribution, tenant-specific
customization, demo app gating, and expanded provider support (Paystack,
Flutterwave, OpenRouter, Cloudflare R2) lives in the **SPS fork** at
`C:\Projects\schoolportalsystem/docs/architecture/`.

This Novastar-repo copy is the **planning source** — the SPS fork version is
the canonical living document.
