import type { Prisma } from '@novastar/database'
import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// Projections
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
export const OPERATOR_PROFILE_SELECT = {
  id: true,
  username: true,
  email: true,
  name: true,
  status: true,
  capabilities: true,
  mustChangePassword: true,
  lastLoginAt: true,
} as const

export const OPERATOR_CREDENTIAL_SELECT = {
  ...OPERATOR_PROFILE_SELECT,
  passwordHash: true,
  loginAttempts: true,
  lockedUntil: true,
} as const

// ---------------------------------------------------------------------------
// Platform operators
// ---------------------------------------------------------------------------

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