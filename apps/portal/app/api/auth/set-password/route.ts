import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'
import { consumeEmailToken, lookupEmailToken } from '@/lib/auth/email-verification'
import { hashPassword, MIN_PASSWORD_LENGTH, meetsPasswordComplexity, PASSWORD_COMPLEXITY_LABEL } from '@/lib/password'
import { createAuditLog, AuditLogAction } from '@/lib/audit/logger'
import { prisma } from '@/lib/prisma'

/**
 * Completes a one-time password setup from an emailed link.
 *
 * This is the whole of the agreed onboarding design: a person is invited, the
 * link is the credential, and they choose their own password here. No password is
 * ever emailed, so there is nothing in a mailbox — or a forwarding rule — worth
 * rotating, and the recipient does not have to remember a temporary one.
 *
 * The token is consumed in the same write that stores the hash, so a link cannot
 * be used twice even if two requests race.
 *
 * Signing in afterwards is done by the client through `signIn('credentials')`,
 * not by minting a session here. One sign-in path means one set of rules —
 * lockout, status, role gating — instead of a second implementation of it in this
 * handler that would drift from `authorize()`.
 */
const SET_PASSWORD_ATTEMPTS = 10
const SET_PASSWORD_WINDOW_MS = 15 * 60 * 1000

const SetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
})

function passwordPolicyMessage(): string {
  return `Your password must be ${PASSWORD_COMPLEXITY_LABEL}.`
}

function invalidTokenResponse(reason: 'invalid' | 'expired') {
  const expired = reason === 'expired'
  return NextResponse.json(
    {
      error: reason,
      message: expired
        ? 'This setup link has expired. Ask for a new invitation and we will send a fresh link.'
        : 'This setup link is no longer valid. It may have expired or already been used — ask for a new invitation.',
    },
    { status: 400 },
  )
}

export async function POST(req: Request) {
  const { success, reset } = checkRateLimit(
    `set-password:${clientIdentifier(req)}`,
    SET_PASSWORD_ATTEMPTS,
    SET_PASSWORD_WINDOW_MS,
  )
  if (!success) {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: 'rate-limited', message: 'Too many attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  const parsed = SetPasswordSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    // Only the password length is ever echoed back. The token is not, and the
    // zod issue list is not either: it would name every field that failed,
    // including the token when the token is what was missing.
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

  // Composition rules are enforced here as well as on the client: the client's
  // check is a convenience for a person typing, and a direct caller (or a
  // script that lifted the client's constants) would bypass it.
  if (!meetsPasswordComplexity(parsed.data.password)) {
    return NextResponse.json(
      { error: 'password-too-weak', message: passwordPolicyMessage() },
      { status: 400 },
    )
  }

  const lookup = await lookupEmailToken(parsed.data.token)
  if (!lookup.ok) return invalidTokenResponse(lookup.reason)

  // An account that already has a password is not in the invited state this flow
  // describes. Refusing rather than overwriting keeps the link from becoming a
  // password-reset-by-email for any address that happens to be unverified, and
  // points the person at the flow that is actually meant for them.
  if (lookup.passwordHash) {
    return NextResponse.json(
      {
        error: 'already-has-password',
        message: 'This account already has a password. Use the password reset page instead.',
      },
      { status: 409 },
    )
  }

  const passwordHash = await hashPassword(parsed.data.password)
  const now = new Date()

  // `passwordChangedAt` is the session-invalidation lever the `jwt` callback in
  // `lib/auth.ts` already reads, so it is set here rather than by adding a second
  // revocation mechanism. On a brand-new account it also serves as the marker
  // that the invitation step is complete.
  const consumed = await consumeEmailToken(lookup.userId, parsed.data.token, {
    passwordHash,
    emailVerified: now,
    mustChangePassword: false,
    passwordChangedAt: now,
  })
  if (!consumed) return invalidTokenResponse('invalid')

  await createAuditLog({
    userId: lookup.userId,
    action: AuditLogAction.PASSWORD_CHANGED,
    entity: 'users',
    entityId: lookup.userId,
    description: 'Password set from a one-time setup link',
  }).catch((err) => console.error('[auth] Failed to log event:', err))

  const user = await prisma.user.findUnique({
    where: { id: lookup.userId },
    select: { email: true },
  })

  return NextResponse.json({ status: 'ok', email: user?.email ?? null }, { status: 200 })
}
