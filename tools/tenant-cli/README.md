# `@novastar/tenant-cli`

Operator tool for tenant lifecycle: onboard a school, copy one school's
configuration into another, inspect and edit tenant configuration, suspend and
reactivate, export or import a tenant's configuration as a versionable file, and
mint a single password setup link by hand when no mail provider is configured.

The schema has been multi-tenant from day one. This tool is what makes that
claim testable, because it is the only thing in the repository that can create a
second tenant.

## Authorisation

**Possession of `DATABASE_URL` is authorisation.** This tool has no
authentication, no audit trail of its own, and no dry-run sandbox beyond the
per-command `--dry-run` defaults described below.

Three properties are deliberate and load-bearing:

- **It deletes nothing.** `suspend` sets `Tenant.isActive = false` and stops
  there. There is no `delete` or `clear` subcommand, and no code path that
  issues a Prisma `delete`.
- **It never invents a credential.** There is no default administrator
  password. The password is read from `TENANT_ADMIN_PASSWORD` or from a masked
  prompt, it is never a command-line argument (argv is world-readable and
  shell history keeps it), and it is never printed.
- **It never prints a secret**, with one deliberate and named exception. No
  connection string, no password hash, no session token. `setup-link` prints
  the one credential it mints, to the operator's own stdout, and to nowhere
  else — see its section below.

## Requirements

`DATABASE_URL` must be set for every command except `--help`. `.env` and
`.env.local` are loaded from the repository root, in that order, so a local file
overrides a CI variable only when both exist.

| Variable | Needed by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | every command except `--help` | Primary connection |
| `TENANT_CODE` | `show`, `set`, `config *`, `suspend`, `reactivate`, `user`, `setup-link`, `import` | Default tenant when `--tenant` is omitted |
| `TENANT_ADMIN_EMAIL` | `create` | Default initial administrator |
| `TENANT_ADMIN_PASSWORD` | `create --admin-email`, `user` | Initial or rotated password. Never defaulted |

## Usage

```bash
bun run --cwd=tools/tenant-cli index.ts --help
```

`bun run --cwd tools/tenant-cli --help` does **not** reach this tool: Bun
intercepts `--help` and prints its own usage. Use the `=` form, or run
`bun index.ts` from this directory.

### create

```bash
TENANT_ADMIN_PASSWORD='...' bun index.ts create \
  --code another --name "Another Montessori School" \
  --domain another.example.com \
  --school-name "Another Montessori School" --school-code main \
  --address "1 Test Road, Kumasi" --phone "+233 24 000 0000" \
  --email info@another.example.com --established 2020-01-01 \
  --admin-email head@another.example.com
```

`School.address`, `School.phone`, `School.email` and `School.established` are
required by the schema with no default, so the CLI requires them explicitly.

Re-running with the same `--code` **updates** the existing tenant. It does not
create a second one, and it does not reset an existing administrator's
password. Base RBAC (the permission catalog and the platform roles) is written
only when the tenant is created, so a re-run cannot overwrite roles an
administrator has since tuned.

### clone

```bash
bun index.ts clone --from novastar --to another            # plan only
bun index.ts clone --from novastar --to another --apply    # requires --yes unattended
```

Copies configuration, never data:

| Copied | |
| --- | --- |
| `Permission`, `Role` | RBAC |
| `ClassLevel`, `Subject`, `SubjectLevel` | academic structure |
| `GradingScale`, `GradingLevel` | grading |
| `FeeCategory`, `PaymentMethodConfig`, `AssessmentTypeConfig` | fees and assessment |
| `House` | |
| `Branding`, `ConfigEntity` | presentation and entity definitions |

Never copied, and enforced by `NEVER_CLONED` in `commands/clone.ts`: `User`,
`Account`, `Session`, `VerificationToken`, `Passkey`, `PasskeyChallenge`,
`Staff`, `StaffRole`, `Student`, `Parent`, `Enrollment`, `AttendanceTaker`,
`LeaveRequest`, `Payment`, `FeeInvoice`, `FeeInvoiceLineItem`, `FeeStructure`,
`FeeLineItem`, `Assessment`, `Score`, `AttendanceStudent`, `AttendanceStaff`,
`Message`, `Notification`, `AcademicYear`, `Term`, `Class`, `ClassTerm`,
`ClassSubject`, `Timetable`, `TimetableEntry`, `Syllabus`, `News`, `Event`,
`ReportTemplate`, `Book`, `BookCategory`, `BookLoan`, `InventoryCategory`,
`InventoryItem`, `InventoryTransaction`, `AuditLog`, `SystemConfig`,
`SystemError`, `LogEntry`.

Two rules worth knowing:

- **`isSystem` is never overwritten.** A target row that is already
  system-owned is counted as `skipped`, not rewritten, and `isSystem` is written
  on create only. A clone can neither demote a protected row the target
  administrator owns nor promote a tenant-authored one.
- **`House.patronId` is dropped, not remapped.** It points at a member of staff,
  and that row does not exist in the target.

Tenant-scoped `GradingScale` rows (`schoolId` null) are reported as `skipped`.
Prisma types a nullable column inside a compound unique as `string`, so they
cannot be selected through `tenantId_schoolId_name` at all; reporting them beats
dropping them silently.

Per-model created / updated / skipped counts are always printed. A clone that
quietly copied three of thirteen models is a failure that looks like a success.

### config get / set / export / import

```bash
bun index.ts config get
bun index.ts config set --key timezone --value Africa/Accra
bun index.ts config export --out config/novastar.json
bun index.ts import --file config/novastar.json --tenant another          # dry run
bun index.ts import --file config/novastar.json --tenant another --apply
```

`config set` writes one dot-path and re-validates the whole document, so an
unknown key is an error rather than a stored typo. The registry is
`currency`, `dateFormat`, `features`, `language`, `timeFormat`, `timezone`.

`config export` writes a document containing exactly what `clone` copies, keyed
by natural keys rather than database ids, with no personal data. `import` is its
inverse and **dry-runs by default**; writing needs `--apply`, and `--apply`
without a terminal needs `--yes`.

### suspend / reactivate

```bash
bun index.ts suspend --tenant another --yes
bun index.ts reactivate --tenant another --yes
```

`isActive` only. Nothing is removed. A suspended tenant keeps every row and
`reactivate` restores sign-in exactly as it was.

### user

```bash
TENANT_ADMIN_PASSWORD='...' bun index.ts user --tenant another --email head@another.example.com
TENANT_ADMIN_PASSWORD='...' bun index.ts user --tenant another --email head@another.example.com --rotate
```

Creates an administrator or rotates a password. `HEADMASTER` is the platform
role identifier granted by default (user-facing copy calls it Head of School).
Passwords are hashed with `Bun.password.hash(..., { algorithm: "argon2id" })`,
matching `tools/seed`. `argon2` and `bcryptjs` are deliberately not used; both
have unresolved version conflicts elsewhere in this repository.

### setup-link

```bash
bun index.ts setup-link --tenant another --email head@another.example.com
bun index.ts setup-link --tenant another --email head@another.example.com --allow-remote-database --yes
```

Mints an account's one-time "set your password" link and prints it. Use it only
to finish an account setup by hand when **no email provider is configured**.

**`RESEND_API_KEY` is the real fix.** Set it in `.env` (see `.env.example`) and
the portal and the super-admin console deliver this link by email; `setup-link`
is then unnecessary. Without it `sendEmail` in `packages/notifications` throws
`EmailDeliveryError('not-configured')`, every staff-account creation ends
`502 created-not-delivered`, and the "set my password" journey cannot be
completed at all.

There is no manual workaround, which is what this command exists for.
`issueEmailToken` stores `hashEmailToken(token)` — a SHA-256 digest — in
`User.verifyToken`, so the link cannot be reconstructed from the database, and
neither invite route returns it on failure. `novastar-tenant user --rotate` does
recover, but it sets the password directly and so bypasses the journey under
test.

The printed URL is a single-use credential: following it sets the password for
that account. It goes to your terminal and nowhere else — no file, no
`--out`, no `--json`, no log line, and no error message. Only its digest is
stored, so the plaintext cannot be recovered afterwards; re-run to mint another.

What it refuses:

| Refusal | Why |
| --- | --- |
| the account already has a `passwordHash` | mirrors `409 already-has-password` in `apps/portal/app/api/auth/set-password/route.ts`. Without it this command is a password reset for anyone who can run the CLI |
| `DATABASE_URL` is not on this machine, without `--allow-remote-database` | it writes a live credential, so that is acknowledged explicitly — the `--allow-production` shape `tools/migrate`'s `baseline` uses. `tools/migrate`'s `reset --dev-only` local-host-only rule is deliberately *not* copied: `.env.example` records that the Prisma client speaks Neon's SQL-over-HTTP, so a local `postgres` cannot serve this schema and a local-only gate could never open against the real database |
| a `--token` value, or any positional argument | `argv` is world-readable and shell history keeps it. This command mints its own token and will not take one |
| no `--yes` when stdin is not a terminal | the standard `requireConfirmation` gate |
| neither `NEXTAUTH_URL` nor `NEXT_PUBLIC_ORIGIN` | resolved **before** the mint, so a missing origin cannot leave an unreadable digest on the row |

The account is always resolved through the tenant code and then
`tenantId_email`, never by email alone: the same address can exist in two
tenants. Run `bun index.ts setup-link --help` for the full text.

## Shared provisioning

`provision.ts` is the single implementation of provisioning. `apps/super-admin`
imports `provisionTenant` from this package rather than reimplementing it:

```ts
import { provisionTenant, type ProvisionInput } from "@novastar/tenant-cli";

const result = await provisionTenant({
  tenant: { name: "Another School", code: "another", domain: "another.example.com" },
  school: {
    name: "Another School",
    code: "main",
    address: "1 Test Road, Kumasi",
    phone: "+233 24 000 0000",
    email: "info@another.example.com",
    established: new Date("2020-01-01"),
  },
  admin: { email: "head@another.example.com", password: process.env.TENANT_ADMIN_PASSWORD! },
});
```

Guarantees, all covered by `tests/provision.test.ts`:

- **One transaction.** Tenant, school, branding, base RBAC and the administrator
  are written atomically.
- **Idempotent by `Tenant.code`.** Re-running converges on one tenant.
- **Never a partial write.** Input is fully validated before the transaction
  opens, so a rejected `create` writes nothing at all.
- **The password is set on create only.** The update branch is `{}`.
- **No default password.** Omit `admin` entirely, or supply a real one; a
  missing password throws and names `TENANT_ADMIN_PASSWORD`.
- **No I/O.** `provision.ts` reads no command-line arguments, writes to no
  terminal and never exits the run. `tests/cli.test.ts` asserts this against the
  file's source so the constraint cannot erode.

## Layout

```
tools/tenant-cli/
  index.ts              subcommand dispatch, shebang, --help with no database
  config.ts             env loading, requireEnv, redact, isLocalHost
  output.ts             --json / --table rendering
  validate.ts           code / domain / email / date / settings validation
  provision.ts          the shared provisioning function (library-safe)
  commands/             one module per subcommand; all I/O lives here
    shared.ts           argument parsing and confirmation gates
    clone.ts            configuration clone and the NEVER_CLONED denylist
    setup-link.ts       mint and print one password setup link; its refusals are
                        the specification
    config/             get, set, export
  tests/                validate, provision, clone, cli, operator, setup-link
    support/fake-prisma.ts   an in-memory Prisma stand-in
```

## Development

```bash
bunx turbo run lint typecheck test --filter=@novastar/tenant-cli
```

Tests never touch a database. `@novastar/database` is replaced with an in-memory
fake that stores rows, so "running `create` twice leaves exactly one tenant" is a
claim about state rather than about call counts.

### Adding a model to `clone`

Add it to `CLONE_STEPS` **or** to `NEVER_CLONED`, never to neither.
`tests/clone.test.ts` asserts that the two sets are disjoint and that the
command touches no model outside `CLONE_STEPS`, so a new schema model cannot be
cloned by accident and a denylist entry cannot be quietly cloned.