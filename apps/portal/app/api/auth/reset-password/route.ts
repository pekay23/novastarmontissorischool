import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'
import {
  matchesPasswordGeneration,
  verifyPasswordResetToken,
} from '@/lib/auth/password-reset-token'
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/password'
import { createAuditLog, AuditLogAction } from '@/lib/audit/logger'
import { prisma } from '@/lib/prisma'

/**
 * Consumes a password-reset link and stores a new password hash.
 *
 * SINGLE USE WITHOUT A COLUMN
 * --------------------------
 * The token carries the user's `passwordChangedAt` at issue time. A successful
 * reset moves that column, so the same token presented a second time fails the
 * generation check and is refused as spent. That is checked here against live
 * database state, not against a value the token claims.
 *
 * LIVE SESSION INVALIDATION
 * -------------------------
 * Setting `passwordChangedAt` to now is the whole of session revocation, and it
 * is not a second mechanism added here: the `jwt` callback in `lib/auth.ts`
 * already compares `passwordChangedAt` against the token's issue time and blanks
 * the session when the former is newer. This route relies on that existing
 * behaviour rather than reaching for a session table or a cookie revocation list.
 */
const RESET_ATTEMPTS = 10
const RESET_WINDOW_MS = 15 * 60 * 1000

const ResetSchema = z.object({
  token: z.string().min(1).max(1024),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
})

/**
 * Wording per failure.
 *
 * `expired` is separated out because it is both true and actionable — the person
 * simply requests a new link. `invalid` and `spent` are merged: both are the
 * signature or generation check failing, the recipient cannot tell them apart,
 * and neither carries information about the account.
 */
function rejected(reason: 'invalid' | 'expired' | 'spent') {
  const message =
    reason === 'expired'
      ? 'This reset link has expired. Request a new one and we will send a fresh link.'
      : reason === 'spent'
        ? 'This reset link has already been used. Request a new one if you still need to change your password.'
        : 'This reset link is not valid. Request a new one if you still need to change your password.'
  return NextResponse.json({ error: reason, message }, { status: 400 })
}

export async function POST(req: Request) {
  const { success, reset } = checkRateLimit(
    `reset-password:${clientIdentifier(req)}`,
    RESET_ATTEMPTS,
    RESET_WINDOW_MS,
  )
  if (!success) {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: 'rate-limited', message: 'Too many attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  const parsed = ResetSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const tooShort = parsed.error.issues.some(
      (issue) => issue.path[0] === 'password' && issue.code === 'too_small'
    )
    return NextResponse.json(
      {
        error: tooShort ? 'password-too-short' : 'invalid-request',
        message: tooShort
          ? `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`
          : 'This request is missing a link or a password.',
      },
      { status: 400 },
    )
  }

  const verification = verifyPasswordResetToken(parsed.data.token)
  if (!verification.ok) {
    return verification.reason === 'expired' ? rejected('expired') : rejected('invalid')
  }

  const { claims } = verification

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      email: true,
      status: true,
      isActive: true,
      passwordHash: true,
      passwordChangedAt: true,
    },
  })

  if (!user) return rejected('invalid')

  // The generation check. This is the replay guard: a token minted before this
  // user's last password change no longer matches, so a link that was already
  // used — or that was superseded by a change made in an authenticated session —
  // cannot be used again.
  if (!matchesPasswordGeneration(claims, user.passwordChangedAt)) return rejected('spent')

  if (user.status !== 'ACTIVE' || !user.isActive) return rejected('invalid')

  const passwordHash = await hashPassword(parsed.data.password)
  const now = new Date()

  // `mustChangePassword` is cleared as well: a user who was flagged to change a
  // provisional password has now chosen one, and leaving the flag set would make
  // the `jwt` callback clear it on the next revalidation anyway, at the cost of a
  // confusing redirect in the meantime.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordChangedAt: now,
      mustChangePassword: false,
      // A reset is proof of control of the mailbox, so it is also the natural
      // moment to clear a lockout: nobody is being asked to prove anything else.
      loginAttempts: 0,
      lockedUntil: null,
    },
  })

  await createAuditLog({
    userId: user.id,
    action: AuditLogAction.PASSWORD_CHANGED,
    entity: 'users',
    entityId: user.id,
    description: 'Password reset via emailed link',
  }).catch((err) => console.error('[auth] Failed to log event:', err))

  return NextResponse.json({ status: 'ok', email: user.email }, { status: 200 })
}
