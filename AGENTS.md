<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Where to put plans

Every plan, spec, design doc, or investigation write-up goes under `docs/`. Nothing else.

When the user does not name an explicit path, place the file in the folder that
matches its kind, using the taxonomy in `docs/README.md`:

| Kind of document | Location |
| --- | --- |
| Technical plans, build plans, implementation plans | `docs/technical/` |
| Architecture Decision Records | `docs/adr/` |
| Audit findings and reviews | `docs/audit-reports/` |
| API specs | `docs/api/` |
| Architecture diagrams and system design | `docs/architecture/` |
| Stakeholder-facing, non-technical documents | `docs/business/` |
| Generated HTML mirror of any of the above | `docs/html/` (build output — do not hand-edit) |

Rules:

- Do not create plan files outside `docs/`. In particular, never in the repo
  root, `plans/`, `tmp/`, `.kilo/`, or beside the code they describe.
- Technical plan filenames use `YYYY-MM-DD_HHMMSS-slug.md`, matching the
  existing master plan. Date-prefix audit reports use `YYYY-MM-DD-slug.md`.
- ADR filenames use `ADR-NNN-kebab-title.md`, numbered from the next free slot,
  and the new row must be added to the table in `docs/adr/README.md`.
- When a document describes work that is not finished, record the blocker and
  the verification command rather than claiming success.
- If a document would restate an architectural decision, write an ADR and link
  it instead of duplicating the reasoning.

## Repository conventions

- **`proxy.ts`, not `middleware.ts`.** Next.js 16.3.3 deprecates
  `middleware.ts`; the portal's request-level auth lives in
  `apps/portal/proxy.ts`. Both files cannot coexist — having both fails the
  build. See `docs/audit-reports/CONSOLIDATED-AUDIT-REPORT.md` (SEC-01).
- Every workspace leaf extends `tsconfig.base.json`. Do not duplicate
  `compilerOptions` across `tsconfig.json` files, and keep `paths` per-leaf
  (Next resolves them relative to the app's own config).
- Internal cross-package dependencies use `workspace:*`. External React/React
  DOM peers stay in `peerDependencies`; internal edges belong in
  `dependencies`.
- **Those five directories are built, not placeholders.** An earlier revision of
  this file described `apps/super-admin/`, `packages/testing/`,
  `tools/migrate/`, `tools/sync-cli/` and `tools/tenant-cli/` as "intentional
  empty placeholders". As of 2026-10-03 that is false and following it would
  delete working code: `apps/super-admin` is a full app with its own auth and
  cross-tenant console, and the other four are implemented workspace members
  with source and test suites. The build plans under `docs/technical/` repeat
  the same stale claim. `tools/seed/` is the only one of the six still lacking
  a `package.json`, so no `typecheck` task reaches it.

