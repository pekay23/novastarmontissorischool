# ADR-023: Production DDL must arrive through `migrate deploy`, never `db push`

**Status:** Accepted
**Date:** 2026-10-04
**Deciders:** Pekay
**Tags:** technical, security, database, migration, production

## Context

Prisma exposes two ways to get DDL into a PostgreSQL database:

- **`prisma db push`** — applies DDL directly from `schema.prisma`. It does **not**
  create a row in `_prisma_migrations`. The migration files on disk and the live
  schema can diverge in ways the tool never records.
- **`prisma migrate deploy`** — replays every pending migration in
  `prisma/migrations/` into `_prisma_migrations`. The ledger, the files, and the
  live schema stay in agreement.

The repository's ledger is baselined: four migrations applied (Init, Platform Config,
Unified Transform wave 0, Platform Operator), `db:migrate:status` reports *Applied 4,
Pending 0*, and `db:migrate:verify` reports live schema == `schema.prisma` exactly.
`migrate deploy` is therefore viable for production.

A prior draft proposal (see `docs/technical/2026-10-03_231500-guard-production-ddl-proposal.md`,
now marked superseded) sought to guard `db push` with a wrapper. Four reviewers were
spawned on the adversarial council; three returned and one was rate-limited by its
provider. All three returned reviewers rejected that shape. The reasoning:

1. **`db push` and a baselined ledger are mutually exclusive workflows.** A push after
   baseline leaves the migration files stale; the next `migrate deploy` fails with
   "already exists" on every object the push touched. `db push`'s post-hoc `verify`
   cannot catch this, because `verify` compares `schema.prisma` to the live schema —
   two sources `db push` just forced into agreement.
2. **A guard around `db push` is a human-factors improvement, not an enforcement
   boundary.** Anyone with `DATABASE_URL` can run `prisma db push` directly and bypass
   it. The only real fix is that the runtime role cannot execute DDL at all — a
   provisioning change in Neon, not a script.
3. **Guard order in a hypothetical `push` command would detect damage after it landed**,
   because `db push` runs before any verify, and failed pushes are never auto-rolled back.
4. **CI schema verification must not hard-fail when credentials are absent**; a missing
   `DATABASE_URL` is a misconfiguration, not drift.

## Decision

1. **Production DDL enters the database only through `bun run db:migrate:deploy`.**
   It is the sanctioned write path: it records every change in `_prisma_migrations`,
   replays migrations in order, and leaves the ledger, files, and live schema
   consistent.
2. **`db push` is dev-only and hard-refused on remote hosts.** A new
   `tools/migrate/index.ts push` command delegates to `prisma db push` but refuses
   for any non-local host (`isLocalHost`: `localhost`, `*.localhost`, `::1`,
   `0.0.0.0`, `host.docker.internal`, `127.x.x.x`). It accepts no acknowledgement and
   no confirmation flag, so there is nothing to type that gets past it: the refusal is
   structural rather than advisory. Two details are load-bearing rather than cosmetic —
   the Prisma child is handed the guard's own resolved `DATABASE_URL`, so the host that
   was inspected is the host that is written to (`--target direct` otherwise resolves
   `DIRECT_URL` while Prisma reads `DATABASE_URL`); and `--accept-data-loss` is
   deliberately **not** passed, so Prisma's own refusal stands instead of a blanket
   "yes" from a wrapper. The `@novastar/database` `db:push` script is repointed through
   it.
3. **`tools/db-mirror/apply-schema.ts` keeps its `neon` target but guards it.**
   Applying a reviewed DDL file to production is a legitimate, if rare, bootstrap/repair
   path (the repo was once in exactly this state). The `neon` target now requires
   `--allow-production`, or a TTY confirmation where a human is present; a
   non-interactive run without the flag refuses. The target is **not** deleted.
   The decision lives in `tools/db-mirror/guards/production-ack.ts`, apart from the `pg`
   client and the readline prompt, so it can be tested without a database — a guard only
   reachable by applying DDL to production is a guard nobody tests. The guard covers
   *every* host that reaches it, because the `/neon/i` host match has already refused
   anything that is not a Neon host, so there is deliberately no local-host exemption to
   fall through.
4. **`scripts/ci/verify.ts` adds `db:migrate:verify`, gated on the presence of a
   connection string.** It looks in `process.env` *and* in the repo root `.env` /
   `.env.local`, because checking only `process.env` would skip the step on exactly the
   machine where a developer keeps their credentials, and honour
   `MIGRATE_SKIP_DOTENV=1` so the two agree. With no credentials the step is a no-op — a
   connection string's absence is a pipeline misconfiguration, not schema drift, and a CI
   job without production credentials must not fail. With credentials, the read-only
   `migrate diff --exit-code` check enforces schema == `schema.prisma` before merge.
5. **The DEPLOYMENT NOTEs embedded in applied migration SQL must not be edited.**
   The four applied migrations carry stored checksums in `_prisma_migrations`; modifying
   an applied migration file risks a checksum mismatch error on later deploys. The new
   operational convention lives in this ADR and in `README.md` / operator docs, not in
   the migration files themselves.

## Consequences

### Positive

- Nobody reaches a remote database with `bun run db:push`, and no flag combination gets
  past the host check — `tests/push-cli.test.ts` drives the real CLI to prove the parser
  wiring as well as the decision. This is a guard, not a boundary: someone with a shell
  and `DATABASE_URL` can still run `prisma db push` themselves. That is what decision 4
  in Alternatives Considered exists to close.
- Every production change is recorded in the migration ledger, enabling rollback
  reasoning, drift detection, and audit.
- CI enforces schema consistency as a read-only check without requiring production
  secrets.
- The rare production-DDL-repair path remains available under explicit acknowledgement.

### Negative

- A developer who previously ran `db:push` against a shared or cloud-local database
  will hit the refusal and must use `db:migrate:deploy` instead — a net win, but a
  migration of workflow for that subset of users.
- `push.ts` is a new first-class command, so it must be kept in sync with `index.ts`
  (`COMMANDS`, `ALLOWED`, dispatch) and with `isLocalHost`. `tests/push-cli.test.ts`
  covers the wiring end to end and `tests/guards.test.ts` covers each host spelling, so
  adding a command without adding the two registrations fails the suite.
- The `neon` target's acknowledgement is a prompt-plus-flag of its own rather than the
  `refuse-production` guard set. Accepted: `refuse-production` classifies a target for
  commands that legitimately talk to production under a declaration, whereas this one
  applies a reviewed DDL file, and folding it in would have made the two guards'
  defaults argue with each other.

### Neutral

- The existing `skipGuards` escape hatch in `DeployOptions` is not copied into the new
  command (the push command has no guards to skip).

## Alternatives Considered

1. **Guard `db push` for production instead of banning it (the rejected proposal).**
   Rejected: a successful push after baseline leaves stale migration files and the next
   `migrate deploy` fails; the post-push `verify` cannot detect that divergence. A guard
   stack is not an enforcement boundary — a human with `DATABASE_URL` bypasses it.
2. **Delete the `neon` target from `apply-schema.ts`.**
   Rejected: it is the documented repair path for a populated database and was the tool
   in active use during this repository's mirror reconciliation. Preserve it behind
   `--allow-production` instead.
3. **Run CI verification against a Neon branch instead of production.**
   Considered as a stronger version of option 4. It adds Neon API access and branch
   lifecycle management for no incremental safety — `migrate diff --exit-code` against
   the live primary with a read connection is sufficient and cheaper. Kept in reserve
   for future hardening.
4. **Add database-level enforcement (non-owner runtime role, revoking DDL) before this change.**
   The strongest design, and the actual root-cause fix. Deferred to a provisioning
   follow-up because it requires Neon role changes, an app-connection change, and a
   new `MIGRATION_DATABASE_URL` environment variable. This change reaches the
   production-DDL-through-migrate-deploy goal without touching the database
   configuration; the follow-up makes the bug class impossible rather than hard to hit.

## Related

- `docs/technical/2026-10-03_231500-guard-production-ddl-proposal.md` (rejected approach)
- `tools/migrate/commands/deploy.ts`, `tools/migrate/commands/push.ts`
- `tools/migrate/tests/push-cli.test.ts`, `tools/migrate/tests/guards.test.ts`
- `tools/db-mirror/apply-schema.ts`, `tools/db-mirror/guards/production-ack.ts`
- `scripts/ci/verify.ts`
- ADR-022: Adopt Aerojet Security Patterns
- `_prisma_migrations` checksum semantics (`prisma migrate resolve --applied`)
