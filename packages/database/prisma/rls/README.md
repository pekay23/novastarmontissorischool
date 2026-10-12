# Row Level Security — deployment state and the role change

Two files, one story:

| File | What it does | State |
| --- | --- | --- |
| `tenant-isolation.sql` | Creates the `app` schema, the `current_tenant_id()` / `is_tenant_bypass()` functions, and one `tenant_isolation` policy per covered table (51 policies across 51 of the models) | **Applied to production** (verified read-only on 2026-10-03) |
| `00-app-role.sql` | Creates the `novastar_app` role: least privilege, `NOBYPASSRLS` | **Not applied** — the app still connects as `neondb_owner`, which has `rolbypassrls = true` |

## Why RLS is not load-bearing yet

`neondb_owner` has `BYPASSRLS`, and a bypassing role skips every policy. The
51 policies have therefore never filtered a production query. Tenant isolation
in production today comes from application code — `getTenantContext()` in
`apps/web/lib/tenant.ts` and the explicit `where: { tenantId }` clauses in
every domain query — and from that role attribute.

## Applying the role change, in the only safe order

1. **Create the role.** Grants and `NOBYPASSRLS` take effect; nothing else
   changes, because `DATABASE_URL` still names `neondb_owner`:
   ```sh
   psql "$DATABASE_URL" -v app_password="$NOVASTAR_APP_PASSWORD" -f 00-app-role.sql
   ```
2. **Make the setting reachable.** The policy reads
   `current_setting('app.current_tenant_id', true)` and matches no tenant when
   that is NULL, and the current driver cannot set it per unit of work:
   `packages/database/index.ts` uses `PrismaNeon`, the stateless serverless HTTP
   driver — every query is its own HTTP request with no session to carry the
   setting. Either switch to a stateful driver (PrismaPg, node-postgres, or the
   Neon WebSocket driver) and `SET` per connection inside a transaction, or wrap
   each tenant-scoped unit of work in
   `prisma.$transaction(async tx => { await tx.$executeRaw\`SELECT set_config('app.current_tenant_id', ${tenantId}, true)\`; … })`.
3. **Only then point `DATABASE_URL` at `novastar_app`.** Switching before
   step 2 makes every read return zero rows and every write rejected — the
   application fails closed, which is the correct failure but still an outage.

Step 2 is the real work and is tracked separately; this directory deliberately
contains no shortcut around it.

## Drift

`prisma migrate deploy` does not read this directory — these files are applied
by hand. Any schema change to a covered table needs a matching edit to
`tenant-isolation.sql` or the policy set silently falls behind the datamodel.
The comment at the top of that file records the last full verification
(2026-10-03) and what it checked.
