# Phase 6 — DevOps, Build & Infrastructure Audit

**Repository:** `novastarmontissorischool` (Bun + Turborepo monorepo, Next.js 16 apps)
**Date:** 2026-09-28
**Auditor scope:** root `package.json`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `eslint.config.mjs`, `bun.lock`, `.bunfig.toml`, `.gitignore`, `.github/workflows/`, `.husky/`, `apps/*`, `packages/*`, `tools/*`
**Method:** static inspection plus live execution of Turbo/Bun commands (`--dry=json` graph enumeration, real exit codes) and the retained `.turbo/turbo-*.log` task logs from the last real run.

---

## Executive Summary

This monorepo has a plausible-looking toolchain — Turbo pipeline, flat ESLint config, a CI workflow, Husky, Biome, Storybook, Playwright, Changesets — but a large fraction of it is **declared and never executed**. The configuration surface is substantially wider than the working surface.

Six findings are structural rather than incremental:

1. **The repository has zero commits.** `git rev-list --count HEAD` returns `fatal: your current branch 'main' does not have any commits yet`. Every file in the tree is untracked (`??`). No CI run has ever been triggered, there is no review trail, and `.gitignore` is itself untracked so it has not yet protected anything.
2. **There are no tests.** Zero `*.test.*` / `*.spec.*` files exist anywhere in `apps/`, `packages/`, or `tools/`. `bun test` fails with `No tests found!` and exit code 1.
3. **The CI test command is syntactically invalid.** `bun run test --run` (ci.yml:53) fails before any test runs: `ERROR unexpected argument '--run' found`.
4. **`@novastar/shared-ui` publishes entry points that can never exist.** `main: ./dist/index.js` / `module: ./dist/index.mjs`, but the build is `tsc --project tsconfig.json` with `noEmit: true`. `dist/` contains only `index.css`.
5. **Prisma migrations are gitignored and none exist.** There is no `prisma/migrations/` directory, and `db:migrate:deploy` is wired into no CI job. Schema change is unreviewed, unreproducible and undeployable.
6. **The scheduled Neon→Supabase mirror job is unreachable and its root script is broken.** The workflow declares no `schedule:` trigger, and `db:mirror` filters on a package name that does not exist.

Beyond that: three divergent TypeScript toolchains, two competing formatters where one is not even installed, zero local git hooks, a non-functional Turbo remote cache, incomplete `globalEnv` (cache-poisoning risk), warn-only environment validation, and no deployment configuration of any kind.

**Overall risk: HIGH.** The build works locally and the pipeline graph is coherent, but nothing that gates quality is actually running, and the parts that do run are not protecting the parts that matter.

| Severity | Count |
|---|---|
| Critical | 6 |
| High | 16 |
| Medium | 24 |
| Low | 8 |

---

## 1. Build System (Turbo + Bun)

### 1.1 Pipeline shape — `turbo.json`

The task graph itself is reasonable: `build` dependsOn `^build`, `typecheck` dependsOn `^typecheck`, persistent tasks (`dev`, `test:ui`, `db:studio`) are flagged correctly, and `outputs` covers `.next/**`, `dist/**`, `build/**`.

**Live graph enumeration** (`turbo run lint --dry=json`, `turbo run typecheck --dry=json`, `turbo run test --dry=json`) returns **all 13 workspace packages for every task**, including packages that define no such script. This is misleading: Turbo creates a task node for every workspace once the task is declared in `turbo.json`, and a missing script is a silent no-op.

- `@novastar/db-mirror` has **no** `lint` and **no** `typecheck` script (`tools/db-mirror/package.json`), yet appears in both graphs. The script that handles `NEON_DATABASE_URL` and `SUPABASE_DATABASE_URL` production credentials is never typechecked. *(Medium)*
- `@novastar/sync-engine` has no `typecheck` script, so it is excluded from `turbo run typecheck` — despite `apps/portal` importing it as a `workspace:*` dependency. *(Medium)*

**FINDING B-1 — `build` on `sync-engine` emits nothing but satisfies `^build`.** `packages/sync-engine/package.json` declares `"build": "tsc --noEmit"`. Turbo caches it (`turbo.json:9-13`), so a "build" that produces no artifacts is recorded as a successful build and satisfies `^build` for every dependent. Confirmed in the retained log: `packages/sync-engine/.turbo/turbo-build.log` contains only `$ tsc --noEmit`. **Severity: Medium.**

### 1.2 Two root scripts target packages that do not exist

Both verified live:

```
$ bunx turbo run db:mirror --filter=db-mirror --dry=json
  x No package found with name 'db-mirror' in workspace     (exit 1)

$ bunx turbo run build --filter=super-admin --dry=json
  x No package found with name 'super-admin' in workspace   (exit 1)
```

- **FINDING B-2 — `db:mirror` is doubly broken. CRITICAL.** `package.json:26` filters on `db-mirror`; the package is named `@novastar/db-mirror` (`tools/db-mirror/package.json:2`). Separately, `packages/database/package.json` also defines `db:mirror` as `bun run mirror.ts`, and **`mirror.ts` does not exist** in `packages/database/` (directory contains only `index.ts`, `package.json`, `prisma.config.ts`, `tsconfig.json`, `prisma/schema.prisma`). The Neon→Supabase replication path — the one workflow that touches production databases — has no working entry point on either side.
- **FINDING B-3 — `build:super-admin` targets an empty directory. HIGH.** `apps/super-admin/` contains zero files and no `package.json`.

### 1.3 Caching

**FINDING B-4 — Turbo remote cache is configured in CI but cannot work. HIGH.** `ci.yml:9-11` exports `TURBO_TOKEN` and `TURBO_TEAM`, but there is no `turbo login` / `turbo link` step and no `.turbo/config.json` in the repository. `TURBO_REMOTE_ONLY` is not set. Every CI run therefore rebuilds from an empty local cache, and the local cache is not shared between the `lint-and-typecheck`, `test`, `test-e2e`, and `build` jobs because no `actions/cache` step exists for `.turbo/cache`. The remote cache is paying cost without returning value.

**FINDING B-5 — `globalEnv` is materially incomplete, allowing cache poisoning. HIGH.** `turbo.json:61` declares only `DATABASE_URL`, `SUPABASE_DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. Actual environment reads across the monorepo:

| Variable | Read at |
|---|---|
| `DIRECT_URL` | `packages/database/prisma.config.ts:6` |
| `NEON_DATABASE_URL` | `.github/workflows/ci.yml:130` |
| `RESEND_API_KEY` | `packages/notifications/index.ts:14` |
| `MTN_MERCHANT_ID` | `packages/payments/index.ts:104` |
| `SCHOOL_BANK_NAME`, `SCHOOL_BANK_ACCOUNT` | `packages/payments/index.ts:173` |
| `TENANT_ID`, `SCHOOL_ID` | `apps/portal/lib/auth.ts:115-116`, `apps/portal/lib/tenant.ts:25` |
| `DEFAULT_LOCALE` | `apps/public-site/lib/i18n.ts:8` |
| `DEFAULT_SCHOOL_CODE` | `apps/portal/lib/auth.ts:30` |

`turbo.json:3` sets `globalDependencies: [".env*"]`, which mitigates only for a **root** `.env` file. Any of the above set in the real process environment (as in the `build` and `test-e2e` CI jobs) can change build output without changing the cache hash. **Severity: High.**

**FINDING B-6 — `test` is cached against coverage output that no test produces. HIGH.** `turbo.json:27-31` declares `test` with `cache: true` and `outputs: ["coverage/**"]`. There is no coverage configuration in any package, and there are no tests. A cache hit replays a green `test` task without executing anything. Once tests do exist, a hash collision on unchanged inputs returns a previous run's result — which is the intended behaviour, but combined with the broken CI invocation (F-5) it means the "test" job is a no-op in two independent ways.

### 1.4 Build output configuration

**FINDING B-7 — `@novastar/shared-ui` entry points are dangling. CRITICAL.**

```jsonc
// packages/shared-ui/package.json:4-8
"main": "./dist/index.js",
"module": "./dist/index.mjs",
"types": "index.ts",
"files": ["dist"],
"scripts": { "build": "tsc --project tsconfig.json && bun run build:css", ... }
```

`packages/shared-ui/tsconfig.json:7` sets `"noEmit": true`. `tsc` therefore writes nothing; `bun run build:css` (`scripts/build-css.js`) writes **only** `dist/index.css`. Verified on disk: `packages/shared-ui/dist/` contains exactly one file, `index.css`. There is no `index.js` and no `index.mjs`.

Type checking passes because `types` points at source (`index.ts`), which masks the problem. Any resolution that honours `main`/`module` — Node runtime, `tsx`, a non-transpilePackages bundler path, Storybook, Playwright — fails to resolve. `files: ["dist"]` also means the package would publish CSS only. **Severity: Critical.**

**FINDING B-8 — `packages/sync-engine` has no `build` output and `shared-utils` has emit config with no build script. Medium.** `packages/shared-utils/tsconfig.json:12-14` sets `declaration: true`, `outDir: "dist"`, `noEmit: false` — but `packages/shared-utils/package.json` declares no `build` script at all, so the emit configuration is unreachable. It is also the only workspace tsconfig that enables `noUncheckedIndexedAccess` (`shared-utils/tsconfig.json:6`), an inconsistency with no stated rationale.

### 1.5 Build warnings observed in the last real build

From `apps/portal/.turbo/turbo-build.log`:

- `MODULE_TYPELESS_PACKAGE_JSON` warning for `apps/portal/tailwind.config.ts` — the package lacks `"type": "module"`, forcing a reparse on every load. **Low.**
- `Experiments (use with caution): webpackBuildWorker` — `experimental.webpackBuildWorker: true` (`apps/portal/next.config.ts`) is active on the production build path, and the build is running under Turbopack. **Medium.**
- `apps/public-site/next.config.ts` moved `typedRoutes` to top level with a comment noting the Next 15+ migration, but `apps/portal/next.config.ts` still uses the deprecated `experimental` block. Inconsistent migration. **Medium.**

---

## 2. TypeScript Configuration

### 2.1 `tsconfig.base.json` is entirely unused

**FINDING T-1 — Dead base config plus two competing alias schemes. HIGH.** No workspace extends `tsconfig.base.json`. Verified across all 12 workspace tsconfigs (`apps/portal`, `apps/public-site`, and 10 packages) — every one restates `target`, `lib`, `strict`, `moduleResolution`, `paths`, `include`, and `exclude` from scratch.

The consequences are visible:

| Concern | `tsconfig.base.json` | Actual workspaces |
|---|---|---|
| `target` | `ES2017` (line 3) | `ES2022` / `esnext` |
| Alias style | 11 explicit `@novastar/<pkg>/*` → `packages/<pkg>/*` (lines 19-29) | wildcard `"@novastar/*": ["../../packages/*/index.ts"]` |
| `@/*` | `["./*"]` (line 18) | app-relative |

The base also declares `"@novastar/plugin-registry/*": ["packages/plugin-registry/*"]` (line 29) for a package that **does not exist** — `packages/plugin-registry/` is an empty directory.

`packages/database/tsconfig.json:14-16` diverges further still, defining only `"~/*": ["./*"]` and no `@novastar/*` mapping at all.

The wildcard alias has a real hazard: `"@novastar/*": ["../../packages/*/index.ts"]` will happily resolve `@novastar/typo` to `packages/typo/index.ts` and fail with a module-not-found rather than a clear "no such workspace package". **Severity: High.**

**FINDING T-2 — Duplicate JSON key silently discarded. Medium.** `packages/shared-utils/tsconfig.json` sets `moduleResolution` twice — line 4 and line 10. The second wins; the first is dead.

**FINDING T-3 — Package `include` globs do not recurse. Medium.** Eight packages use `"include": ["*.ts"]` (`shared-types`, `database`, `auth`, `sync-engine`, `notifications`, `payments`, `reports`, `ghana-education`) — top level only, no `**`. Any file added in a subdirectory is silently excluded from `turbo run typecheck` with no error. Only `shared-ui` uses `src/**/*`.

**FINDING T-4 — No project references. Medium.** There are no `references` arrays, no `composite: true`, and no build-mode orchestration. Type information crosses package boundaries as raw `.ts` source through the path alias, so each app re-typechecks every dependency. The build logs show this cost: public-site spends **54s of a 93s compile in "Running TypeScript"** versus 3.3s generating static pages. Duplicating `tsc` across 13 packages with no incremental sharing is the single largest avoidable cost in the build.

**FINDING T-5 — `apps/public-site/tsconfig.json:41-42` lists `"node_modules"` twice** in `exclude`. Cosmetic. **Low.**

**FINDING T-6 — Bun globals in a Next.js app. Low.** `apps/portal/tsconfig.json:26` sets `"types": ["node", "bun"]`, resolving `@types/bun` (declared only in the **root** devDependencies, `package.json:43`). Bun-specific globals typecheck in a Node/Edge runtime where they do not exist.

### 2.2 Type checking in CI

Type checking **is** wired: `ci.yml:34-35` runs `bun run typecheck` → `turbo run typecheck` → 13 tasks, and the retained logs show `tsc --noEmit` succeeding across all packages. This is the strongest part of the pipeline. Two caveats: `apps/portal/next.config.ts:80-82` sets `typescript.ignoreBuildErrors: false` (correct), and `apps/public-site/next.config.ts` does the same (correct), so `next build` also typechecks — meaning type errors surface twice, once in the `lint-and-typecheck` job and again in `build`, at a cost of 26s and 54s respectively.

---

## 3. Linting & Formatting

### 3.1 Biome is configured but not installed and never invoked

**FINDING L-1 — `biome.json` is dead configuration. HIGH.** The file is a full, thoughtful Biome config — formatter, `organizeImports`, lint rules, per-language formatters, 17 ignore globs. But:

- `@biomejs/biome` is **not** in any `package.json`. Verified: `Test-Path node_modules/@biomejs` → `False`.
- No script anywhere invokes `biome`. Root `lint` → `turbo run lint` → `eslint`. Root `lint:fix` → `turbo run lint:fix`, and **no package defines a `lint:fix` script** — silent no-op.

The stated intent in the audit brief is that Biome "replaces ESLint + Prettier". It does not. Biome is an orphan file.

### 3.2 Two live formatters that disagree

**FINDING L-2 — Prettier and Biome are both configured, disagree, and Prettier has no config. High.** Root `package.json:27`:

```json
"format": "prettier --write \"**/*.{ts,tsx,json,md,css,html}\""
```

There is **no** `.prettierrc`, `.prettierrc.json`, or `prettier` key in `package.json`. Prettier therefore runs on defaults — `printWidth: 80` — while `biome.json:36` declares `lineWidth: 100`. Any file touched by `bun run format` is formatted to a different standard than Biome would apply, and there is no Prettier ignore file to stop it walking generated output such as `docs/html/**` (which both `biome.json:22` and `eslint.config.mjs:46` explicitly ignore — Prettier does not respect either).

`prettier-plugin-tailwindcss` is installed in both the root and `apps/public-site` but has no Tailwind entry to sort against, and its output is not verifiable given the missing config.

**FINDING L-3 — ESLint version claim in the config header is wrong. Medium.** `eslint.config.mjs:2` states *"Migrated from .eslintrc.json (legacy) to ESLint 10 + Next.js 16 flat config."* Installed is `eslint: "^9.18.0"` (`package.json:55`) and `eslint-config-next: "^16.3.3"`. ESLint 9 is what actually runs.

**FINDING L-4 — `--ext` is a flat-config anti-pattern, used in all 13 packages. Medium.** Every lint script is `eslint . --ext .ts` or `eslint . --ext .ts,.tsx`. In flat config, file targeting is controlled by the `files` array of each config object, not by `--ext`; ESLint 9 accepts the flag for backwards compatibility. The lint logs show it currently still lints files (2 warnings found in portal), but the effective target set is coming from the spread Next configs, not from `--ext`. The flag is misleading about what is being linted.

**FINDING L-5 — Next.js config applied to non-Next packages. Medium.** `eslint.config.mjs:89-90` spreads `nextCoreWebVitals` and `nextTypescript` with no `files` scoping, so they apply across all 13 packages. Every package lint log is polluted:

```
Warning: React version was set to "detect" in eslint-plugin-react settings,
but the "react" package is not installed. Assuming latest React version for linting.
Pages directory cannot be found at ...\packages\auth\pages or ...\packages\auth\src\pages.
```

This affects `auth`, `database`, `ghana-education`, `notifications`, `payments`, `reports`, `shared-types`, `shared-ui`, `shared-utils`, `sync-engine`. Ten of thirteen lint jobs emit two warnings of noise before doing any work.

**FINDING L-6 — The global ignore list is an allowlist of exemptions that will silently absorb new code. Medium.** `eslint.config.mjs:18-84` ignores `tests/**` outright, plus 14 individually named one-off scripts (`fix.js`, `migrate_enums.js`, `scripts/*.cjs`, `scripts/_tmp_*.cjs`, `scripts/debug*.mjs`). The comment at lines 65-66 concedes these are *"kept for history but should not gate CI lint"*. The pattern is the problem: any new file matching those globs inherits a permanent, invisible exemption. `scripts/_tmp_*.cjs` in particular is a wildcard that will match future scratch files by default.

**FINDING L-7 — Rule severities are weaker than the config suggests. Medium.** `eslint.config.mjs:96-104` downgrades `@typescript-eslint/no-unused-vars` and `no-explicit-any` to `warn`, and lines 107-109 turn off `react/no-unescaped-entities`, `@typescript-eslint/no-empty-object-type`, and `no-non-null-asserted-optional-chain` because *"the codebase is mid-migration."* Combined with the absence of `--max-warnings` on every lint script, warnings never fail anything. The portal lint log ends with `✖ 2 problems (0 errors, 2 warnings)` and a zero exit code.

**FINDING L-8 — `.mjs` and `.json` config files are themselves unlinted. Low.** `biome.json:9` sets `files.ignoreUnknown: false`, but Biome is not installed, and ESLint's `globalIgnores` does not cover `*.mjs`, `*.json`, `*.yml`, or `*.prisma`. `eslint.config.mjs`, `turbo.json`, `tsconfig.base.json`, `biome.json`, and `.github/workflows/ci.yml` have no automated validation at all.

### 3.3 Husky and lint-staged — installed, configured for, and absent

**FINDING L-9 — Zero git hooks exist. HIGH.**

```
$ Get-ChildItem -Force .husky
Name  Length
----  ------
_             <-- the only entry
```

`.husky/` contains **only** the generated `_/` directory (husky's own bootstrap shims). There is no `pre-commit`, no `pre-push`, no `commit-msg`. `package.json:28` declares `"prepare": "husky install"`, so the bootstrap runs and installs nothing.

Combined with the fact that nothing is committed (§7.1), **no commit in this repository has ever passed through a local gate.**

**FINDING L-10 — `lint-staged` is a dead dependency. High.** `lint-staged: "^17.4.1"` is in `package.json:58`. There is no `lint-staged` key in any `package.json` and no `.lintstagedrc*` file anywhere. Nothing consumes it — and with no `pre-commit` hook (L-9) nothing could.

**FINDING L-11 — `husky install` is the deprecated entry point. Low.** `package.json:28` uses `husky install`; husky 9.1 deprecates it in favour of bare `husky`. It still works, but emits a deprecation notice on every `bun install`.

---

## 4. Testing

### 4.1 There are no tests

**FINDING X-1 — Zero test files in the entire monorepo. CRITICAL.**

`glob {apps,packages,tools}/**/*.{test,spec}.{ts,tsx}` → **no files found.** An independent recursive filesystem scan (excluding `node_modules`) returned the same result.

The confirmed runtime behaviour, from the retained log `apps/public-site/.turbo/turbo-test.log`:

```
$ bun test
bun test v1.4.0 (34cbb9a40)
No tests found!
error: script "test" exited with code 1
```

`packages/sync-engine/.turbo/turbo-test.log` shows the same. There is no `turbo-test.log` under `apps/portal/.turbo` at all, so portal's `test` task has not successfully completed either.

The infrastructure implies a test strategy that was never built out:

| Signal | Location | Reality |
|---|---|---|
| `@playwright/test`, `@axe-core/playwright` | root `package.json:34-35` | No `playwright.config.*` anywhere in the repo |
| `@testing-library/react`, `/jest-dom`, `/user-event` | root `package.json:40-42` | Unused; no Vitest, no Jest, no test setup file |
| `@storybook/nextjs`, `@storybook/react`, `storybook` | root `package.json:38,66` | No `.storybook/` directory in any package |
| `coverage/**` in Turbo outputs + Codecov upload | `turbo.json:29`, `ci.yml:55-59` | No coverage tool configured, no thresholds |
| `packages/testing/` | workspace | **Empty directory**, no `package.json` — not a workspace member |
| `tsconfig.base.json:33` excludes `**/*.test.ts` | base config | Excludes a file category that does not exist |

**Coverage thresholds: none defined anywhere.**

### 4.2 Test scripts that cannot work

**FINDING X-2 — `test:ui` is not a Bun capability. Medium.** `apps/portal/package.json:12` and `apps/public-site/package.json:12` both define `"test:ui": "bun test --ui"`. Bun has no `--ui` flag. Executed live:

```
$ bun test --ui
error: 0 test files matching **{.test,.spec,_test_,_spec_}.{js,ts,jsx,tsx}
```

`turbo.json:32-35` allocates this task a `persistent: true` slot, meaning a long-running watcher Turbo will never allow to complete.

**FINDING X-3 — `test:e2e` has nothing to run. HIGH.** `apps/portal/package.json:13` defines `"test:e2e": "playwright test"`. No `playwright.config.ts`/`.js`/`.mjs` exists in `apps/`, `packages/`, or `tools/`. No `e2e/` or `tests/` directory exists in any app. `apps/public-site` defines no `test:e2e` at all, so `turbo run test:e2e` covers exactly one package, and that package has no test files and no config.

Additionally `turbo.json:36-40` sets `test:e2e` → `dependsOn: ["build"]` (its own package's build) rather than `^build`. Combined with the absence of a `webServer` configuration anywhere, there is no mechanism to start the Next server the E2E suite would need.

**FINDING X-4 — Root `test:ui` / `test:e2e` turbo passthrough. Medium.** `package.json:20-21` define both. Since the backing scripts are non-functional, both root scripts fail on invocation.

**FINDING X-5 — Test task ordering. Low.** `turbo.json:28` gives `test` an empty `dependsOn: []`, so tests run without waiting for a build. Defensible for unit tests, incorrect for anything touching the built app.

---

## 5. CI/CD

### 5.1 What the workflow runs

`.github/workflows/ci.yml` is the only workflow file. Five jobs:

| Job | Lines | Command | Status |
|---|---|---|---|
| `lint-and-typecheck` | 14-35 | `bun run lint`, `bun run typecheck` | Functional |
| `test` | 37-59 | `bun run test --run` | **Broken** |
| `test-e2e` | 61-84 | `bun run build` then `bun run test:e2e` | **Broken** |
| `build` | 86-109 | `bun run build` | Functional |
| `db-mirror` | 111-132 | `bun run db:mirror` | **Broken** |

### 5.2 The `test` job fails before executing anything

**FINDING CI-1 — `bun run test --run` is rejected by Turbo. CRITICAL.** `ci.yml:53`. Verified live:

```
$ bunx turbo run test --run --dry=json
  ERROR  unexpected argument '--run' found
  Usage: turbo run [FLAGS]
(exit 1)
```

`package.json:19` maps `test` to `turbo run test`; `--run` was evidently intended for `vitest`. Turbo parses it as a turbo flag and aborts. Even with the flag removed, the job would then hit X-1 (no tests) and exit 1. **The unit-test gate has never been capable of passing.**

### 5.3 The `db-mirror` job cannot run

**FINDING CI-2 — The mirror job is both unreachable and broken. CRITICAL.** Two independent defects:

1. `ci.yml:114` gates on `if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'`. The workflow's `on:` block (`ci.yml:3-7`) declares only `push` and `pull_request`. **There is no `schedule:` trigger and no `workflow_dispatch:`,** so the job is unreachable by both paths. The intended nightly Neon→Supabase replication does not exist.
2. Even under `workflow_dispatch`, `bun run db:mirror` → `turbo run db:mirror --filter=db-mirror` → `x No package found with name 'db-mirror' in workspace` (B-2).

This is the single highest-consequence gap: a job holding `NEON_DATABASE_URL` and `SUPABASE_DATABASE_URL` production credentials has no working path. **Severity: Critical.**

### 5.4 Workflow hardening — all absent

**FINDING CI-3 — No `permissions:` block. High.** The workflow inherits the repository's default `GITHUB_TOKEN` permissions. Every job — including `test-e2e` and `build`, which run `bun install` and execute arbitrary package lifecycle scripts including `trustedDependencies` native builds — has full default token scope. Every job should declare `permissions: contents: read`.

**FINDING CI-4 — No `concurrency:` block. High.** `ci.yml:1-132`. Rapid successive pushes to `main`/`develop` queue unlimited redundant runs, each performing a full install and a full 85-93s Next.js build. Standard mitigation is `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`.

**FINDING CI-5 — Actions are tag-pinned, not SHA-pinned. Medium.** All six third-party actions use mutable tags: `actions/checkout@v4` (lines 19, 42, 66, 92, 118), `oven-sh/setup-bun@v1` (24, 45, 69, 97, 121), `codecov/codecov-action@v4` (56). A compromised or repointed tag executes with the workflow's token. Pin to full commit SHAs.

**FINDING CI-6 — No dependency caching. Medium.** All five jobs run `bun install --frozen-lockfile` with no `oven-sh/setup-bun` cache option and no `actions/cache` step. Every job re-downloads the full dependency tree. With `centralStore = true` (`.bunfig.toml:2`) the install is deduplicated on disk but still fully re-fetched.

**FINDING CI-7 — No `timeout-minutes` on 4 of 5 jobs. Medium.** Only `db-mirror` declares one (`ci.yml:115`). A hung `next build` or Playwright run holds a runner until GitHub's 6-hour default.

**FINDING CI-8 — Codecov step is configured to never fail and has no token. Medium.** `ci.yml:55-59`: `files: ./coverage/lcov.info` points at a root path, but coverage would be produced inside app workspaces and no coverage tool is configured; `fail_ci_if_error: false` means the step cannot fail regardless; and `codecov-action@v4` requires a `token` for private repositories.

**FINDING CI-9 — `build` and `test-e2e` are independent; E2E does not gate. Medium.** `ci.yml:89` sets `needs: [lint-and-typecheck, test]`. The `test-e2e` job is not in any `needs` list and nothing depends on it, so E2E results have no effect on merge eligibility even once repaired. Both jobs also run a full `bun run build` independently (~93s + 85s of compile each, per the logs).

### 5.5 Deployment

**FINDING CI-10 — There is no deployment configuration of any kind. High.** Verified absent: `Dockerfile`, `vercel.json`, `Procfile`, `.dockerignore`, `.github/workflows/deploy.yml`. Directories scanned across the whole tree.

This leaves several declared intentions unimplemented:
- `apps/portal/next.config.ts:83` sets `output: 'standalone'` with the comment `// Output standalone for Docker` — there is no Dockerfile.
- `apps/public-site/next.config.ts:9` sets `output: 'export'` with the comment `// Static export for free hosting` — no host is configured.
- `.gitignore:15` and the ignore lists in `biome.json:14` / `eslint.config.mjs:34` reference `.vercel/**`, implying a Vercel workflow that does not exist.

The intended target platform is genuinely ambiguous, which is itself the finding.

### 5.6 Bun version drift

**FINDING CI-11 — Three different Bun version constraints. Medium.**

| Source | Constraint |
|---|---|
| `package.json:75` | `"packageManager": "bun@1.4.0"` |
| `package.json:72-74` | `"engines": { "bun": ">=1.4.0" }` |
| `ci.yml:26, 47, 70, 98, 122` | `bun-version: 1.4.x` |

CI resolves `1.4.x` to the newest 1.4 patch, not the pinned `1.4.0`. A `bun patch` release can change install or test behaviour in CI without any repo change. Use `bun-version-file: package.json` (honours `packageManager`) or pin the exact version.

---

## 6. Dependency Management

### 6.1 Three TypeScript toolchains

**FINDING D-1 — Four different TypeScript resolutions coexist. HIGH.**

| Location | Declaration | Resolves to |
|---|---|---|
| `package.json:70` | `"typescript": "npm:@typescript/typescript6@^6.0.2"` | TS 6 preview |
| `package.json:52` | `"@typescript/native": "npm:typescript@^7.0.2"` | TS 7 preview |
| `apps/portal/package.json:55` | `"typescript": "5.7.3"` | TS 5.7 (pinned, no caret) |
| `apps/portal/package.json:51` | `"@typescript/native": "npm:typescript@^7.0.2"` | TS 7 preview |
| `apps/public-site/package.json:43` | `"typescript": "5.7.3"` | TS 5.7 |
| all 10 packages | `"typescript": "npm:@typescript/typescript6@^6.0.2"` | TS 6 preview |

So the apps typecheck against **5.7.3** while every library they import is compiled by **TS 6**, and both are shadowed by a **TS 7** alias in each. Diagnostics, narrowing behaviour, and `lib` typings will differ between the package that defines a symbol and the app that consumes it. `@typescript/native` (`tsgo`) is declared in three places and is not wired into any script.

**Severity: High.** Pick one compiler, one version, and put it in the root as the single source of truth.

### 6.2 Native module placement

**FINDING D-2 — `argon2` is imported by an app but declared only in the workspace root. HIGH.**

- `apps/portal/lib/password.ts:1` — `import { verify as argon2Verify } from 'argon2'`
- Declared at `package.json:76-79` (root `dependencies`), **not** in `apps/portal/package.json`

It resolves only by Bun's hoisting behaviour. `apps/portal` cannot be installed, built, or reasoned about in isolation — which is precisely the isolation Turborepo and workspace boundaries exist to provide. `bcryptjs` has the same problem: declared at root and in portal, but `packages/auth/package.json:12` pins a different major.

**FINDING D-3 — `argon2` is a native module absent from `trustedDependencies`, whose contents are stale. Medium.** `argon2` requires a node-gyp build. `.bunfig.toml:7-11` lists `"@prisma/client"`, `"better-sqlite3"`, `"bcrypt"`, `"sharp"` as trusted. Only `@prisma/client` is a real dependency. `better-sqlite3`, `bcrypt`, and `sharp` appear in no `package.json` in the repository. Meanwhile the one native module that *is* used (`argon2`) is unlisted, so `bun install` will warn and skip its build script. Note `apps/portal` also depends on `@node-rs/argon2` (`^2.2.1`), a prebuilt N-API alternative — the two argon2 implementations coexisting is itself a smell.

### 6.3 Version alignment

**FINDING D-4 — `bcryptjs` majors diverge. High.** `^3.0.3` at `package.json:78` and `apps/portal/package.json:33`; `^2.4.3` at `packages/auth/package.json:12`. Two majors of a password-hashing library in one install tree — `@types/bcryptjs@^3.0.0` (`apps/portal/package.json:46`) will then misdescribe the v2 API inside `@novastar/auth`.

**FINDING D-5 — Incompatible Auth.js adapter/runtime pairing. High.** `apps/portal/package.json:16` declares `@auth/prisma-adapter: "^2.11.3"` — the Auth.js **v5** adapter — while `package.json:36` and `packages/auth/package.json:14` declare `next-auth: "^4.24.15"`. The v2 adapter requires a `next-auth@5` / `@auth/core` runtime and a differently-shaped `Adapter` export. Either the app is on v4 with an unusable adapter, or the v4 pin is stale.

**FINDING D-6 — Mixed pinning policy with no automation. Medium.**

| Exact-pinned | Caret-ranged |
|---|---|
| `next: "16.3.3"` (both apps) | `react: "^19.2.8"` |
| `lucide-react: "1.8.0"` (3 packages) | `tailwindcss: "^4.3.3"` |
| `pg: "8.18.0"` (database, db-mirror) | `eslint-config-next: "^16.3.3"` |
| `resend: "6.22.0"` (notifications) | `@prisma/client: "^7.10.0"` |
| `@typescript-eslint/*: "8.68.0"` (root + both apps) | `@playwright/test: "^1.62.1"` |

No Renovate config, no Dependabot config, no `.github/dependabot.yml`. The exact pins drift silently; the caret ranges are never updated. Nothing enforces either.

**FINDING D-7 — Orphan devDependencies at the root. Low.** `package.json:33-71` is a hoisted junk drawer. Verified unused by import scan: `postgres` (`:61`), `pdf-parse` (`:59`), `@types/sanitize-html` (`:49`), `@types/qrcode` (`:46`), `@axe-core/playwright` (`:34`, unusable without Playwright tests), `cross-env` (`:54`), `@release-it/conventional-changelog` (`:37`). `tsx` (`:68`) is used only by `packages/sync-engine`, which declares it itself. Root `dependencies` should be empty in a private workspace root.

### 6.4 Lockfile and security

**FINDING D-8 — Lockfile is healthy. Informational.** `bun.lock` is the text format (`lockfileVersion: 2`, 463 KB) and CI installs with `--frozen-lockfile` in all five jobs — the correct posture. `.gitignore:33` ignores the legacy `bun.lockb`; harmless but should be removed to avoid confusion.

**FINDING D-9 — No dependency vulnerability scanning. HIGH.** No `bun audit`, no `npm audit`, no Dependabot security updates, no OSV/Trivy/Snyk step, no CodeQL, no SBOM generation, no license policy check. Nothing in the repository inspects the ~1,500-entry dependency tree for known CVEs. For a project handling student PII, payment instructions (`packages/payments`), and OAuth sessions, this is a material gap.

**FINDING D-10 — All release tooling is non-functional. Medium.** `package.json:29-31` define `changeset`, `version`, and `release` against the `changeset` CLI. Verified: `@changesets/cli` is **not installed** (`Test-Path node_modules/@changesets` → `False`) and no `.changeset/` directory exists. All three scripts fail. `release-it` (`:65`) and `@release-it/conventional-changelog` (`:37`) are installed with no `.release-it.json` and no invoking script.

### 6.5 Workspace membership

**FINDING D-11 — Six directories are outside the workspace entirely. High.** `package.json:5-9` declares `apps/*`, `packages/*`, `tools/*`, but these have no `package.json` and are therefore not workspace members — no lint, no typecheck, no test, no build:

| Path | Files |
|---|---|
| `apps/super-admin/` | 0 (targeted by the broken `build:super-admin` script) |
| `packages/plugin-registry/` | 0 (but aliased in `tsconfig.base.json:29`) |
| `packages/testing/` | 0 |
| `packages/plugins/{alumni,analytics,canteen,clinic,learning,library}/` | 6 unmanifested directories |
| `tools/migrate/` | 0 |
| `tools/sync-cli/` | 0 |
| `tools/tenant-cli/` | 0 |

`tools/seed/` is the one exception — it has a single file (`index.ts`) and is referenced by `packages/database`'s `db:seed` as `bun run ../../tools/seed/index.ts`, reaching outside the package boundary to a directory that is not a workspace member and is therefore never typechecked.

**`workspace:*` protocol usage is otherwise correct** — all 9 internal cross-package dependencies in `apps/portal/package.json:19-27` and `apps/public-site/package.json:15-18` use `workspace:*`, and the four `peerDependencies` groups (`auth`, `notifications`, `payments`) also use it correctly with no `peerDependenciesMeta` where the peer is genuinely required.

---

## 7. Environment & Configuration

### 7.1 Secret handling — gitignore is correct, repository state is not

`.gitignore:14-20` is well-constructed:

```
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
!.env.example
```

Both `.env` and `.env.local` are present in the working tree and correctly untracked. **No secret is exposed.** `apps/portal/.env.example` and `apps/public-site/.env.example` contain only placeholders (`ep-xxx.neon.tech`, `user:pass`).

**FINDING E-1 — But `.gitignore` is itself untracked, and the repository has no commits. CRITICAL.** See §8.1. The ignore rules are correct and currently load-bearing only by accident of local state. Combined with a repo containing live `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SUPABASE_SECRET_KEY`, and `NEXTAUTH_SECRET` in `.env`, the margin for error is zero: a `git add -A` before the ignore rules are committed would stage credentials. Commit `.gitignore` and add a pre-commit secret scan (§8.2, recommendation R-1) before the first commit.

**FINDING E-2 — Two env files with no documented precedence and duplicated keys. Medium.** `.env` and `.env.local` both exist and both define `DATABASE_URL`. `.env` additionally defines `SUPABASE_DATABASE_URL` **twice** (lines 8 and 9 of the key list) and `DIRECT_URL`, which `.env.local` omits. There is no `.env.example` at the root documenting the union, and no documented precedence rule outside a code comment.

### 7.2 Environment variable validation is warn-only

**FINDING E-3 — The only env validation in the repo is a `console.warn` that is disabled in production. HIGH.** `apps/portal/next.config.ts:37-42`:

```ts
if (process.env.NODE_ENV !== 'production') {
  const required = ['DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL']
  const missing = required.filter((key) => !process.env[key])
  if (missing.length > 0) {
    console.warn(`[next.config] Missing env vars for the portal: ${missing.join(', ')}`)
  }
}
```

A `console.warn` does not fail anything, and the `NODE_ENV !== 'production'` guard means **the one environment where a missing `NEXTAUTH_SECRET` breaks authentication is the one environment that is not checked.** The failure surfaces at runtime as a NextAuth `NO_SECRET` error in production, not at build time.

**There is no zod env schema anywhere in the monorepo**, despite `zod@^4.4.3` being a dependency of four packages. This is the single highest-value addition to the environment layer: one `env.ts` at the root that parses `process.env` once, exports a typed object, and `throw`s on missing required keys.

**`apps/public-site` has no environment handling at all** — no root env loader, no validation. Its `lib/data.ts:11-19` compensates by silently swallowing:

```ts
if (!process.env.DATABASE_URL) { return fallback }
// ...
} catch (error) {
  console.warn(`Data fetch failed, using fallback:`, error)
  return fallback
}
```

Because `next build` for this app is a static export, **a production build can succeed while shipping fabricated placeholder content to the live site** with only a build-log warning. That is a content-integrity risk, not just a DX one. **Severity: High.**

**FINDING E-4 — Custom env loader has a path-fragility bug. Medium.** `apps/portal/next.config.ts:21-23` derives the repo root as `path.resolve(appDir, '..', '..')` where `appDir` is `__dirname`. Correct for `apps/portal`, but it is duplicated logic with no counterpart in `apps/public-site`, and it hard-codes a two-level depth. Any relocation of the app breaks env loading silently.

### 7.3 `.env.example` drift

**FINDING E-5 — Documented variables do not match consumed variables. Medium.** Cross-referencing the examples against actual reads:

| Documented | Actually read | Status |
|---|---|---|
| `MTN_SUBSCRIPTION_KEY`, `MTN_API_USER`, `MTN_API_KEY` (`apps/portal/.env.example`) | `MTN_MERCHANT_ID` (`packages/payments/index.ts:104`) | **Wrong names** |
| — | `SCHOOL_BANK_NAME`, `SCHOOL_BANK_ACCOUNT` (`packages/payments/index.ts:173`) | **Undocumented** |
| `SUPABASE_ANON_KEY` (`apps/portal/.env.example`) | `SUPABASE_PUBLISHABLE_KEY` (`.env`) | **Wrong name** |
| — | `TENANT_ID`, `SCHOOL_ID` (`apps/portal/lib/auth.ts:115-116`, `lib/tenant.ts:25`) | **Undocumented and required** |
| — | `DIRECT_URL` (`packages/database/prisma.config.ts:6`) | **Undocumented** |
| — | `RESEND_API_KEY` (portal example: present) | Documented in one file only |
| — | `NEON_DATABASE_URL` (`ci.yml:130`) | **Undocumented in both examples** |
| — | `DEFAULT_LOCALE`, `DEFAULT_SCHOOL_CODE` | **Undocumented** |
| — | `MTN_MERCHANT_ID`, `MTN_MERCHANT_KEY` (public-site example) | Contradicts portal example |
| — | `NEXT_PUBLIC_SCHOOL_NAME/PHONE/EMAIL` (public-site example) | Not read by any `process.env` access found |

`TENANT_ID` and `SCHOOL_ID` are exported as `export const TENANT_ID = process.env.TENANT_ID` (`apps/portal/lib/auth.ts:115-116`) with no fallback, and `lib/tenant.ts:25` reads `process.env.TENANT_ID` for tenant resolution. A developer following `apps/portal/.env.example` exactly — which omits both — gets an app with no tenant.

**FINDING E-6 — `NEXT_PUBLIC_*` variables defeat Turbo's env isolation. Medium.** The `NEXT_PUBLIC_` prefix means these are inlined into the client bundle at build time and therefore must participate in the build hash. They appear in neither `globalEnv` (`turbo.json:61`) nor `globalPassThroughEnv`. A build cache hit can serve a client bundle inlined with the previous environment's values.

### 7.4 Feature flags

**FINDING E-7 — No feature-flag system exists. Low.** No flag library, no flags table, no `flags` config. Feature gating is done ad hoc via environment variables and Next.js experimental flags (`apps/portal/next.config.ts:60-62`). Acceptable at this stage, but it means every flag is a redeploy.

### 7.5 Bun configuration

**FINDING E-8 — `[run] test = { timeout = 30000 }` is misplaced. Low.** `.bunfig.toml:4-5`. Test timeouts belong under a `[test]` section, not `[run]`; this setting is ignored. Separately, `.bunfig.toml:2` sets `centralStore = true`, which is already Bun's default, and `.bunfig.toml:7-11` lists three packages that are not dependencies of anything in the repo (D-3).

---

## 8. Additional Findings

### 8.1 Version control

**FINDING R-1 — Zero commits. CRITICAL.**

```
$ git rev-list --count HEAD
fatal: your current branch 'main' does not have any commits yet

$ git status --short
?? .bunfig.toml
?? .github/
?? .gitignore
?? IDEA.md
?? apps/
?? audit-reports/
?? biome.json
?? bun.lock
?? docs/
?? eslint.config.mjs
?? null
?? package.json
?? packages/
?? tools/
?? tsconfig.base.json
?? turbo.json
```

Every file is untracked. Notable: `.gitignore` and `.github/` are among them. There is no `develop` branch despite `ci.yml:5,7` targeting one. `git ls-files` returns nothing for `.env`, `.husky`, or `.github` — the ignore rules are holding, but nothing is under version control.

A stray file named `null` sits at the repository root (from a shell redirect mistake) and is not covered by any ignore rule.

**Impact:** no CI has ever run, no change has been reviewed, no rollback is possible, and `.gitignore` is not yet protected by a commit. This finding gates the value of every other CI recommendation in this report.

### 8.2 Repository hygiene

**FINDING R-2 — `packages/shared-ui/src/src/index.css` is a stray nested duplicate. Low.** The build script reads `../src/index.css` (`scripts/build-css.js:6`); the nested `src/src/index.css` is unreferenced. `src/index.css` is likewise not tracked by any tsconfig `include`.

**FINDING R-3 — ESLint ignores `.github/**` (`.github/workflows/ci.yml` unlinted). Low.** `eslint.config.mjs:49`. Combined with L-8, the CI workflow — the most security-sensitive file in the repository — has no automated validation whatsoever.

**FINDING R-4 — `allowedDevOrigins` hardcodes LAN IPs in both apps. Low.** `apps/portal/next.config.ts:51-56` and `apps/public-site/next.config.ts:3-8` list `192.168.8.202`, `192.168.8.226`, `172.25.96.1`, `172.31.16.1`. These are a specific developer's network, committed to a shared config, and will be stale for everyone else.

**FINDING R-5 — Security headers are incomplete and one is obsolete. Medium.** `apps/portal/next.config.ts:86-95` sets four headers. `X-XSS-Protection: 1; mode=block` (`next.config.ts:92`) is deprecated — modern guidance is to omit it, as it has been superseded by CSP and in some configurations introduces vulnerabilities. **Missing:** `Content-Security-Policy` (the single highest-value header for this app — it handles user-generated rich text via `@tiptap/react`, `apps/portal/package.json:31`), `Strict-Transport-Security`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy`.

**FINDING R-6 — No governance files. Low.** Absent: `.editorconfig`, `CODEOWNERS`, `CONTRIBUTING.md`, `dependabot.yml`, `renovate.json`, `.npmrc`. There is no documented command reference for contributors and no review-ownership policy for a monorepo where a change to `packages/shared-types` affects both apps.

---

## 9. Security Configuration Issues

Consolidated, ordered by severity.

| # | Issue | Location | Severity |
|---|---|---|---|
| S-1 | Live credentials in untracked `.env`/`.env.local`; `.gitignore` uncommitted, so the guardrail is not yet durable | `.gitignore:14-20`, §8.1 | **Critical** |
| S-2 | No dependency vulnerability scanning of any kind — no `bun audit`, no Dependabot, no CodeQL, no SBOM, no license check | repo-wide | **High** |
| S-3 | Neon→Supabase mirror has no working entry point and no trigger, while holding production DB credentials | `ci.yml:111-132`, `package.json:26` | **Critical** |
| S-4 | No `permissions:` block — all 5 jobs run with default token scope, including two that execute install scripts against native modules | `ci.yml:1-132` | **High** |
| S-5 | No `Content-Security-Policy` on an app that renders user-generated rich text; no HSTS, no `Permissions-Policy` | `apps/portal/next.config.ts:86-95` | **High** |
| S-6 | Obsolete `X-XSS-Protection: 1; mode=block` header | `apps/portal/next.config.ts:92` | **Medium** |
| S-7 | Env validation is a `console.warn`, and is explicitly skipped when `NODE_ENV === 'production'` | `apps/portal/next.config.ts:37-42` | **High** |
| S-8 | `public-site` static export silently ships fallback content on DB failure — build succeeds, prod serves fabricated data | `apps/public-site/lib/data.ts:11-19` | **High** |
| S-9 | Actions pinned to mutable tags (`@v4`, `@v1`) rather than commit SHAs | `ci.yml:19,24,42,45,…` | **Medium** |
| S-10 | Native module `argon2` handles password verification and is absent from `trustedDependencies`; stale entries point at packages not in the tree | `.bunfig.toml:7-11` | **Medium** |
| S-11 | `packages/auth` pins `bcryptjs@^2.4.3` while the app uses `^3.0.3`, with `@types/bcryptjs@^3` describing the v2 API | `packages/auth/package.json:12` | **High** |
| S-12 | `NEXTAUTH_SECRET` is read at module scope in two places with no validation | `apps/portal/lib/auth.ts:44`, `app/api/session/route.ts:7` | **Medium** |
| S-13 | `tools/db-mirror/mirror.ts` — the code path with production DB credentials — has no `lint` or `typecheck` script but appears as a passing task in the Turbo graph | `tools/db-mirror/package.json` | **Medium** |
| S-14 | Prisma migrations gitignored, absent, and never deployed — schema state is unreproducible | `.gitignore:36` | **Critical** |
| S-15 | No `SECURITY.md`, no vulnerability disclosure policy | repo-wide | **Low** |

---

## 10. CI/CD Pipeline Gaps — Consolidated

### Blocking (pipeline cannot succeed)

| Gap | Location | Verified by |
|---|---|---|
| `bun run test --run` → Turbo rejects `--run` | `ci.yml:53` | `ERROR unexpected argument '--run' found`, exit 1 |
| `turbo run db:mirror --filter=db-mirror` → package not in workspace | `package.json:26` | `x No package found with name 'db-mirror' in workspace`, exit 1 |
| `turbo run build --filter=super-admin` → package not in workspace | `package.json:15` | `x No package found with name 'super-admin' in workspace`, exit 1 |
| `test:e2e` has no Playwright config and no test files | `apps/portal/package.json:13` | No `playwright.config.*` in repo |
| `bun test` finds no tests, exits 1 | all `test` scripts | `No tests found!`, exit 1 |
| `packages/database` `db:mirror` → `mirror.ts` does not exist | `packages/database/package.json` | File absent from directory |
| `db-mirror` job has no `schedule:` or `workflow_dispatch:` trigger | `ci.yml:3-7, 114` | `on:` declares only push/PR |
| `changeset` / `version` / `release` → CLI not installed | `package.json:29-31` | `Test-Path node_modules/@changesets` → `False` |
| `shared-ui` `storybook` / `storybook:build` → no `.storybook/` | `packages/shared-ui/package.json` | Directory absent |

### Quality coverage gaps (pipeline runs but proves little)

| Gap | Location |
|---|---|
| Biome configured, not installed, never invoked | `biome.json`; `Test-Path node_modules/@biomejs` → `False` |
| No pre-commit / pre-push hooks | `.husky/` contains only `_/` |
| `lint-staged` installed, unconfigured, unhookable | `package.json:58` |
| Zero tests in the monorepo | repo-wide |
| Zero coverage thresholds, no coverage tool | repo-wide |
| `noUnusedVariables` etc. never fail — no `--max-warnings` | all 13 `lint` scripts |
| 6 directories outside the workspace: unlinted, untypechecked | `apps/super-admin`, `packages/plugin-registry`, `packages/testing`, `packages/plugins/*`, `tools/{migrate,sync-cli,tenant-cli}` |
| `tsconfig.base.json` unused by all 12 workspaces | repo-wide |
| `sync-engine` excluded from `turbo run typecheck` | no `typecheck` script |
| `db-mirror` appears in the Turbo graph but runs nothing | no `lint`/`typecheck` script |
| Warnings do not block: 2 open warnings in portal, exit 0 | `apps/portal/.turbo/turbo-lint.log` |

### Performance gaps

| Gap | Location |
|---|---|
| Turbo remote cache non-functional (`TURBO_TOKEN` set, never linked) | `ci.yml:9-11`; no `.turbo/config.json` |
| No local cache persistence between CI jobs | no `actions/cache` |
| No dependency install cache (5× full `bun install`) | all 5 jobs |
| No `concurrency` → redundant full builds on rapid pushes | `ci.yml:1-132` |
| E2E and build jobs each rebuild everything, independently | `ci.yml:61-109` |
| No project references → every package re-typechecks its dependencies (public-site: 54s of 93s is TypeScript) | `apps/public-site/.turbo/turbo-build.log` |

### Security gaps

See §9.

---

## 11. Recommendations

### P0 — Before the first commit

| # | Action | Fixes |
|---|---|---|
| R-1 | `git add .gitignore` and commit it **first**, alone, then add a secret scan (`gitleaks` or `trufflehog`) as a pre-commit hook and a CI job before staging anything else. Delete the stray root `null` file. | R-1, S-1 |
| R-2 | Commit the repository, then create `develop` to match `ci.yml:5,7`. | R-1 |
| R-3 | Stop `prisma/migrations/` being ignored. Commit the migration history and add `db:migrate:deploy` to the deploy path. | S-14, B-8 |
| R-4 | Add `.husky/pre-commit` running `bun run typecheck` + `bun run lint`, with `lint-staged` wired in. Replace `husky install` with `husky`. | L-9, L-10, L-11 |

### P1 — Fix the broken pipeline

| # | Action | Fixes |
|---|---|---|
| R-5 | `ci.yml:53` → `bun run test`. Delete `--run`. | CI-1, X-1 |
| R-6 | `package.json:26` → `--filter=@novastar/db-mirror`, and create the missing `packages/database/mirror.ts` or delete that script. | B-2 |
| R-7 | `package.json:15` → delete `build:super-admin`, or scaffold `apps/super-admin/package.json`. | B-3 |
| R-8 | Add `schedule: [{ cron: '0 3 * * *' }]` and `workflow_dispatch:` to `ci.yml:3-7`, then re-verify the mirror job end-to-end against a staging database. | CI-2 |
| R-9 | Either add a `playwright.config.ts` with a `webServer` block and a first smoke test, or delete the `test:e2e` scripts, the `test-e2e` job, and the Playwright devDependencies. Do not leave it configured-but-absent. | X-3 |
| R-10 | Delete `test:ui` from both apps and `turbo.json:32-35`. Bun has no `--ui` flag. | X-2, X-4 |
| R-11 | Remove the `changeset`/`version`/`release`/`release-it` scripts and devDependencies, or install `@changesets/cli` and run `changeset init`. | D-10 |

### P2 — Make quality gates real

| # | Action | Fixes |
|---|---|---|
| R-12 | Delete `biome.json` **or** adopt it fully: add `@biomejs/biome` to root devDependencies, replace every `lint` script with `biome check`, and remove ESLint + Prettier. Half-adopting two formatters (D-1) is worse than either alone. | L-1, L-2 |
| R-13 | Consolidate on one TypeScript version in the root; remove the `5.7.3` pins from both apps and the `@typescript/native` aliases. | D-1 |
| R-14 | Add `--max-warnings 0` to every `lint` script, or promote the currently-warned rules to `error` once the migration is complete. | L-7 |
| R-15 | Scope the Next.js ESLint configs with `files: ['apps/**/*.{ts,tsx}']` so the ten package lint jobs stop emitting React/pages warnings. | L-5 |
| R-16 | Remove `tests/**` and the 14 named scripts from `globalIgnores`; delete the scripts instead. | L-6 |
| R-17 | Move `argon2` and `bcryptjs` out of the root `dependencies` and into `apps/portal`. Reconcile `bcryptjs` to a single major. | D-2, D-4, S-11 |
| R-18 | Add `package.json` to the six orphan directories, or delete them. Delete the `plugin-registry` alias from `tsconfig.base.json:29` meanwhile. | D-11, T-1 |
| R-19 | Add `lint` + `typecheck` scripts to `tools/db-mirror` and `packages/sync-engine`. | B-1, S-13 |
| R-20 | Delete the root `dependencies` block; move genuinely-used packages to their consumers. | D-7 |

### P3 — Build performance and correctness

| # | Action | Fixes |
|---|---|---|
| R-21 | Fix `shared-ui`: set `noEmit: false` with `outDir: dist` and `declaration: true` in its build tsconfig, or add `"exports"` with a `transpilePackages` entry for source. Verify `dist/index.js` and `dist/index.mjs` exist after a clean build. Add a CI assertion that `dist/index.js` exists. | **B-7** |
| R-22 | Add `turbo login`/`turbo link` (or `TURBO_REMOTE_ONLY` with a documented team slug) and add `actions/cache` for `.turbo/cache` so remote caching is actually used. | B-4 |
| R-23 | Declare every consumed variable in `globalEnv`, including all `NEXT_PUBLIC_*`, and add `globalPassThroughEnv` for the rest. | B-5, E-6 |
| R-24 | Set `test` to `cache: false` until a coverage tool and thresholds exist. | B-6 |
| R-25 | Change every package `include` from `["*.ts"]` to `["**/*.ts"]`; or better, have each workspace `extends: "../../tsconfig.base.json"` and delete the duplicated options. | T-1, T-3 |
| R-26 | Introduce TypeScript project references with `composite: true` for the 10 packages, or accept the duplicated `tsc` cost and document it. | T-4 |
| R-27 | Delete `turbo run typecheck` from `sync-engine` and instead use `tsc --noEmit`; stop declaring a `build` task that emits nothing. | B-1, B-8 |
| R-28 | Remove `experimental.webpackBuildWorker` from `apps/portal/next.config.ts`; migrate the `experimental` block to top-level flags to match `public-site`. | §1.5 |
| R-29 | Add `"type": "module"` to `apps/portal/package.json`. | §1.5 |

### P4 — CI hardening and security

| # | Action | Fixes |
|---|---|---|
| R-30 | Add `permissions: { contents: read }` at workflow level. | S-4 |
| R-31 | Add `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`. | CI-4 |
| R-32 | Pin all actions to full commit SHAs. | S-9 |
| R-33 | Enable caching on `oven-sh/setup-bun`; add `actions/cache` for `.turbo/cache` and the Bun install cache. | CI-6, B-4 |
| R-34 | Add `timeout-minutes` to all jobs; add `needs: [lint-and-typecheck, test]` to `build` (present) and make `test-e2e` gate the merge once working. | CI-7, CI-9 |
| R-35 | Use `bun-version-file: package.json` so CI honours `packageManager: bun@1.4.0`. | CI-11 |
| R-36 | Add a `security` job: `bun audit --audit-level=high`, `gitleaks detect`, and Dependabot with `npm.audit` + version updates enabled. | S-2, D-6, D-9 |
| R-37 | Replace the environment `console.warn` with a root `env.ts` using zod that **throws** on missing required keys, imported by both apps. Remove the `NODE_ENV !== 'production'` exemption. | S-7, E-3 |
| R-38 | Make `apps/public-site`'s data fetchers **fail the build** when `NODE_ENV === 'production'` and the database is unreachable, instead of returning fallbacks. | S-8 |
| R-39 | Add `Content-Security-Policy`, `Strict-Transport-Security`, and `Permissions-Policy`; remove `X-XSS-Protection`. | S-5, S-6 |
| R-40 | Create a root `.env.example` covering the union of all 19 consumed variables, and correct the per-app examples (`MTN_MERCHANT_ID`, `SUPABASE_PUBLISHABLE_KEY`, add `TENANT_ID`/`SCHOOL_ID`/`DIRECT_URL`). | E-5 |
| R-41 | Add `SECURITY.md` with a disclosure policy. | S-15 |

### P5 — Deployment and governance

| # | Action | Fixes |
|---|---|---|
| R-42 | Decide the deployment target and write the config: a `Dockerfile` for the portal's `output: 'standalone'` mode, or `vercel.json` for both apps, or a `Procfile`. Add a `deploy.yml` workflow with environment protection on `main`. | CI-10 |
| R-43 | Add `.editorconfig`, `CODEOWNERS`, and a `CONTRIBUTING.md` documenting the build/lint/test commands and the workspace layout. | R-6 |
| R-44 | Un-ignore `.github/**` in ESLint or add `actionlint` to CI so the workflow is validated. | R-3 |
| R-45 | Adopt Renovate or Dependabot to own the version pins. | D-6, D-9 |
| R-46 | Establish a real test baseline before adding gates: unit tests for `@novastar/shared-utils`, `ghana-education`, and `payments` (pure functions, no infrastructure needed), then a Playwright smoke test for the portal login flow. | X-1, X-3 |
| R-47 | Add `coverage` thresholds only after R-46 — a threshold above 0% on an empty suite is theatre. | X-1, B-6 |

---

## Appendix A — Verification Commands

Every claim marked "verified" was reproduced. Reproduce with:

```bash
# R-1  Zero commits
git rev-list --count HEAD            # fatal: your current branch 'main' does not have any commits yet
git status --short                   # every file ?? untracked

# B-2 / B-3  Broken turbo filters
bunx turbo run db:mirror --filter=db-mirror --dry=json   # x No package found with name 'db-mirror'
bunx turbo run build --filter=super-admin --dry=json    # x No package found with name 'super-admin'

# CI-1  CI test command is invalid
bunx turbo run test --run --dry=json                    # ERROR unexpected argument '--run' found

# X-1  No tests
bun test                               # error: 0 test files matching ...
# or: turbo run test                   # per apps/public-site/.turbo/turbo-test.log

# X-2  test:ui is not a bun flag
bun test --ui                          # same "0 test files" error

# L-1  Biome is not installed
test -d node_modules/@biomejs          # False

# B-7  shared-ui dist contains only CSS
ls packages/shared-ui/dist             # index.css only — no index.js, no index.mjs

# L-9  No git hooks
ls -A .husky                           # only: _

# D-10  Changesets not installed
test -d node_modules/@changesets       # False

# B-1 / S-13  Turbo graph lists tasks that have no script
bunx turbo run typecheck --dry=json    # includes @novastar/db-mirror#typecheck
```

## Appendix B — Turbo Task Coverage Matrix

`✓` = script exists · `—` = no script (Turbo lists the task; it is a silent no-op) · `✗` = script exists but is non-functional

| Workspace | lint | typecheck | build | test | test:e2e |
|---|:--:|:--:|:--:|:--:|:--:|
| `apps/portal` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `apps/public-site` | ✓ | ✓ | ✓ | ✗ | — |
| `@novastar/shared-types` | ✓ | ✓ | — | — | — |
| `@novastar/shared-utils` | ✓ | ✓ | — | — | — |
| `@novastar/shared-ui` | ✓ | ✓ | ✗ | — | — |
| `@novastar/database` | ✓ | ✓ | — | — | — |
| `@novastar/auth` | ✓ | ✓ | — | — | — |
| `@novastar/sync-engine` | ✓ | — | ✗ | ✗ | — |
| `@novastar/notifications` | ✓ | ✓ | — | — | — |
| `@novastar/payments` | ✓ | ✓ | — | — | — |
| `@novastar/reports` | ✓ | ✓ | — | — | — |
| `@novastar/ghana-education` | ✓ | ✓ | — | — | — |
| `@novastar/db-mirror` | — | — | — | — | — |
| `tools/seed`, `tools/migrate`, `tools/sync-cli`, `tools/tenant-cli` | n/a | n/a | n/a | n/a | n/a |
| `apps/super-admin`, `packages/plugin-registry`, `packages/testing`, `packages/plugins/*` | n/a | n/a | n/a | n/a | n/a |

Rows marked `n/a` are **not workspace members** (no `package.json`), so no Turbo task is created for them at all. They are invisible to every gate in this repository.

**Aggregate: 0 of 15 locations have a working test. 6 locations are not workspace members at all. 1 of 13 workspace packages has no `lint` or `typecheck` script despite appearing in both Turbo graphs.**
