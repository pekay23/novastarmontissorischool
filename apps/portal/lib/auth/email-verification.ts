import 'server-only'
import { hashEmailToken, isEmailToken } from '@novastar/auth/invite'
import { prisma } from '@/lib/prisma'

/**
 * Email verification and one-time password-setup tokens.
 *
 * WHY THIS IS A HASHED, STORED TOKEN
 * ----------------------------------
 * `User.verifyToken` is the only column the schema gives us for a link the
 * recipient follows from an email, and it is the same column the existing
 * `authorize()` branch in `lib/auth.ts` already reads to complete a verification
 * sign-in. Rather than add a second mechanism, both sides use one: the
 * primitives below mint the token, and `lib/auth.ts` calls `hashEmailToken` on the
 * incoming value before looking the row up. The two therefore always agree.
 *
 * THE PRIMITIVES MOVED
 * --------------------
 * `mintEmailToken`, `hashEmailToken`, `isEmailToken`, `issueEmailToken`,
 * `emailActionUrl` and the two TTL constants now live in `@novastar/auth/invite`,
 * because `createInvitedUser` needs them and the platform console has to be able to
 * mint a link this portal can redeem. A token format defined twice is a link that
 * works from one app and 404s from the other. They are re-exported here so every
 * existing importer — including `lib/auth.ts` and the tests — keeps one import path
 * and sees no behaviour change.
 *
 * SINGLE USE
 * ----------
 * Consumption writes `verifyToken: null`, so a second use of the same link finds
 * no row. That is the entire replay defence and it is structural rather than a
 * separate consumed-token record. The consequence, which the verify-email page
 * states plainly: an already-used link and a link that was never valid are
 * indistinguishable, because nothing records that a token was ever spent.
 */

export {
  EMAIL_TOKEN_TTL_MS,
  EMAIL_TOKEN_TTL_HOURS,
  emailActionUrl,
  hashEmailToken,
  isEmailToken,
  issueEmailToken,
  mintEmailToken,
} from '@novastar/auth/invite'

export type EmailTokenFailure = 'invalid' | 'expired'

export type EmailTokenLookup =
  | { ok: true; userId: string; passwordHash: string | null; mustChangePassword: boolean }
  | { ok: false; reason: EmailTokenFailure }

/**
 * Resolves a raw token to its user, and says which of the two failures it was.
 *
 * Expiry is reported separately from "no such token" because the recipient can
 * act on it — request a new link — whereas a genuinely wrong token gets the same
 * advice anyway, so nothing is disclosed by the distinction.
 *
 * Status is NOT checked here. A suspended account should still be told its link
 * is dead rather than be silently redirected to a sign-in that will also refuse
 * it, and the consuming routes are the right place to decide that.
 */
export async function lookupEmailToken(token: string): Promise<EmailTokenLookup> {
  if (!isEmailToken(token)) return { ok: false, reason: 'invalid' }

  const user = await prisma.user.findUnique({
    where: { verifyToken: hashEmailToken(token) },
    select: {
      id: true,
      passwordHash: true,
      mustChangePassword: true,
      verifyTokenExpires: true,
    },
  })

  if (!user) return { ok: false, reason: 'invalid' }
  if (user.verifyTokenExpires && user.verifyTokenExpires < new Date()) {
    return { ok: false, reason: 'expired' }
  }

  return {
    ok: true,
    userId: user.id,
    passwordHash: user.passwordHash,
    mustChangePassword: user.mustChangePassword,
  }
}

/**
 * Clears a token only if it is still the one we resolved.
 *
 * The conditional is the concurrency guard. Two requests carrying the same link
 * race here; without `verifyToken` in the `where` clause both read the row, both
 * pass the lookup, and the second write resurrects a spent token's side effects —
 * two verifications, or a verification that undoes a password change. Matching
 * on the stored digest means exactly one of them can win.
 *
 * Returns false when another request consumed the token first.
 */
export async function consumeEmailToken(
  userId: string,
  token: string,
  extraData: Record<string, unknown> = {},
): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: { id: userId, verifyToken: hashEmailToken(token) },
    data: { verifyToken: null, verifyTokenExpires: null, ...extraData },
  })
  return result.count === 1
}
