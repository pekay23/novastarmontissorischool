# CI/CD: GitHub Actions, TeamCity, Docker and Vercel

Status: wired up, one blocker outstanding (Docker build unverified). Last touched
2026-10-02. Re-verified against the source 2026-10-03 - see the pass below, which
adds a second blocker (the Dockerfiles' manifest lists are stale).

## Verification pass - 2026-10-03

**Status (verified 2026-10-03): BUILT, with one live drift defect found.** Every
artefact this document describes exists: `.github/workflows/ci.yml`,
`.github/workflows/db-mirror.yml`, `.teamcity/settings.kts`, `Dockerfile`,
`Dockerfile.public-site`, `docker-compose.yml`, and `scripts/ci/{install,verify,e2e,docker,deploy-vercel,shared}.ts`.
Every artifact-level verdict is from reading those files. **Corrected 2026-10-03:** the
repo-wide commands were subsequently run - `bunx turbo run build` 4/4 tasks successful,
typecheck 18/18, lint 18/18 with 0 errors, `bun run test` 7/7 tasks with **1396 pass /
0 fail** - so the Outstanding row below is now partly measured. Nothing Docker-,
database- or deployment-shaped was run at all.

### Verdicts

| Claim in this document | Status (verified 2026-10-03) |
|---|---|
| "What runs where" table, all seven rows | **BUILT** - job and build-type names match one for one |
| GitHub Actions `ci.yml` owns lint / typecheck / unit tests | **BUILT** - `lint-and-typecheck`, `test` |
| GitHub Actions `ci.yml` owns E2E (chromium, firefox, webkit) | **BUILT** - `test-e2e`, `bunx playwright install --with-deps chromium firefox webkit` at `:178` |
| `ci:docker` builds both images | **BUILT** - `docker` job at `ci.yml:202`, gated on `vars.DOCKER_BUILD_ENABLED == 'true'`, `cache-to: type=gha,mode=max` |
| Production deploy to Vercel from `main` + `VERCEL_DEPLOY_ENABLED=true` | **BUILT** - `deploy` job at `ci.yml:283-289`, `needs: [lint-and-typecheck, test, build, test-e2e]`, `environment: production` |
| TeamCity chain on push to `main`; local build and compose run | **BUILT** - `Install` (`:141`, VCS trigger `:160-164`) -> `Verify` -> `E2ETest` -> `DockerBuild` -> `DeployLocal` |
| TeamCity `Deploy Preview (Vercel)` after E2E passes | **BUILT** - `DeployVercelPreview` (`:319`), snapshot on `E2ETest`, `VERCEL_TARGET=preview` |
| TeamCity `Deploy Production (Vercel)` is manual only | **BUILT** - `DeployVercelProduction` (`:356`) has **no** `triggers` block, plus a `project_admins` approval feature (`:391-396`) |
| `DeployVercelProduction` has no VCS trigger | **BUILT** - confirmed; the comment at `:361-367` explains that `runAlways = true` would be wrong |
| All six `bun run ci:*` entrypoints exist and do what the table says | **BUILT** - read individually; `ci:install` runs `--frozen-lockfile` then `db:generate`; `ci:verify` runs `lint`, `typecheck`, `test` in that order; `ci:e2e` generates the client, installs browsers, runs `test:e2e`; `ci:docker` uses `docker buildx build` with `--cache-from/--cache-to`; `ci:deploy` runs `vercel pull` / `build` / `deploy --prebuilt` |
| "There is deliberately no `vercel.json`" | **BUILT** - no `vercel.json` anywhere in the repo, as documented |
| Constraint 1: no `postgres` service, Neon over HTTP | **BUILT** - `docker-compose.yml:1-29` explains it at length; only `portal` and `public-site` services exist |
| Constraint 1: no `redis` service, Upstash over REST | **BUILT** - `docker-compose.yml:19-22`; `apps/portal/lib/rate-limit.ts` uses `@upstash/redis` with an in-memory `Map` fallback |
| Constraint 2: `prisma migrate deploy` is never run | **BUILT and still true** - the `Deploy database migrations` step is gated on `if: env.MIGRATE_ON_PUSH == 'true'`, is unset, and passes no `--yes`; `DeployLocal` runs `docker compose up` with no migration step. **Updated in the wiring pass below:** its `--filter` was `@novastar/database`, which has no `db:migrate:deploy` script and resolved zero tasks; it now names `@novastar/migrate`, the guarded wrapper. The gate stayed closed |
| Constraint 3: `--frozen-lockfile` does not generate the Prisma client | **BUILT** - `db:generate` is an explicit step in all four `ci.yml` jobs (`:43`, `:73`, `:102`, `:167`, `:321`), in `scripts/ci/install.ts`, in `scripts/ci/e2e.ts`, and in both Dockerfiles (`Dockerfile:99`, `Dockerfile.public-site:67`) |
| Caching 1: `deps` stage copies only manifests | **BUILT BUT NOW INCOMPLETE** - see open item 1 below |
| Caching 2: `TURBO_TOKEN` enables the remote cache | **BUILT** - `ci.yml:10`, `.teamcity/settings.kts:84-85` |
| Caching 3: `cleanCheckout = false` on every TeamCity build type | **BUILT** - set on all seven (`:150`, `:172`, `:206`, `:256`, `:290`, `:326`, `:370`) |
| Caching 3: GitHub caches `~/.bun/install/cache` | **BUILT** - `ci.yml:233-238` and `:311-316` |
| `.dockerignore` excludes `.docker-cache/` | **BUILT** - and `.gitignore:96` excludes it too, which the document mentions only for git |
| "What you must supply" credential list | **BUILT** - every GitHub secret and variable named in `ci.yml` and every TeamCity parameter in `settings.kts:82-124` |
| "Also fixed along the way": `next/no-html-link-for-pages` disabled outside Next apps | **BUILT** - `eslint.config.mjs:118-129`, scoped to `packages/**`, `tools/**`, `scripts/**` and root `*.ts` |
| **Outstanding**: "Everything else in this document was executed: `ci:install`, `ci:verify` (lint, typecheck, 109 tests passing) and `docker compose config`" | **PARTLY VERIFIED (measured 2026-10-03), and the test count is now wrong.** The lint / typecheck / unit-test half is confirmed: lint 18/18 tasks with 0 errors, typecheck 18/18, tests 7/7 tasks with **1396 pass / 0 fail** - not 109, which predates five workspace members joining the root `test` fan-out. The commands were run directly rather than through `bun run ci:verify`, and `ci:verify` itself was not invoked. **STILL UNVERIFIABLE:** `ci:install`, `docker compose config`, the image builds, and every TeamCity / Vercel deploy path. See below. |

### Open items, ranked by impact

1. **The Dockerfiles' manifest `COPY` lists have drifted out of date, and this is
   the exact failure the document warns about.** `Dockerfile:54-68` and
   `Dockerfile.public-site:39-51` each enumerate 13 workspace manifests, ending
   at `tools/db-mirror/package.json`. Five workspace members that now exist are
   absent from both lists: `apps/super-admin`, `packages/testing`,
   `tools/migrate`, `tools/sync-cli`, `tools/tenant-cli`. The document's own
   words: *"Adding a workspace means adding one `COPY` line to both
   Dockerfiles, or `bun install --frozen-lockfile` will not see it and the
   lockfile will not update."* Five were added without the line. The `deps`
   stage therefore installs a workspace that is smaller than the real one, and
   `apps/super-admin` - whose only route to `@novastar/tenant-cli` and
   `@novastar/notifications` is through that install - is the member most likely
   to break. **This has never been observed failing, because the images have
   never been built.** Fixing it is source work, not documentation work, and is
   out of scope for this pass.
2. **The Docker images still have not been built.** "Outstanding" is accurate.
   `bun run ci:docker` and `docker compose up -d --wait` remain the two commands
   that would close it. Until then item 1 above is a prediction, not an
   observation.
3. **`MIGRATE_ON_PUSH` is still undeclared to Turborepo.** `turbo.json`
   `globalEnv` (`:76-110`) does not list it, so the flag that decides whether
   production is migrated cannot change any task's cache hash.
   `tools/migrate/README.md:105` records the omission as deliberate, which puts
   this document's constraint 2 and the migrate tool's README in quiet
   disagreement.
4. **`.dockerignore` is correct but the document's caching contract is now
   half-documented.** It says `.docker-cache/` must stay excluded from
   `.dockerignore`; `.gitignore:96` excludes it too, and `docker-compose.yml:36-39`
   declares `cache_to` -> `.docker-cache/portal-new` unconditionally while
   `scripts/ci/docker.ts` documents its own `--cache-to type=local` as **off by
   default** unless `DOCKER_CACHE_MODE` is set. So compose reads a cache that
   `ci:docker` does not write by default. Not wrong, but the three documents
   describing the cache do not agree on who populates it.

### Not claimed

**The "109 tests passing" figure in **Outstanding** is now superseded by measurement
(2026-10-03): `bun run test` gives 7/7 successful tasks and **1396 pass / 0 fail** -
portal 976 across 33 files, super-admin 150 across 7, tenant-cli 94 across 5,
sync-cli 90 across 5, migrate 56 across 3, sync-engine 30 across 2. The root `test`
script (`package.json:22`) fans out to those seven workspace filters, five of which
did not exist when 109 was counted. Lint is 18/18 with 0 errors and one pre-existing
warning (`packages/shared-types/permission-keys.test.ts:10`), typecheck is 18/18, and
`bunx turbo run build` is 4/4.

**STILL UNVERIFIABLE, unchanged:** `bun run ci:verify` was not invoked as a script,
`bun run ci:install` was not run, no Playwright / E2E spec was executed,
`db:seed` and every Prisma migration and live-database command were skipped, the
Docker images have still never been built, and no TeamCity or Vercel deployment -
preview or production - has been exercised. To settle both this and the item-2
blocker:

```bash
bun run ci:verify     # lint + typecheck + unit tests
bun run ci:docker
docker compose up -d --wait
docker compose config
```

**Blocker on item 1 specifically:** the image build is the only way to observe
whether the missing `COPY` lines actually fail. If a build is not going to happen,
the cheaper check is to compare each Dockerfile's manifest list against
`package.json` `workspaces` by hand.

### Wiring pass - 2026-10-03 (later)

**Two wiring gaps closed. Nothing was built, deployed or migrated, no database
was contacted, and no image exists yet.** This pass added no feature and changed
no auth behaviour.

**1. `turbo.json` had no task for `tools/migrate`'s `baseline`.** `@novastar/migrate`
is a full workspace member (56 tests) and `tools/migrate/package.json` declares a
`baseline` script, but no turbo task matched it, so `turbo run baseline` failed
outright: `x Could not find task 'baseline' in project`. `turbo.json` now declares
`"baseline": { "cache": false }`, matching the other `db:migrate:*` tasks and the
README's stated reason for `cache: false` — the result is a statement about a
database, so it is stale the moment it is written.

Verified by resolution, deliberately not by execution:
`bunx turbo run baseline --dry=json` reports 19 tasks of which exactly one is
executable — `@novastar/migrate#baseline => bun index.ts baseline` — the identical
shape `db:migrate:deploy` already has. **The command was not run**: it resolves a
real target URL and would open a connection to live Neon.

The task is named `baseline`, not `db:migrate:baseline`, because that is the only
script name `tools/migrate/package.json` uses for this command. A
`db:migrate:baseline` task would resolve to zero executable tasks in every package
and pass silently, which is the exact failure mode this pass exists to remove.

**2. The `ci.yml` migration step was doubly dead, and its filter pointed at the
wrong workspace.** It was gated on `env.MIGRATE_ON_PUSH == 'true'`, which is never
set — but even with the gate open it named `--filter=@novastar/database`, and
`packages/database/package.json` has no `db:migrate:deploy` script, so turbo would
have resolved zero tasks. It now names `@novastar/migrate`, the package that owns
the script and the one the root `db:migrate:deploy` resolves to. **The gate itself
is unchanged and still closed**, and the step still does not pass `--yes`, so with
no TTY the guarded tool treats the confirmation as a refusal and exits 1. Turning
this step on therefore cannot quietly begin applying migrations to production;
`--yes --allow-production` is an owner decision taken at the same time as
baselining. The build plan's "the urgent one" and the README's "deliberately
absent" are reconciled as: the *turbo task* was missing and is now declared, while
the *CI step* stays deliberately gated — see the rewritten comment at `ci.yml:109-141`.

**3. `apps/super-admin` had no deploy path and now has one on Vercel.** It is a
54-file Next.js app with its own auth, it passes `bun run build`, and it was
reachable nowhere. `scripts/ci/deploy-vercel.ts` now carries a third entry, and the
`deploy` job in `ci.yml` gained a matching `Deploy super admin` step plus
`VERCEL_PROJECT_ID_SUPER_ADMIN`. Two deliberate differences from the two existing
apps:

- **The `ci:deploy` entry is opt-in, not required.** `.teamcity/settings.kts` calls
  `bun run ci:deploy` from `DeployVercelPreview` and `DeployVercelProduction`, and
  it declares parameters for `VERCEL_PROJECT_ID_PORTAL` and
  `VERCEL_PROJECT_ID_PUBLIC` only. A hard `requireEnv` for a third variable would
  have aborted both TeamCity build types — including the two apps that do have a
  project — until that file was edited. `settings.kts` was outside this pass's
  scope, so the script skips an unset opt-in app with a log line instead, and
  deploys it the moment the variable exists. **Follow-up:** add
  `param("env.VERCEL_PROJECT_ID_SUPER_ADMIN", "SET_IN_TEAMCITY")` to
  `.teamcity/settings.kts:167-171` to make TeamCity deploy it too.
- **The `ci.yml` step is required**, matching the other two. It is inside a job
  already gated on `vars.VERCEL_DEPLOY_ENABLED == 'true'` and `main`, it runs last
  so a missing project id cannot take the other two down with it, and it fetches
  `DATABASE_URL` / `PLATFORM_SESSION_SECRET` from Vercel project settings via
  `vercel pull` rather than from repository secrets.

**4. `Dockerfile` deliberately still contains no super-admin, and this is a
decision rather than an omission.** `apps/super-admin/next.config.ts` sets
`output: 'standalone'` with the same repo-root tracing as the portal, so it is a
second long-running server, not files that can be copied into the portal image.
Folding it in means a second process, a second port, a changed `CMD` and a
healthcheck that only probes `:3000` — i.e. either a shell-wrapped multi-process
`CMD` with no health signal for the second server and no orderly shutdown, or a
process supervisor that `node:alpine` does not ship. The repo already has the
right pattern for a second app: `Dockerfile.public-site` is a separate file
producing a separate image, with its own service in `docker-compose.yml`. What
super-admin needs, therefore, and does not have:

- a new `Dockerfile.super-admin` mirroring `Dockerfile.public-site` (standalone
  build, `CMD ["node", "apps/super-admin/server.js"]`, its own `EXPOSE` and
  `HEALTHCHECK` — the console's routes are deny-by-default, so its health probe
  must target a route that answers),
- that file's workspace manifest `COPY` list corrected first (open item 1 above),
- a `super-admin` service in `docker-compose.yml` on a free host port (the app
  already expects `:3200` per `apps/super-admin/package.json`),
- a `Build and push super-admin image` step in the `docker` job alongside the two
  existing ones, and `scripts/ci/docker.ts` taught the third image.

None of those files were in scope for this pass, so none were touched. The
reasoning is recorded in the `Dockerfile` header so the next reader does not have
to re-derive it.

### Not claimed by this pass

No Vercel deploy, TeamCity compile, Docker build or `docker compose config` was
run. `PLATFORM_SESSION_SECRET` is not a new requirement — `.env.example` and
`settings.kts` already document it and `turbo.json` already lists it in
`globalEnv`; the only genuinely new variable is `VERCEL_PROJECT_ID_SUPER_ADMIN`,
now commented in `.env.example`. `scripts/setup-local.ts:130-131` still prints only
the two Vercel project ids and was outside scope.

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
| `bun run ci:deploy` | `vercel pull` / `build` / `deploy --prebuilt` for portal and public-site, and for super-admin when `VERCEL_PROJECT_ID_SUPER_ADMIN` is set |

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

   **Status (verified 2026-10-03): the list has drifted and the rule was not
   followed.** `Dockerfile:55-67` and `Dockerfile.public-site:39-51` each list 13
   manifests. Five current workspace members are missing from both:
   `apps/super-admin`, `packages/testing`, `tools/migrate`, `tools/sync-cli`,
   `tools/tenant-cli`. Because the images have never been built, this has never
   surfaced. Bring both lists up to date before the first `ci:docker`.

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
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID_PORTAL` / `VERCEL_PROJECT_ID_PUBLIC` /
`VERCEL_PROJECT_ID_SUPER_ADMIN`. In `scripts/ci/deploy-vercel.ts` the third is
opt-in: unset means that app is skipped with a log line, because TeamCity calls
the same script and does not yet declare the variable.

## What you must supply

Nothing below can be generated locally. Each is a credential that only exists in
a provider's dashboard.

**Vercel** — create three projects from the same repository:

| Project | Root Directory | Notes |
| --- | --- | --- |
| portal | `apps/portal` | Node runtime; `output: 'standalone'` is overridden by Vercel |
| public-site | `apps/public-site` | `output: 'export'`, static |
| super-admin | `apps/super-admin` | Cross-tenant operator console. Node runtime; needs `PLATFORM_SESSION_SECRET` and `DATABASE_URL` in its project settings, or every route denies |

There is deliberately no `vercel.json`. `next.config.ts` already supplies the
CSP and security headers, and Vercel detects the framework and output mode on
its own; a hand-written `vercel.json` with `buildCommand` only overrides the
correct behaviour.

**GitHub** — repo → Settings → Secrets and variables → Actions.

*Secrets:* `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_PORTAL`,
`VERCEL_PROJECT_ID_PUBLIC`, `VERCEL_PROJECT_ID_SUPER_ADMIN`, `TURBO_TOKEN`,
`TURBO_TEAM` (and, only if you want images in GHCR, `DOCKER_USERNAME`,
`DOCKER_PASSWORD`).

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
this was set up, so `ci:docker` and both Dockerfiles are unverified.
**Status (verified 2026-10-03): STILL TRUE**, and now carries a second,
undocumented problem - the `deps` stages in both Dockerfiles are missing five
workspace manifests. See open item 1 in the verification pass above.

Everything else in this document was executed: `ci:install`, `ci:verify` (lint,
typecheck, 109 tests passing) and `docker compose config`.
**Status (verified 2026-10-03): PARTLY VERIFIED, and the test count is wrong.** Lint,
typecheck and the unit tests were run and pass - 18/18, 18/18 and 7/7 tasks with 1396
pass / 0 fail, not 109. `ci:install` and `docker compose config` were not run, and no
deployment was exercised, so the sentence above remains a record of 2026-10-02 with a
corrected test count rather than a current claim. The commands that would re-establish
the rest are `bun run ci:verify` and `docker compose config`.

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

**Confirmed by measurement (2026-10-03):** `bunx turbo run lint` is 18/18 tasks
successful with **0 errors**. The single remaining warning is pre-existing and
unrelated to this fix - an unused `ROLE_GRANT_RULES` at
`packages/shared-types/permission-keys.test.ts:10`.
