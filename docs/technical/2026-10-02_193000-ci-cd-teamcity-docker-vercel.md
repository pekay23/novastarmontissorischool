# CI/CD: GitHub Actions, TeamCity, Docker and Vercel

Status: wired up, one blocker outstanding (Docker build unverified). Last touched
2026-10-02.

## What runs where

| Concern | Owner | Trigger |
| --- | --- | --- |
| Lint, typecheck, unit tests | GitHub Actions (existing `ci.yml`) | push / PR |
| E2E (chromium, firefox, webkit) | GitHub Actions (existing `ci.yml`) | push / PR |
| Container images | `ci:docker`, callable from either system | manual |
| Production deploy to Vercel | GitHub Actions `deploy` job | push to `main` + `VERCEL_DEPLOY_ENABLED=true` |
| Local build and compose run | TeamCity chain | push to `main`, or Run |
| Vercel preview deploy | TeamCity `Deploy Preview (Vercel)` | after E2E passes |
| Vercel production deploy | TeamCity `Deploy Production (Vercel)` | **manual only** |

Two systems deploy to Vercel, so production is auto-deployed by exactly one of
them (GitHub Actions). TeamCity's production config has no VCS trigger and must
be started by hand. Delete `DeployVercelProduction` from
`.teamcity/settings.kts` if you settle on a single deploy path.

## Pipeline commands

Every system runs the same entrypoints, so CI cannot drift from a laptop:

| Command | Does |
| --- | --- |
| `bun run setup` | Checks the toolchain, `.env`, and pipeline commands; generates `NEXTAUTH_SECRET` if missing |
| `bun run ci:install` | `bun install --frozen-lockfile` then `prisma generate` |
| `bun run ci:verify` | lint, then typecheck, then unit tests |
| `bun run ci:e2e` | installs all three Playwright browsers, then `bun run test:e2e` |
| `bun run ci:docker` | builds both images with BuildKit layer caching |
| `bun run ci:deploy` | `vercel pull` / `build` / `deploy --prebuilt` for both apps |

These live in `scripts/ci/` as Bun scripts rather than shell one-liners so the
same command works on a Windows agent's `cmd.exe`, on Git Bash and on Linux.

## Local run

```bash
bun run setup                  # once
docker compose up -d --wait    # portal on :3000, public site on :8080
```

There is no `postgres` service and that is deliberate — see the next section.

## Three constraints that shape the whole setup

### 1. The database is Neon over HTTP, not a local Postgres

`packages/database/index.ts` builds its client with
`new PrismaNeon({ connectionString })` (`@prisma/adapter-neon`). That adapter
speaks Neon's SQL-over-HTTP protocol, not the PostgreSQL wire protocol, so a
`postgres:16` container on `tcp/5432` cannot answer it. `docker-compose.yml`
therefore ships no database and the portal reaches real Neon over HTTPS using
`DATABASE_URL`.

`@prisma/adapter-pg` is already a dependency, so supporting a genuinely local
Postgres is a small adapter switch in `packages/database/index.ts`. That is
runtime database code rather than CI/CD, so it was not done here. It is the one
change needed if you want the stack to run with no external dependency.

There is also no `redis` service: `apps/portal/lib/rate-limit.ts` talks to
Upstash over REST (`UPSTASH_REDIS_REST_URL` / `_TOKEN`) and falls back to an
in-process `Map`. A `tcp://6379` container would be ignored.

### 2. `prisma migrate deploy` is never run

The live database was created with `prisma db push`, so it has no
`_prisma_migrations` table, and the checked-in init migration is 56 bare
`CREATE TABLE` / `CREATE TYPE` statements with no `IF NOT EXISTS`. Deploying it
against a database that already has all of them fails partway through and
records a partially applied migration.

Until the history is baselined (or diffed and reconciled), use `db push`, which
diffs the live schema and emits only what is needed to converge. The GitHub
Actions migration step is gated behind `MIGRATE_ON_PUSH` for the same reason.

### 3. `--frozen-lockfile` does not generate the Prisma client

Under bun's isolated `node_modules` layout, `@prisma/client`'s postinstall hook
does not fire reliably. On a clean machine the client is never generated, and
because `packages/database/index.ts` imports `PrismaClient` plus the models and
enums, every typecheck and build then fails with `TS2305`. Generation is
therefore an explicit step in `ci:install`, `ci:e2e`, and both Dockerfiles.

## Caching

Three independent layers, in the order they save time:

1. **Docker layer cache (biggest win).** Each Dockerfile has a `deps` stage that
   copies only `package.json` manifests before `bun install`. Editing a `.tsx`
   file cannot invalidate the install layer. The previous root Dockerfile did
   `COPY . .` *before* installing, so every source edit reinstalled every
   dependency.

   The manifest `COPY` lines are enumerated by hand because a glob like
   `COPY packages/*/package.json ./packages/` collapses into a single
   destination and loses the directory structure. **Adding a workspace means
   adding one `COPY` line to both Dockerfiles**, or `bun install --frozen-lockfile`
   will not see it and the lockfile will not update.

2. **Turborepo remote cache.** Set `TURBO_TOKEN` and unchanged tasks in unchanged
   packages are restored instead of re-run. This is the single highest-leverage
   setting for build wall-clock time.

3. **Agent / runner work directory.** TeamCity configs use
   `cleanCheckout = false` so `node_modules`, `.turbo` and `.docker-cache`
   survive between builds on the agent. GitHub Actions cannot do this, so it
   caches `~/.bun/install/cache` with `actions/cache` and uses
   `cache-from/cache-to: type=gha` for the images.

`.dockerignore` is part of the caching contract: `.docker-cache/` must stay
excluded, or the cache directory gets copied into the build context, changes the
`COPY . .` hash on every build, and invalidates every layer after it.

## Deploying to Vercel

```
vercel pull      # fetches the project's env vars from Vercel into .vercel/
vercel build     # one build
vercel deploy --prebuilt --prod
```

Application secrets (`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXT_PUBLIC_ORIGIN`, …)
live in **Vercel project settings** and are fetched by `vercel pull`. They do
not pass through CI and never appear in runner logs. GitHub Actions and TeamCity
only need deployment credentials.

Projects are targeted without a committed `.vercel/` directory by setting
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID_PORTAL` / `VERCEL_PROJECT_ID_PUBLIC`.

## What you must supply

Nothing below can be generated locally. Each is a credential that only exists in
a provider's dashboard.

**Vercel** — create two projects from the same repository:

| Project | Root Directory | Notes |
| --- | --- | --- |
| portal | `apps/portal` | Node runtime; `output: 'standalone'` is overridden by Vercel |
| public-site | `apps/public-site` | `output: 'export'`, static |

There is deliberately no `vercel.json`. `next.config.ts` already supplies the
CSP and security headers, and Vercel detects the framework and output mode on
its own; a hand-written `vercel.json` with `buildCommand` only overrides the
correct behaviour.

**GitHub** — repo → Settings → Secrets and variables → Actions.

*Secrets:* `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_PORTAL`,
`VERCEL_PROJECT_ID_PUBLIC`, `TURBO_TOKEN`, `TURBO_TEAM` (and, only if you want
images in GHCR, `DOCKER_USERNAME`, `DOCKER_PASSWORD`).

*Variables (non-secret):* `VERCEL_DEPLOY_ENABLED=true`,
`DOCKER_BUILD_ENABLED=true`.

The two `*_ENABLED` variables exist so that pushing to `main` before these
secrets exist does not turn the trunk pipeline red. Until they are set, the new
jobs are skipped and the existing CI behaves exactly as it did.

**TeamCity** — Administration → Project → Parameters, every secret marked as a
password parameter. Then Versioned Settings → Kotlin, repository
`pekay23/novastarmontissorischool`, branch `main`, settings directory
`.teamcity`. TeamCity compiles `settings.kts` and reports errors with a line
number, so a mistake is reported rather than silently ignored.

## Outstanding

**The Docker images have not been built.** Docker Desktop was not running while
this was set up, so `ci:docker` and both Dockerfiles are unverified. Everything
else in this document was executed: `ci:install`, `ci:verify` (lint, typecheck,
109 tests passing) and `docker compose config`.

To verify once Docker is up:

```bash
bun run ci:docker
docker compose up -d --wait
```

Expect two things to need attention on a first run. The portal build inlines
`NEXT_PUBLIC_ORIGIN` / `NEXT_PUBLIC_DOMAIN`, so both must be set or the client
bundle ships `undefined` — the container cannot fix this at runtime. And
`docker compose up` reaches Neon over HTTPS, so the stack is not offline-capable
until constraint 1 above is addressed.

## Also fixed along the way

`bun run lint` was failing across the whole repo before any of this. The shared
`eslint.config.mjs` spreads `eslint-config-next/core-web-vitals` over everything,
so `next/no-html-link-for-pages` threw `Pages directory cannot be found` in each
package under `packages/`, and each `eslint .` exited 1. The rule only means
anything inside a Next app, so it is now switched off for `packages/`, `tools/`,
`scripts/` and root-level `.ts` files.