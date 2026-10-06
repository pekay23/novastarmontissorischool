import { createHash } from 'node:crypto'
import type { Prisma } from '@novastar/database'
import { TenantSuspendedError } from '@/lib/errors'
import { prisma } from '@/lib/prisma'
import type {
  AuditEntrySummary,
  Paged,
  PaginationQuery,
  PlatformAuditPage,
  SchoolSummary,
  TenantDetail,
  TenantSummary,
  TenantUserSummary,
} from '@/types/admin'

/**
 * Every Prisma call in the control plane.
 *
 * Confining the calls to one module is what makes the guard in
 * `tests/tenant-scope.test.ts` possible. The plan's §11 risk 1 mitigation asks for
 * a test that fails when a `findMany` is written without either a tenant
 * predicate or an explicit `// CROSS-TENANT` marker; scanning one file makes that
 * check meaningful, where scanning the whole tree would mostly assert on
 * incidental code and rot.
 *
 * THE RULE
 * --------
 * Either the `where` names a tenant — `tenantId`, `tenantId_code`,
 * `tenantId_email`, or `id: tenantId`, which is the tenant's own primary key — or
 * the call is prefixed with a `// CROSS-TENANT:` comment saying why the fleet-wide
 * read is intended. There is no third option and no ambient scope.
 *
 * The cross-tenant reads that exist are the roster, the health totals, the
 * platform-wide audit log, the migration count, and the head of the audit hash
 * chain (which is global by design, so that two tenants writing concurrently
 * extend one chain instead of forking two). Everything else is scoped.
 *
 * AUDIT AND THE MUTATION IT RECORDS
 * ---------------------------------
 * Every tenant mutation writes its `AuditLog` entry inside the same transaction
 * as the write. A best-effort audit after the fact is worse than no audit: the
 * change is already committed, and a failure in the log leaves a real change with
 * no record of who made it. Login events are the one exception, and they are
 * documented where they are written.
 *
 * SUSPENSION IS A GATE, NOT A LABEL
 * ---------------------------------
 * `Tenant.isActive` is checked by every function below that touches one tenant,
 * with three deliberate exceptions, each marked where it is declared: `readTenant`
 * and `getTenantById`, which are the resolution primitive; `setTenantActive`, which
 * is the off switch itself; and the two fleet-wide reads, which exist to show
 * suspended tenants so that one can be found and reactivated. The first draft of
 * this module treated the flag as something to display, which left `PATCH
 * {"isActive": false}` — the request `DELETE /api/tenants/:id` refuses with and
 * points operators at as the tenant's off switch — writing a column that nothing
 * read.
 *
 * `auditAcrossPlatform` is not one of the exceptions, and the distinction is worth
 * spelling out because it is the only fleet-wide read that touches tenant data at
 * all. The roster and the health totals exist to *surface* suspension, so they read
 * across it and must keep doing so. The audit trail exists to describe activity, so
 * a suspended tenant's entries are withheld from it — and the withheld count is
 * returned in `meta` rather than dropped, because a trail that shrinks silently is
 * worse than one that admits it is incomplete.
 *
 * `assertTenantIsActive` is the shared form for callers that have not already read
 * the row. It throws rather than filtering: a suspended tenant reached by
 * `where: { tenantId, tenant: { isActive: true } }` would answer with an empty
 * page, and an operator cannot tell an empty page from a school with no users in
 * it. The refusal has to be a refusal.
 *
 * A row that is absent is not a suspension — it is a tenant that does not exist,
 * which every caller has already resolved to a 404 by the time it gets here, and
 * the `findMany` calls that follow are scoped to that id and return nothing.
 */

/** Either the pooled client or a transaction. Reads and writes accept both. */
type Db = Prisma.TransactionClient | typeof prisma

/**
 * Throws `TenantSuspendedError` unless `tenantId` names an active tenant.
 *
 * The refusal carries the tenant id and nothing else, so a client can name the
 * tenant it asked about without learning anything about any other.
 *
 * On a row that does not exist this returns rather than throwing, because a
 * nonexistent tenant is a 404 that the caller has already produced and this
 * function has no opinion about; the reads that follow are scoped to that id and
 * return nothing.
 */
export async function assertTenantIsActive(tenantId: string): Promise<void> {
  const row = await prisma.tenant.findFirst({
    // `id: tenantId` is the tenant predicate: `Tenant.id` is the primary key and is
    // unique across the fleet, so this names exactly one tenant and cannot widen.
    where: { id: tenantId },
    select: { isActive: true },
  })
  if (row && !row.isActive) throw new TenantSuspendedError(tenantId)
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/**
 * Exactly `TENANT_LIST_FIELDS`, expressed as a Prisma select.
 *
 * `_count` rather than a join: the roster needs two integers per tenant, and a
 * join would make this query scale with the number of schools and users in the
 * fleet instead of with the number of tenants.
 */
const TENANT_SELECT = {
  id: true,
  name: true,
  code: true,
  domain: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { schools: true, users: true } },
} as const

type TenantRow = {
  id: string
  name: string
  code: string
  domain: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  _count: { schools: number; users: number }
}

function toSummary(row: TenantRow): TenantSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    domain: row.domain,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    schoolCount: row._count.schools,
    userCount: row._count.users,
  }
}

const SCHOOL_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  code: true,
  email: true,
  phone: true,
  address: true,
  motto: true,
  established: true,
  createdAt: true,
  updatedAt: true,
} as const

const TENANT_USER_SELECT = {
  id: true,
  tenantId: true,
  schoolId: true,
  email: true,
  name: true,
  // The credential columns are absent from this select and there is no code path
  // that adds them: `passwordHash`, `twoFactorSecret`, `passkeyBridgeToken` and
  // `verifyToken` are not in TENANT_USER_SELECT and cannot reach a response.
  role: { select: { name: true } },
  status: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} as const

const AUDIT_SELECT = {
  id: true,
  tenantId: true,
  schoolId: true,
  userId: true,
  // Present so a console action reads as attributable in this console's own audit
  // view. `userId` stays alongside it rather than being replaced: a tenant action
  // has a user and no operator, and a console action has an operator and no user.
  operatorId: true,
  action: true,
  entity: true,
  entityId: true,
  description: true,
  createdAt: true,
} as const

type AuditRow = {
  id: string
  tenantId: string
  schoolId: string
  userId: string | null
  operatorId: string | null
  action: string
  entity: string
  entityId: string | null
  description: string | null
  createdAt: Date
}

function toAuditEntry(row: AuditRow): AuditEntrySummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    schoolId: row.schoolId,
    userId: row.userId,
    operatorId: row.operatorId,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  }
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function pageOf<T>(rows: T[], total: number, page: PaginationQuery): Paged<T> {
  return {
    data: rows,
    meta: { total, take: page.take, skip: page.skip, hasMore: page.skip + rows.length < total },
  }
}

// ---------------------------------------------------------------------------
// Fleet-wide reads — the deliberate CROSS-TENANT calls
// ---------------------------------------------------------------------------

/**
 * Every tenant, for the roster.
 *
 * CROSS-TENANT: the roster's purpose is to span tenants. There is no session
 * tenant to filter by — that is the entire difference between this app and the
 * portal — and `Tenant` has no `tenantId` column of its own to filter against.
 * The `select` above is what keeps this from being a data dump.
 */
export async function listTenantsAcrossPlatform(): Promise<TenantSummary[]> {
  const rows = await prisma.tenant.findMany({
    select: TENANT_SELECT,
    orderBy: { code: 'asc' },
  })
  return rows.map(toSummary)
}

/**
 * The counts the overview page and the health page are built from.
 *
 * CROSS-TENANT: platform-wide totals. Each statement below is an aggregate with
 * no row-level `where` to add — there is no caller tenant, and a per-tenant
 * filter on a count that is supposed to be the whole fleet would return the count
 * for one tenant and call it the platform.
 */
export async function countPlatformTotals(): Promise<{
  tenants: number
  activeTenants: number
  schools: number
  users: number
  auditEntries: number
}> {
  const [tenants, activeTenants, schools, users, auditEntries] = await Promise.all([
    // CROSS-TENANT: platform-wide total. `Tenant` has no tenantId column of its
    // own, so there is nothing here to filter by and nothing to narrow to.
    prisma.tenant.count({}),
    // CROSS-TENANT: as above, plus the active flag.
    prisma.tenant.count({ where: { isActive: true } }),
    // CROSS-TENANT: platform-wide total, see the note above.
    prisma.school.count({}),
    // CROSS-TENANT: platform-wide total, see the note above.
    prisma.user.count({}),
    // CROSS-TENANT: platform-wide total, see the note above.
    prisma.auditLog.count({}),
  ])
  return { tenants, activeTenants, schools, users, auditEntries }
}

/**
 * How many migrations this database has applied.
 *
 * CROSS-TENANT: `_prisma_migrations` has no tenant column and belongs to the
 * database rather than to any school, so there is nothing to scope it to.
 *
 * Prisma's client cannot model this table, so it is a raw statement — and a raw
 * statement is exactly where a `where` clause would be missed, which is why the
 * identifier is a literal in a tagged template and nothing is interpolated.
 */
export async function countAppliedMigrations(): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL
  `
  const first = rows[0]
  if (!first) return null
  return Number(first.count)
}

/**
 * The audit trail across every tenant, for the platform audit page.
 *
 * CROSS-TENANT: the platform audit page exists to show what happened anywhere, which
 * is the one view a per-tenant filter would defeat. `auditForTenant` is the scoped
 * counterpart for a drill-down, and both share the same projection so the two views
 * cannot disagree about what a row contains.
 *
 * A SUSPENDED TENANT'S ROWS ARE EXCLUDED, AND THE EXCLUSION IS REPORTED
 * ------------------------------------------------------------------
 * `meta.excludedSuspendedEntries` counts what was withheld. Silent filtering was the
 * shape that was rejected: an operator auditing a school that has been switched off
 * would see an empty result and read it as "nothing happened", when the answer is "not
 * readable while it is off". A row that is missing and a row that was never written
 * have to look different here, or the trail is worse than useless during exactly the
 * window somebody most wants to read it.
 *
 * Tagging the rows instead was rejected for a reason that is structural rather than
 * stylistic: a tag has to live on the row, and the rows are gone. Inventing
 * `suspended: true` on rows this function does not return is a contradiction, and
 * returning the rows with a tag is the owner's other option, ruled out.
 *
 * WHY NOT MATCH `auditForTenant` AND REFUSE
 * ----------------------------------------
 * Because the request names no tenant, so there is nothing to refuse. `auditForTenant`
 * can throw because the caller said "tenant X" and X is off; `auditAcrossPlatform` is
 * asked "what happened anywhere", and the honest answer to that is every tenant that
 * is on. Refusing here would mean one suspended school out of the whole fleet blinds an
 * operator to every *other* school's history — a worse failure than the one this closes,
 * and one an operator could cause deliberately. The two functions are therefore
 * inconsistent in mechanism and consistent in principle: neither presents a suspended
 * tenant as an ordinary, complete answer — one refuses, the other withholds and says so.
 *
 * WHY `notIn` RATHER THAN AN ALLOWLIST OF ACTIVE TENANTS
 * -----------------------------------------------------
 * `AuditLog.tenantId` is a plain `String` with no relation to `Tenant` (only `userId`
 * and `operatorId` are relations), so `tenant: { isActive: true }` is not expressible
 * — and an allowlist spelled by hand would be wrong besides. The table legitimately
 * holds rows whose `tenantId` is a sentinel rather than a tenant: `'platform'` for the
 * console's own sign-ins, sign-outs and refusals (`lib/audit.ts`), and `'system'` for
 * a portal row whose tenant could not be resolved (`apps/portal/lib/audit/logger.ts`).
 * "Only active tenants" would silently delete the operator's own sign-in trail from the
 * one view that is supposed to be the whole story. `notIn` subtracts exactly the
 * switched-off tenants' ids and leaves every sentinel, and every `tenantId` that
 * resolves to no tenant at all, where it was.
 *
 * CONSEQUENCE, ACCEPTED RATHER THAN PAPERED OVER: a tenant's own `TENANT_SUSPEND` and
 * `TENANT_REACTIVATE` entries are withheld for as long as it is off, so suspending a
 * school also removes the suspension from this page. That is the coherent reading —
 * the trail for a switched-off tenant is withheld while it is off and complete again
 * once it is on — and the count above is what tells the operator it happened.
 */
export async function auditAcrossPlatform(page: PaginationQuery): Promise<PlatformAuditPage> {
  // CROSS-TENANT: the set of switched-off tenants is a fact about the whole fleet, so
  // it is read across it. This is the only reason the function is not one statement.
  const suspended = await prisma.tenant.findMany({
    where: { isActive: false },
    select: { id: true },
  })
  const suspendedIds = suspended.map((row) => row.id)

  // `undefined` rather than `{ tenantId: { notIn: [] } }` when nothing is suspended:
  // an empty `notIn` is left to the engine's own handling of an empty list rather
  // than relied upon, so the no-suspension case is decided here where it is legible.
  const where = suspendedIds.length > 0 ? { tenantId: { notIn: suspendedIds } } : undefined

  const [rows, visibleTotal, allTotal] = await Promise.all([
    // CROSS-TENANT: the platform trail. The `where` above is not a tenant scope — a
    // request here named no tenant — but the exclusion it carries is what keeps a
    // suspended tenant's rows out of this page, which is the whole point of the read.
    prisma.auditLog.findMany({
      where,
      select: AUDIT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: page.take,
      skip: page.skip,
    }),
    // CROSS-TENANT: as above, for the count that pages the result.
    prisma.auditLog.count({ where }),
    // CROSS-TENANT: the unfiltered total, so the withheld count is arithmetic on the
    // two counts above rather than a third independent read that could disagree with
    // either of them.
    prisma.auditLog.count({}),
  ])

  const paged = pageOf(rows.map(toAuditEntry), visibleTotal, page)
  return {
    ...paged,
    meta: { ...paged.meta, excludedSuspendedEntries: allTotal - visibleTotal },
  }
}

// ---------------------------------------------------------------------------
// Tenant-scoped reads
// ---------------------------------------------------------------------------

/**
 * One tenant by its own id, on whichever handle the caller is holding.
 *
 * No `isActive` in the `where`, and deliberately so: this is the resolution
 * primitive, and the two callers that must reach a suspended tenant cannot both
 * do it through a gated read. `requireTenantScope` needs the row in order to
 * *report* that it is suspended, and `setTenantActive` needs it in order to return
 * the reactivated tenant in the response that proves the suspension lifted.
 * Filtering here would turn both into a 404 on a tenant that plainly exists.
 *
 * The suspension decision therefore lives one layer up — in `requireTenantScope`
 * for the drill-down routes and in the write paths below for everything else.
 */
async function readTenant(db: Db, tenantId: string): Promise<TenantDetail | null> {
  // `id: tenantId` is the tenant predicate: `Tenant.id` is the primary key and is
  // unique across the fleet, so this names exactly one tenant and cannot widen.
  const row = await db.tenant.findFirst({
    where: { id: tenantId },
    select: { ...TENANT_SELECT, settings: true },
  })
  return row ? { ...toSummary(row), settings: (row.settings ?? {}) as Record<string, unknown> } : null
}

export async function getTenantById(tenantId: string): Promise<TenantDetail | null> {
  return readTenant(prisma, tenantId)
}

/**
 * A tenant's schools. Scoped on `tenantId`, which is a non-null column.
 *
 * Refuses a suspended tenant rather than answering with an empty list, for the
 * reason in the module header: the read must be a refusal or it is indistinguishable
 * from a school with no schools in it.
 */
export async function listSchoolsForTenant(tenantId: string): Promise<SchoolSummary[]> {
  await assertTenantIsActive(tenantId)
  const rows = await prisma.school.findMany({
    where: { tenantId },
    select: SCHOOL_SELECT,
    orderBy: { code: 'asc' },
  })
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    code: row.code,
    email: row.email,
    phone: row.phone,
    address: row.address,
    motto: row.motto,
    established: row.established.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))
}

/**
 * A tenant's user directory. Scoped on `tenantId`.
 *
 * A suspended tenant's staff directory refuses, rather than listing. This is the
 * read that matters most of the three: the projection already keeps every
 * credential column out of it, but a directory of names, addresses, roles and last
 * sign-ins for a school that has been switched off is not something an operator
 * needs in order to decide whether to switch it back on.
 */
export async function listUsersForTenant(tenantId: string): Promise<TenantUserSummary[]> {
  await assertTenantIsActive(tenantId)
  const rows = await prisma.user.findMany({
    where: { tenantId },
    select: TENANT_USER_SELECT,
    orderBy: { email: 'asc' },
    take: 500,
  })
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    schoolId: row.schoolId,
    email: row.email,
    name: row.name,
    roleName: row.role?.name ?? null,
    status: row.status,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: iso(row.lastLoginAt),
    createdAt: row.createdAt.toISOString(),
  }))
}

/**
 * One school, addressed by its own id *and* the tenant it must belong to.
 *
 * `tenantId` in the `where` is the whole point and not belt-and-braces. A request
 * naming a school id gets this predicate, so a school belonging to another tenant
 * resolves to `null` rather than to a row — and the caller turns that into a 404.
 * The alternative, reading the school by id alone and comparing afterwards, is a
 * cross-tenant read that happens to be checked one line later, which is one refactor
 * away from being a cross-tenant *write*.
 *
 * It also refuses a suspended tenant, and that is load-bearing rather than
 * decorative: this is the only caller-visible path into `inviteTenantUser`, so it is
 * the suspension gate on the console's only credential-minting route. The check runs
 * before the school row is read, so a suspended tenant cannot be probed for which
 * school ids it holds.
 */
export async function getSchoolInTenant(
  tenantId: string,
  schoolId: string,
): Promise<{ id: string; tenantId: string; name: string } | null> {
  await assertTenantIsActive(tenantId)
  const row = await prisma.school.findFirst({
    where: { id: schoolId, tenantId },
    select: { id: true, tenantId: true, name: true },
  })
  return row
}

/**
 * One tenant's audit trail. Scoped on `tenantId`.
 *
 * Refuses a suspended tenant rather than returning an empty page, for the reason in
 * the module header: the caller named this tenant, so an empty page would be a lie
 * about a tenant that plainly exists. What must not happen is that it reads as a normal
 * drill-down — an operator working inside a school that has been switched off sees
 * nothing, and cannot tell "switched off" from "no history".
 *
 * This is deliberately the opposite mechanism to `auditAcrossPlatform`, which has no
 * named tenant to refuse and therefore withholds and counts instead. That function
 * documents why, and what would go wrong if it did the same thing here.
 */
export async function auditForTenant(
  tenantId: string,
  page: PaginationQuery,
): Promise<Paged<AuditEntrySummary>> {
  await assertTenantIsActive(tenantId)
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tenantId },
      select: AUDIT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: page.take,
      skip: page.skip,
    }),
    prisma.auditLog.count({ where: { tenantId } }),
  ])
  return pageOf(rows.map(toAuditEntry), total, page)
}

// ---------------------------------------------------------------------------
// Platform operators
// ---------------------------------------------------------------------------

/**
 * What a sign-in attempt needs: the credential hash, the lockout columns, and
 * enough identity to mint a session.
 */
export interface OperatorCredentialRow {
  readonly id: string
  readonly username: string
  readonly email: string
  readonly name: string | null
  readonly passwordHash: string
  readonly status: string
  readonly capabilities: readonly string[]
  readonly mustChangePassword: boolean
  readonly loginAttempts: number | null
  readonly lockedUntil: Date | null
}

/**
 * What a *request* needs, which is less: no `passwordHash`.
 *
 * Two projections on purpose. The sign-in path has a reason to hold a credential;
 * the per-request re-read that backs `resolveLiveOperator` runs on every dashboard
 * render and every route handler, and there is no reason for it to pull a password
 * hash into process memory on any of them. Keeping them separate makes that
 * structural rather than a reviewer's judgement call.
 */
const OPERATOR_PROFILE_SELECT = {
  id: true,
  username: true,
  email: true,
  name: true,
  status: true,
  capabilities: true,
  mustChangePassword: true,
  lastLoginAt: true,
} as const

const OPERATOR_CREDENTIAL_SELECT = {
  ...OPERATOR_PROFILE_SELECT,
  passwordHash: true,
  loginAttempts: true,
  lockedUntil: true,
} as const

/**
 * Every operator whose username *or* email matches `identifier`.
 *
 * A LIST rather than a single row, deliberately, and `authenticateOperator` refuses
 * anything that is not exactly one element. `username` and `email` are each
 * `@unique` independently, which is what makes the identifier unambiguous *most* of
 * the time — but nothing forbids one operator's username from being another's
 * email, and a `findFirst` over that would silently resolve to whichever row the
 * planner reached first. Returning the candidates and refusing the ambiguous case
 * moves the decision to code, where it can be tested, instead of leaving it to row
 * order.
 *
 * Case-insensitive on both sides. A case-sensitive lookup would make resolution
 * depend on every writer remembering to case-fold first, and the two writers are a
 * CLI and a human with a database client. The table is small by construction — one
 * row per person who administers the platform — so a functional scan here is not a
 * cost worth optimising away with a denormalised lowercase column that could itself
 * drift.
 *
 * CROSS-TENANT: `PlatformOperator` has no `tenantId` column and cannot have one.
 * That is the entire reason the model exists rather than a `User` row: an operator
 * belongs to no school, so there is nothing here to scope to and nothing that a
 * tenant filter could narrow.
 */
export async function findOperatorByIdentifier(identifier: string): Promise<OperatorCredentialRow[]> {
  return prisma.platformOperator.findMany({
    where: {
      OR: [
        { username: { equals: identifier, mode: 'insensitive' } },
        { email: { equals: identifier, mode: 'insensitive' } },
      ],
    },
    select: OPERATOR_CREDENTIAL_SELECT,
  })
}

/**
 * One operator by primary key, for the per-request re-read.
 *
 * CROSS-TENANT: as above — the row has no tenant to scope to. The id comes from a
 * signature this module minted, never from a request field, so it names at most one
 * row.
 */
export async function readOperatorById(id: string): Promise<{
  id: string
  username: string
  email: string
  name: string | null
  status: string
  capabilities: string[]
  mustChangePassword: boolean
  lastLoginAt: Date | null
} | null> {
  // CROSS-TENANT: as above. A `PlatformOperator` row is addressed by its own primary
  // key, which the signature in `admin-auth.ts` supplied — never by a request field.
  return prisma.platformOperator.findUnique({ where: { id }, select: OPERATOR_PROFILE_SELECT })
}

/**
 * Clears the lockout and stamps the sign-in, after a verified password.
 *
 * CROSS-TENANT: as above. `id` comes from a row this app just read, not from a
 * request body.
 */
export async function recordOperatorLogin(id: string, at: Date): Promise<void> {
  await prisma.platformOperator.update({
    where: { id },
    data: { loginAttempts: 0, lockedUntil: null, lastLoginAt: at },
  })
}

/**
 * Counts one failed sign-in and locks the account once it crosses the threshold.
 *
 * Two statements rather than a read-then-write, and the reason is concurrency: the
 * increment is `SET "loginAttempts" = "loginAttempts" + 1`, so five simultaneous
 * wrong-password attempts cannot lose a count against each other and slip past a
 * threshold on a read-modify-write. `MAX_OPERATOR_LOGIN_ATTEMPTS` lives in
 * `admin-auth.ts` and is passed in rather than imported, which keeps this module
 * free of the auth module and the import edge one-directional.
 *
 * The second statement clears `lockedUntil` below the threshold rather than leaving
 * a stale one. A lapsed lock is not enforced anyway — the sign-in path compares it
 * against the clock — but leaving it would keep every lapsed row matching the
 * lockout-sweep index forever, so the sweep would stop being able to tell "just
 * expired" from "expired last year".
 *
 * CROSS-TENANT: as above.
 */
export async function recordOperatorPasswordFailure(
  id: string,
  at: Date,
  maxAttempts: number,
  lockoutMs: number,
): Promise<void> {
  // CROSS-TENANT: as above — an operator row, addressed by its own primary key.
  const updated = await prisma.platformOperator.update({
    where: { id },
    data: { loginAttempts: { increment: 1 } },
    select: { loginAttempts: true },
  })

  const attempts = updated.loginAttempts ?? 0
  // CROSS-TENANT: as above.
  await prisma.platformOperator.update({
    where: { id },
    data:
      attempts >= maxAttempts
        ? { lockedUntil: new Date(at.getTime() + lockoutMs) }
        : { lockedUntil: null },
  })
}

// ---------------------------------------------------------------------------
// Audit writes
// ---------------------------------------------------------------------------

/**
 * The `tenantId`/`schoolId` written on an entry that is about the platform rather
 * than about any school — an operator signing in, or signing out.
 *
 * `AuditLog.tenantId` and `AuditLog.schoolId` are plain `String` columns with no
 * referential integrity (only `userId` is a relation), so a sentinel is
 * storable. It matches the portal's own `'system'` fallback in
 * `apps/portal/lib/audit/logger.ts:89-90`, so an operator reading the same table
 * from either app sees one vocabulary rather than two.
 */
export const PLATFORM_AUDIT_SCOPE = 'platform'

export interface AuditWrite {
  readonly tenantId: string
  readonly schoolId: string
  readonly userId?: string | null
  /**
   * The platform operator the entry is attributable to.
   *
   * A sibling of `userId` and not a replacement. A console action has no `User` —
   * the operator belongs to no tenant — so before this column every console entry
   * was written with `userId: null` and the trail could say what happened but never
   * who did it. Pointing `userId` at the nearest school administrator would be
   * worse than null: it would name a tenant member who did not perform the action.
   */
  readonly operatorId?: string | null
  readonly action: string
  readonly entity: string
  readonly entityId?: string | null
  readonly description?: string | null
  readonly changes?: Record<string, unknown>
  readonly ipAddress?: string | null
  readonly userAgent?: string | null
}

/**
 * Appends one tamper-evident audit entry on an existing transaction.
 *
 * The hash chain is a single chain across every tenant, not one chain per tenant.
 * A per-tenant chain would fork the moment two tenants wrote concurrently and
 * neither could prove the other had not edited its own tail — which is the
 * property the chain exists to provide. So the head read is cross-tenant by
 * necessity, and it is marked.
 */
async function appendAudit(db: Db, entry: AuditWrite): Promise<void> {
  // CROSS-TENANT: the audit hash chain is global, so its head is not a tenant's
  // row. See the note above.
  const head = await db.auditLog.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  })
  const previousHash = head?.hash ?? null
  const createdAt = new Date()

  // Scoped on the entry's own tenant, which the caller supplies from the tenant
  // the route was addressing. This is the one statement in the write path that
  // could file an operator's action under the wrong tenant.
  await db.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      schoolId: entry.schoolId,
      userId: entry.userId ?? null,
      operatorId: entry.operatorId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      description: entry.description ?? null,
      newData: (entry.changes ?? {}) as Prisma.InputJsonValue,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      previousHash,
      hash: computeAuditHash(previousHash, entry.action, entry.entityId ?? null, entry.changes ?? {}, createdAt),
      createdAt,
    },
  })
}

/**
 * Appends one audit entry in its own transaction.
 *
 * Used only for events that have no accompanying mutation — signing in, signing
 * out, a refused attempt. A mutation's entry is written by that mutation's
 * transaction instead.
 */
export async function writeAuditEntry(entry: AuditWrite): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await appendAudit(tx, entry)
  })
}

function computeAuditHash(
  previousHash: string | null,
  action: string,
  entityId: string | null,
  changes: Record<string, unknown>,
  timestamp: Date,
): string {
  // The same input tuple as `apps/portal/lib/audit/logger.ts:52-67`, so an
  // auditor verifying an entry with either app's code gets the same answer.
  const data = [
    previousHash ?? '',
    action,
    entityId ?? '',
    JSON.stringify(changes ?? {}),
    timestamp.toISOString(),
  ].join('|')
  return createHash('sha256').update(data).digest('hex')
}

// ---------------------------------------------------------------------------
// Tenant-scoped writes
// ---------------------------------------------------------------------------

/**
 * The mutable `Tenant` columns.
 *
 * `code` is absent on purpose and cannot be added here: it is the routing key, so
 * patching it would move a live tenant to a different subdomain.
 */
export type MutableTenantField = 'name' | 'domain'

/**
 * The mutable columns, typed by what each one actually accepts.
 *
 * A `Partial<Record<MutableTenantField, string | null>>` would type `name` as
 * nullable, and `Tenant.name` is not: Prisma rejects it, and the rejection is the
 * type system telling the truth about the column. So the shape is spelled out —
 * `name` takes a string, `domain` takes a string or `null`.
 */
export interface MutableTenantFields {
  name?: string
  domain?: string | null
}

/**
 * What a mutation's audit entry is attributed to.
 *
 * Both operator fields are non-null and always are: they come from a verified
 * `AdminOperator`, which by construction has a row and therefore an id. That was
 * not true before per-operator accounts, when there was no row to name — the type
 * used to allow `null` and every description carried a `?? 'an operator'`
 * fallback. An audit entry cannot be anonymous now, and a type that permits the
 * old shape would only invite the fallback back.
 */
export interface TenantMutationContext {
  readonly operatorId: string
  readonly operatorEmail: string
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

/**
 * Patches a tenant's mutable fields and records the change in the same
 * transaction.
 *
 * `id: tenantId` is the predicate and the only one. The id comes from the URL
 * segment, never from the body, so there is no way for a request to address a
 * tenant other than the one its route named.
 *
 * The previous values are read inside the transaction and go into the audit
 * entry as `changes.from`. Reading them after the write would file "name changed
 * from Foo to Foo" for every request, and an audit log that cannot reconstruct
 * the prior state is not an audit log.
 *
 * `isActive` rides along on that same read because the suspension check needs it
 * and a second query would not: the flag has to be judged inside the transaction
 * that is about to write, or a tenant suspended by a concurrent request could be
 * renamed after it. The refusal is thrown rather than returned as `null` so a
 * suspended tenant is a 403 and a nonexistent one stays the 404 the caller has
 * always answered with.
 */
export async function updateTenantFields(
  tenantId: string,
  data: MutableTenantFields,
  context: TenantMutationContext,
): Promise<{ tenant: TenantDetail; previous: Partial<Record<MutableTenantField, string | null>> } | null> {
  return prisma.$transaction(async (tx) => {
    // Scoped on the tenant's own primary key.
    const before = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { name: true, domain: true, isActive: true },
    })
    if (!before) return null
    if (!before.isActive) throw new TenantSuspendedError(tenantId)

    // Scoped on the tenant's own primary key.
    await tx.tenant.update({ where: { id: tenantId }, data })

    const previous: Partial<Record<MutableTenantField, string | null>> = {}
    for (const field of Object.keys(data) as MutableTenantField[]) {
      previous[field] = before[field]
    }

    await appendAudit(tx, {
      tenantId,
      schoolId: PLATFORM_AUDIT_SCOPE,
      userId: null,
      operatorId: context.operatorId,
      action: 'TENANT_UPDATE',
      entity: 'tenant',
      entityId: tenantId,
      description: `Tenant updated by ${context.operatorEmail}: ${Object.keys(data).join(', ')}`,
      changes: { from: previous, to: data },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    const tenant = await readTenant(tx, tenantId)
    if (!tenant) return null
    return { tenant, previous }
  })
}

/**
 * Suspends or reactivates a tenant, and records which way it moved.
 *
 * Flips `isActive` and nothing else. Suspension is never a delete: `tools/tenant-cli`
 * makes the same promise about its own `suspend`, and a control plane whose "off
 * switch" destroys a school's academic year is not an off switch.
 *
 * The one function in this module that does NOT check `isActive`, and the reason
 * is the whole point of the flag: this is how a suspended tenant comes back. A gate
 * here would make `PATCH {"isActive": true}` a 403 and the console's documented
 * recovery path a dead end. Every other write in this module refuses against a
 * suspended tenant precisely so that this one remains the only way through.
 */
export async function setTenantActive(
  tenantId: string,
  isActive: boolean,
  context: TenantMutationContext,
): Promise<{ previous: boolean; tenant: TenantDetail } | null> {
  return prisma.$transaction(async (tx) => {
    // Scoped on the tenant's own primary key.
    const before = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { isActive: true },
    })
    if (!before) return null

    // Scoped on the tenant's own primary key.
    await tx.tenant.update({ where: { id: tenantId }, data: { isActive } })

    await appendAudit(tx, {
      tenantId,
      schoolId: PLATFORM_AUDIT_SCOPE,
      userId: null,
      operatorId: context.operatorId,
      action: isActive ? 'TENANT_REACTIVATE' : 'TENANT_SUSPEND',
      entity: 'tenant',
      entityId: tenantId,
      description: `Tenant ${isActive ? 'reactivated' : 'suspended'} by ${context.operatorEmail}`,
      // `from`/`to` rather than a bare value: an auditor asking "was it already
      // off?" needs the answer, and a no-op flip still records the attempt.
      changes: { from: before.isActive, to: isActive },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    const tenant = await readTenant(tx, tenantId)
    if (!tenant) return null
    return { previous: before.isActive, tenant }
  })
}

/**
 * Writes a dot-path into `Tenant.settings`, read-modify-write.
 *
 * The whole document is read inside the transaction and merged, so a stale tab
 * cannot erase a key it never knew about by submitting a document it fetched
 * before someone else's change.
 *
 * Refuses a suspended tenant, on the same transaction-local read and for the same
 * reason as `updateTenantFields`: a settings document is configuration a school is
 * running on, and the console's promise that suspension is the off switch is only
 * true if nothing can reconfigure the school behind it. `isActive` is selected on
 * the read the merge already performs rather than fetched again.
 */
export async function writeTenantSetting(
  tenantId: string,
  path: readonly string[],
  value: unknown,
  context: TenantMutationContext,
): Promise<Record<string, unknown> | null> {
  return prisma.$transaction(async (tx) => {
    // Scoped on the tenant's own primary key.
    const current = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { settings: true, isActive: true },
    })
    if (!current) return null
    if (!current.isActive) throw new TenantSuspendedError(tenantId)

    const before = (current.settings ?? {}) as Record<string, unknown>
    const next = setDotPath({ ...before }, path, value)

    // Scoped on the tenant's own primary key.
    await tx.tenant.update({
      where: { id: tenantId },
      data: { settings: next as Prisma.InputJsonValue },
    })

    await appendAudit(tx, {
      tenantId,
      schoolId: PLATFORM_AUDIT_SCOPE,
      userId: null,
      operatorId: context.operatorId,
      action: 'TENANT_SETTING_UPDATE',
      entity: 'tenant_settings',
      entityId: tenantId,
      description: `Tenant setting ${path.join('.')} changed by ${context.operatorEmail}`,
      changes: { from: readPath(before, path), to: value },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    return next
  })
}

/**
 * Rejects a dot-path that escapes the document: an empty segment, or a segment
 * naming `__proto__`, `constructor` or `prototype`.
 *
 * Without this, `{"__proto__": {"isActive": false}}` would be written into the
 * settings JSON and read back as an inherited property by anything that merges
 * the document — the prototype-pollution route into a control plane.
 */
export function isSafeSettingPath(path: readonly string[]): boolean {
  if (path.length === 0) return false
  return path.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '__proto__' &&
      segment !== 'constructor' &&
      segment !== 'prototype',
  )
}

function setDotPath(
  document: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path
  if (head === undefined) return document
  if (rest.length === 0) return { ...document, [head]: value }
  const child = document[head]
  const nested =
    typeof child === 'object' && child !== null && !Array.isArray(child)
      ? (child as Record<string, unknown>)
      : {}
  return { ...document, [head]: setDotPath(nested, rest, value) }
}

function readPath(document: Record<string, unknown>, path: readonly string[]): unknown {
  let cursor: unknown = document
  for (const segment of path) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}
