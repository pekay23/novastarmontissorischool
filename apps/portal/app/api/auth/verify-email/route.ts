import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'
import { consumeEmailToken, lookupEmailToken } from '@/lib/auth/email-verification'
import { createAuditLog, AuditLogAction } from '@/lib/audit/logger'

/**
 * Consumes an email verification link.
 *
 * Unauthenticated by design: the recipient is following a link from their inbox
 * and has no session. The token in the body IS the credential, which is why this
 * route is safe to leave open — and why it must be the only way `emailVerified`
 * is set from outside.
 *
 * Limited in-handler rather than relying on the proxy. `proxy.ts` does rate limit
 * `/api/auth/*`, but at 20/minute against every auth endpoint pooled together, so
 * a dedicated bucket is what actually bounds attempts against this one. 10 per 15
 * minutes is generous for the two requests a person makes (load, confirm) and
 * useless to someone enumerating tokens.
 */
const VERIFY_ATTEMPTS = 10
const VERIFY_WINDOW_MS = 15 * 60 * 1000

const ConsumeSchema = z.object({
  token: z.string().min(1).max(512),
})

/**
 * The same response shape and wording for "no such token" and "already spent".
 *
 * They are genuinely indistinguishable: consumption writes `verifyToken: null`
 * and nothing records that a token ever existed, so a spent link is simply an
 * absent one. Merging them is also the better answer for the recipient — both
 * mean "follow the link from a fresh email" — and it keeps this endpoint from
 * confirming that a given address has an account at all.
 */
function invalidTokenResponse(reason: 'invalid' | 'expired') {
  const expired = reason === 'expired'
  return NextResponse.json(
    {
      error: reason,
      message: expired
        ? 'This verification link has expired. Request a new one and we will send a fresh link.'
        : 'This verification link is no longer valid. It may have expired or already been used — request a new one.',
    },
    { status: 400 },
  )
}

export async function POST(req: Request) {
  const { success, reset } = checkRateLimit(
    `verify-email:${clientIdentifier(req)}`,
    VERIFY_ATTEMPTS,
    VERIFY_WINDOW_MS,
  )
  if (!success) {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: 'rate-limited', message: 'Too many attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  const parsed = ConsumeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return invalidTokenResponse('invalid')

  const lookup = await lookupEmailToken(parsed.data.token)
  if (!lookup.ok) return invalidTokenResponse(lookup.reason)

  // An account created by invitation has no password yet. Marking its email
  // verified here would be a dead end: the sign-in path refuses a row with no
  // `passwordHash`, so the person would verify successfully and then be unable
  // to get in. Send them to the page that also sets the password instead, leaving
  // the token unspent so the link stays usable.
  if (!lookup.passwordHash) {
    return NextResponse.json({ status: 'set-password-required' }, { status: 200 })
  }

  // The conditional write in `consumeEmailToken` is what makes this single-use:
  // two requests carrying the same link race, and only one can match the stored
  // digest. A false return means the other request won, which is reported as the
  // same "no longer valid" the recipient would see for any spent link.
  const consumed = await consumeEmailToken(lookup.userId, parsed.data.token, {
    emailVerified: new Date(),
  })
  if (!consumed) return invalidTokenResponse('invalid')

  await createAuditLog({
    userId: lookup.userId,
    action: AuditLogAction.UPDATE,
    entity: 'users',
    entityId: lookup.userId,
    description: 'Email address verified via emailed link',
  }).catch((err) => console.error('[auth] Failed to log event:', err))

  return NextResponse.json({ status: 'verified' }, { status: 200 })
}
