# `@novastar/migrate`

The operator entry point for schema changes.

Prisma owns applying migrations. It lives in `packages/database`, and it is
correct there. This tool is a **wrapper and a safety layer** around it: it adds
the checks Prisma has no command for, and it refuses to let a DDL run happen in
a state where the answer is unknown.

## Division of labour

| Concern | Owner |
| --- | --- |
| Applying SQL migrations | Prisma, via `packages/database` |
| Authoring a migration interactively | Prisma `migrate dev` |
| Comparing migrations on disk, the ledger, and the live schema | `tools/migrate status` |
| Baselining a database with no migration history | `tools/migrate baseline` |
| Pre-flight guards, rollback guidance, reset | `tools/migrate` |

**This tool owns no migration SQL.** If you find yourself writing DDL here you
have reimplemented Prisma. It delegates to `prisma migrate …` as a subprocess
and reads the schema back through `pg` and `information_schema`.

Prisma is **not** a dependency of this package. It is resolved from
`packages/database` at run time with `bun x --no-install prisma`, so there is
one Prisma in the tree and no chance of the tool and the package that owns the
migrations disagreeing about versions.

## Commands

```bash
bun run tools/migrate/index.ts --help

bun run --cwd tools/migrate status                 # read-only, exits non-zero on drift
bun run --cwd tools/migrate verify                 # read-only, live schema vs schema.prisma
bun run --cwd tools/migrate create --name add_x   # delegates to prisma migrate dev
bun run --cwd tools/migrate baseline               # dry run; --apply to write
bun run --cwd tools/migrate deploy --yes          # guarded, then verifies
bun run --cwd tools/migrate rollback               # guidance only; writes nothing
bun run --cwd tools/migrate mirror --verify-only  # delegates to @novastar/db-mirror
bun run --cwd tools/migrate reset --dev-only      # localhost only
```

Every command prints the mechanism it used, on success **and** on failure.

Exit codes: `0` success, `1` failed or a guard refused, `2` usage error.

## Environment

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | primary, via the pooler |
| `DIRECT_URL` | primary, direct (non-pooler) |
| `SUPABASE_DATABASE_URL` | the failsafe mirror |
| `MIGRATE_SKIP_DOTENV` | `1` ignores the repo root `.env` / `.env.local` |
| `SKIP_PRODUCTION_GUARD` | `1` skips the deploy/baseline confirmation |

Resolution follows `packages/database/prisma.config.ts` exactly:
`DATABASE_URL || DIRECT_URL`. Every Prisma subprocess is handed the selected
value as an explicit `DATABASE_URL`, so the tool and Prisma cannot disagree.

**A missing connection string throws.** It never warns and never falls back to
a placeholder. `packages/database/index.ts` can return a mock client when
`DATABASE_URL` is absent because that path only exists for `next build`; there
is no such allowance for a tool that runs DDL.

`.env` and `.env.local` are loaded from the repo root with **no override**, so
the shell wins over the file — the same precedence `prisma.config.ts` gets from
`import "dotenv/config"`.

## Safety properties

**Nothing blocks on a TTY.** `--yes` accepts. With no TTY and no `--yes`, a
confirmation is a refusal, not a wait. A CI step that hangs on a prompt nobody
can answer is a stuck pipeline, and a stuck pipeline is worse than a deploy
that did not run. `prisma migrate dev` is forced to `--create-only` in that
situation so it cannot offer to reset a database.

**`status` and `verify` write nothing.** Not as a promise in a comment: the
`pg` connection is opened with `default_transaction_read_only = on`, so the
write is rejected by Postgres. The only Prisma call involved is
`migrate diff`, which Prisma documents as read-only and which for the
`schema.prisma` digest needs no database at all.

**`baseline` is a dry run by default.** `--apply` is required to write, and even
then it needs a confirmation. It writes a ledger row asserting that a migration
ran; if the live schema does not actually match it, every future
`migrate deploy` skips that migration and nothing notices. Run `verify` *before*
`baseline`, not after.

**`reset` has two independent locks and both must open:** `--dev-only`, and a
host that is a local address. `SKIP_PRODUCTION_GUARD` is deliberately ignored
there — a variable in the environment is not a decision a person made.

**`rollback` never writes.** Prisma has no down-migration and neither does
anything else: reversing DDL is a decision about data. The command prints the
ledger, the SQL that ran, and the manual steps, and stops.

**A failed deploy is never rolled back automatically.** A migration that stopped
halfway leaves a state only a human has seen. `deploy` prints the failing
migration and its ledger row, points at `rollback`, and stops.

## Flags that change behaviour without changing a cache key

`MIGRATE_ON_PUSH` and `SKIP_PRODUCTION_GUARD` are deliberately **not** in
`turbo.json`'s `globalEnv`. An env var that changes behaviour but not the cache
hash is how a cached result from one value of a variable gets replayed under
another. Add them before any task that depends on them is ever cached.

The two tasks this tool owns in `turbo.json`, `db:migrate:status` and
`db:migrate:verify`, are `cache: false` for the same reason: they read a live
database, so their result is stale the moment it is written.

## Tests

```bash
bun test tools/migrate
```

Pure-logic only: environment resolution, the guards, ledger classification,
baseline planning and the fingerprints. No test needs a database or a Prisma
CLI, which is the point — a test that needs production to run is a test that
does not get run.
