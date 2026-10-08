# Merge public-site, portal and super-admin into `apps/web`

Date: 2026-10-08
Status: In progress
Decision owner: project owner (four decisions recorded 2026-10-08 ~00:14 UTC)

## Context

The repo is a Turborepo monorepo with three Next.js apps:

- `apps/public-site` — marketing site, `output: 'export'`, deployed live on the
  root Vercel project (build green as of d56b203)
- `apps/portal` — tenant portal, server app, `basePath: '/portal'`, never deployed
  (the gated CI deploy job is off)
- `apps/super-admin` — cross-tenant operator console, server app,
  `basePath: '/admin'`, never deployed

The owner wants one Vercel project, one config, one domain — the shape of the
Aerojet Academy project (`pekay23/aerojet-academy`: a single Next.js app with
`(public)`/`(portal)`/`(auth)` route groups and role trees, one `proxy.ts`, one
`vercel.json`, `postinstall: prisma generate`). Separate projects and separate
configs for the portals are explicitly rejected.

Telling detail: the root Vercel project already carries portal/console env vars
(`PLATFORM_OPERATOR_PASSWORD`, `SEED_PORTAL_ADMIN_PASSWORD`,
`UPSTASH_REDIS_REST_URL/TOKEN`, `DEFAULT_SCHOOL_CODE`) — it was configured for
a combined app all along.

## Decisions (owner, 2026-10-08)

1. **Merge location**: `apps/web` inside the monorepo (turbo, shared packages
   and CI keep working). Not a repo-root restructure.
2. **URL scheme**: portal under `/portal/*`, super-admin under `/admin/*`,
   public site at the domain root. (Matches the recorded decision that
   super-admin mirrors the portal structure under the same nms domain, and the
   `basePath` comments already written in both apps.)
3. **Auth**: keep the two session systems separate in the one app — the portal's
   next-auth (`NEXTAUTH_SECRET`) and the console's own
   `super_admin_session` cookie (`PLATFORM_SESSION_SECRET`). Unifying them is a
   separate security project.
4. **Deployment surface**: the public site is live only on the `*.vercel.app`
   alias, not the real domain, so work happens on `main` and deploys to the
   existing root Vercel project.

## Target architecture

```
apps/web/
  app/
    (public)/          <- public-site pages (URLs unchanged: /about, /academics, ...)
    portal/
      (portal)/        <- portal sections (/portal/attendance, /portal/fees, ...)
      (auth)/          <- credential-recovery pages (/portal/login, /portal/set-password, ...)
      api/             <- portal API + next-auth endpoints (/portal/api/auth/...)
      layout.tsx       <- portal shell (sidebar) + portal.css import
      not-found.tsx
    admin/
      (dashboard)/     <- console pages (/admin/tenants, /admin/overview, ...)
      (auth)/          <- /admin/login
      api/             <- console API (/admin/api/...)
      layout.tsx       <- operator shell + admin.css import
      page.tsx         <- redirect('/admin/tenants')
      not-found.tsx
    layout.tsx         <- minimal root: html/body, fonts, globals.css, ToastProvider
    robots.ts          <- from public-site (must sit at app root)
    sitemap.ts         <- from public-site (must sit at app root)
    not-found.tsx      <- global, from public-site
  components/  lib/  messages/  public/  scripts/  tests/  e2e/
  proxy.ts             <- portal's request-level proxy, gated to /portal/*
  next.config.ts       <- merged (server app, scoped security headers)
  globals.css          <- public-site's (purple brand, @theme tokens)
  portal.css           <- portal's (emerald HSL tokens, @config)
  admin.css            <- super-admin's (navy HSL tokens, @config)
```

### Why the prefix is mandatory, not cosmetic

`/fees` exists in both public-site (marketing) and portal (fee management).
Portal routes therefore cannot live at the app root; they must be physically
under `app/portal/`. The same holds for `/settings` (portal settings vs any
future public page).

### CSS strategy

The three apps use two different token mechanisms that happen to share utility
names (`bg-primary` etc.) with three different brands (public = purple hex via
`@theme --color-*`; portal = emerald via HSL `@config`; admin = navy via HSL
`@config`). They cannot share one token namespace.

**Chosen approach — per-layout stylesheet imports:** the root layout imports
`globals.css` (public-site tokens); `app/portal/layout.tsx` imports
`portal.css`; `app/admin/layout.tsx` imports `admin.css`. Each CSS file keeps
its own `@theme`/`@config` context. On portal pages both stylesheets ship and
the portal import wins the cascade (later import, same specificity); public
pages ship only `globals.css`. Fallback if the build misbehaves: scoped token
overrides (`.portal-shell { --color-primary: hsl(var(--primary)); ... }`) with
the layouts wrapping their subtrees in the scoping class.

### Prefix sweep inventory (bounded)

Portal (absolute root paths that need `/portal`):
- `app/(portal)/layout.tsx` — `navigation` array (16 items), `router.push('/login')`,
  `Link href="/dashboard"`, `signOut({ callbackUrl: '/login' })` ×3
- `proxy.ts` — `matcher`, `publicPaths` (8), redirects to `/login`,
  `/set-password`, `/dashboard/unauthorized`, `/dashboard`; strip `/portal`
  before `decidePortalPath(role, pathname)`
- `app/login/page.tsx` — default `callbackUrl || '/dashboard'` → `/portal/dashboard`
- `lib/redirect-to-login.ts` — `redirect('/login')`
- `lib/auth.ts` / next-auth `pages.signIn` — `/login` → `/portal/login`
- `lib/sso-signin.ts` — returned URL strings

Super-admin (absolute root paths that need `/admin`):
- `lib/navigation.ts` — `PLATFORM_NAV` and `tenantTabs()` hrefs
- `app/page.tsx` — `redirect('/tenants')` → `/admin/tenants`
- `app/(dashboard)/layout.tsx` — `Link href="/"`
- `components/sign-out-button.tsx`, `lib/admin-context.ts` redirects

Portal navigation is otherwise relative or config-driven, which keeps the sweep
small. Public-site pages use relative `@/` imports and need no path changes.

### next.config.ts (merged)

Server app (no `output: 'export'` — the marketing pages still prerender at
build time because they use no dynamic APIs). `useTypeScriptCli: false` (the
repo's `typescript` alias is `@typescript/typescript6`, which ships no
`tsc` bin — all three apps already set this). `transpilePackages` (super-admin's
list — workspace packages are consumed as TS source, ADR-016).
`allowedDevOrigins` union. `images.unoptimized: true` (all three apps
effectively unoptimized today). Headers scoped by `source`:
`/(.*)` base headers, `/portal/:path*` portal CSP (uploadthing/stripe/google
allowlist), `/admin/:path*` console CSP (strict, no third-party).
`typedRoutes: true`. Dev rewrites from public-site's config are dropped — the
merged app is one dev server on :3000, so nothing to forward.

### Vercel + CI

Root `vercel.json`:
`"buildCommand": "bun run --cwd packages/database db:generate && bun run build --filter=web"`,
`"outputDirectory": "apps/web/.next"`, `installCommand: "bun install"`.
Root `package.json` gains `"postinstall": "prisma generate"` (the Aerojet
pattern — a fresh clone gets a generated client immediately). Both generate
steps are idempotent; keeping both is belt-and-braces (~3 s each).

CI: the lint/test/build tasks run through turbo over `apps/*`, so they pick up
`apps/web` automatically. The gated `deploy` job collapses from three projects
to one (`VERCEL_PROJECT_ID_PUBLIC` remains the project id; the
`_PORTAL`/`_SUPER_ADMIN` secrets become unused). Playwright e2e keeps
public-site's config at `apps/web/playwright.config.ts`.

## Phases (one commit each, verification gate per phase)

1. **Scaffold** `apps/web`: package.json (dependency union), tsconfig,
   merged next.config.ts, postcss/tailwind configs, merged `proxy.ts`,
   minimal root layout.
2. **Migrate public-site**: `git mv` app tree into `(public)`, lib,
   components, messages, public, robots/sitemap, tests, e2e.
3. **Migrate portal**: `git mv` into `app/portal/`, proxy rework, prefix sweep.
4. **Migrate super-admin**: `git mv` into `app/admin/`, prefix sweep.
5. **Root configs**: vercel.json, .vercelignore, root postinstall; remove the
   three old apps.
6. **CI**: deploy job collapse.
7. **Verify**: `bun install`, `bun run build --filter=web`, `lint`,
   `typecheck`, `test` — all green.
8. **Deploy**: push to `main`, Vercel builds the root project; verify live —
   public pages at `/`, `/portal/login` renders the portal sign-in,
   `/admin/login` renders the console sign-in.

## Risks and rollback

- **CSS cascade surprise** (two brands shipping on one page): caught by the
  Phase-7 build plus a visual check of one page per section on the live
  deployment. Fallback is the scoped-token approach above.
- **next-auth endpoint move** (`/api/auth/...` → `/portal/api/auth/...`):
  next-auth derives its endpoints from the route file location; the proxy's
  `publicPaths` and `pages.signIn` must match. Covered by the sweep inventory.
- **A stale absolute path the inventory missed**: greps for `'/` across each
  migrated tree before the phase commit; every hit is classified (internal →
  prefix, external/api → leave).
- **Rollback**: `git revert` the phase commits, or redeploy the previous
  Vercel deployment (the live public site keeps serving the last good build
  until a new one succeeds).

## Verification commands

```
bun install
bun run build --filter=web
bun run lint --filter=web
bun run typecheck --filter=web
bun run test --filter=web
```

Live checks after deploy: `/`, `/academics/`, `/portal/login` (redirects
unauthenticated), `/admin/login`.
