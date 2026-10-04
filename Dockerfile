# syntax=docker/dockerfile:1.7

# ============================================================================
# Novastar Montessori - portal image
#
# Layout facts this file depends on (verified, do not change blindly):
#   - apps/portal/next.config.ts sets `output: 'standalone'` and
#     `outputFileTracingRoot: <repo root>`. Tracing from the repo root is what
#     makes the standalone bundle keep the monorepo shape, so the entrypoint is
#     `apps/portal/server.js` and NOT `./server.js`.
#   - Workspace packages are consumed as source (`main: index.ts`), so the
#     standalone tracer copies them in. They are NOT built to dist/.
#   - `--frozen-lockfile` does not reliably run @prisma/client's postinstall
#     under bun's isolated node_modules layout, so `db:generate` is an explicit
#     step. packages/database/index.ts imports PrismaClient and the models, so
#     without it both typecheck and `next build` fail with TS2305.
#
# Caching strategy (the reason the manifest COPYs are enumerated by hand):
#   `deps` copies ONLY package.json / lockfile / config, never source. Editing a
#   .tsx file therefore cannot invalidate the install layer. Adding a workspace
#   means adding one COPY line below -- `bun install --frozen-lockfile` will
#   otherwise not see the new manifest and will not update the lockfile.
#
# This image is the PORTAL and nothing else. apps/super-admin is deliberately
# NOT in it, and that is an architectural boundary rather than an oversight:
#
#   super-admin is a second Next.js standalone server. apps/super-admin/
#   next.config.ts sets output: 'standalone' and traces from the repo root,
#   exactly like the portal, so it is a long-running process with its own port,
#   CMD and healthcheck -- not files that can be copied in. This image has one
#   CMD and one HEALTHCHECK, and the HEALTHCHECK probes :3000 only, so folding
#   super-admin in means a shell-wrapped multi-process CMD (no health signal for
#   the second server, no orderly shutdown of either child) or a process
#   supervisor that node:alpine does not ship.
#
#   The repo already has the pattern for this: Dockerfile.public-site is a
#   separate file producing a separate image, and docker-compose.yml gives it a
#   separate service. super-admin needs the same treatment -- its own
#   Dockerfile.super-admin, image, port and service entry.
#
#   It also could not be built here as written. The manifest list below is
#   missing five workspace members, two of which super-admin requires:
#   apps/super-admin itself, and tools/tenant-cli (how it reaches
#   @novastar/tenant-cli). See
#   docs/technical/2026-10-02_193000-ci-cd-teamcity-docker-vercel.md, open item 1.
# ============================================================================

ARG NODE_VERSION=22
ARG BUN_VERSION=1.4.0

# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base

ENV NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    CI=true

WORKDIR /app

# ----------------------------------------------------------------------------
# deps: install toolchain + workspace dependencies from manifests only
# ----------------------------------------------------------------------------
FROM base AS deps

# Must be redeclared inside the stage. An ARG declared before the first FROM is
# only an instruction default for FROM lines; referencing it in a stage without
# re-declaring it expands to an empty string, which would turn this into
# `npm install --global bun@`.
ARG BUN_VERSION

# node-gyp toolchain for the one dependency without a musl prebuild (argon2).
RUN apk add --no-cache libc6-compat python3 make g++ \
    && npm install --global bun@${BUN_VERSION}

COPY package.json bun.lock turbo.json tsconfig.base.json biome.json ./

# --- workspace manifests (keep in sync with package.json "workspaces") ---
COPY apps/portal/package.json         ./apps/portal/
COPY apps/public-site/package.json    ./apps/public-site/
COPY packages/auth/package.json       ./packages/auth/
COPY packages/database/package.json   ./packages/database/
COPY packages/domain/package.json     ./packages/domain/
COPY packages/ghana-education/package.json ./packages/ghana-education/
COPY packages/notifications/package.json ./packages/notifications/
COPY packages/payments/package.json   ./packages/payments/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-ui/package.json  ./packages/shared-ui/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/sync-engine/package.json ./packages/sync-engine/
COPY packages/testing/package.json    ./packages/testing/
COPY apps/super-admin/package.json    ./apps/super-admin/
COPY tools/db-mirror/package.json     ./tools/db-mirror/
COPY tools/migrate/package.json       ./tools/migrate/
COPY tools/seed/package.json          ./tools/seed/
COPY tools/sync-cli/package.json      ./tools/sync-cli/
COPY tools/tenant-cli/package.json    ./tools/tenant-cli/
# --- end workspace manifests ---

RUN bun install --frozen-lockfile

# ----------------------------------------------------------------------------
# builder: source, prisma client, next build
# ----------------------------------------------------------------------------
FROM deps AS builder

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so a
# missing value here cannot be fixed at runtime -- it ships as undefined. Pass
# them as --build-arg.
ARG NEXT_PUBLIC_ORIGIN
ARG NEXT_PUBLIC_DOMAIN

# packages/database/index.ts falls back to a mock client when DATABASE_URL is
# absent (it checks NEXT_PHASE, which `next build` always sets), so the build
# does NOT need a reachable database. Supply a real one only if a prerender
# actually needs live rows.
ARG DATABASE_URL
ARG NEXTAUTH_SECRET
ARG NEXTAUTH_URL

ENV NEXT_PUBLIC_ORIGIN=$NEXT_PUBLIC_ORIGIN \
    NEXT_PUBLIC_DOMAIN=$NEXT_PUBLIC_DOMAIN \
    DATABASE_URL=$DATABASE_URL \
    NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
    NEXTAUTH_URL=$NEXTAUTH_URL

COPY . .

RUN bun run --cwd packages/database db:generate

RUN bun run build:portal

# ----------------------------------------------------------------------------
# runner: standalone output only
# ----------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --gid 1001 --system nodejs \
    && adduser --uid 1001 --system nextjs

WORKDIR /app

# standalone bundle: server + traced deps + the source of each workspace package
COPY --from=builder --chown=nextjs:nodejs /app/apps/portal/.next/standalone ./
# Next does NOT include either of these in standalone; both must be copied or
# every hashed asset 404s.
COPY --from=builder --chown=nextjs:nodejs /app/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/portal/public ./apps/portal/public

USER nextjs

EXPOSE 3000

# Standalone has no curl; node 22 has global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/portal/server.js"]