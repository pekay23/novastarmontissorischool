# Novastar Montessori School — Master Implementation Plan (Final v4) — **HISTORICAL**

> **⚠️ HISTORICAL DOCUMENT (2026-10-08):** This document describes the **original three-app architecture** (`apps/public-site`, `apps/portal`, `apps/super-admin`) before the consolidation into a single merged app `apps/web` (ADR-024, 2026-10-08). The current architecture is documented in [ADR-024](../adr/ADR-024-consolidate-web-app.md) and the [merge plan](../technical/2026-10-08_003500-merge-portal-admin-public-into-apps-web.md).

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a world-class, offline-first, **fully configurable** school management system for Novastar Montessori School in Kumasi, Ghana. The system comprises a public marketing website and a comprehensive intranet/portal that syncs online when internet is available. **Zero hardcoded values** — every domain entity (subjects, classes, grades, academic years, grading scales, roles, permissions, fees, news, events, etc.) is editable via admin UI. The Headmaster/Headmistress has full system oversight and can delegate any function to staff. Multi-tenancy ready from day one for future school contracts.

**Architecture (ORIGINAL):** Monorepo (Turborepo + Bun) with shared TypeScript types, offline-first PWA for portal, static-generated public site, **Neon DB (primary, free tier) + Supabase (backup/read-replica, free tier) with cron mirroring**, Prisma ORM, Yjs CRDT sync engine, dynamic RBAC with delegation, plugin architecture for extensibility.

**Tech Stack:** **TypeScript 7.x** (native Go compiler), **Bun 1.4+** (package manager + runtime), **Next.js 16** (App Router), **React 19.2** (latest stable), **Tailwind CSS v4**, PostgreSQL 16 (Neon/Supabase), SQLite (local via sql.js WASM), Prisma 7, TanStack Query 5, Zod 4, Auth.js v5, Playwright, Vitest, Bun workspaces.

---

## Verification pass - 2026-10-08 (POST-MERGE)

**Status (verified 2026-10-08): this document is a strategy and cost baseline for the ORIGINAL three-app architecture, not a build plan for the current merged architecture. It has no phases with deliverables to verify against the current state, and most of it is NOT-A-CODE-ITEM for the current codebase.**

This document predates every build plan in `docs/technical/`. It was written on 2026-09-24 and its per-phase status is tracked in those plans, not here. It is also marked `Status: READY FOR EXECUTION` at the foot, which was true when it was written and should not be read as current — **the architecture it describes no longer exists**.

As of **2026-10-08 (ADR-024)**, the three apps `apps/public-site`, `apps/portal`, and `apps/super-admin` have been merged into a single app `apps/web`. The directory structure table below reflects the **pre-merge state** and is preserved for historical reference. The current state has:

| Current Path | Source |
|---|---|
| `apps/web/app/(public)/` | Was `apps/public-site/app/` |
| `apps/web/app/portal/` | Was `apps/portal/app/` |
| `apps/web/app/admin/` | Was `apps/super-admin/app/` |

Every BUILT / NOT-BUILT verdict below comes from reading the tree at the time of the 2026-10-03 verification, and those verdicts are unchanged for the pre-merge state. **Corrected 2026-10-08:** this pass originally ran nothing, which made every runtime claim in it UNVERIFIABLE. The repo's build, typecheck, lint, test and encoding commands have since been run and all passed for the pre-merge architecture, so the runtime claims below now carry measured results for that historical state. See "Not claimed" at the foot of this section.

### section 1 PROJECT STRUCTURE, directory by directory (PRE-MERGE STATE)

`apps/*` - all three exist and all three are full apps. `packages/*` - eleven of the seventeen listed exist; `tools/*` - all five exist but only four are workspace members.

| Path | Status (verified 2026-10-03, PRE-MERGE) |
|---|---|
| `apps/public-site/` | **BUILT** - Next 16 static export, 8 content routes, `sitemap.ts`, `robots.ts`, `not-found.tsx`, Prisma-backed `lib/data.ts` |
| `apps/portal/` | **BUILT** - Next 16 standalone, `proxy.ts`, 26 API route groups under `app/api/` |
| `apps/super-admin/` | **BUILT** - full cross-tenant app with its own auth. See `docs/technical/2026-10-01_000000-build-plan-super-admin-app.md` |
| `packages/shared-types/` | **BUILT** |
| `packages/shared-ui/` | **BUILT** - Radix component library. See the ADR-016 conflict in the verification note there |
| `packages/shared-utils/` | **BUILT** |
| `packages/sync-engine/` | **BUILT** - injectable storage (`MemorySyncStorage`, `IndexedDbSyncStorage`), not the Yjs/Automerge stub the plan implies |
| `packages/auth/` | **BUILT** - `hasPermission`, `createDelegation`, `approveDelegation`, `revokeDelegation`, `logAudit` |
| `packages/database/` | **BUILT** - Prisma schema with **63 models** (this plan says 57) plus 4 migrations and `prisma/rls/tenant-isolation.sql` |
| `packages/ghana-education/` | **BUILT** |
| `packages/reports/` | **NOT-BUILT** - the directory does not exist. Report generation lives in the portal (`app/api/reports/academic/[studentId]/route.ts`) |
| `packages/notifications/` | **BUILT** |
| `packages/payments/` | **BUILT** - MTN MoMo, bank, cash |
| `packages/plugin-registry/` | **NOT-BUILT** - absent, correctly. Its dead `tsconfig.base.json` alias has been removed |
| `packages/plugins/{library,canteen,clinic,alumni,learning,analytics}/` | **NOT-BUILT** - all six absent. Library and inventory ship *inside* the portal instead (`app/api/library/`, `app/api/inventory/`) |
| `packages/testing/` | **BUILT** - factories, MSW handlers, page objects, storage state |
| *(not in this plan)* `packages/domain/` | **BUILT** - exists, is a workspace member, and is absent from section 1's structure. The structure diagram is out of date |
| `tools/seed/` | **PARTIAL** - `index.ts` and `verify-admin.ts` only. **No `package.json`**, so it is not a workspace member and no `typecheck` task reaches it |
| `tools/migrate/` | **BUILT** - fingerprints, guarded deploy, rollback, reset |
| `tools/sync-cli/` | **PARTIAL** - the CLI is built; the portal-side endpoint it talks to (`apps/portal/app/api/sync/route.ts`) does not exist, so it cannot work end to end |
| `tools/tenant-cli/` | **BUILT** - provision, clone, config, suspend/reactivate, operator |
| `tools/db-mirror/` | **BUILT** - 15 `.ts` files, plus `.github/workflows/db-mirror.yml` |
| `docs/{architecture,wireframes,adr,api}/` | **BUILT** - all four exist |
| `turbo.json`, `package.json`, `.bunfig.toml`, `tsconfig.base.json`, `eslint.config.mjs`, `biome.json` | **BUILT** - all six present. `tsconfig.base.json` is now 12 lines and is extended by all 18 workspace tsconfigs |
| `README.md` (repo root) | **NOT-BUILT** - no root `README.md` exists. `AGENTS.md` occupies that role |
| `.hermes/plans/` | **BUILT** - holds four revisions of this plan (v2, v3, final, and an earlier draft) plus `plan.md` |

### Tech-stack claims that the code contradicts

| This plan says | The code does | Status |
|---|---|---|
| Auth.js v5 | `next-auth` **v4**. `apps/portal/lib/auth.ts` imports `Credentials from 'next-auth/providers/credentials'` and types `NextAuthOptions`; `proxy.ts:30` uses `withAuth` from `next-auth/middleware`; `app/api/auth/[...nextauth]/route.ts` mounts `NextAuth`. section 2.1's own dependency list is honest about this - it pins `next-auth: ^4.24.15` - so the header line and the manifest disagree with each other | **DOC-STALE** - the header line is wrong, section 2.1 is right |
| SQLite (local via sql.js WASM) for offline-first | No `sql.js` and no `better-sqlite3` anywhere in `apps/` or `packages/`. Local offline storage is IndexedDB, via `IndexedDbSyncStorage` in `packages/sync-engine` | **SUPERSEDED** - by IndexedDB |
| Vitest | Zero `from 'vitest'` imports repo-wide. Every test file uses `bun:test`. ADR-015 ("Testing: Vitest Unit + Playwright E2E + MSW Mocking") is still marked *Planned* in `docs/adr/README.md` and its file does not exist | **SUPERSEDED** - by `bun test`, before the ADR was ever written |
| TanStack Query 5 | **BUILT** - `apps/portal/package.json:32` pins `@tanstack/react-query: ^5.57.1` | **BUILT** |
| TypeScript 7 native | **BUILT** - root `devDependencies` carries both `"@typescript/native": "npm:typescript@^7.0.2"` and `"typescript": "npm:@typescript/typescript6@^6.0.2"`, exactly as section 2.2 specifies | **BUILT** |
| Bun 1.4+, `centralStore = true`, Next 16.3.3, React 19.2, Prisma 7.10, Tailwind 4.3.3, Zod 4 | **BUILT** - all present in the manifests | **BUILT** |

### section 5's mirror design was not what shipped

This plan is emphatic that the Neon -> Supabase mirror should run as **pg_cron
inside Neon**, on the grounds that it costs zero GitHub Actions minutes, and it
lists a GH Actions schedule only as a fallback. What exists is the fallback:
`tools/db-mirror/` (15 TypeScript files) driven by
`.github/workflows/db-mirror.yml` on `cron: '17 */6 * * *'` - every six hours,
not the 30 minutes section 5 specifies. `prisma/rls/tenant-isolation.sql` exists and
the workflow also runs `verify-restore.ts` and `verify-rls-enforced.ts`, so the
verification story is arguably better than the plan's; the scheduling mechanism is
the part that diverged. **SUPERSEDED** by the Bun tool plus a GH Actions
schedule. Whether the six-hour cadence is deliberate or a stopgap is not
recorded anywhere.

### section 7 and section 8 spot checks

- **section 7 "Configuration-First"**: **BUILT.** `app/api/config/[entityType]/route.ts`
  and `app/api/config/entities/[type]/route.ts` provide generic CRUD over
  Prisma models, gated by `hasPermission(userId, 'config:read' | 'config:write',
  ...)`, and `packages/shared-types` holds the entity config map.
- **section 8 "Headmaster Delegation UI" at `/portal/settings/delegation`**: **PARTIAL.**
  The engine is complete - `createDelegation`, `approveDelegation`,
  `revokeDelegation`, `getEffectivePermissions`, and `hasPermission` resolving
  delegations - and `apps/portal/tests/delegation-fail-closed.test.ts` covers
  it. **The page does not exist.** `app/(portal)/settings/` contains
  `admissions`, `attendance-takers`, `audit-logs`, `entities`, `platform`,
  `roles`, `school` and `subjects` - no `delegation`.
- **section 8 "Teacher Attendance" at `/portal/settings/attendance-takers`**: **BUILT**  - 
  the route and `app/api/attendance-takers/route.ts` both exist.
- **section 9 Phase 3 deliverable "PWA"**: **NOT-BUILT.**
  `apps/portal/public/` contains only `.gitkeep` - no `manifest.json`, no service
  worker.

### NOT-A-CODE-ITEM

section 3 free-tier limits, section 4 cost breakdown and TCO, section 6 school profile and mission
copy, section 10 next steps and section 11 git conventions are business and process documents.
They are not verifiable against the repository and are not restated here. Two
notes that are: section 6's school details are the source of the values now living in
`apps/public-site/lib/metadata.ts`, so the marketing copy and this section must
change together; and section 11's commit conventions are Conventional Commits, which the
repository does follow.

### Not claimed

No phase in section 9 was assessed for completion. That work is tracked per-phase by
the build plans in `docs/technical/`, which is where a reader should look. The
`Phase 0 - monorepo initialization, design system, free tier setup` item in
`docs/README.md`'s Next Steps is also stale: the monorepo is initialised.

To settle the section 9 phases, the per-plan status markers are the index; to settle the
build state of any workspace member without trusting a document:

```bash
bun run lint && bun run typecheck && bun run build && bun run test
```

**Measured 2026-10-03 - that block now passes.** `bunx turbo run build` 4/4 tasks
successful (`portal`, `public-site`, `super-admin`, `@novastar/shared-ui`); `bunx turbo
run typecheck` 18/18; `bunx turbo run lint` 18/18, 0 errors and 1 pre-existing warning
(`packages/shared-types/permission-keys.test.ts:10`, unused `ROLE_GRANT_RULES`);
`bun run test` 7/7 tasks, **1396 pass / 0 fail** (portal 976, super-admin 150,
tenant-cli 94, sync-cli 90, migrate 56, sync-engine 30); `bun run check:encoding` all 6
checks clean.

That covers this repo only. `bun run test:e2e` (Playwright), `db:seed`, any Prisma
migration or live-database command, and the Docker / TeamCity / Vercel paths are
**still UNVERIFIABLE** and were not run.

---

## 1. PROJECT STRUCTURE (Monorepo — Multi-Tenancy Ready)

```
novastar-montessori/
├── .github/
│   └── workflows/           # CI/CD pipelines (Bun-based)
├── .hermes/
│   └── plans/               # This plan + future plans
├── apps/
│   ├── public-site/         # Next.js static export (marketing) — multi-tenant aware
│   ├── portal/              # Next.js PWA (intranet/online) — tenant-scoped
│   └── super-admin/         # Super Admin dashboard (cross-tenant, for SaaS owner)
├── packages/
│   ├── shared-types/        # TypeScript types, Zod schemas (tenant-aware)
│   ├── shared-ui/           # Design system, components (themable per tenant)
│   ├── shared-utils/        # Date, currency (GHS), validation helpers
│   ├── sync-engine/         # Offline-first sync logic (Yjs/Automerge)
│   ├── auth/                # Dynamic RBAC, permissions, delegation, sessions
│   ├── database/            # Prisma schema + migrations (RLS policies)
│   ├── ghana-education/     # GES/NaCCA curriculum engine (configurable)
│   ├── reports/             # Report generation (PDF, Excel) — template-driven
│   ├── notifications/       # Email, in-app, push (SMS/WhatsApp plugin-ready)
│   ├── payments/            # Payment abstraction (MTN MoMo, Bank, Cash)
│   ├── plugin-registry/     # Plugin discovery, loading, lifecycle
│   ├── plugins/
│   │   ├── library/         # Library management
│   │   ├── canteen/         # Meal planning, POS
│   │   ├── clinic/          # Health records, visits
│   │   ├── alumni/          # Alumni portal, donations
│   │   ├── learning/        # LMS integration (Moodle/Canvas)
│   │   └── analytics/       # BI dashboards, ML insights
│   └── testing/             # Test utilities, MSW handlers
├── tools/
│   ├── seed/                # Database seeding (configurable per tenant)
│   ├── migrate/             # Migration runners
│   ├── sync-cli/            # Manual sync trigger
│   ├── tenant-cli/          # Tenant provisioning, cloning, config
│   └── db-mirror/           # Neon → Supabase cron mirror jobs
├── docs/
│   ├── architecture/        # Architecture diagrams
│   ├── wireframes/          # Excalidraw files
│   ├── adr/                 # Architecture Decision Records
│   └── api/                 # OpenAPI specs
├── turbo.json               # Turborepo config
├── package.json             # Root package.json (Bun)
├── .bunfig.toml             # Bun config (centralStore = true)
├── tsconfig.base.json       # Shared TS config
├── eslint.config.mjs        # ESLint 10 flat config
├── biome.json               # Biome formatter/linter
└── README.md
```

---

## 2. EXACT PACKAGE VERSIONS (from aerojet-academy reference)

### 2.1 Dependencies (Production)

```json
{
  "dependencies": {
    "@date-fns/tz": "1.4.1",
    "@hookform/resolvers": "^5.9.1",
    "@neondatabase/serverless": "^1.1.0",
    "@prisma/adapter-neon": "^7.10.0",
    "@prisma/adapter-pg": "^7.10.0",
    "@prisma/client": "^7.10.0",
    "@radix-ui/react-accordion": "^1.2.20",
    "@radix-ui/react-alert-dialog": "^1.1.23",
    "@radix-ui/react-avatar": "^1.2.6",
    "@radix-ui/react-checkbox": "^1.3.11",
    "@radix-ui/react-dialog": "^1.1.23",
    "@radix-ui/react-dropdown-menu": "^2.1.24",
    "@radix-ui/react-label": "^2.1.15",
    "@radix-ui/react-navigation-menu": "^1.2.22",
    "@radix-ui/react-popover": "^1.1.23",
    "@radix-ui/react-progress": "^1.1.16",
    "@radix-ui/react-radio-group": "^1.4.7",
    "@radix-ui/react-scroll-area": "^1.2.18",
    "@radix-ui/react-select": "^2.3.7",
    "@radix-ui/react-separator": "^1.1.15",
    "@radix-ui/react-slot": "^1.3.3",
    "@radix-ui/react-switch": "^1.3.7",
    "@radix-ui/react-tabs": "^1.1.21",
    "@radix-ui/react-toast": "^1.2.23",
    "@radix-ui/react-tooltip": "^1.2.16",
    "@react-pdf/renderer": "^4.8.1",
    "@simplewebauthn/browser": "^13.3.0",
    "@simplewebauthn/server": "^13.3.3",
    "@supabase/ssr": "^0.12.5",
    "@supabase/supabase-js": "^2.112.4",
    "@tailwindcss/postcss": "^4.3.3",
    "@tailwindcss/typography": "^0.5.20",
    "@tanstack/react-table": "^8.21.3",
    "@tanstack/react-virtual": "^3.14.11",
    "@tiptap/core": "3.31.3",
    "@tiptap/extension-color": "3.31.3",
    "@tiptap/extension-font-family": "3.31.3",
    "@tiptap/extension-image": "3.31.3",
    "@tiptap/extension-link": "3.31.3",
    "@tiptap/extension-placeholder": "3.31.3",
    "@tiptap/extension-text-align": "3.31.3",
    "@tiptap/extension-text-style": "3.31.3",
    "@tiptap/html": "3.31.3",
    "@tiptap/pm": "3.31.3",
    "@tiptap/react": "3.31.3",
    "@tiptap/starter-kit": "3.31.3",
    "@types/papaparse": "^5.5.2",
    "@uploadthing/react": "^7.3.3",
    "@upstash/ratelimit": "^2.0.8",
    "@upstash/redis": "^1.38.3",
    "@vercel/analytics": "^2.0.1",
    "@vercel/speed-insights": "^2.0.0",
    "bcryptjs": "^3.0.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "csv-parse": "^7.0.2",
    "date-fns": "^4.4.0",
    "dotenv": "^17.4.2",
    "framer-motion": "^12.43.0",
    "gsap": "^3.15.0",
    "isomorphic-dompurify": "^3.23.0",
    "jspdf": "^4.2.1",
    "jspdf-autotable": "^5.0.8",
    "lucide-react": "1.8.0",
    "mammoth": "^1.12.3",
    "next": "16.3.3",
    "next-auth": "^4.24.15",
    "next-themes": "^0.4.6",
    "otplib": "^13.5.0",
    "papaparse": "^5.7.0",
    "pdf-lib": "^1.17.1",
    "pdfkit": "^0.20.2",
    "pg": "8.18.0",
    "qrcode": "^1.5.4",
    "react": "^19.2.8",
    "react-day-picker": "^10.0.1",
    "react-dom": "^19.2.8",
    "react-google-recaptcha-v3": "^1.11.0",
    "react-hook-form": "^7.86.0",
    "react-joyride": "^3.2.0",
    "react-markdown": "^10.1.0",
    "recharts": "^3.10.1",
    "rehype-raw": "^7.0.0",
    "resend": "6.22.0",
    "sanitize-html": "^2.17.7",
    "server-only": "^0.0.1",
    "sharp": "^0.35.4",
    "sonner": "^2.0.8",
    "svix": "2.0.0",
    "tailwind-merge": "^3.6.0",
    "tw-animate-css": "^1.4.0",
    "uploadthing": "^7.7.4",
    "use-debounce": "^10.1.1",
    "vaul": "^1.1.2",
    "zod": "^4.4.3"
  }
}
```

### 2.2 DevDependencies

```json
{
  "devDependencies": {
    "@axe-core/playwright": "^4.13.0",
    "@playwright/test": "^1.62.1",
    "@prisma/config": "^7.10.0",
    "@release-it/conventional-changelog": "^12.0.0",
    "@storybook/nextjs": "^10.5.10",
    "@storybook/react": "^10.5.10",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.6",
    "@types/node": "^25.9.5",
    "@types/pg": "^8.18.0",
    "@types/qrcode": "^1.5.6",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.5",
    "@types/sanitize-html": "^2.16.1",
    "@typescript-eslint/eslint-plugin": "8.68.0",
    "@typescript-eslint/parser": "8.68.0",
    "@typescript/native": "npm:typescript@^7.0.2",
    "@vitejs/plugin-react": "6.1.0",
    "@vitest/coverage-v8": "^4.1.11",
    "@vitest/ui": "^4.1.11",
    "autoprefixer": "^10.5.4",
    "cross-env": "^10.1.0",
    "eslint": "10.9.1",
    "eslint-config-next": "^16.3.3",
    "husky": "^9.1.7",
    "jsdom": "^28.1.0",
    "lint-staged": "^17.4.1",
    "pdf-parse": "^2.4.5",
    "postcss": "^8.5.26",
    "postgres": "^3.4.9",
    "prettier": "^3.9.6",
    "prettier-plugin-tailwindcss": "^0.8.1",
    "prisma": "^7.10.0",
    "release-it": "^21.0.2",
    "storybook": "^10.5.10",
    "tailwindcss": "^4.3.3",
    "tsx": "^4.23.12",
    "typescript": "npm:@typescript/typescript6@^6.0.2",
    "vitest": "4.1.4"
  }
}
```

### 2.3 Key Version Notes
- **TypeScript 7**: Use `@typescript/native` for compilation, keep `typescript` (v6) for compiler API tools until 7.1
- **Next.js 16.3.3**: App Router, Turbopack, standalone output
- **React 19.2.8**: Server Components, Actions, Compiler stable
- **Prisma 7.10.0**: Neon adapter, Supabase adapter, RLS support
- **Tailwind CSS v4.3.3**: CSS-first, OKLCH, PostCSS plugin
- **Zod 4.4.3**: Schema validation
- **Bun 1.4+**: Package manager, test runner, bundler

### 2.4 Config Files (from reference)

**`.bunfig.toml`**
```toml
[install]
centralStore = true
```

**`tsconfig.base.json`** (shared across monorepo)
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "incremental": true,
    "module": "esnext",
    "esModuleInterop": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next", "scratch", "scripts"]
}
```

**`eslint.config.mjs`** (ESLint 10 flat config)
```javascript
import { defineConfig, globalIgnores } from 'eslint/config'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  globalIgnores([
    '.next/**', 'next-env.d.ts', 'out/**', '.vercel/**',
    'coverage/**', 'playwright-report/**', 'test-results/**',
    'storybook-static/**', '.storybook/**', 'supabase/**',
    'prisma/migrations/**', 'docs/html/**', '.git/**',
    '.github/**', '.husky/**', '.vscode/**', '.cursor/**',
    '.claude/**', '.claude-design/**', '.agents/**', '.kilo/**',
    '.codegraph/**', 'tmp/**', 'scratch/**', 'artifacts/**',
    'plans/**', 'node_modules/**'
  ]),
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      'no-unused-vars': 'off'
    }
  }
])
```

---

## 3. FREE TIER SERVICES (Start Here)

| Service | Free Tier Limits | Upgrade Trigger |
|---------|------------------|-----------------|
| **Neon DB** | 0.5 GB storage, 190 hrs/mo compute, 1 project, 10 branches | >0.5 GB or >190 hrs |
| **Supabase** | 500 MB database, 1 GB file storage, 2 GB bandwidth, 50 MAU | >500 MB or >50 MAU |
| **Vercel** | 100 GB bandwidth, 100 GB-hours serverless, unlimited personal projects | >100 GB bandwidth |
| **Resend** | 3,000 emails/month, 1 domain | >3,000 emails |
| **UploadThing** | 2 GB storage, 100 GB bandwidth | >2 GB |
| **Upstash Redis** | 10,000 requests/day, 256 MB | >10k req/day |
| **Upstash RatLimit** | 10,000 requests/day | >10k req/day |
| **GitHub Actions** | 2,000 minutes/month (private), unlimited public | >2,000 min |
| **Sentry** | 5,000 errors/month, 1 user | >5,000 errors |
| **Logtail** | 1 GB/month ingestion, 3 days retention | >1 GB |

**Estimated Free Tier Duration:** 6-12 months for a single school with ~500 students, 50 staff.

---

## 4. COST BREAKDOWN (Detailed)

### 4.1 Development (One-Time)

| Item | Weeks | Rate (GHS/week) | Total (GHS) | Notes |
|------|-------|-----------------|-------------|-------|
| **Phase 0: Foundation** | 2 | 4,500 | 9,000 | Monorepo, CI, Auth, DB setup |
| **Phase 1: Config Engine** | 2 | 5,000 | 10,000 | Generic CRUD, Settings Hub |
| **Phase 2: Public Website** | 3 | 5,000 | 15,000 | CMS-driven, i18n, SEO |
| **Phase 3: Portal Core** | 4 | 5,500 | 22,000 | RBAC, dashboards, student/staff mgmt |
| **Phase 4: Assessment** | 5 | 5,500 | 27,500 | SBA, reports, promotion workflow |
| **Phase 5: Attendance** | 3 | 5,000 | 15,000 | Student + staff, offline |
| **Phase 6: Finance** | 5 | 5,500 | 27,500 | Fees, MoMo, bank, payroll |
| **Phase 7: Communication** | 3 | 5,000 | 15,000 | Email, push, CMS, templates |
| **Phase 8: Reports** | 4 | 5,500 | 22,000 | Engine, analytics, compliance |
| **Phase 9: Sync/Offline** | 5 | 6,000 | 30,000 | Yjs, Docker, Mini PC |
| **Phase 10: Advanced** | 5 | 5,500 | 27,500 | Parent portal, library, inventory |
| **Phase 11: Super Admin** | 4 | 5,000 | 20,000 | Multi-tenant, provisioning |
| **Phase 12: Launch** | 5 | 4,500 | 22,500 | Migration, training, UAT, deploy |
| **Design System & UI/UX** | Ongoing | — | 15,000 | Iterative during build |
| **Testing & QA** | Ongoing | — | 10,000 | Automated + manual |
| **Documentation & Training** | Ongoing | — | 5,000 | Video + written guides |
| **Contingency (15%)** | — | — | 39,000 | Risk buffer |
| **TOTAL DEVELOPMENT** | **50 weeks** | — | **327,000** | ~USD 21,800 @ 15:1 |

### 4.2 Infrastructure (Annual Recurring) — Free Tier → Paid

| Service | Free Tier | Paid Tier (Year 2+) | Notes |
|---------|-----------|---------------------|-------|
| **Neon DB** | Free (0.5 GB) | $25/mo = GHS 1,800/yr | Pro: 10 GB, unlimited compute |
| **Supabase** | Free (500 MB) | $25/mo = GHS 1,800/yr | Pro: 8 GB, 50 GB bandwidth |
| **Vercel** | Free (100 GB) | $20/mo = GHS 1,440/yr | Pro: 1 TB bandwidth |
| **Resend** | Free (3k/mo) | $20/mo = GHS 1,440/yr | Pro: 50k emails |
| **UploadThing** | Free (2 GB) | $10/mo = GHS 720/yr | Pro: 100 GB |
| **Upstash Redis** | Free (10k/day) | $10/mo = GHS 720/yr | Pro: 1M req/day |
| **Monitoring (Sentry)** | Free (5k/mo) | $26/mo = GHS 1,872/yr | Team plan |
| **Domain/SSL** | — | GHS 200/yr | .edu.gh or .com.gh |
| **TOTAL CLOUD (Year 2+)** | **GHS 0** | **GHS 9,992/yr** | ~USD 666/yr |

### 4.3 Local Hardware (Optional, Year 1+)

| Item | Cost (GHS) | Notes |
|------|------------|-------|
| **Mini PC (Intel NUC 13/14, 16GB/512GB)** | 8,000 - 12,000 | Runs local portal + sync |
| **UPS (1000VA)** | 1,500 - 2,500 | Power backup |
| **WiFi AP (Ubiquiti U6 Lite)** | 1,200 | Staff device connectivity |
| **Thermal Printer (80mm)** | 800 - 1,500 | Cash receipts |
| **TOTAL HARDWARE** | **11,500 - 17,500** | One-time |

### 4.4 Support (Annual)

| Tier | Monthly | Annual | Includes |
|------|---------|--------|----------|
| **Remote Support Retainer** | GHS 1,500 | GHS 18,000 | Monitoring, updates, 4h response |
| **Hypercare (Launch, 2 weeks)** | — | Included | Daily check-ins, rapid fixes |
| **TOTAL SUPPORT** | — | **GHS 18,000/yr** | |

### 4.5 Total Cost of Ownership

| Scenario | Year 1 (Dev + Infra) | Year 2+ (Infra + Support) |
|----------|----------------------|---------------------------|
| **Cloud Only (Free Tier Start)** | GHS 327,000 | GHS 28,000/yr |
| **Cloud + Mini PC** | GHS 338,500 - 344,500 | GHS 28,000/yr |
| **Self-Hosted (No Cloud Paid)** | GHS 338,500 - 344,500 | GHS 20,400/yr (support only) |

**Recommendation:** Start **100% Free Tier** (Neon + Supabase + Vercel + Resend). No infrastructure cost Year 1. Add Mini PC in parallel for offline testing. Migrate to paid tiers only when free limits exceeded.

---

## 5. DATABASE ARCHITECTURE: NEON + SUPABASE (FREE TIER)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATABASE ARCHITECTURE (FREE TIER)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐         ┌──────────────────┐         ┌──────────────┐   │
│  │   NEON DB    │         │   pg_cron ON     │         │  SUPABASE    │   │
│  │  (Primary)   │────────►│   NEON (Built-in)│────────►│  (Backup/    │   │
│  │  Free: 0.5GB │  pg_dump│  Every 30 min    │  psql/COPY │  Read Replica)│  │
│  │  190 hrs/mo  │         │  Zero GH Actions │         │  Free: 500MB │   │
│  │  Branching   │         │  Runs in Neon    │         │  Realtime    │   │
│  └──────────────┘         └──────────────────┘         └──────────────┘   │
│        │                           │                           │          │
│        ▼                           ▼                           ▼          │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                    APPLICATION LAYER                                │  │
│  │  • Prisma connects to Neon (DATABASE_URL)                          │  │
│  │  • Read replicas: Supabase for analytics/reports                   │  │
│  │  • Failover: Auto-switch to Supabase on Neon outage                │  │
│  │  • Local: SQLite (sql.js) for offline-first portal                 │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Mirror Implementation: pg_cron on Neon (Zero GitHub Actions Minutes)**

```sql
-- Enable pg_cron extension on Neon (run once via psql)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS dblink;  -- for cross-db operations

-- Create mirror function (runs on Neon, pushes to Supabase)
CREATE OR REPLACE FUNCTION mirror_to_supabase()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  supabase_conn text := 'host=db.xxx.supabase.co port=5432 dbname=postgres user=postgres password=xxx sslmode=require';
  tables_to_mirror text[] := ARRAY[
    'tenant', 'school', 'academic_year', 'term', 'class_level', 'class',
    'subject', 'subject_level', 'class_subject', 'grading_scale', 'grading_level',
    'assessment_type_config', 'fee_category', 'payment_method_config',
    'role', 'permission', 'delegation', 'attendance_taker',
    'news', 'event', 'report_template', 'branding',
    'staff', 'student', 'enrollment', 'assessment', 'score',
    'attendance_student', 'attendance_staff', 'fee_invoice', 'payment',
    'message', 'notification', 'audit_log'
  ];
  tbl text;
BEGIN
  -- For each table, use COPY TO/FROM for efficient bulk sync
  FOREACH tbl IN ARRAY tables_to_mirror LOOP
    EXECUTE format(
      'COPY (SELECT * FROM %I) TO PROGRAM ''psql "%s" -c "TRUNCATE %I; COPY %I FROM STDIN"''',
      tbl, supabase_conn, tbl, tbl
    );
  END LOOP;
END;
$$;

-- Schedule: Every 30 minutes (uses Neon compute hours, not GitHub Actions)
SELECT cron.schedule('mirror-to-supabase', '*/30 * * * *', 'SELECT mirror_to_supabase()');

-- View job status
SELECT * FROM cron.job WHERE jobname = 'mirror-to-supabase';
SELECT * FROM cron.job_run_details WHERE jobname = 'mirror-to-supabase' ORDER BY start_time DESC LIMIT 10;
```

**Alternative: Logical Replication (Neon → Supabase)**
```sql
-- On Neon (publisher)
CREATE PUBLICATION neon_to_supabase FOR ALL TABLES;

-- On Supabase (subscriber) - run via psql
CREATE SUBSCRIPTION neon_sub
  CONNECTION 'host=ep-xxx.neon.tech port=5432 dbname=neondb user=xxx password=xxx sslmode=require'
  PUBLICATION neon_to_supabase
  WITH (copy_data = true, create_slot = true);
```

**Why pg_cron on Neon?**
- ✅ **Zero GitHub Actions minutes** — runs inside Neon's compute (counts toward 190 hrs/mo free tier)
- ✅ **More reliable** — no external CI dependencies, runs on database server
- ✅ **Lower latency** — direct DB-to-DB, no checkout/install overhead
- ✅ **Transactional** — can wrap in transaction, better consistency
- ✅ **Monitorable** — `cron.job_run_details` shows history, duration, errors
- ✅ **Configurable** — change schedule via SQL, no workflow file edits

**Fallback: GitHub Actions (if pg_cron unavailable)**
```yaml
# .github/workflows/db-mirror.yml (30-min schedule = 1,440 runs/mo)
# At ~1.5 min/run = ~2,160 min/mo — still exceeds 2,000 free tier
# Only use if pg_cron not an option
```

---

## 6. NOVASTAR MONTESSORI SCHOOL — PLACEHOLDER CONTENT

### 6.1 School Profile (Researched)
| Detail | Value |
|--------|-------|
| **Name** | Novastar Montessori School |
| **Location** | Ayeduase new site K-5 junction, Ayeduase Road, Kumasi, Ashanti Region, Ghana |
| **Phone** | +233 24 493 5251 |
| **Established** | ~2016 |
| **School Type** | Day only |
| **Curriculum** | Ghanaian (GES/NaCCA) + Montessori Method |
| **Academic Year** | 2026/2027 |
| **Category** | Creche, Nursery, Kindergarten, Primary, JHS |

### 6.2 Mission Statement (Placeholder)
> "Bringing quality care and experience to learning through authentic Montessori education that nurtures each child's natural curiosity, independence, and love for discovery."

### 6.3 Programs Offered
- **Creche & Nursery** (6 months – 3 years) — Montessori toddler environment
- **Kindergarten** (KG1–KG2, ages 4–5) — Practical life, sensorial, language, math, culture
- **Lower Primary** (B1–B3, ages 6–8) — Montessori + GES curriculum integration
- **Upper Primary** (B4–B6, ages 9–11) — Advanced Montessori materials + NaCCA standards
- **Junior High School** (JHS 1–3 / B7–B9, ages 12–15) — Common Core Programme + BECE prep

### 6.4 Key Differentiators (from Research)
- Montessori practical learning through play
- Science lab with local materials (PEN-trained teachers)
- BECE Science: 100% Grade 1 achievement (2021)
- Child-centered, inquiry-based approach
- Qualified Montessori-trained staff (e.g., Alfred Owusu, Amanda Erbah, Louisa Dziwornu)

---

## 7. CONFIGURATION-FIRST ARCHITECTURE (Zero Hardcoding)

**Core Principle:** Everything that varies between schools or over time is data, not code. Admin UI exposes CRUD for all domain entities. Default seed data provides Ghana/NaCCA baselines; admins customize without developer involvement.

**Configurable Entities:** Academic Years, Terms, Class Levels, Classes/Streams, Subjects, Subject-Class Mapping, Grading System, Assessment Types, Fee Categories, Fee Structures, Payment Methods, User Roles, Permissions, Role Delegation Rules, Staff Roles, Houses, News/Announcements, Events/Calendar, Report Templates, School Branding, Communication Templates, Attendance Rules, Promotion Rules.

---

## 8. DYNAMIC RBAC WITH DELEGATION

**Headmaster Delegation UI:** `/portal/settings/delegation`
- See all staff with their current effective permissions
- Grant temporary/permanent delegations with scope
- Audit trail of all delegated actions
- Revoke instantly

**Teacher Attendance:** Configurable attendance takers per class/department (`/portal/settings/attendance-takers`)

---

## 9. IMPLEMENTATION PHASES (50 Weeks)

| Phase | Weeks | Focus | Key Deliverable |
|-------|-------|-------|-----------------|
| 0 | 1-2 | Foundation | Monorepo, CI, Neon+Supabase, Auth, Design System |
| 1 | 3-4 | Config Engine | Generic CRUD, Settings Hub (all entities) |
| 2 | 5-7 | Public Website | Next.js 16 static export, CMS-driven, En/Twi |
| 3 | 8-11 | Portal Core | PWA, Dynamic RBAC, Student/Staff mgmt, Academics |
| 4 | 12-16 | Assessment | SBA, terminal reports, promotion workflow |
| 5 | 17-19 | Attendance | Student + Staff, offline, alerts |
| 6 | 20-24 | Finance | Fees, MTN MoMo, Bank, Payroll |
| 7 | 25-27 | Communication | Email, Push, CMS, Templates |
| 8 | 28-31 | Reports | Engine, Analytics, GES Compliance |
| 9 | 32-36 | Sync/Offline | Yjs, Docker, Mini PC deploy |
| 10 | 37-41 | Advanced | Parent portal, Library, Inventory |
| 11 | 42-45 | Super Admin | Multi-tenant, Provisioning, White-label |
| 12 | 46-50 | Launch | Migration, Training, UAT, Deploy |

---

## 10. IMMEDIATE NEXT STEPS

1. **Initialize Monorepo** — `bun create turborrepo@latest novastar-montessori` + configure exact package versions
2. **Set Up Free Tier Accounts** — Neon, Supabase, Vercel, Resend, UploadThing, Upstash
3. **Design System Workshop** — Define tokens, components, theming (parallel with Phase 0)
4. **Technical Spikes (2 days each):**
   - Yjs + IndexedDB + Supabase Realtime sync
   - Dynamic RBAC + Delegation resolution
   - Prisma RLS multi-tenancy + Neon connection
   - MTN MoMo sandbox integration
   - **Neon pg_cron → Supabase mirror (COPY-based, zero GH Actions)**
5. **Collect Brand Assets** — Logo, photos, final copy from school
6. **Stakeholder Kickoff** — Align timeline, roles, communication cadence

---

## 11. GIT CONVENTIONS

```bash
# Branch naming
feat/TASK-XXX-short-description
fix/BUG-XXX-short-description
chore/DESCRIPTION

# Commit messages (Conventional Commits)
feat: add student enrollment wizard
fix: resolve offline sync conflict on grades
docs: update API documentation
chore: update dependencies

# PR Template: linked tasks, screenshots for UI, test results
```

---

*Document Version: 4.0 (Final — Exact packages from aerojet-academy, Free tier start, Neon+Supabase mirror, Novastar content)*
*Created: 2026-09-24*
*Status: READY FOR EXECUTION*
*Next Review: Sprint 0 Planning (Week 1)*
