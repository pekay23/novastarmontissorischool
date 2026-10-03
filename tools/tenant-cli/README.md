# `@novastar/tenant-cli`

Operator tool for tenant lifecycle: onboard a school, copy one school's
configuration into another, inspect and edit tenant configuration, suspend and
reactivate, and export or import a tenant's configuration as a versionable file.

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
- **It never prints a secret.** No connection string, no password hash, no
  session token.

## Requirements

`DATABASE_URL` must be set for every command except `--help`. `.env` and
`.env.local` are loaded from the repository root, in that order, so a local file
overrides a CI variable only when both exist.

| Variable | Needed by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | every command except `--help` | Primary connection |
| `TENANT_CODE` | `show`, `set`, `config *`, `suspend`, `reactivate`, `user`, `import` | Default tenant when `--tenant` is omitted |
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
  config.ts             env loading, requireEnv, redact
  output.ts             --json / --table rendering
  validate.ts           code / domain / email / date / settings validation
  provision.ts          the shared provisioning function (library-safe)
  commands/             one module per subcommand; all I/O lives here
    shared.ts           argument parsing and confirmation gates
    clone.ts            configuration clone and the NEVER_CLONED denylist
    config/             get, set, export
  tests/                validate, provision, clone, cli
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