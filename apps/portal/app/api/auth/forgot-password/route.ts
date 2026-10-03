import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'
import { portalOrigin, resolveSchool } from '@/lib/auth/school-lookup'
import {
  createPasswordResetToken,
  PASSWORD_RESET_TTL_HOURS,
} from '@/lib/auth/password-reset-token'
import { emailActionUrl } from '@/lib/auth/email-verification'
import { sendEmail, passwordResetTemplate } from '@novastar/notifications'
import { prisma } from '@/lib/prisma'

/**
 * Starts a password reset by mailing a stateless, HMAC-signed link.
 *
 * TWO LIMITS, NOT ONE
 * -------------------
 * `AUTH_LIMITS.forgotPassword` in `lib/rate-limit.ts` is keyed on the action name
 * alone — `auth:forgotPassword` — so it is a single global bucket: the third
 * request from anyone consumes the quota for everyone, and one attacker cycling
 * addresses can lock every user out of resetting their password for an hour.
 * The pre-configured limiter is therefore not what bounds this endpoint. What
 * bounds it is the pair below: a per-address bucket (the meaningful one — it is
 * what stops an attacker using this endpoint to mail a school) and a per-client
 * bucket (what stops one machine spraying addresses). `rateLimitAuth` — the
 * only reader of `AUTH_LIMITS` — has no callers anywhere, so the table below
 * is the whole of this route's throttling.
 *
 * NOTHING IS REVEALED
 * -------------------
 * Unknown address, wrong school, disabled account, no password hash, unverified
 * email and a failed send all produce the same 200 and the same sentence. A reset
 * request that answered "we sent you a link" only for real accounts would confirm
 * every address an attacker guessed, and would separately tell them which of
 * those addresses belong to a school.
 */
const FORGOT_IP_ATTEMPTS = 5
const FORGOT_ADDRESS_ATTEMPTS = 3
const FORGOT_WINDOW_MS = 60 * 60 * 1000

const ForgotSchema = z.object({
  email: z.string().email().max(320),
  /** Optional: single-school deployments fall back to DEFAULT_SCHOOL_CODE. */
  schoolCode: z.string().max(64).optional(),
})

const ACCEPTED = {
  message: 'If that address has an account, a password reset link is on its way.',
}

export async function POST(req: Request) {
  const byIp = checkRateLimit(
    `forgot-password:ip:${clientIdentifier(req)}`,
    FORGOT_IP_ATTEMPTS,
    FORGOT_WINDOW_MS,
  )
  if (!byIp.success) {
    const retryAfter = Math.max(1, Math.ceil((byIp.reset - Date.now()) / 1000))
    return NextResponse.json(
      { message: 'Too many requests. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  const parsed = ForgotSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(ACCEPTED, { status: 200 })

  const email = parsed.data.email.trim().toLowerCase()

  const byAddress = checkRateLimit(
    `forgot-password:addr:${email}`,
    FORGOT_ADDRESS_ATTEMPTS,
    FORGOT_WINDOW_MS,
  )
  if (!byAddress.success) {
    const retryAfter = Math.max(1, Math.ceil((byAddress.reset - Date.now()) / 1000))
    return NextResponse.json(ACCEPTED, { status: 429, headers: { 'Retry-After': String(retryAfter) } })
  }

  const school = await resolveSchool(parsed.data.schoolCode)
  if (!school) return NextResponse.json(ACCEPTED, { status: 200 })

  const user = await prisma.user.findFirst({
    where: {
      schoolId: school.id,
      email: { equals: email, mode: 'insensitive' },
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      status: true,
      passwordChangedAt: true,
      school: { select: { name: true } },
    },
  })

  // `passwordHash` is the check that matters most here: an account still awaiting
  // its one-time setup link has nothing to reset, and the setup email is the
  // message that should reach them. Mailing a reset link instead would land them
  // on a page for a password they never chose.
  if (!user?.passwordHash) return NextResponse.json(ACCEPTED, { status: 200 })
  if (user.status !== 'ACTIVE') return NextResponse.json(ACCEPTED, { status: 200 })

  // The token is bound to the current password generation, so a reset link stops
  // working the moment the password changes by any other route — including a
  // second reset, or a change made from an authenticated session. That binding is
  // what makes a mailed link single-use without a database column for it, and it
  // is what `reset-password` re-checks against live state before writing.
  const { token } = createPasswordResetToken(user.id, user.passwordChangedAt)

  try {
    const rendered = passwordResetTemplate({
      schoolName: user.school?.name ?? school.name,
      recipientName: user.name ?? 'there',
      actionUrl: emailActionUrl(portalOrigin(), 'reset-password', token),
      expiresInHours: PASSWORD_RESET_TTL_HOURS,
    })
    await sendEmail({
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
  } catch (error) {
    console.error('[auth] password reset email was not delivered:', error)
  }

  return NextResponse.json(ACCEPTED, { status: 200 })
}
