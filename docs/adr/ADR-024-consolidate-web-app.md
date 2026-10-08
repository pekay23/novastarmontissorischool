# ADR-024: Consolidate public-site, portal and super-admin into one app (`apps/web`)

**Status:** Accepted
**Date:** 2026-10-08
**Deciders:** project owner
**Tags:** architecture, deployment, vercel, next.js

## Context

The monorepo carried three separately built Next.js apps: a static
marketing site (`apps/public-site`, the only one deployed), the tenant
portal (`apps/portal`, `basePath: '/portal'`), and the cross-tenant
operator console (`apps/super-admin`, `basePath: '/admin'`). The
portal and the console had never been deployed: the Vercel deploy path
in CI was gated off, and deploying them as separate Vercel projects
would mean separate configs, separate env-var sets, and separate
deploy pipelines for apps that share one database, one design system
and one domain.

The owner's reference is the Aerojet Academy project
(`pekay23/aerojet-academy`): a single Next.js app serving public
pages and every role tree from one `app/` directory, deployed as one
Vercel project with one `vercel.json`. The owner explicitly rejected
separate projects and separate configs for the portals.

Both portal apps already anticipated this: their `next.config.ts`
files carry `basePath` comments saying they are "Mounted under
/portal|/admin on the single nms domain (see root `vercel.json`)",
and the public site's config already dev-proxies those prefixes.

## Decision

Merge the three apps into `apps/web` in the monorepo:

- Public pages at the domain root, in the `(public)` route group
  (URLs unchanged).
- Portal routes physically under `app/portal/` (URLs `/portal/*`).
- Console routes physically under `app/admin/` (URLs `/admin/*`).
- One `proxy.ts` (the portal's request-level proxy, gated to
  `/portal/*`), one `next.config.ts`, one `vercel.json`, one Vercel
  project.
- The two session systems stay separate inside the app: the portal's
  next-auth session (`NEXTAUTH_SECRET`) and the console's
  `super_admin_session` cookie (`PLATFORM_SESSION_SECRET`).
- Per-section stylesheets: `globals.css` (public brand) imported by
  the root layout, `portal.css` and `admin.css` imported by their
  section layouts, so each section keeps its own brand tokens
  (purple / emerald / navy) through CSS cascade order.
- Root `package.json` gains `postinstall: prisma generate` (the
  Aerojet pattern), and the Vercel `buildCommand` runs
  `db:generate` explicitly before `bun run build --filter=web`.

`/portal/*` and `/admin/*` are mandatory, not cosmetic: `/fees`
(and potentially `/settings`) exists in both the marketing site and
the portal, so portal routes cannot live at the app root of a merged
app.

## Consequences

### Positive
- One project, one config, one domain — the deployment story becomes
  "push to main, one build", matching Aerojet.
- The root Vercel project's existing env vars
  (`PLATFORM_OPERATOR_PASSWORD`, `SEED_PORTAL_ADMIN_PASSWORD`,
  `UPSTASH_REDIS_REST_*`, `DEFAULT_SCHOOL_CODE`) finally belong to
  the app that runs on it.
- Shared code (`packages/*`, the design system) is consumed directly
  instead of through three parallel builds.
- The Prisma-client build failure class (fresh installs not
  generating the client) is retired by `postinstall`.

### Negative
- One build contains three brands' worth of CSS; the cascade order
  decides which brand a page gets, so a stylesheet import mistake is
  a visual bug, not a compile error. Mitigated by the per-layout
  import discipline and a live check of one page per section.
- The internal-link sweep (portal/console absolute paths gaining the
  `/portal` / `/admin` prefix) is mechanical but must be complete; a
  missed path 404s or misroutes. Mitigated by the enumerated sweep
  inventory in the migration plan and a grep audit per phase.
- `next dev` now runs all three sections on one port (3000); the
  old per-app ports (3001, 3200) are gone.

### Neutral
- The three `tailwind.config.mts` files collapse into one (the
  portal's, loaded via `@config` by the section stylesheets; the
  public stylesheet deliberately does not use it).
- The gated CI deploy job collapses from three projects to one
  (`VERCEL_PROJECT_ID_PUBLIC` stays; the `_PORTAL` and
  `_SUPER_ADMIN` secrets become unused).

## Alternatives Considered

- **Three Vercel projects** (the CI job's design): rejected by the
  owner — separate configs and projects for apps that share a domain.
- **Rewrites from the static export to separately hosted portal
  origins**: still requires the portal and console to be deployed
  somewhere, i.e. separate projects; and the static export cannot
  host rewrites at all (its own config says so).
- **Repo-root restructure** (dissolve the monorepo, hoist the app to
  the root like Aerojet): rejected — throws away the workspace, turbo
  and CI investment for no functional gain.
- **Unified auth** (one secret, role claims in the JWT, the Aerojet
  pattern): deferred — the console's separate signing key and cookie
  are deliberate security properties (its `admin-auth.ts` threat
  notes), and unification is its own security project.

## Related

- ADR-001 (monorepo structure — this decision keeps it)
- ADR-016 (packages consumed as TypeScript source — unchanged)
- ADR-022 (Aerojet security patterns — the CSP allowlists and the
  proxy discipline carry over)
- `docs/technical/2026-10-08_003500-merge-portal-admin-public-into-apps-web.md`
  (the migration plan and sweep inventory)
