# `@novastar/sync-cli`

The operator's handle on the sync queue: run a sync for one tenant or one
school, see what is queued, resolve conflicts, replay failures, drain the queue
from cron, and — if you insist — wipe it.

It is a thin driver over `@novastar/sync-engine` (`packages/sync-engine`, reached
through the workspace dependency, never a relative path). The engine owns the
queue semantics; this owns the flags, the guards and the output. The engine is
never reimplemented here.

```
bun index.ts <command> [flags]
```

## `--help` first

```bash
bun index.ts --help        # exit 0, no database, no token, no arguments
```

That is the single most important property of this tool. If it needed a
credential to print its own help, people would stop using it.

## Commands

| Command | Writes? | What it does |
| --- | --- | --- |
| `status` | **No.** `SELECT` only | Queue depth, oldest pending change, conflicts, last drain. The only command considered for CI. |
| `sync` | Yes | Pull remote changes, then push the queue. |
| `push` | Yes | Push queued changes only. |
| `pull` | Yes | Store remote changes only. |
| `pending` | **No** | List queued, unsent changes. |
| `conflicts` | **No** | List unresolved conflicts. Exits 1 while any are unresolved. |
| `resolve` | Yes | Apply a conflict strategy. |
| `replay` | Yes | Put failed records back on the queue, optionally push them. |
| `drain` | Yes | Loop `sync` until the queue is empty. For cron. |
| `clear` | **Deletes** | Remove a tenant's queue. Destroys unsynced work. |

Flags: `--json`, `--table`, `--quiet`, `--tenant <id>`, `--school <id>`,
`--strategy <last-write-wins|merge|ask-user>`, `--limit <n>`,
`--max-iterations <n>`, `--yes`. Run `--help` for the full list.

## Safety rules this tool enforces

- **No default tenant.** A tenant comes from `--tenant` or `TENANT_ID`, or the
  command fails. `clear` takes `--tenant` only — no environment fallback, because
  the whole point is to name what you are about to destroy.
- **No default conflict strategy.** `sync`, `push`, `pull`, `resolve`, `replay`
  and `drain` all rewrite data, so `--strategy` or `SYNC_CONFLICT_STRATEGY` is
  required. `resolve` refuses without one. A silent `last-write-wins` in a cron
  job overwrites one side of every conflict with nobody told.
- **`ask-user` without a TTY exits non-zero.** It never falls back.
  `SyncEngine` throws `AskUserWithoutDeciderError` for the same reason.
- **`clear` needs `--yes`,** and prints the row count — including how many are
  unsynced — on stderr before it asks, so `--quiet` cannot hide it.
- **`drain` has `--max-iterations`** (default 10), stops early when a pass makes
  no progress, always prints a summary, and exits non-zero if anything is left.
- **Every statement is tenant-scoped.** `adapters/server-store.ts` binds one
  tenant at construction and rejects any other, and every statement carries a
  `tenant_id` predicate with the tenant as a bind parameter.
- **Secrets are never printed.** The connection string is passed through
  `redact()`; the service token never appears in output or in an error message.

## Environment

| Variable | Required by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | every command except `--help` | Postgres connection string. `DIRECT_URL` is the fallback. |
| `TENANT_ID` | `status`, `pending`, `conflicts`, `sync`, `push`, `pull`, `resolve`, `replay`, `drain` | Default tenant scope. |
| `SCHOOL_ID` | none | Default school scope. |
| `SYNC_API_URL` | `sync`, `push`, `pull`, `resolve`, `replay`, `drain` | Portal sync endpoint. |
| `SYNC_API_TOKEN` | same | Service token for that endpoint. A service token, not a user session. |
| `SYNC_CONFLICT_STRATEGY` | same | `last-write-wins` \| `merge` \| `ask-user`. |

`.env` and `.env.local` are loaded if present, and the real environment wins over
both. That is the opposite of `tools/db-mirror`, where the dotenv file is the
source of truth; for a CLI, a token exported for one command must not be
replaced by a stale line in a file.

`SYNC_API_URL`, `SYNC_API_TOKEN` and `SYNC_CONFLICT_STRATEGY` are **not** in
`turbo.json`'s `globalEnv`. Add them before wiring this into a cached turbo task:
an undeclared variable that changes destructive behaviour without changing the
cache hash is a stale-green-CI failure mode. `turbo.json` is not this
workspace's to change.

## The queue table

The store reads and writes `sync_queue`, which is **not** in
`packages/database/prisma/schema.prisma`. That is a gap this workspace cannot
close, because the Prisma schema belongs to `packages/database`. Apply this once
per database before any command other than `--help`:

```sql
CREATE TABLE IF NOT EXISTS sync_queue (
  id          uuid        PRIMARY KEY,
  tenant_id   text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   text        NOT NULL,
  table_name  text        NOT NULL,
  record_id   text        NOT NULL,
  operation   text        NOT NULL,
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sync_status text        NOT NULL DEFAULT 'pending',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  retry_count integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sync_queue_tenant_status_recorded
  ON sync_queue (tenant_id, sync_status, recorded_at);
```

A missing table surfaces as `SyncQueueTableMissingError` rather than as an empty
queue: a status report of "nothing pending" that is really "no table" is a lie.

`operation` takes `create | update | delete | upsert` and `sync_status` takes
`pending | synced | conflict | failed`, matching `SyncRecord` in
`@novastar/shared-types`.

## The remote endpoint

`adapters/remote-endpoint.ts` talks to `POST /api/sync` (push a batch) and
`GET /api/sync` (pull, with an optional `?since=` cursor), authenticating with
`Authorization: Bearer $SYNC_API_TOKEN` and sending the tenant in `x-tenant-id`.

**That route does not exist yet.** It is Phase 5 of the build plan and lives in
`apps/portal`, which this workspace does not own. Until it does, `sync`, `push`,
`pull`, `resolve`, `replay` and `drain` fail with a 404 naming the missing route.
`status`, `pending`, `conflicts` and `clear` work without it.

The route must take the tenant from the authenticated service token, never from
the request body. The test that matters is a body claiming a `tenantId` the
session does not own, and it has to be rejected.

## Cron

```bash
# Non-zero unless the queue drained and nothing failed.
bun index.ts drain --tenant "$TENANT_ID" --strategy merge --max-iterations 5
```

Read-only monitoring, safe to run anywhere:

```bash
bun index.ts status --json
```

Do not put `status` in CI against a production database without a throwaway
`DATABASE_URL`, and do not give it `continue-on-error`: a silent status check is
worse than none.

## Tests

```bash
bun run --cwd tools/sync-cli test
```

90 tests, no database and no network. The store is driven by a fake `pg` client
that records every statement it is asked to run, which is what lets the suite
assert that `status` issues zero writes, that `clear` without `--yes` writes
nothing, and that every statement carries its tenant.