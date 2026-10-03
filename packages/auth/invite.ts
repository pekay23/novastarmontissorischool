import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { PLATFORM_ROLE_NAMES, type PlatformRoleName } from '@novastar/shared-types'
import { prisma } from '@novastar/database'

/**
 * Inviting an account: the one definition, two callers.
 *
 * This module used to live in `apps/portal/lib/auth/invite.ts` and was reachable
 * from exactly one route. It is here because a second caller exists — the
 * platform console, `POST /api/tenants/:tenantId/users` — and a Next.js app cannot
 * import from another Next.js app. Two copies would mean two definitions of the
 * invited state, two token formats and two privilege rules, and the console's
 * setup links would only work if the portal happened to agree with it.
 *
 * It also owns the email-token primitives, because `createInvitedUser` cannot exist
 * without them: a link the recipient follows has to be minted by the same code the
 * portal's `authorize()` hashes with, or a console-created account is unreachable.
 * `apps/portal/lib/auth/email-verification.ts` re-exports them, so the portal keeps
 * one import path and one behaviour.
 *
 * NO PRISMA CLIENT ARGUMENT — EXCEPT AN OPTIONAL ONE
 * --------------------------------------------------
 * It imports `prisma` from `@novastar/database`, because that is how every other
 * function in this package reaches the database — `getEffectivePermissions`,
 * `createDelegation`, `logAudit` all do it — and a second calling convention in one
 * package is one more thing to remember. A client parameter would also buy nothing
 * for either original caller: neither has a transaction to enlist this into, and an
 * argument that is always the same value is an argument that will eventually be a
 * *different* value.
 *
 * The one caller that does have a transaction is the portal's staff-account route,
 * which has to write the `User` and the `Staff` row together or not at all: a login
 * with no staff profile cannot sign in usefully, and a staff profile with no login
 * cannot sign in at all, so either half is a support call. It passes its
 * transaction client through the optional second parameter below.
 *
 * The parameter is trailing, optional and defaulted, so every existing call site
 * keeps working unchanged and continues to use the module `prisma`. That is the
 * whole compatibility contract: adding the ability to enlist in a transaction, not
 * changing what happens when nobody does.
 */

// ============================================================================
// Privilege ceiling
// ============================================================================

/**
 * How much authority each seeded role carries, highest first.
 *
 * WHY A TABLE AT ALL
 * ------------------
 * Without one, "may this caller grant that role?" has no answer, and the answer
 * every implementation reaches for by default is "yes" — which is how an
 * `ADMIN_STAFF` account (student and communication reads) came to be able to mint a
 * `HEADMASTER` and take the school over. The ceiling is what makes the invite
 * function safe to expose to anyone beyond a Head of School.
 *
 * HOW THE ORDER WAS CHOSEN
 * ------------------------
 * By breadth of grant in `ROLE_GRANT_RULES` (`packages/shared-types/permission-keys.ts`):
 * HEADMASTER takes the whole catalog; ASSISTANT_HEAD takes everything outside the
 * `system` category and without a `delete` verb; HEAD_TEACHER and CLASSROOM_TEACHER
 * take the academic, student and communication families, the Head of School in full
 * and the classroom teacher minus promotion and grading edits; ACCOUNTANT takes
 * finance and reports; ADMIN_STAFF takes two student keys and one communication key;
 * PARENT takes three, two of them narrowed to their own children.
 *
 * Where two roles' grants are disjoint — CLASSROOM_TEACHER and ACCOUNTANT share no
 * keys at all — the table is arbitrary, and it says so rather than implying a
 * comparison it cannot make. It does not matter: the ceiling is only consulted for a
 * caller who already holds a user-security role, and those three — HEADMASTER,
 * ASSISTANT_HEAD, ADMIN_STAFF (`USER_SECURITY_ADMIN_ROLES` in
 * `apps/portal/lib/constants/platform-roles.ts`) — are ordered unambiguously here.
 * Anything below ADMIN_STAFF never reaches this function.
 *
 * A TOTAL ORDER, NOT A SUBSET TEST
 * -------------------------------
 * "Does the caller's grant set contain the target role's?" cannot be computed from
 * `Role.permissions`, because the sets are not nested: ACCOUNTANT holds no academic
 * key and CLASSROOM_TEACHER holds no finance key, so each would fail a containment
 * test against the other in both directions. A rank is the only representation that
 * gives a stable answer for disjoint sets, and an answer that is always "no" is the
 * safe direction to be wrong in.
 */
export const ROLE_GRANT_RANK: Readonly<Record<PlatformRoleName, number>> = {
  HEADMASTER: 8,
  ASSISTANT_HEAD: 7,
  HEAD_TEACHER: 6,
  CLASSROOM_TEACHER: 5,
  ACCOUNTANT: 4,
  /*
   * `ADMISSIONS_OFFICER` sits directly above `ADMIN_STAFF` because its grant
   * rule is a strict superset: `ROLE_GRANT_RULES` gives it every `student` and
   * every `communication` permission plus `admissions:*`, where `ADMIN_STAFF`
   * gets only `student:read`, `student:create` and `communication:read`.
   *
   * Ranked low deliberately. The rank only decides who may *grant* the role, so
   * under-ranking cannot hand anyone more power — it can only stop a legitimate
   * `ASSISTANT_HEAD` from creating this account, which is a correctable mistake.
   * Over-ranking would let a caller grant a role above their own standing, which
   * is the direction that matters. Its read scope is `all`, but scope is not
   * reach: it still cannot write grades, fees or attendance.
   *
   * If `ADMISSIONS_OFFICER` is meant to outrank `HEAD_TEACHER`, this is the line
   * to change — and it must be changed here rather than at the call site, which
   * is the point of the assertion below.
   */
  ADMISSIONS_OFFICER: 3,
  ADMIN_STAFF: 2,
  PARENT: 1,
}

/**
 * Every seeded role is ranked, asserted at module load.
 *
 * A new entry in `PLATFORM_ROLE_NAMES` with no rank here would otherwise be granted
 * by nobody (fail closed, but silently) while an operator reading the seed believes
 * the new role is usable. Throwing at load turns that into an immediate, named
 * failure in every test that touches this module, which is the cheapest place to
 * discover it.
 */
for (const name of PLATFORM_ROLE_NAMES) {
  if (typeof ROLE_GRANT_RANK[name] !== 'number') {
    throw new Error(
      `Platform role "${name}" has no entry in ROLE_GRANT_RANK in packages/auth/invite.ts. ` +
        'Every seeded role must be ranked: an unranked role cannot be granted, which is safe but ' +
        'silent, and an operator has no way to tell a missing rank from a missing role row.',
    )
  }
}

/**
 * Narrow an arbitrary string to a real seeded role name, or `null`.
 *
 * Narrowing happens before anything is resolved against the database so a typo is a
 * refusal rather than a role row that matches nothing and locks its holder out on
 * first sign-in. The names come from `PLATFORM_ROLE_NAMES`, which is the platform's
 * own vocabulary — there are several other role-name lists in this repository and
 * this one is the one the seed and the permission catalog agree with.
 */
export function parsePlatformRoleName(value: string | null | undefined): PlatformRoleName | null {
  if (!value) return null
  const match = PLATFORM_ROLE_NAMES.find((name) => name === value)
  return match ?? null
}

/**
 * Who is asking for an account.
 *
 * Two kinds, and the distinction is the whole point: a platform operator belongs to
 * no school and holds no school role, so there is nothing above it in this table to
 * be capped by, while a school user is capped by their own rank.
 */
export type GrantAuthority =
  | {
      /** A `PlatformOperator` row in `apps/super-admin`. Belongs to no tenant. */
      readonly kind: 'platform-operator'
    }
  | {
      /** A portal `User`, identified by their role in their own school. */
      readonly kind: 'school-role'
      readonly roleName: string | null
    }

/**
 * Whether `authority` may mint an account holding `targetRoleName`.
 *
 * A platform operator may grant any seeded school role. That is not a hole and it is
 * deliberate: the operator's authority over tenants is total by construction — it can
 * already create a tenant, its school and its first administrator through
 * `tenant:provision` — so a ceiling on a ceiling would only stop the console from
 * doing the job it exists to do. What a platform operator must never do is act
 * *outside* a tenant it has scoped to, and that is enforced by the callers: every
 * one of them derives `tenantId` and `schoolId` from its own verified context rather
 * than from the request, and `createInvitedUser` will only resolve a role inside
 * exactly those two.
 *
 * A school user may grant at or below their own rank. Both directions fail closed: a
 * caller whose role is unrecognised (rank undefined) grants nothing, and a target
 * that is not a seeded role name never arrives here because it was narrowed first.
 */
export function mayGrantRole(authority: GrantAuthority, targetRoleName: PlatformRoleName): boolean {
  if (authority.kind === 'platform-operator') return true
  const callerRole = parsePlatformRoleName(authority.roleName)
  if (!callerRole) return false
  return ROLE_GRANT_RANK[callerRole] >= ROLE_GRANT_RANK[targetRoleName]
}

// ============================================================================
// One-time email tokens
// ============================================================================

/**
 * Prefix on the raw token. Two jobs: it makes the value self-describing in a
 * support log without revealing anything, and it guarantees the token can never be
 * confused with the passkey bridge token (`pk_`), which `authorize()` routes to a
 * different branch entirely.
 */
const TOKEN_PREFIX = 'vem_'

/** 32 bytes of CSPRNG output, base64url. */
const TOKEN_BYTES = 32

/**
 * 24 hours.
 *
 * Long enough that someone who does not read email at lunch can still use the link
 * that evening, short enough that a link forwarded months later is not a live
 * credential. The column pair (`verifyToken` / `verifyTokenExpires`) exists precisely
 * so this deadline is stored next to the token rather than inferred.
 */
export const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** Expiry expressed in hours, for the "this link expires in …" line in the email. */
export const EMAIL_TOKEN_TTL_HOURS = EMAIL_TOKEN_TTL_MS / (60 * 60 * 1000)

/**
 * The stored form of a raw token.
 *
 * A SHA-256 digest rather than the token itself, which is what makes storing it in
 * `User.verifyToken` safe: a database read — a backup, a replica, a support query —
 * yields digests that are not themselves credentials. SHA-256 is the right primitive
 * and not a password hash, because the input is 256 bits of CSPRNG output rather than
 * a guessable secret: there is no search for an attacker to slow down.
 *
 * `authorize()` applies the identical transform to the value it receives before
 * looking the row up, which is the only reason a link minted here resolves there.
 */
export function hashEmailToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Whether a string has the shape of a token this module issued. */
export function isEmailToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length === TOKEN_PREFIX.length + 43
}

/** Mints a fresh raw token. Never persisted, never logged. */
export function mintEmailToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * Issues a token for a user, replacing any token already outstanding.
 *
 * Overwriting rather than accumulating is deliberate: the column is unique, and "the
 * newest link always works, older ones say they were superseded" is a better model
 * than a user holding three live links for the same account.
 *
 * `client` is the optional enlistment point: pass a transaction client and the token
 * is written inside that transaction, so an account whose creation rolls back carries
 * no live credential.
 */
export async function issueEmailToken(
  userId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<{ token: string; expiresAt: Date }> {
  const token = mintEmailToken()
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS)

  await client.user.update({
    where: { id: userId },
    data: { verifyToken: hashEmailToken(token), verifyTokenExpires: expiresAt },
  })

  return { token, expiresAt }
}

/** Absolute URL a recipient follows. Built server-side so the token never round-trips a form. */
export function emailActionUrl(origin: string, path: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/${path.replace(/^\//, '')}?token=${encodeURIComponent(token)}`
}

/** The deadline stated in the invitation email. */
export const INVITE_TOKEN_TTL_HOURS = EMAIL_TOKEN_TTL_HOURS

// ============================================================================
// The invited account
// ============================================================================

export interface CreateInvitedUserInput {
  /** From the caller's own scope, never from the request body. */
  tenantId: string
  /** From the caller's own scope, never from the request body. */
  schoolId: string
  /**
   * A role *name*, resolved below against this tenant and school.
   *
   * Not a `roleId`, and that is the load-bearing part of the signature. `Role.id` is
   * a cuid with no relationship to the role's grants, so accepting one would let a
   * caller name a role that exists in another school or another tenant, or one whose
   * name means nothing here, and the account would be created with it regardless. A
   * name is checked against the seeded vocabulary and then looked up under
   * `{ tenantId, schoolId, name }`, so the role a caller can grant is the role their
   * own scope contains.
   */
  roleName: string
  email: string
  name?: string | null
  /** Who is asking. Caps what `roleName` may be. */
  authority: GrantAuthority
}

export interface InviteResult {
  userId: string
  /** The resolved role, so a caller can report what was actually granted. */
  roleId: string
  roleName: PlatformRoleName
  /** Normalised: trimmed and lowercased, which is how the row is stored. */
  email: string
  /** The raw, single-use setup token. Returned so it can be emailed, never logged. */
  token: string
  expiresAt: Date
}

/** Why an invite was refused. A route maps these onto its own status codes. */
export type InviteFailure =
  | 'invalid-email'
  | 'unknown-role'
  | 'role-out-of-scope'
  | 'role-not-in-school'
  | 'duplicate'

export class InviteError extends Error {
  readonly reason: InviteFailure

  constructor(reason: InviteFailure, message: string) {
    super(message)
    this.name = 'InviteError'
    this.reason = reason
  }
}

/** 320 is the RFC 5321 maximum length of a forward path. */
const MAX_EMAIL_LENGTH = 320

/**
 * A deliberately loose shape check, not a parser.
 *
 * Both callers already validate with zod before reaching here; this exists so the
 * invariant does not depend on that, because "the caller validated it" is not a
 * property of this function. It rejects the shapes that are certainly wrong — no
 * `@`, whitespace, nothing after the `@`, over the length limit — and normalises to
 * lowercase, which is what `User.email` is compared on.
 */
function normaliseEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) {
    throw new InviteError('invalid-email', 'Provide a valid email address.')
  }
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1 || /\s/.test(email)) {
    throw new InviteError('invalid-email', 'Provide a valid email address.')
  }
  return email
}

/**
 * Creates an account in the invited state and mints its one-time setup link.
 *
 * THE STATE, AND WHY EACH FIELD IS SET
 * -----------------------------------
 * `passwordHash: null`       the person has not chosen a password yet, so there is
 *                             nothing to verify. It also makes the sign-in path refuse
 *                             them, which is correct for an account that is not usable
 *                             yet.
 * `mustChangePassword: true` the only password they will ever have is the one they
 *                             set themselves, so the "change your temporary password"
 *                             prompt has nothing to do afterwards.
 * `emailVerified: null`      the setup link is the verification. Marking it now would
 *                             claim control of an address nobody has proved.
 * `status: 'ACTIVE'`         a new row's default, stated here because the whole flow
 *                             depends on it: the sign-in path refuses anything that is
 *                             not ACTIVE.
 *
 * NO PASSWORD IS EVER EMAILED OR ACCEPTED. There is no field for one. The link is the
 * credential, so a mailbox — including one under a forwarding rule — holds nothing
 * that needs rotating.
 *
 * ORDER OF CHECKS
 * ---------------
 * Cheap, non-database refusals first, and the privilege ceiling *before* the role
 * lookup. That ordering is deliberate: an escalation attempt must not learn whether
 * the role it asked for exists, or the ceiling becomes an oracle for enumerating a
 * school's roles.
 *
 * Two writes rather than one: the token format, its TTL and its hashing all live in
 * `issueEmailToken`, and reusing that single definition is worth more here than saving
 * one round-trip. A second invitation for the same person is refused as a duplicate
 * rather than silently reissuing the first person's link, so the previous behaviour —
 * "latest link wins" — is gone on purpose: overwriting a live token would strand an
 * account whose first link was already in flight.
 *
 * `client` is optional and defaults to the module `prisma`, which is what both original
 * callers rely on. A caller with a transaction passes it so the whole invited state —
 * the row and its token — commits or rolls back with whatever else the caller is
 * writing. The privilege ceiling below is evaluated identically either way, so
 * enlisting in a transaction grants no authority the default path would refuse.
 */
export async function createInvitedUser(
  input: CreateInvitedUserInput,
  client: Prisma.TransactionClient = prisma,
): Promise<InviteResult> {
  const email = normaliseEmail(input.email)

  const roleName = parsePlatformRoleName(input.roleName)
  if (!roleName) {
    throw new InviteError('unknown-role', `"${input.roleName}" is not a platform role name.`)
  }

  if (!mayGrantRole(input.authority, roleName)) {
    throw new InviteError(
      'role-out-of-scope',
      `Your role may not create an account holding ${roleName}.`,
    )
  }

  // Scoped to this tenant and school, so a caller cannot reach a role row that
  // belongs to somebody else even by naming it.
  const role = await client.role.findFirst({
    where: { tenantId: input.tenantId, schoolId: input.schoolId, name: roleName },
    select: { id: true },
  })
  if (!role) {
    throw new InviteError('role-not-in-school', `No ${roleName} role exists in this school.`)
  }

  // `@@unique([tenantId, email])` is the real constraint; this read exists so the
  // refusal is a message about the duplicate rather than a Prisma error, and the
  // catch below is what makes it correct under concurrency.
  const existing = await client.user.findFirst({
    where: { tenantId: input.tenantId, email },
    select: { id: true },
  })
  if (existing) {
    throw new InviteError('duplicate', 'An account with that email address already exists.')
  }

  const user = await insertInvitedRow(
    {
      tenantId: input.tenantId,
      schoolId: input.schoolId,
      roleId: role.id,
      email,
      name: input.name ?? null,
      passwordHash: null,
      emailVerified: null,
      mustChangePassword: true,
      isActive: true,
      status: 'ACTIVE',
    },
    client,
  )

  const { token, expiresAt } = await issueEmailToken(user.id, client)

  return { userId: user.id, roleId: role.id, roleName, email, token, expiresAt }
}

/**
 * The insert, with the unique-constraint violation folded into the same `duplicate`
 * refusal as the read above.
 *
 * The read is the one that produces a good message; this is the one that is actually
 * correct. Two requests for the same address both pass it, and what settles it is
 * `@@unique([tenantId, email])`. Matched on the error `code` rather than with
 * `instanceof PrismaClientKnownRequestError`, because this package is loaded through
 * three different bundlers — the portal, the console and the tests — and an
 * `instanceof` against a class that was instantiated in another bundle is false.
 */
async function insertInvitedRow(
  data: {
    tenantId: string
    schoolId: string
    roleId: string
    email: string
    name: string | null
    passwordHash: null
    emailVerified: null
    mustChangePassword: boolean
    isActive: boolean
    status: 'ACTIVE'
  },
  client: Prisma.TransactionClient = prisma,
): Promise<{ id: string }> {
  try {
    return await client.user.create({ data, select: { id: true } })
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'P2002'
    ) {
      throw new InviteError('duplicate', 'An account with that email address already exists.')
    }
    throw error
  }
}

/**
 * Absolute one-time setup link, built server-side so the token never round-trips a form.
 */
export function inviteActionUrl(origin: string, token: string): string {
  return emailActionUrl(origin, 'set-password', token)
}