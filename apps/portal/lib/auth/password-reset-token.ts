import 'server-only'
import crypto from 'node:crypto'
import { z } from 'zod'

/**
 * Stateless, single-use password-reset tokens.
 *
 * WHY NOT `User.verifyToken`
 * --------------------------
 * Because `verifyToken` is a *login* credential. `authorize()` in `lib/auth.ts`
 * accepts any `credentials.token` whose digest matches a stored `verifyToken` and
 * signs the holder straight in. Storing a reset token there would therefore make
 * "click this link in your email" equivalent to "you are signed in" — for a link
 * that is mailed to an address and can sit in a mailbox, a forwarding rule or a
 * proxy log for hours. `authorize()` also refuses `prt_` tokens outright, so the
 * two families cannot cross even if one is pasted into the other.
 *
 * WHY STATELESS ANYWAY
 * -------------------
 * A reset token has to be minted from nothing but the request: the person asking
 * for a reset cannot prove who they are yet. That rules out any column that could
 * carry a purpose, so the purpose, the subject and the deadline are carried in the
 * token itself and authenticated by the signature.
 *
 * THREAT MODEL
 * ------------
 * T1  Forged or edited token.      Refused: the HMAC is checked with
 *                                   `timingSafeEqual` BEFORE the payload is parsed.
 *                                   An unverifiable token's claims are never read.
 * T2  Token from another purpose.  Refused: `purpose` is a required claim and is
 *                                   schema-checked, so a token minted for any other
 *                                   flow cannot be presented here.
 * T3  Expired token.               Refused, and reported as expired so the page can
 *                                   say so instead of "invalid".
 * T4  Replay of a spent token.     Refused: the token is bound to the user's
 *                                   `passwordChangedAt` at issue time, and a
 *                                   successful reset moves that column. The second
 *                                   use of the same token therefore no longer
 *                                   matches. See `matchesPasswordGeneration`.
 * T5  `NEXTAUTH_SECRET` unset.     Every check refuses. There is no development
 *                                   bypass and no fallback key.
 *
 * The key derivation mirrors `apps/super-admin/lib/admin-auth.ts` deliberately:
 * same HKDF construction, same "separate the signing key from the shared secret"
 * reasoning, so a reader who knows one can read the other.
 */

/** Fixed, not attacker-chosen, so it carries no information. */
const TOKEN_VERSION = 'v1'

/**
 * Distinct from the passkey bridge (`pk_`) and verification (`vem_`) prefixes.
 * Checked explicitly at the login boundary so a reset link pasted into the
 * sign-in form gets a real explanation instead of "invalid token".
 */
export const PASSWORD_RESET_TOKEN_PREFIX = 'prt_'

/**
 * One hour.
 *
 * Shorter than the 24-hour verification link because this token is a step on the
 * way to changing a credential rather than a confirmation of an invitation, and
 * because mailbox-forwarding rules are much more likely to pass through a
 * "reset your password" message than an invitation.
 */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60

export const PASSWORD_RESET_TTL_HOURS = PASSWORD_RESET_TTL_SECONDS / 3600

const PasswordResetPayloadSchema = z.object({
  /** 1 or 2: schema version, so a future claim set is distinguishable. */
  v: z.literal(1),
  /** Subject of the reset. */
  sub: z.string().min(1),
  /** Purpose. Required, so no other flow's token can be replayed here. */
  purpose: z.literal('password-reset'),
  /**
   * The user's `passwordChangedAt` at issue time, epoch ms, or 0 when unset.
   *
   * This is what makes the token single-use without a database column: consuming
   * it sets `passwordChangedAt` to now, so the same token presented a second time
   * fails this equality and is refused as spent.
   */
  pca: z.number().int().nonnegative(),
  /** Issued and expiry, epoch seconds. */
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
})

export type PasswordResetClaims = z.infer<typeof PasswordResetPayloadSchema>

export type PasswordResetVerification =
  | { ok: true; claims: PasswordResetClaims }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' | 'misconfigured' }

/**
 * `NEXTAUTH_SECRET`, as key material.
 *
 * Throws when unset rather than substituting anything: an unsigned-or-weakly-signed
 * reset token is a password reset anyone can mint, so a deployment missing its
 * secret must refuse rather than fall back to a guessable key.
 */
function nextAuthSecret(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'NEXTAUTH_SECRET is not set, so no password-reset token can be signed or verified. ' +
        'Set it in .env (see .env.example).',
    )
  }
  return Buffer.from(secret, 'utf8')
}

/**
 * HMAC key derived from `NEXTAUTH_SECRET` with HKDF, salted by a fixed info
 * string.
 *
 * Domain separation is the point. `NEXTAUTH_SECRET` also signs every NextAuth
 * session cookie, so signing with it directly would mean a captured reset
 * signature is a candidate session-cookie signature and vice versa. The distinct
 * info string makes the two key streams unrelated.
 */
function signingKey(): Buffer {
  const derived = crypto.hkdfSync(
    'sha256',
    nextAuthSecret(),
    Buffer.from('novastar-portal/password-reset', 'utf8'),
    Buffer.from(`hmac-${TOKEN_VERSION}`, 'utf8'),
    32,
  )
  return Buffer.from(derived)
}

function sign(payloadSegment: string): string {
  return crypto
    .createHmac('sha256', signingKey())
    .update(payloadSegment)
    .digest('base64url')
}

/**
 * Compares two strings without leaking their common prefix length.
 *
 * Both sides are hashed first so the inputs are always the same length:
 * `timingSafeEqual` throws on a length mismatch, and hashing first lets an
 * attacker-supplied signature of any length be compared safely.
 */
function safeEqual(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a, 'utf8').digest()
  const right = crypto.createHash('sha256').update(b, 'utf8').digest()
  return crypto.timingSafeEqual(left, right)
}

/**
 * The generation a token is bound to: epoch ms of `passwordChangedAt`, or 0 when
 * the user has never set one.
 *
 * Callers pass the value read in the same request that verified the token, so the
 * comparison is against live state rather than a value carried by the token.
 */
export function passwordGenerationOf(passwordChangedAt: Date | null): number {
  return passwordChangedAt ? passwordChangedAt.getTime() : 0
}

/** Whether a token's bound generation still matches the user's current one. */
export function matchesPasswordGeneration(
  claims: PasswordResetClaims,
  passwordChangedAt: Date | null,
): boolean {
  return claims.pca === passwordGenerationOf(passwordChangedAt)
}

/**
 * Mints a reset token: `<payload>.<signature>`, both base64url.
 *
 * Not a JWT and not pretending to be one — the same reasoning as the super-admin
 * session token: no third party verifies these, so an `alg`/`kid` header would be
 * fields nobody reads and an algorithm-confusion surface if anything ever did.
 */
export function createPasswordResetToken(
  userId: string,
  passwordChangedAt: Date | null,
  now: number = Math.floor(Date.now() / 1000),
): { token: string; expiresAt: Date } {
  const payload = {
    v: 1,
    sub: userId,
    purpose: 'password-reset',
    pca: passwordGenerationOf(passwordChangedAt),
    iat: now,
    exp: now + PASSWORD_RESET_TTL_SECONDS,
  }
  const segment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { token: `${PASSWORD_RESET_TOKEN_PREFIX}${segment}.${sign(segment)}`, expiresAt: new Date(payload.exp * 1000) }
}

/**
 * Verifies a reset token.
 *
 * Order matters and is the security property: the signature is checked against
 * the payload segment before the payload is parsed, and the parsed payload is
 * schema-checked before any field is read. A token whose body claims a longer
 * expiry is discarded rather than trusted.
 *
 * `expired` is therefore only ever returned for a token with a VALID signature —
 * the claim set has been authenticated by the time it is read.
 */
export function verifyPasswordResetToken(
  token: string | undefined | null,
  now: number = Math.floor(Date.now() / 1000),
): PasswordResetVerification {
  if (!token || !token.startsWith(PASSWORD_RESET_TOKEN_PREFIX)) return { ok: false, reason: 'malformed' }

  const body = token.slice(PASSWORD_RESET_TOKEN_PREFIX.length)
  const separator = body.lastIndexOf('.')
  if (separator <= 0) return { ok: false, reason: 'malformed' }

  const segment = body.slice(0, separator)
  const signature = body.slice(separator + 1)

  let expected: string
  try {
    expected = sign(segment)
  } catch {
    // Misconfigured deployment. Refuse rather than fall open.
    return { ok: false, reason: 'misconfigured' }
  }
  if (!safeEqual(signature, expected)) return { ok: false, reason: 'bad-signature' }

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const parsed = PasswordResetPayloadSchema.safeParse(decoded)
  if (!parsed.success) return { ok: false, reason: 'malformed' }
  if (parsed.data.exp <= now) return { ok: false, reason: 'expired' }

  return { ok: true, claims: parsed.data }
}
