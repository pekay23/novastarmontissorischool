# apps/super-admin — the platform console

A cross-tenant control plane for the Novastar Montessori deployment. One account per
operator, every tenant. It is a **separate Next.js app**, not a route group inside
`apps/portal`, and the split is the security model rather than an organisational
preference.

## Why it is not inside the portal

The portal resolves tenant scope from the caller's own `User` row
(`apps/portal/lib/tenant.ts`). That is correct there: a portal user can never leave
their tenant, so the scope is a fact about them rather than a parameter.

An operator here has no `User` row, enumerates every tenant, and switches between
them deliberately. Routing that through the portal's `getTenantContext()` would mean
either inventing a fake `User` per tenant — a platform operator is not a tenant user
— or adding an override parameter to a function the whole portal depends on, which is
one careless call site away from becoming a portal-wide tenant-escape hatch.

Two authorisation models, two codebases, no shared tenant resolution. Nothing under
`app/super-admin` imports `apps/portal/lib/tenant.ts`.

## Operator accounts

There is one credential per operator, held in a `PlatformOperator` row — not one
passphrase shared by everybody and not an environment list of who may hold it. Three
things were true of the shared model and are no longer:

| | Before | Now |
| --- | --- | --- |
| Credential | one passphrase in `SUPER_ADMIN_SECRET` | one argon2id hash per row |
| Who may sign in | an address list in `SUPER_ADMIN_EMAIL` | the rows themselves |
| Who did it | `AuditLog.userId: null` on every console entry | `AuditLog.operatorId` |
| Password rotation | rotated everyone's credential at once | rotated one person's |
| Compromised credential | usable by everybody until rotated | usable by one person until reset |

`PlatformOperator` has no `tenantId`, and cannot have one — that is the entire reason
it is a separate table rather than a `User` row. A platform operator belongs to no
school, so there is nothing for a tenant filter to narrow. A `HEADMASTER` address
presented to the sign-in form is refused because the sign-in path reads
`PlatformOperator` and nothing else: it consults no `User` row and no `Role` row, and
`tests/rbac.test.ts` asserts those reads never happen rather than trusting the prose.

### Signing in

`POST /api/auth/login` takes `identifier` and `password`. The identifier resolves
against either `username` or `email`, case-insensitively; an identifier that matches
two operators is refused rather than resolved, because `findFirst` would make the
winner a function of physical row order.

Passwords are argon2id at 19 MiB / t=2 / p=1 (`lib/operator-password.ts`), verified
with the `argon2` package on Node. A verify runs on **every** attempt, including one
against no account at all, against a committed dummy hash — so "no such operator" does
not return in microseconds while a real account takes ~50ms. The failure body is
identical for an unknown identifier, a wrong password, a locked account and a
suspended one; a distinguishable message is a free oracle for enumerating which
accounts hold the platform.

### Lockout

Five failed attempts locks an account for thirty minutes, on the same columns and
thresholds the portal's `User` lockout uses, so one policy covers every credential in
the platform and one sweep can clear both. A correct password does not open a lock.
`PlatformOperator` carries `@@index([status, lockedUntil])` for that sweep.

Above it sits a per-process fixed-window limiter (10 attempts per 15 minutes, keyed by
client address). It is a mitigation, not a control: it resets on restart and each
instance has its own window. Put a limit at the reverse proxy in front of this app.

### Sessions

The session is a signed cookie naming an operator id, and **every request re-reads the
live row**. Deactivating an account revokes at once rather than at expiry, and removing
a capability narrows what an existing session can do immediately. The live grant set and
the token's are intersected, so a removal takes effect at once while an *addition*
waits for the next sign-in — widening a live session on the strength of a database
write is a smaller guarantee than re-authenticating.

`PLATFORM_SESSION_SECRET` is a variable, never an operator password and never
`NEXTAUTH_SECRET`. Rotating it invalidates every issued session at once, which is the
deliberate recovery lever; rotating one operator's password touches no session but
their own. The signing key is HKDF-derived from it, so the configured value is not
itself a signing key. Unset or shorter than 32 characters, every signing and
verification throws: an unconfigured console refuses everybody.

## The two cookies

| Cookie | Authorises | Notes |
| --- | --- | --- |
| `super_admin_session` | yes | HMAC-SHA256 over the operator's id, issued/expiry times and the grants held at sign-in. Verified against a key derived from `PLATFORM_SESSION_SECRET` on every request, then against the live row. |
| `super_admin_tenant` | **no** | A UI preference. It decides what the operator is *looking at*, never what they may read: every drill-down re-resolves it through `requireTenantScope`, which re-reads the tenant and 404s on a miss. A hand-edited cookie buys a 404 and nothing else. |

The portal's session cookie is a different name under a different key, so neither app's
token can be replayed into the other. `tests/rbac.test.ts` asserts that a token signed
with `NEXTAUTH_SECRET` is refused here, which is the scenario separating the two
secrets exists for.

## Authorisation

Two layers, and both have to pass:

1. **Authentication** — a `PlatformOperator` row, its argon2id password hash, and a
   signed session cookie whose subject is that row's id.
2. **Capability** — the row's `capabilities` list, narrowed by the token's, and every
   route asserts one. A verified operator that grants nothing is a **403**, not a 401:
   the caller proved who they are, only the grant is missing.

The vocabulary is an allowlist (`lib/permissions.ts`), validated at module load against
the same `PermissionKeySchema` the portal's permissions use and matched with the same
`permissionMatches`, so a wildcard grant behaves identically in both apps. There is no
`isAdmin` boolean and no implied-superuser path.

An operator is created only from the CLI, never from this console's own UI:

```
# create
PLATFORM_OPERATOR_PASSWORD='…' bun run operator create \
  --username ops --email ops@example.com \
  --capabilities platform:read,platform:audit,tenant:read,tenant:update

# an operator who may also add school-level accounts to a tenant
PLATFORM_OPERATOR_PASSWORD='…' bun run operator create \
  --username onboarding --email onboarding@example.com \
  --capabilities tenant:read,tenant:user:read,tenant:user:create

# reset a lost password, or unlock an account
PLATFORM_OPERATOR_PASSWORD='…' bun run operator reset --username ops --rotate

# reduce a grant without touching the password
bun run operator reset --username ops --keep-password --capabilities platform:read
```

`create` refuses a username or email another operator already holds, refuses an
identifier that is not in the capability vocabulary, and refuses a password under 12
characters without hashing it. `--rotate` clears the lockout and sets
`mustChangePassword`; `--keep-password` leaves the password alone and warns, because
revoking someone's grant while preserving their session is a decision worth stating out
loud. The password comes from `PLATFORM_OPERATOR_PASSWORD` or a masked prompt, and is
never a flag — a password in `ps` output or a shell history is a password in a log.

## Routes

| Path | Capability | Scoping |
| --- | --- | --- |
| `/login` | — | Unauthenticated. `noindex`. |
| `/overview` | `platform:read` | Fleet totals. |
| `/tenants` | `tenant:read` | Roster. The one read with no session tenant to filter by; a narrow `select` is what makes it safe rather than a dump. |
| `/tenants/:id` | `tenant:read` | Scoped. 404 on an unknown id, never the fleet. |
| `/tenants/:id/schools` | `tenant:read` | `where: { tenantId }`. |
| `/tenants/:id/users` | `tenant:user:read` | `where: { tenantId }`. No credential column is in the projection. |
| `/tenants/:id/settings` | `tenant:config` | Dot-path writes, merged read-modify-write. Prototype keys refused. |
| `/audit` | `platform:audit` | Fleet-wide, paged. |
| `/health` | `platform:read` | Configuration and database reachability. Gated: an open health endpoint tells an anonymous caller whether the platform has been provisioned. |

## Creating an account

`POST /api/tenants/:tenantId/users` is the only route in the platform that creates an
arbitrary account, and it exists because provisioning did not cover the case: it makes
exactly one administrator and then stops, so a live tenant with three schools and one
account could not get a second one from here.

It creates the account and delegates. `createInvitedUser` from
`@novastar/auth/invite` does the writing — the same function
`apps/portal/app/api/auth/invite/route.ts` calls, so there is one definition of the
invited state, one token format and one privilege ceiling across both apps. This app
supplies what that package cannot know: the tenant scope, the portal origin the
setup link is built from, and the audit entry. `lib/invite-user.ts` is the adapter,
mirroring `lib/provision.ts`.

Four refusals, in the order they happen:

| Refusal | Status | Why |
| --- | --- | --- |
| No session / no `tenant:user:create` | 401 / 403 | `tenant:user:read` opens the page and is not enough to add to it. |
| A body naming a `tenantId` | 409 | The URL addresses the tenant. Dropping the field silently would let an operator believe they had created an account in one school while creating it in another. |
| A `roleId` in the body | 400 | `Role.id` is a cuid that means nothing outside the tenant and school it belongs to. The request may not choose a role row; it names a role and the shared function resolves it under `{ tenantId, schoolId, name }`. |
| A `schoolId` in another tenant | 404 | The school lookup carries both predicates, so the row is a miss rather than something the caller is trusted to have named correctly — and the role lookup never runs. |
| An address already in this tenant | 409 | `@@unique([tenantId, email])`. Reissuing instead would overwrite a token the first recipient may already have open. |
| The setup email was not delivered | 502 | See below. The account exists; the recipient has no way in without the link. |

**No plaintext password is ever emailed, generated or accepted.** There is no field
for one. The recipient follows a single-use link, expires in 24 hours, and chooses
their own password; until they do, `passwordHash` is `null` and the sign-in path
refuses the account.

### What a platform operator may grant

Any seeded school role, inside a tenant they have scoped to. That is the honest answer
rather than a gap, and the reasoning is in `mayGrantRole`: an operator belongs to no
school and holds no school role, so there is nothing above it to be capped by, and its
authority over tenants is already total — `tenant:provision` lets it create a tenant,
its school and its first administrator. A ceiling on a ceiling would only stop the
console doing the job it exists to do.

What it must never do is act outside the tenant it scoped to, and that is what the
guards are for. The `tenantId` comes from the URL segment and is re-read through
`requireTenantScope`, which 404s on a miss; the `schoolId` the body does carry is
looked up with `{ id, tenantId }`; the role is resolved inside both. Every id written
came from the request path or from a tenant-scoped read, never from the body. There is
no parameter through which a caller could name another tenant.

The same function does cap the *portal's* caller, by rank:
`mayGrantRole({ kind: 'school-role' }, target)` refuses a role that outranks the
caller's, which is the check `POST /api/auth/invite` lacked — see the comment in
`packages/auth/invite.ts` for the ordering and why it is a rank rather than a subset
test.

### Delivery failure is visible

`sendEmail` throws `EmailDeliveryError`; this app does not swallow it. The response is
**502 with `setupEmail: "failed"`** and a `setupEmailReason` of `not-configured` or
`provider-rejected` — the first of which is the one that names `RESEND_API_KEY`, the
single line between a working deployment and one where no setup email can go out.

The audit entry carries the same fact: one `TENANT_USER_CREATE` row per create, with
`changes.setupEmail` set to `sent` or `failed`, written *after* the delivery attempt so
the outcome is on the row rather than inferred from the absence of a second entry. The
cost is the same one `lib/provision.ts` documents — a crash between the create and the
entry leaves an account with no record of who made it — and the direction that matters
is the one that cannot happen: an entry claiming a delivery that did not.

`/` redirects to `/tenants`. Every route is `force-dynamic` and the whole app is
`noindex`: a control plane has no business in a search index.

## Provisioning delegates; it does not implement

`POST /api/tenants` and `POST /api/tenants/:id/provision` hand the whole request to
`provisionTenant` from `@novastar/tenant-cli/provision`. This app writes no tenant,
school, role or permission rows itself — two writers would mean two idempotency
stories.

The import is a subpath on purpose. `@novastar/tenant-cli`'s root is a command-line
entry point; importing the package root from a route would run the CLI during module
initialisation. `/provision` is the library half: it reads no argv, writes no
terminal and never ends the run.

`provisionTenant` is idempotent by `Tenant.code`, so both routes are safe to retry.
201 on create, 200 on reconcile, and `created` is in the body as well as implied by
the status — a reconcile reporting 201 would tell an operator they onboarded a school
twice.

`POST /api/tenants/:id/provision` refuses a body naming a different `code` with a
409. `provisionTenant` is keyed on `code`, so without that guard a request would
create or update a *different* tenant while the operator watched a URL saying
otherwise — a cross-tenant write expressed as an ordinary request.

## Cross-tenant reads are marked, not accidental

Every Prisma statement in `lib/queries.ts` is either scoped by a tenant id or carries
a `// CROSS-TENANT:` comment explaining why it is not. `tests/tenant-scope.test.ts`
fails if a new unscoped statement appears without that marker, so the exception list
can only grow deliberately.

The audit hash chain is one chain across every tenant, not one per tenant. A per-tenant
chain would fork the moment two tenants wrote concurrently and neither could prove the
other had not edited its own tail — which is the property the chain exists to provide.

## The administrator password

`POST /api/tenants` takes it from `admin.password` in the body, or from
`TENANT_ADMIN_PASSWORD` when the body omits it. It is never defaulted, never
generated, never echoed in a response, never logged and never written to an audit
entry. With neither available, the request is refused with a 400 naming the variable.

`tools/tenant-cli` hashes it with `Bun.password`. That is the right primitive and this
app does not reimplement it — but `Bun.password` is a Bun global, and `next build` /
`next start` run on Node. Provisioning *with* an administrator therefore requires the
Bun runtime; `lib/provision.ts` checks for it and fails closed with a message naming
the cause, rather than dying on `TypeError: Bun is not defined` halfway through a
transaction. Provisioning *without* an administrator never reaches it.

## Environment variables

Names only; `.env.example` carries the same list with blank values. No value in this
repository is a working credential.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PLATFORM_SESSION_SECRET` | yes | Seeds the session signing key through HKDF. At least 32 characters; a shorter value is refused, not padded. Rotating it invalidates every issued session at once. Never an operator password, never `NEXTAUTH_SECRET`. |
| `SUPER_ADMIN_DATABASE_URL` | no | Overrides `DATABASE_URL` for this app only. |
| `DATABASE_URL` | yes, unless the above is set | Fallback connection string. |
| `SUPABASE_DATABASE_URL` | no | Read replica the health page reports on by name. Not connected to. |
| `TENANT_ADMIN_PASSWORD` | no | Administrator password when a provisioning body omits one. |
| `RESEND_API_KEY` | yes, to create accounts | The email provider. Without it `POST /api/tenants/:id/users` still creates the account and answers 502 with `setupEmailReason: "not-configured"` — the recipient gets nothing and the operator is told so rather than being shown a success. |
| `NEXTAUTH_URL` | yes, to create accounts | The **portal's** origin, not this console's. The setup link points at the portal's set-password page, which lives in `apps/portal`; a link built from this app's origin 404s in the recipient's browser. `NEXT_PUBLIC_ORIGIN` is the fallback. |
| `PLATFORM_OPERATOR_PASSWORD` | no | Read by `tools/tenant-cli operator`. A CLI-time variable, never an app variable: this app has no route that creates an operator. |
| `NEXT_PUBLIC_SUPER_ADMIN_URL` | no | Canonical URL of this console. On the single nms domain it is mounted at `/admin` (see root `vercel.json`), so it shares an origin with the portal and the public site. The console's session cookie is still scoped to its own path, so it never collides with a portal session — the two cookies have different names and different paths regardless of origin. |

The console is deny-by-default. With `PLATFORM_SESSION_SECRET` unset, nobody can
authenticate and every route refuses. With no `PlatformOperator` row, every sign-in is
refused too — there is no environment allowlist left to fall back on and no default
operator. There is no development bypass.

## Tests

`tests/harness.ts` is the single place `@/lib/prisma`, `@novastar/database`,
`@novastar/notifications`, `next/headers` and the shared provisioning module are
mocked, and `bunfig.toml` preloads it — Bun evaluates a test
file's static imports in parallel, so a mock registered from a test file's own body can
lose the race to the real Prisma client. Nothing in the suite reaches a database.

`@novastar/database` is mocked alongside `@/lib/prisma` because the two names are one
object at runtime but `mock.module` keys on the specifier: the shared invite function
in `@novastar/auth` reaches the database through the package, so without it, account
creation would build the real lazy client and answer from its empty-result mock.

| File | Asserts |
| --- | --- |
| `rbac.test.ts` | Sign-in, argon2id parameters, token signature/expiry/vocabulary, immediate revocation, per-account lockout, the throttle, and audit attribution. |
| `admin-context.test.ts` | The gate itself: revoked row, withdrawn grants, the narrow `getOperatorOrNull` catch, and the selection cookie as a hint rather than a grant. |
| `tenant-switch.test.ts` | Every drill-down query carries the tenant id it was given, and the two fleet-wide reads are the only unscoped ones. |
| `tenant-routes.test.ts` | 401/403/404/409/405 per route, and that an unauthenticated caller triggers no query at all. |
| `provision-route.test.ts` | The console delegates provisioning exactly once and refuses a body addressing another tenant. |
| `create-user.test.ts` | Account creation: the capability required and refused when absent, both cross-tenant attempts, every validation refusal, the password-less invited state, the setup email and its failure, and the audit row. |
| `tenant-scope.test.ts` | A source scan: no Prisma call in `lib/queries.ts` without either a tenant predicate or a `// CROSS-TENANT:` comment. |

## Commands

```
bun run dev      # next dev --port 3200
bun run build    # next build
bun run start    # next start --port 3200
bun run lint     # eslint
bun run typecheck
bun test
```

## The migration

`packages/database/prisma/migrations/20261003164500_platform_operator/` adds
`PlatformOperator` and `AuditLog.operatorId`. It is additive and nullable on
`operatorId`, so existing audit rows are untouched and read back with no author — a
historical entry genuinely does not record one.

## Known gaps

- **Database role separation is not written.** `SUPER_ADMIN_DATABASE_URL` overrides
  the *connection string*, not the *role*. A distinct PostgreSQL role with explicit
  grants is a migration, and it has not been written — so leaving the override unset
  means the console connects with the same role as the portal.
- **`lib/prisma.ts` is the only Prisma call site.** That is the point of the file, and
  it is what makes the cross-tenant audit possible at all.
- **Provisioning with an administrator needs the Bun runtime**; see above.
- **Rate limiting is in-process.** Sign-in throttling lives in `lib/admin-auth.ts` and
  is per instance. A multi-instance deployment needs a shared store. The per-account
  lockout is in the database and does survive a restart.
- **No session revocation list, and none is needed for the common cases.** Suspending
  a row revokes at once, and rotating `PLATFORM_SESSION_SECRET` invalidates every
  issued token. What remains is revoking *one* session without touching that person's
  account, which no rotation can do cheaply — a stolen cookie is bounded by the 8-hour
  TTL until then.
- **The lockout has no scheduled sweep.** `lockedUntil` is checked on sign-in and the
  composite index exists for a sweep, but no job clears lapsed locks or resets counters
  for accounts nobody signs into again. The portal's own lockout has the same shape.
- **`mustChangePassword` is surfaced, not enforced.** The row carries the flag, the
  dashboard shows a warning, and the CLI sets it — but no route forces a password
  change before other work, because the only writer is a CLI an operator already has
  shell access to.

## Request-level auth

There is no `middleware.ts` and no `proxy.ts` in this app. Authorisation is asserted
per surface — `requireCapability` in route handlers, `requireCapabilityPage` in
server components — rather than in a single request interceptor, because the two
surfaces refuse different things: a handler answers 401/403, a page redirects to
`/login`. A single matcher would have to pick one.

Next.js 16.3.3 deprecates `middleware.ts`, so a future `proxy.ts` is the file to add,
not a `middleware.ts`. Having both fails the build.
