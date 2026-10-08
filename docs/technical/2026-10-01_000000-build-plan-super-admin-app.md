# Build Plan — `apps/super-admin` (Cross-Tenant SaaS-Owner Dashboard) — **HISTORICAL**

> **⚠️ HISTORICAL DOCUMENT (2026-10-08):** This document describes the **original separate `apps/super-admin` app** before the consolidation into `apps/web` (ADR-024, 2026-10-08). The super-admin console now lives at `apps/web/app/admin/`. This document is preserved for historical reference.

**Status:** **SUPERSEDED** (was BUILT, verified 2026-10-03)  
**Author:** written 2026-10-01  
**Target directory (historical):** `apps/super-admin/` (fully implemented as of 2026-10-03)  
**Current location (post-merge):** `apps/web/app/admin/`  
**Master plan reference:** `docs/technical/2026-09-24_000000-novastar-montessori-master-plan-final.md:24`  
— `super-admin/  # Super Admin dashboard (cross-tenant, for SaaS owner)`

> **This plan does not authorise deleting `apps/super-admin/`.** The directory is
> a placeholder that already exists on disk. This plan fills it in.
>
> **Status (verified 2026-10-03): SUPERSEDED.** That premise was false. The
> directory is not a placeholder and is not empty: it holds 54 source files
> (app routes, 15 lib files, 13 components, 8 test files). This plan is the plan
> it actually became, so the rest of the document is read as the specification
> that was delivered, not as work still to do.

> **⚠️ ARCHITECTURE UPDATE (2026-10-08):** As of ADR-024, `apps/super-admin/` has been merged into `apps/web/app/admin/`. The functionality described here is now part of the single merged app. See [ADR-024](../adr/ADR-024-consolidate-web-app.md) and the [merge plan](../technical/2026-10-08_003500-merge-portal-admin-public-into-apps-web.md).

---

## Verification pass - 2026-10-03 (PRE-MERGE)

**Status (verified 2026-10-03): BUILT, with three named gaps.** This is the plan
`apps/super-admin` actually became. Every BUILT / PARTIAL / NOT-BUILT verdict is from
reading the files; **corrected 2026-10-03**, the runtime claims are no longer
UNVERIFIABLE - `bun run build:super-admin`, `bun run typecheck --filter super-admin`,
`bun run lint --filter super-admin` and `bun run test --filter super-admin` have all
been run and all passed. See "Not claimed" at the foot of this section.

### Verdicts (PRE-MERGE STATE)

| Claim in this plan | Status (verified 2026-10-03) |
|---|---|
| Workspace scaffolding and `build:super-admin` | **BUILT** - `apps/super-admin/package.json:2`, root `package.json:15`, `tsconfig.json`, `next.config.ts`, `postcss.config.cjs`, `.env.example` |
| Separate `admin-context.ts` / `admin-auth.ts` / `permissions.ts` with a dashboard route guard and tests | **BUILT** - `tests/admin-context.test.ts` |
| Cross-tenant tenant list, detail, schools, users and switcher | **BUILT** - `app/(dashboard)/tenants/`, `[tenantId]/{page,schools/page,users/page,not-found}.tsx`, `components/tenant-{table,switcher,status-badge,actions}.tsx` |
| Provisioning route imports the CLI function rather than copying it | **BUILT** - `lib/provision.ts:1` imports `provisionTenant` from `@novastar/tenant-cli/provision`; `app/api/tenants/[tenantId]/provision/route.ts`, `tests/provision-route.test.ts` |
| Cross-tenant audit log | **BUILT** - `app/(dashboard)/audit/page.tsx`, `components/audit-log-table.tsx`, `app/api/audit/route.ts` |
| Root `test` includes `--filter=super-admin` | **BUILT** - `package.json:22` |
| README documents the never-import-`getTenantContext` rule | **BUILT** - `apps/super-admin/README.md:228-243`, restated at `lib/provision.ts:4` |
| Acceptance criterion `grep -c workspace:*` yields 6 | **SUPERSEDED** - it now yields 7 (`package.json:14-20`) |
| The dependency list in this plan | **SUPERSEDED** - no `next-auth`, no `@tanstack/react-query`, no `react-table`, no `zustand`, no `@novastar/domain`. The real stack is `lib/admin-auth.ts` + `app/api/auth/{login,logout}` + `argon2` + `zod`, plus `@novastar/notifications` and `@novastar/tenant-cli` |
| `app/api/auth/[...nextauth]/route.ts` | **SUPERSEDED** - replaced by `login/route.ts` + `logout/route.ts`. The plan's own Risk 3 warned against pairing next-auth v4/v5; that trap was avoided |
| Suspend / reactivate reachable from the admin UI | **PARTIAL** - implemented in `tools/tenant-cli/commands/{suspend,reactivate}.ts` and exposed through the CLI break-glass operator path (`commands/operator.ts:4`), but `app/api/tenants/[tenantId]/route.ts` has no isActive action and there is no UI |
| Health page signals (`_prisma_migrations` row count, `SUPABASE_DATABASE_URL` reachability) | **PARTIAL** - `lib/health.ts`, `app/(dashboard)/health/page.tsx` and `app/api/health/route.ts` exist, but those two specific signals could not be confirmed as read |
| `playwright.admin.config.ts`, root `test:e2e:admin`, CI `test-e2e-admin` job | **NOT-BUILT** - only `playwright.config.ts` exists; `ci.yml` has no such job |
| "Add `SUPER_ADMIN_*` to `turbo.json` `globalEnv`" | **NOT-BUILT, and superseded for a different reason** - those variable names were renamed away. The app now uses `PLATFORM_SESSION_SECRET` (`next.config.ts:62`) and DB operator rows, which `lib/admin-auth.ts:196` states explicitly. See open item 1 |

### Open items, ranked by impact

1. **Add `PLATFORM_SESSION_SECRET` to `turbo.json` `globalEnv`.** `turbo.json:76-110`
   has no such key, and turbo does not pass undeclared variables through to a task,
   so the app's session secret is not reaching the build. This is the one defect
   found here that changes runtime behaviour.
2. **No admin E2E coverage.** `playwright.admin.config.ts`, the root
   `test:e2e:admin` script and the CI `test-e2e-admin` job are all absent, so the
   cross-tenant console has unit tests but no browser coverage.
3. **No suspend/reactivate UI.** The capability exists in the CLI only.

### Not claimed

- **VERIFIED (measured 2026-10-03), replacing the previous "nothing was run" verdict.**
  `bun run build:super-admin` succeeds - `bunx turbo run build` reports 4/4 tasks
  successful and the super-admin task emits 18 routes. `bun run typecheck --filter
  super-admin` passes as part of the 18/18 typecheck tasks. `bun run lint --filter
  super-admin` passes as part of 18/18 lint tasks, 0 errors (the single repo-wide
  warning is pre-existing and lives in `packages/shared-types`, not here). `bun run
  test --filter super-admin` passes: **150 tests across 7 files, 0 fail**, part of the
  repo total of 1396 pass / 0 fail across 7/7 test tasks.
- **STILL UNVERIFIABLE.** No admin E2E coverage exists to run, so the cross-tenant
  console has no browser-level evidence: `playwright.admin.config.ts`,
  `bun run test:e2e:admin` and the CI `test-e2e-admin` job are all absent (see open
  item 2). The `ci:docker` image build, the TeamCity/Vercel deploy paths, and any
  Prisma migration or live-database command were not run either.
- The health page's two unconfirmed signals (`_prisma_migrations` row count,
  `SUPABASE_DATABASE_URL` reachability) still require a live database and remain
  UNVERIFIABLE.

## 1. Goal

Create `apps/super-admin` as the **third and final deployable** in the
monorepo: a cross-tenant administration dashboard for the SaaS owner (the person
who operates Novastar Montessori as a product and will one day operate it for
other schools). It lists every tenant, drills into any single tenant, manages
tenant lifecycle, and surfaces platform-wide health.

## 2. Why it exists

Three reasons, in order of importance:

1. **It is a specified deliverable that does not exist.** The master plan's
   PROJECT STRUCTURE names it, and the root `package.json:15` already carries a
   script that targets it:
   ```json
   "build:super-admin": "turbo run build --filter=super-admin"
   ```
   `docs/audit-reports/phase6-devops-infra.md` FINDING B-3 rates this **HIGH**:
   the script targets an empty directory with no `package.json`, so the filter
   matches nothing. That script starts working the moment this plan is executed.
   It must stay broken until then — deleting the script was the alternative fix
   (`phase6` R-7) and was correctly rejected, because the dashboard is a
   requirement, not dead code.

   **Status (verified 2026-10-03): SUPERSEDED.** FINDING B-3 is resolved.
   `apps/super-admin/package.json` exists, so `--filter=super-admin` matches a
   real workspace member and the script is no longer broken. **VERIFIED (measured
   2026-10-03): the build itself succeeds too** - `bun run build:super-admin`
   emits 18 routes, and the app passes typecheck (18/18 tasks), lint (18/18 tasks,
   0 errors) and its own tests (150 pass / 0 fail across 7 files).

2. **Tenant lifecycle has no owner.** `Tenant` and `School` rows exist
   (`packages/database/prisma/schema.prisma:13-51` and `:53-93+`), and the
   intended tenant provisioning tool is `tools/tenant-cli` (see its plan). But
   a SaaS owner needs a *UI* for onboarding a school and taking one away — a CLI
   is not an onboarding interface. This app is that interface.

3. **It is the operational counterpart to the school administrator.** The
   portal's headmaster administers one school. This app administers the *fleet*.

### Hard requirement: this is a SEPARATE deployable with its own tenant model

**`apps/super-admin` must NOT reuse the portal's `getTenantContext()`.**

`apps/portal/lib/tenant.ts:18-43` resolves tenant scope from the authenticated
user's own database row:

```ts
const dbUser = await prisma.user.findUnique({
  where: { id: user.id },
  select: { tenantId: true, role: { select: { name: true } } },
})
```

That is correct and load-bearing for the portal: it means a user can never
escape their own tenant by tampering with a header, cookie, or subdomain. The
super-admin has **no tenant row**. It enumerates *all* tenants and switches
between them deliberately. Forcing that through `getTenantContext()` would mean
either faking a `User` row per tenant (wrong model — a super-admin is not a
tenant user) or refactoring `getTenantContext()` to accept an override parameter
(wrong — a footgun that, once it exists, is one careless call site away from
being used in the portal).

**The rule: two authorisation models, two apps, two codebases. No shared tenant
resolution.** Concretely:

- `apps/super-admin/lib/admin-context.ts` — resolves the *operator* identity
  and the *selected* tenant. Separate module, separate file, separate app.
- It does not import anything from `apps/portal/lib/tenant.ts`. That is not
  possible without a cross-app import, which the monorepo forbids
  ([ADR-001](../adr/ADR-001-monorepo-turborepo-bun-workspaces.md)).
- Its data access is explicit: every query names the tenant it is scoped to, or
  is deliberately cross-tenant. There is no ambient tenant.

Additional consequences of the separate model:

- **Separate session/auth.** Super-admin operators are not `User` rows. Reuse
  `packages/auth` only for its permission primitives, not for the portal's
  session shape.
- **Separate route guard.** The portal's middleware does not apply.
- **Row-level security is not a substitute.** RLS scopes a session's tenant. The
  super-admin's database role must be a distinct role with explicitly broader
  grants, and that must be a deliberate, reviewed decision — see Risks.

## 3. Exact files to create

```
apps/super-admin/
├── package.json
├── tsconfig.json
├── next.config.ts
├── next-env.d.ts                (generated by next; gitignored — see .gitignore:9)
├── postcss.config.mjs
├── postcss.config.cjs
├── .env.example
├── README.md
├── app/
│   ├── layout.tsx               root layout, admin shell
│   ├── page.tsx                 redirect → /tenants
│   ├── globals.css
│   ├── (auth)/
│   │   ├── layout.tsx
│   │   └── login/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx           shell: nav, tenant switcher
│   │   ├── page.tsx             platform overview
│   │   ├── tenants/
│   │   │   ├── page.tsx         tenant list (cross-tenant)
│   │   │   └── [tenantId]/
│   │   │       ├── page.tsx     tenant detail
│   │   │       ├── settings/page.tsx
│   │   │       ├── schools/page.tsx
│   │   │       └── users/page.tsx
│   │   ├── health/
│   │   │   └── page.tsx         mirror status, migration status, job runs
│   │   └── audit/
│   │       └── page.tsx         cross-tenant audit log
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── tenants/route.ts
│       ├── tenants/[tenantId]/route.ts
│       ├── tenants/[tenantId]/provision/route.ts
│       ├── health/route.ts
│       └── audit/route.ts
├── lib/
│   ├── admin-context.ts         operator identity + selected tenant  (see §2)
│   ├── admin-auth.ts            admin session options
│   ├── prisma.ts                client for the admin DB role
│   ├── permissions.ts           operator capability check
│   └── navigation.ts
├── components/
│   ├── tenant-switcher.tsx
│   ├── tenant-table.tsx
│   ├── tenant-status-badge.tsx
│   ├── school-list.tsx
│   ├── health-checks.tsx
│   └── audit-log-table.tsx
├── types/
│   └── admin.ts
└── tests/
    ├── admin-context.test.ts
    ├── tenant-switch.test.ts
    └── rbac.test.ts
```

## 4. `package.json`

The package **must be named `super-admin`**, not `@novastar/super-admin`, because
`package.json:15` filters on the bare name `--filter=super-admin`. This matches
the sibling convention (`portal`, `public-site` — both unnamespaced) and is what
makes the existing root script work.

```jsonc
{
  "name": "super-admin",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3200",
    "build": "next build",
    "start": "next start --port 3200",
    "lint": "eslint . --ext .ts,.tsx",
    "typecheck": "tsc --noEmit",
    "test": "bun test --pass-with-no-tests",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@novastar/auth": "workspace:*",          // permission primitives ONLY, not session shape
    "@novastar/database": "workspace:*",
    "@novastar/domain": "workspace:*",
    "@novastar/shared-types": "workspace:*",
    "@novastar/shared-ui": "workspace:*",
    "@novastar/shared-utils": "workspace:*",
    "@tanstack/react-query": "^5.57.1",
    "@tanstack/react-table": "^8.21.3",
    "next": "16.3.3",
    "next-auth": "^4.24.15",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "zod": "^4.4.3",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.3",
    "@tailwindcss/typography": "^0.5.20",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.5",
    "@typescript-eslint/eslint-plugin": "^8.71.0",
    "@typescript-eslint/parser": "^8.71.0",
    "eslint": "^9.39.5",
    "eslint-config-next": "^16.3.3",
    "tailwindcss": "^4.3.3",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

Notes:
- Versions are copied from `apps/portal/package.json` exactly. Do not
  introduce a third `next` pin or a fourth `react` range — phase6 FINDING D-6
  already records version drift as unmaintained.
- `@novastar/sync-engine` is deliberately **absent**. This dashboard is online-only.
- Every internal dependency uses `workspace:*` ([ADR-001](../adr/ADR-001-monorepo-turborepo-bun-workspaces.md)).
- `typescript: "npm:@typescript/typescript6@^6.0.2"` matches both apps and the
  packages; do not introduce a fourth TypeScript version (phase6 R-13).

### `next.config.ts`

```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  // Matches apps/portal: Docker-targeted, self-hosted Node server.
  // NOT 'export' — the dashboard is session-bearing and reads a live database.
  output: 'standalone',
  // Source-consumed workspace packages (ADR-016) must be transpiled by this app.
  transpilePackages: [
    '@novastar/database',
    '@novastar/domain',
    '@novastar/shared-types',
    '@novastar/shared-ui',
    '@novastar/shared-utils',
    '@novastar/auth',
  ],
}

export default config
```

Use top-level `output`, not the `experimental` block. `apps/public-site` already
migrated; `apps/portal` still has not (phase6 §1.5, R-28). Do not copy the
portal's config verbatim.

### `tsconfig.json`

```jsonc
{
  "extends": "../../tsconfig.base.json",   // see the config-hygiene plan; until
                                          // then, copy apps/portal/tsconfig.json
                                          // and adjust the path aliases
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next"]
}
```

The hygiene plan (`2026-10-01_000000-build-plan-workspace-membership-and-config-hygiene.md`)
removes the duplicated alias scheme. Extending the base config now avoids
re-creating the drift it is fixing.

## 5. Dependencies on existing workspace packages

| Package | Used for | Constraint |
|---|---|---|
| `@novastar/database` | `prisma`, `Tenant`, `School`, `User`, `AuditLog` types | Re-exported from `packages/database/index.ts`. Import types from the package, not from `@prisma/client` directly. |
| `@novastar/domain` | cross-tenant read models if it already has them | Read `packages/domain` first; do not duplicate business logic. |
| `@novastar/shared-types` | DTOs, Zod schemas | `tenant` code field is `Tenant.code` (the subdomain), `Tenant.domain` is the nullable custom domain. Use the real names. |
| `@novastar/shared-ui` | design system | The only package with a `dist/` — see [ADR-016](../adr/ADR-016-packages-consumed-as-typescript-source.md). Verify `dist/` builds before depending on it. |
| `@novastar/shared-utils` | date/currency (GHS) formatting | — |
| `@novastar/auth` | permission primitives | **Do not import the portal's session resolution.** Permission checks only. |

Not used: `@novastar/sync-engine` (offline-first is a portal concern),
`@novastar/notifications`, `@novastar/payments` (add only when a real feature
needs them).

## 6. `turbo.json`

**No change is required.** `turbo.json` already declares `build`
(`dependsOn: ["^build"]`, `outputs: [".next/**", ...]`), `dev`
(`cache: false, persistent: true`), `lint`, `typecheck`, and `test`. A new
member that declares the same script names is picked up automatically. This is
the payoff of [ADR-001](../adr/ADR-001-monorepo-turborepo-bun-workspaces.md).

Two additions the hygiene plan should make, not this plan:
- `turbo.json`'s `globalEnv` must gain `SUPER_ADMIN_*` variables — see §8.
- `test` has `cache: true` with `outputs: ["coverage/**"]` while nothing produces
  coverage (phase6 FINDING B-6, R-24). Until that is fixed, a cached `test` task
  can report green without executing anything.

## 7. How CI should invoke it

`ci.yml` needs **no change to make this app build**. `bun run build` →
`turbo run build` → the `build` job will pick up `super-admin` because it is a
workspace member with a `build` script.

Three additions, all landing with this plan:

1. **`test` job filters.** `package.json:19` is
   `"test": "bunx turbo run test --filter=portal --filter=public-site"`.
   `super-admin`'s tests are **excluded**. Add `--filter=super-admin`.
   > **Status (verified 2026-10-03): DONE, and the exclusion above no longer holds.**
   > The root `test` script (`package.json:22`) carries `--filter=super-admin`.
   > **VERIFIED (measured 2026-10-03):** that task runs and passes - 150 tests across
   > 7 files, 0 fail, one of the 7/7 test tasks totalling 1396 pass / 0 fail.

2. **`lint-and-typecheck` job.** Already covered (`bun run lint`,
   `bun run typecheck` at root fan out to all members) — but only after the app
   has a `package.json`. It has no `db:generate` problem: the job already runs
   `bun run --cwd packages/database db:generate` at `ci.yml:43-44`, and
   `@novastar/database`'s `index.ts` imports `PrismaClient`. Nothing extra needed.

3. **E2E.** `playwright.config.ts` sets `testDir: './e2e'`, a single `webServer`
   running `bunx turbo run dev --filter=portal -- --port 3100`, and probes
   `${BASE_URL}/login`. A super-admin E2E suite needs a **second project** with
   its own base URL and web server. Recommended shape:

   ```ts
   // playwright.admin.config.ts (separate file — do not overload the existing config)
   export default defineConfig({
     testDir: './e2e-super-admin',
     use: { baseURL: 'http://localhost:3200' },
     projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
     webServer: {
       command: 'bunx turbo run dev --filter=super-admin -- --port 3200',
       url: 'http://localhost:3200/login',
       timeout: 180_000,
     },
   })
   ```
   Then `"test:e2e:admin": "playwright test --config=playwright.admin.config.ts"`
   on the root, and a `test-e2e-admin` job in `ci.yml` with `needs: [build]`.
   Defer this to Phase 5 — do not attempt it in Phase 1.

## 8. Environment variables

New, and **must be added to `turbo.json`'s `globalEnv`** or the cache hash will
not change when they do (phase6 FINDING B-5):

| Variable | Purpose |
|---|---|
| `SUPER_ADMIN_EMAIL` | allowed operator login — an allowlist, not an auth mechanism |
| `SUPER_ADMIN_SECRET` | dedicated session secret; do **not** reuse `NEXTAUTH_SECRET` |
| `SUPER_ADMIN_DATABASE_URL` | connection string for the broader DB role |
| `NEXT_PUBLIC_SUPER_ADMIN_URL` | canonical URL |

`SUPABASE_DATABASE_URL` is already in `globalEnv` and is what the health page
should report mirror freshness against.

## 9. Phased task breakdown

Each phase ends in a command that passes.

### Phase 1 — Scaffolding that satisfies the toolchain

1. Create `apps/super-admin/package.json` exactly as in §4.
2. `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.env.example`.
3. Minimal `app/layout.tsx` and `app/page.tsx`.
4. Run `bun install`.
5. **Verify:** `bun run build:super-admin` from the root now succeeds (FINDING B-3
   closed). `bun run typecheck` and `bun run lint` pass. The root `build` output
   lists `super-admin`.

### Phase 2 — Identity and the two-tenant-model guard

1. `lib/admin-auth.ts` — separate `authOptions`, its own providers.
2. `lib/admin-context.ts` — resolves the operator; exposes
   `getSelectedTenantId()` and `requireOperator()`.
3. `lib/permissions.ts` — operator capability check. Start with a static
   allowlist; do not build RBAC-on-RBAC in Phase 2.
4. `app/(auth)/login/page.tsx`.
5. Route guard in `app/(dashboard)/layout.tsx`: redirect to `/login` when
   unauthenticated.
6. Tests: `tests/admin-context.test.ts` asserts that an unauthenticated request
   throws and that there is **no** ambient tenant fallback.
7. **Verify:** `bun run --cwd apps/super-admin test` passes;
   `bun run --cwd apps/super-admin typecheck` passes;
   `grep -rn "getTenantContext" apps/super-admin` returns nothing.

### Phase 3 — Tenant and school views

1. `app/(dashboard)/tenants/page.tsx` — cross-tenant list. Query
   `prisma.tenant.findMany()` **with no `where: { tenantId }` filter**, because
   there is no tenant filter; that is the point.
2. `app/api/tenants/route.ts`.
3. `components/tenant-table.tsx`, `tenant-status-badge.tsx`.
4. `components/tenant-switcher.tsx` — sets the selected tenant for drill-down.
5. `app/(dashboard)/tenants/[tenantId]/page.tsx`, `schools/page.tsx`,
   `users/page.tsx`.
6. Tests: `tests/tenant-switch.test.ts` — switching selection changes exactly
   which rows are returned, and a tenant id that does not exist 404s rather than
   falling back to "all".
7. **Verify:** the same commands as Phase 2, plus a manual check that the tenant
   list shows more than one row against a seeded database.

### Phase 4 — Tenant lifecycle (provision / suspend / reactivate)

1. `app/api/tenants/[tenantId]/provision/route.ts` — wraps the same logic
   `tools/tenant-cli` will expose as a CLI. See that plan for the field-level
   rules; the CLI and this route must call **one shared function**.
2. Suspend / reactivate actions. `Tenant.isActive` is the field
   (`schema.prisma:18`). Suspension must **not** delete anything.
3. Every mutation writes an `AuditLog` row. `AuditLog` is re-exported from
   `packages/database/index.ts:106`.
4. **Verify:** tests assert that a suspended tenant's portal sessions stop
   resolving and that the tenant's rows are still present.

### Phase 5 — Health and audit

1. `app/(dashboard)/health/page.tsx` — migration status (`_prisma_migrations`
   row count), mirror freshness (`SUPABASE_DATABASE_URL` reachability),
   `AuditLog` volume.
2. `app/(dashboard)/audit/page.tsx` — cross-tenant audit log with tenant column.
3. E2E project (§7 item 3).
4. **Verify:** `bun run test:e2e:admin` passes against a local build.

### Phase 6 — Wire CI and documentation

1. Add `--filter=super-admin` to the root `test` script.
2. Add `SUPER_ADMIN_*` to `turbo.json` `globalEnv`.
3. Add `test-e2e-admin` to `ci.yml` with `needs: [build]`.
4. `apps/super-admin/README.md` — the two-tenant-model rule, and the explicit
   statement that `getTenantContext()` must never be imported here.
5. **Verify:** full CI green on a branch.

## 10. Acceptance criteria

```bash
# 1. It is a real workspace member (FINDING B-3 closed)
bunx turbo run build --filter=super-admin
# → exit 0, produces apps/super-admin/.next/standalone

# 2. The pre-existing root script now works
bun run build:super-admin

# 3. It is included in the repo-wide gates
bun run typecheck
bun run lint
bun run build

# 4. Tests run in CI, not just locally
bun run --cwd apps/super-admin test

# 5. No portal tenant resolution leaked in
grep -rn "getTenantContext" apps/super-admin        # → no matches
grep -rn "@/lib/tenant" apps/super-admin            # → no matches
grep -rn "from '@novastar/sync-engine'" apps/super-admin  # → no matches

# 6. Internal deps all use workspace:*
grep -c "workspace:\*" apps/super-admin/package.json  # → 6

# 7. No dangling dist dependency (FINDING B-7)
bun run --cwd packages/shared-ui build
test -f packages/shared-ui/dist/index.js
```

## 11. Risks and open questions

| # | Risk / Question | Mitigation |
|---|---|---|
| 1 | **RLS does not protect the super-admin.** RLS scopes a session's tenant. An operator role with broader grants bypasses it by design, which means a single query bug leaks cross-tenant data. | Every super-admin query names its scope explicitly. No ambient tenant. Add a test that fails if a `findMany` is written without either a `tenantId` filter or an explicit `// CROSS-TENANT` comment. |
| 2 | **The DB role for the dashboard does not exist yet.** | Decide before Phase 4: a dedicated role with explicit grants, created by a migration. Do not reuse the portal's connection string with elevated rights. |
| 3 | `next-auth` v4 vs the v5 adapter mismatch is unresolved (phase6 FINDING D-5). `apps/portal` declares `@auth/prisma-adapter ^2.11.3` with `next-auth ^4.24.15`. | Do not copy that pair. Resolve D-5 first, or use a separate session implementation for the dashboard. |
| 4 | `packages/shared-ui`'s `dist/` may not exist (FINDING B-7). | Acceptance criterion 7 above. Resolve before depending on it. |
| 5 | `zustand` version drift — portal pins `^4.5.5`, §4 proposes `^5.0.0`. | Pin to `^4.5.5` to match, or resolve globally. Do not let a third version appear. |
| 6 | A third `next.config.ts` with different conventions compounds the `experimental`-block inconsistency (R-28). | Use top-level flags. Fix `apps/portal` in the same PR. |
| 7 | **Does this app need to exist before the first second school?** | It does not. It is a Phase 0 layout commitment, not a Phase 0 deliverable. If the SaaS never gets a second tenant, this app stays a thin tenant list. Build Phase 1–3 and stop; do not build Phase 4–6 speculatively. |
| 8 | Operator auth has no source of truth. | Decide early: NextAuth credentials against a static allowlist, or an OAuth provider. This is a security decision, not an implementation detail. |

## 12. Related documents

- [ADR-001 — Monorepo Structure](../adr/ADR-001-monorepo-turborepo-bun-workspaces.md)
- [ADR-016 — Packages Consumed as TypeScript Source](../adr/ADR-016-packages-consumed-as-typescript-source.md)
- `docs/technical/2026-09-24_000000-novastar-montessori-master-plan-final.md:24`
- `docs/audit-reports/phase6-devops-infra.md` FINDING B-3, B-7, D-5, D-6, B-5
- Build plan — `tools/tenant-cli` (shares provisioning logic)