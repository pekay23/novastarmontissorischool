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
| Comparing the live schema with `schema.prisma` | `tools/migrate verify` |
| Comparing the migration files with `schema.prisma` | `tools/migrate compose` |
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
bun run --cwd tools/migrate compose --shadow-database-url <url> --dev
bun run --cwd tools/migrate rollback               # guidance only; writes nothing
bun run --cwd tools/migrate mirror --verify-only  # delegates to @novastar/db-mirror
bun run --cwd tools/migrate reset --dev-only      # localhost only
```

Root scripts exist for the turbo-run variants. `compose` needs its flag, so
forward it past `--`:

```bash
bun run db:migrate:compose -- --shadow-database-url <branch-url> --dev
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

**`verify` and `compose` answer different questions, and only one of them is
about the migration files.** `verify` runs

```
prisma migrate diff --exit-code --from-config-datasource --to-schema prisma/schema.prisma
```

`--from-config-datasource` is the **live database**, so `verify` says *does the
database match the datamodel* and never opens `prisma/migrations`. `compose`
asks the other question — *do the files on disk compose to the datamodel* — with
`--from-migrations`, and it is the one that `baseline` depends on. A green
`verify` is not evidence about `compose`.

**`compose` needs a throwaway database, and there is no default.**
`--from-migrations` has to build a database from the migration files before it
can compare anything, and Prisma does that by **resetting the database named by
`--shadow-database-url` and replaying every migration into it**. So the flag is
required; the command refuses without it rather than defaulting, because a
default pointing at `DATABASE_URL` would execute DDL against production. It also
refuses a URL that resolves to any configured live database
(`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_DATABASE_URL`), treats an unreadable
host as a refusal rather than proceeding, and ignores `SKIP_PRODUCTION_GUARD`
for the same reason `reset` does.

The natural target is a **Neon branch of the same project**: an empty database
on the right engine, created in two clicks and deleted afterwards. A local
`postgres:16` container cannot serve this schema — `packages/database` speaks
Neon's SQL-over-HTTP through `@prisma/adapter-neon` (see `.env.example`). The
URL is passed as an argv element, so it is visible in the process table while
the command runs: use a throwaway credential.

**`baseline` is a dry run by default.** `--apply` is required to write, and even
then it needs a confirmation, a restore point, and a clean
`packages/database/prisma`.

**`baseline` will not assert history you did not name.** A ledger row means *this
migration ran*. `baseline` therefore requires either `--migration <name>` per
migration, or `--assert-all`, which is one word that says out loud that you are
writing the ledger from a claim rather than from evidence. The bare form used to
resolve every unsettled migration, so `baseline --apply` asserted the entire
history and every later `migrate deploy` skipped it — an invisible divergence
with an awkward reversal (`resolve --rolled-back` is itself an assertion).

**Run `compose` *before* `baseline`, not `verify`.** `compose` is the only check
that tests what `baseline` is about to claim. `verify` compares the live schema
with `schema.prisma`; a database can match the datamodel perfectly while the
migration files on disk do not compose to it, and then a ledger written from
those files is a ledger that lies.

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

The three tasks this tool owns in `turbo.json`, `db:migrate:status`,
`db:migrate:verify` and `db:migrate:compose`, are `cache: false` for the same
reason: their result is a statement about a database, so it is stale the moment
it is written. The shadow database URL is passed as a flag rather than an
environment variable on purpose — a variable would have to be declared in
`turbo.json` to survive the turbo boundary, and a URL that resets a database has
no business in a cache key.

## Tests

```bash
bun test tools/migrate
```

Pure-logic only: environment resolution, the guards, ledger classification,
baseline planning, shadow-target resolution and the fingerprints. No test needs a
database or a Prisma CLI, which is the point — a test that needs production to
run is a test that does not get run. `compose`'s refusal path is tested rather
than its diff for the same reason: the diff needs a live shadow database, and the
refusals are the part that must never be wrong.
