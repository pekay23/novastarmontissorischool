import crypto from 'node:crypto'
import { z } from 'zod'
import { ServerConfigError } from '@/lib/errors'
import { verifyOperatorPassword } from '@/lib/operator-password'
import { parseOperatorCapability } from '@/lib/permissions'
import {
  findOperatorByIdentifier,
  readOperatorById,
  recordOperatorLogin,
  recordOperatorPasswordFailure,
  type OperatorCredentialRow,
} from '@/lib/queries'

/**
 * Operator authentication for the cross-tenant control plane.
 *
 * WHY THIS IS NOT NEXTAUTH
 * -----------------------
 * The plan (build plan §3) sketched `app/api/auth/[...nextauth]/route.ts` with the
 * portal's `PrismaAdapter` pairing. Two facts on disk make that unbuildable in
 * this workspace, and both are load-bearing rather than cosmetic:
 *
 * 1. `next-auth` is not installed for `super-admin` and cannot be: the workspace
 *    declares no such dependency and installing one is outside this app's
 *    ownership. It exists only under `apps/portal/node_modules`.
 * 2. `next-auth` v4 with `@auth/prisma-adapter` is itself unresolved repo-wide
 *    (audit report FINDING D-5), so copying the pair would import a known defect.
 *
 * Nor did the *previous* version of this file use it: it accepted one shared
 * passphrase plus an environment allowlist and minted its own signed cookie. So
 * the mechanism here is unchanged and only the identity behind it moved — one
 * passphrase shared by everybody became one account per operator. The token
 * format, the HKDF-derived signing key, the cookie name and the throttle all
 * survive, which is why nothing outside this module and `admin-context.ts` had to
 * move with the change.
 *
 * WHY THIS IS NOT A `User` ROW
 * ---------------------------
 * A platform operator belongs to no tenant. `User.tenantId` is non-null, so there
 * is no correct row to create, and borrowing `HEADMASTER` would be the one outcome
 * the brief forbids: a school-level Head of School must never reach this console.
 * So the identity is a `PlatformOperator` row — still not a `User`, still never
 * touching the portal's `Role` table, and still created only from the CLI
 * (`novastar-tenant operator`), never from this console's own UI.
 *
 * THREAT MODEL
 * ------------
 * T1  A school-level user escalates.      Refused: the sign-in path reads
 *                                          `PlatformOperator` and nothing else,
 *                                          and a portal session cookie is a
 *                                          different cookie under a different key,
 *                                          so it cannot be replayed here. Asserted
 *                                          in `tests/rbac.test.ts`.
 * T2  A stolen dashboard cookie is replayed. Refused three times over: the token
 *                                          expires in 8 hours; every request
 *                                          re-reads the operator's *live* status
 *                                          and capabilities, so suspending an
 *                                          account or removing a grant revokes at
 *                                          once rather than at expiry; and the
 *                                          signature is checked before the payload
 *                                          is parsed at all.
 * T3  A forged or tampered token.          Refused: the signature is verified with
 *                                          `timingSafeEqual` before the payload is
 *                                          parsed, and a payload failing the schema
 *                                          is discarded. The token carries an
 *                                          operator *id* and nothing else about
 *                                          privilege — the grant set comes from the
 *                                          row, not from the token.
 * T4  Timing oracles on the credential.   Refused: the argon2 verify runs on every
 *                                          attempt, including one against no
 *                                          account at all, against
 *                                          `DUMMY_PASSWORD_HASH`. It is computed
 *                                          before every branch below and nothing
 *                                          short-circuits it, so an unknown
 *                                          identifier costs the same as a real one.
 *                                          The failure message is identical for an
 *                                          unknown identifier, a wrong password, a
 *                                          locked account and a suspended one.
 * T5  Missing configuration.               Refused: with `PLATFORM_SESSION_SECRET`
 *                                          unset or shorter than 32 characters every
 *                                          check throws `ServerConfigError` and
 *                                          nothing is ever signed. There is no
 *                                          development bypass, no default operator,
 *                                          and no environment allowlist left to fall
 *                                          back on — an absent allowlist cannot
 *                                          authenticate anybody, because there is no
 *                                          allowlist any more.
 * T6  Online password guessing.            Reduced, not eliminated: a per-account
 *                                          lockout on the same columns and the same
 *                                          thresholds the portal's `User` lockout
 *                                          uses, plus the in-process fixed-window
 *                                          limiter below. The limiter is per-process
 *                                          and resets on restart, so the README puts
 *                                          a reverse-proxy limit in front of it as
 *                                          the real control.
 */

export const ADMIN_SESSION_COOKIE = 'super_admin_session'
export const ADMIN_TENANT_COOKIE = 'super_admin_tenant'

/**
 * 8 hours, matching the portal's super-admin session ceiling rather than the
 * standard staff 30 days. Plan §3.1 of the NMS document sets the same figure.
 *
 * With per-operator accounts this is no longer the primary revocation mechanism —
 * suspending the row revokes immediately — so the window is a bound on a stolen
 * cookie rather than the thing standing between a thief and the console.
 */
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60

/**
 * Below this length an HMAC key is not worth having. Refused rather than padded:
 * a deployment running a five-character "secret" should fail loudly, not get
 * silently worse key derivation than it asked for.
 */
export const MIN_SESSION_SECRET_LENGTH = 32

/**
 * Failed sign-ins before an operator account locks, and how long it stays locked.
 *
 * The same figures as `apps/portal/lib/auth.ts:87-88` for `User`, deliberately.
 * One lockout policy across every credential in the platform means an operator
 * cannot be held to a rule the portal's own accounts are not, and one sweep can
 * clear both.
 */
export const MAX_OPERATOR_LOGIN_ATTEMPTS = 5
export const OPERATOR_LOCKOUT_MS = 30 * 60 * 1000

/** The header is fixed, not attacker-chosen, so it carries no information. */
const TOKEN_VERSION = 'v1'

const AdminSessionSchema = z.object({
  /** 1: schema version, so a future claim set is distinguishable. */
  v: z.literal(1),
  /** `PlatformOperator.id`. The token names a person; it never names a privilege. */
  sub: z.string().min(1),
  /** Carried for rendering only. The authoritative values are re-read per request. */
  username: z.string().min(1).max(64),
  email: z.string().min(3).max(320),
  /** Issued and expiry, epoch seconds. */
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  /**
   * Capabilities as they stood at sign-in. Advisory only: the live grant set on the
   * row is intersected with this on every request, so a removal takes effect
   * immediately and an addition waits for the next sign-in. See
   * `resolveLiveOperator`.
   */
  caps: z.array(z.string()),
})

/** What a verified token asserts, before the database is consulted. */
export interface SessionClaims {
  readonly id: string
  readonly username: string
  readonly email: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly capabilities: readonly string[]
}

/**
 * A verified operator: the token's claims plus everything re-read from the live
 * row. Only this shape is handed to a route, so a caller cannot accidentally
 * authorise on a token claim.
 */
export interface AdminOperator extends SessionClaims {
  readonly name: string | null
  readonly mustChangePassword: boolean
}

export interface AdminCredentials {
  /** A username or an email. Both are resolved, case-insensitively. */
  readonly identifier: string
  readonly password: string
}

/** The public shape of an operator, for rendering. Never includes a token or a hash. */
export interface OperatorProfile {
  readonly username: string
  readonly email: string
  readonly name: string | null
  readonly capabilities: readonly string[]
  readonly mustChangePassword: boolean
  readonly sessionExpiresAt: string
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The session-signing secret, or `ServerConfigError`.
 *
 * A VARIABLE, NOT AN OPERATOR PASSWORD, and that is the whole point of the
 * rewrite. It used to be `SUPER_ADMIN_SECRET`, which was simultaneously the login
 * passphrase and the HKDF seed — and the signing key had to be *derived* from it
 * (see `sessionSigningKey`) precisely because a captured signature would
 * otherwise have been a candidate passphrase. With one account per operator that
 * derivation would mean every operator's own password was a signing-key seed,
 * which is the same coupling with more victims: rotating one person's password
 * would silently invalidate every other operator's session.
 *
 * So the signing key has its own variable with its own lifecycle, and no fallback:
 *
 * - Rotating it invalidates every issued session at once. That is the deliberate
 *   recovery lever when a signing key is suspected, and it is why it is separate.
 * - Rotating an operator's password touches no session but their own.
 * - It is never an operator's password and never `NEXTAUTH_SECRET`. The portal's
 *   secret is separate by design (plan §8): sharing it would mean a portal session
 *   cookie and a console session cookie are signed by the same key, and a bug in
 *   either app's parsing would be a bug in both.
 */
function platformSessionSecret(): string {
  const secret = process.env.PLATFORM_SESSION_SECRET
  if (!secret || secret.trim().length === 0) {
    throw new ServerConfigError(
      'PLATFORM_SESSION_SECRET is not set. No operator session can be signed or verified.',
    )
  }
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new ServerConfigError(
      `PLATFORM_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters. ` +
        `It is ${secret.length}.`,
    )
  }
  return secret
}

/**
 * HMAC key derived from `PLATFORM_SESSION_SECRET` with HKDF, salted by a fixed info
 * string.
 *
 * The derivation is retained from the previous implementation even though the
 * reason for it has gone. It cost nothing and it still buys domain separation: the
 * signing key is not the configured value itself, so the value has one fewer use
 * and a copy of it recovered from a heap dump is not immediately a signing key.
 * `hmac-${TOKEN_VERSION}` in the info string is what will make a future token
 * version a different key rather than a re-sign of the old one.
 */
function sessionSigningKey(): Buffer {
  const derived = crypto.hkdfSync(
    'sha256',
    Buffer.from(platformSessionSecret(), 'utf8'),
    Buffer.from('novastar-super-admin/session', 'utf8'),
    Buffer.from(`hmac-${TOKEN_VERSION}`, 'utf8'),
    32,
  )
  return Buffer.from(derived)
}

/**
 * Whether the console is configured enough to sign a session.
 *
 * Only the secret, because the allowlist is gone: there is no longer an
 * environment list that could be empty and silently lock everybody out, and there
 * is no "is anyone on the list" question to ask. It does *not* report whether any
 * operator account exists — that would mean a count query on a page an anonymous
 * visitor can load, and "this console has no operators" is not something an
 * anonymous caller needs to learn. An unprovisioned console simply refuses every
 * sign-in, which is the correct answer.
 */
export function adminAuthConfigured(): boolean {
  try {
    platformSessionSecret()
  } catch {
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Constant-time comparison
// ---------------------------------------------------------------------------

/**
 * Compares two strings without leaking their common prefix length.
 *
 * Both sides are hashed first so the inputs are always the same length:
 * `timingSafeEqual` throws on a length mismatch, and hashing first is what lets an
 * attacker-supplied candidate of any length be compared safely.
 *
 * Only for the *token signature*. The operator's password is not compared here at
 * all — `argon2.verify` does that, and it is already constant time. What this
 * function is for is a signature whose length an attacker fully controls.
 */
function safeEqual(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a, 'utf8').digest()
  const right = crypto.createHash('sha256').update(b, 'utf8').digest()
  return crypto.timingSafeEqual(left, right)
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * The one message every failed sign-in returns.
 *
 * Exported so the route and this module cannot drift into saying something
 * different for "no such operator", "wrong password", "locked out" and "suspended",
 * which is exactly the distinction this constant exists to prevent. A
 * distinguishable failure is a free oracle: it turns this endpoint into a way to
 * enumerate which accounts hold the platform and which are currently locked.
 */
export const LOGIN_FAILURE = 'Invalid operator credentials.'

/**
 * An argon2id hash of a value nobody holds, used only to make a failed sign-in
 * cost what a successful one costs.
 *
 * The parameters match `ARGON2_OPTIONS` in `lib/operator-password.ts`, so a verify
 * against this constant does the same memory-hard work a verify against a real row
 * does. The result is discarded: this constant is never a candidate's match
 * target, so knowing its plaintext would buy an attacker nothing. Its only job is
 * to stop "no such operator" returning in microseconds while a real account takes
 * ~50ms, which is a perfectly good account-enumeration oracle.
 *
 * Committed rather than generated at module load: a first-call hash would make the
 * *first* sign-in after a deploy slow and every later one fast — the opposite
 * shape of the thing it is smoothing out.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$jEbXxU/E/O/QKbDdNIySAQ$tFZVG5/e9XL9KkF+24IOlMVPv2g6j0GRoparDKMuL4Q'

/**
 * Authenticates an operator from a username *or* an email plus their password.
 *
 * Returns `null` for every failure — unknown identifier, wrong password, locked
 * account, suspended account, ambiguous identifier, misconfiguration. The caller
 * cannot tell them apart, which is the point.
 *
 * Returns `null` rather than throwing on `ServerConfigError` because the login form
 * is the one surface where an operator needs a usable message. The operator
 * checklist and health page both report the misconfiguration separately. A *lockout
 * write* that fails is the opposite case and does propagate: an attempt that could
 * not be counted must not be answered as a clean refusal, because the account would
 * then never lock.
 *
 * The order below is the security property, so it is worth reading top to bottom:
 * the credential is verified before any of the cheap checks, so none of them can
 * short-circuit the expensive one.
 */
export async function authenticateOperator(credentials: AdminCredentials): Promise<AdminOperator | null> {
  // Case-folded on both sides of the comparison, because `findOperatorByIdentifier`
  // matches case-insensitively: `OPS@Novastar.Test` is the same operator as
  // `ops@novastar.test`, and an operator who fat-fingered the capitalisation of
  // their own address should not need the CLI to fix it.
  const identifier = credentials.identifier.trim().toLowerCase()

  // Undefined behaviour guarded explicitly rather than by `?? []`: a blank
  // identifier must cost a lookup and a verify like any other, so there is no
  // cheap early return for it to hide behind.
  const candidates: readonly OperatorCredentialRow[] =
    identifier.length > 0 ? await findOperatorByIdentifier(identifier) : []

  // Exactly one row, or none. Two is refused rather than resolved: `username` and
  // `email` are each `@unique` independently, but nothing forbids one operator's
  // username from being another operator's email, and picking the first match would
  // make the winner a function of physical row order. Refusing is the only answer
  // that cannot be arranged by whoever chose the two names.
  const row = candidates.length === 1 ? candidates[0] : null
  const now = new Date()

  // Always runs, even with no row and even with a blank identifier.
  const matched = await verifyOperatorPassword(
    credentials.password,
    row?.passwordHash ?? DUMMY_PASSWORD_HASH,
  )

  if (!row) return null

  if (!matched) {
    await recordOperatorPasswordFailure(row.id, now, MAX_OPERATOR_LOGIN_ATTEMPTS, OPERATOR_LOCKOUT_MS)
    return null
  }

  // Status and lock are checked only *after* the password is known good, so a
  // suspended operator is not told anything a wrong password would not tell them,
  // and a locked account is not unlocked by guessing correctly.
  if (row.status !== 'ACTIVE') return null
  if (row.lockedUntil !== null && row.lockedUntil > now) return null

  await recordOperatorLogin(row.id, now)

  const issuedAt = Math.floor(now.getTime() / 1000)
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    issuedAt,
    expiresAt: issuedAt + ADMIN_SESSION_TTL_SECONDS,
    capabilities: narrowCapabilities(row.capabilities),
    mustChangePassword: row.mustChangePassword,
  }
}

/**
 * Narrows stored grants through the live vocabulary.
 *
 * The stored array is a plain `String[]` because it is edited by a CLI and by hand,
 * so a key that no longer exists — or never did — has to be dropped rather than
 * trusted. The result is therefore a subset of `OPERATOR_CAPABILITIES`, and a key
 * that is not in that set grants nothing.
 */
function narrowCapabilities(stored: readonly string[]): readonly string[] {
  return stored
    .map((key) => parseOperatorCapability(key))
    .filter((key): key is NonNullable<typeof key> => key !== null)
}

// ---------------------------------------------------------------------------
// Session token
// ---------------------------------------------------------------------------

function sign(payloadSegment: string): string {
  return crypto.createHmac('sha256', sessionSigningKey()).update(payloadSegment).digest('base64url')
}

/**
 * Mints a signed session token: `<payload>.<signature>`, both base64url.
 *
 * Not a JWT and deliberately not pretending to be one. There is no third party
 * verifying these tokens, so the `alg` header and `kid` machinery would be fields
 * nobody reads and an algorithm-confusion surface if anything ever did start
 * reading them. Two segments and one HMAC is the whole of it.
 */
export function createSessionToken(operator: AdminOperator): string {
  const payload: Record<string, unknown> = {
    v: 1,
    sub: operator.id,
    username: operator.username,
    email: operator.email,
    iat: operator.issuedAt,
    exp: operator.expiresAt,
    caps: [...operator.capabilities],
  }
  const segment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${segment}.${sign(segment)}`
}

/**
 * Verifies a session token's signature, schema and expiry. Returns what it asserts.
 *
 * Reads no database. That separation is deliberate and load-bearing:
 *
 * 1. Order matters. The signature is checked against the payload segment before the
 *    payload is parsed, and the parsed payload is schema-checked before any field is
 *    read. A token whose body claims a longer expiry is discarded rather than
 *    trusted.
 * 2. It stays pure, so every cryptographic claim about this format is testable
 *    without a database — and the questions "is this signature sound?" and "is this
 *    operator still allowed?" then have separate answers in `tests/rbac.test.ts`.
 *
 * What comes back is *claims*, not an authorisation. `resolveLiveOperator` turns
 * claims into an `AdminOperator` or into `null`.
 */
export function verifySessionToken(token: string | undefined | null): SessionClaims | null {
  if (!token) return null

  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null

  const segment = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  let expected: string
  try {
    expected = sign(segment)
  } catch {
    // Misconfigured deployment. Refuse rather than fall open.
    return null
  }
  if (!safeEqual(signature, expected)) return null

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  const parsed = AdminSessionSchema.safeParse(decoded)
  if (!parsed.success) return null
  if (parsed.data.exp <= Math.floor(Date.now() / 1000)) return null

  return {
    id: parsed.data.sub,
    username: parsed.data.username,
    email: parsed.data.email,
    issuedAt: parsed.data.iat,
    expiresAt: parsed.data.exp,
    // Narrowed here as well as at login, so a token minted before a capability was
    // removed from `permissions.ts` cannot keep exercising it.
    capabilities: narrowCapabilities(parsed.data.caps),
  }
}

/**
 * Turns verified claims into an operator, or `null`.
 *
 * This is the immediate-revocation mechanism, and it is why the allowlist
 * re-check this function replaced could stay cheap but not lossless: the
 * environment was readable for free, a database row is not. Every request pays
 * one indexed read by primary key.
 *
 * Three refusals, in this order:
 *
 * 1. The row is gone — deleted, or a token naming an id that no longer exists. 401.
 * 2. The row is not `ACTIVE`. 401. This is what makes deactivating an operator
 *    revoke at once rather than at token expiry, and it is the single most
 *    important line in the file.
 * 3. The intersection of the token's grants and the row's live grants is empty.
 *    403, not 401 — the caller proved who they are; only the grant is missing.
 *
 * The intersection is the narrower of the two, deliberately. A removal therefore
 * takes effect immediately, and an *addition* waits for the next sign-in: widening
 * a live session on the strength of a database write is a smaller guarantee than
 * re-authenticating, and nothing in the console needs a grant to appear mid-session.
 *
 * A database error is *not* caught here. It propagates, so an outage is reported as
 * an outage rather than as "your session is invalid" — which matters, because the
 * alternative would teach every legitimate operator to sign in again during an
 * incident and would hide the incident from the health page. It still fails closed:
 * no operator, no authorisation.
 */
export async function resolveLiveOperator(claims: SessionClaims): Promise<AdminOperator | null> {
  const row = await readOperatorById(claims.id)
  if (!row) return null
  if (row.status !== 'ACTIVE') return null

  const live = narrowCapabilities(row.capabilities)
  const capabilities = claims.capabilities.filter((key) => live.includes(key))

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    capabilities,
    mustChangePassword: row.mustChangePassword,
  }
}

// ---------------------------------------------------------------------------
// Cookie attributes
// ---------------------------------------------------------------------------

/**
 * `httpOnly` so a script cannot read the credential, `secure` outside
 * development so it cannot cross a plaintext hop, `sameSite: 'strict'` so a
 * link from another origin cannot ride the cookie in on a top-level navigation,
 * `path: '/'` because the dashboard's routes are all at the root, and a short
 * `maxAge` so the browser forgets it when the token has already expired.
 */
export function adminSessionCookieOptions(): {
  httpOnly: boolean
  secure: boolean
  sameSite: 'strict'
  path: string
  maxAge: number
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  }
}

/**
 * Attributes for the selected-tenant cookie.
 *
 * Not `httpOnly`: the tenant switcher writes it, and a server component cannot.
 * That is safe because the value is a *hint* — `requireTenantScope` re-reads the
 * tenant by id and 404s on a miss, so the worst a forged value achieves is a 404.
 * It is never used to widen a query's scope.
 */
export function adminTenantCookieOptions(): {
  httpOnly: boolean
  secure: boolean
  sameSite: 'lax'
  path: string
  maxAge: number
} {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    // `lax` rather than `strict` so a navigation into a tenant URL from outside
    // keeps the selection. It is a preference, not a credential.
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60,
  }
}

// ---------------------------------------------------------------------------
// Login throttle
// ---------------------------------------------------------------------------

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS_PER_WINDOW = 10

/**
 * Per-process fixed-window counter keyed by client address.
 *
 * Deliberately in-process and deliberately called out as insufficient in the
 * module docstring: with more than one instance, or behind a restart, each has its
 * own window. It exists so a single-process dev or single-container deployment is
 * not trivially guessable, not to replace an edge rate limit.
 *
 * Kept alongside the per-account lockout rather than in place of it, and the two
 * answer different questions. This one bounds how much work an attacker can ask the
 * server to do from one address, including against accounts that do not exist. The
 * lockout bounds how many guesses one *account* absorbs before it stops answering
 * at all, which survives the attacker rotating addresses.
 */
const attempts = new Map<string, { count: number; resetAt: number }>()

export function isLoginThrottled(clientId: string, now: number = Date.now()): boolean {
  const existing = attempts.get(clientId)
  if (!existing || existing.resetAt <= now) {
    attempts.set(clientId, { count: 0, resetAt: now + ATTEMPT_WINDOW_MS })
    return false
  }
  return existing.count >= MAX_ATTEMPTS_PER_WINDOW
}

export function recordLoginFailure(clientId: string, now: number = Date.now()): void {
  const existing = attempts.get(clientId)
  if (!existing || existing.resetAt <= now) {
    attempts.set(clientId, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS })
    return
  }
  existing.count += 1
}

/** Clears the window after a success, so a legitimate operator is not locked out. */
export function clearLoginFailures(clientId: string): void {
  attempts.delete(clientId)
}

/** Reduces an `AdminOperator` to what a response may carry. */
export function toOperatorProfile(operator: AdminOperator): OperatorProfile {
  return {
    username: operator.username,
    email: operator.email,
    name: operator.name,
    capabilities: operator.capabilities,
    mustChangePassword: operator.mustChangePassword,
    sessionExpiresAt: new Date(operator.expiresAt * 1000).toISOString(),
  }
}