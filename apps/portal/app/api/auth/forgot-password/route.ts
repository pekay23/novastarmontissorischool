import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createHmac } from 'crypto'
import { rateLimitAsync, clientIdentifier } from '@/lib/rate-limit'
import { portalOrigin, resolveSchool } from '@/lib/auth/school-lookup'
import {
  createPasswordResetToken,
  PASSWORD_RESET_TTL_HOURS,
} from '@/lib/auth/password-reset-token'
import { emailActionUrl } from '@/lib/auth/email-verification'
import { sendEmail, passwordResetTemplate } from '@novastar/notifications'
import { prisma } from '@/lib/prisma'

const FORGOT_IP_ATTEMPTS = 5
const FORGOT_ADDRESS_ATTEMPTS = 3
const FORGOT_WINDOW_MS = 60 * 60 * 1000

const ForgotSchema = z.object({
  email: z.string().email().max(320),
  /** Optional: single-school deployments fall back to DEFAULT_SCHOOL_CODE. */
  schoolCode: z.string().max(64).optional(),
})

const ACCEPTED = {
  message:
    'If that address has an account, a password reset link is on its way. If you do not see it within a few minutes, contact your school office.',
}

function emailHash(email: string): string {
  // NEXTAUTH_SECRET is required for NextAuth to function at all — the
  // providers, session strategy and CSRF token all depend on it — so a
  // missing value here is a deployment error, not a fallback case. Falling
  // back to a static key would make the address-level rate-limit bucket
  // deterministic and identical across deployments, letting an attacker
  // predict or link rate-limit keys.
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error(
      '[auth] NEXTAUTH_SECRET is unset, so email-based rate-limit keys cannot be ' +
        'computed safely. Set NEXTAUTH_SECRET in .env (see .env.example).',
    )
  }
  return createHmac('sha256', secret).update(email).digest('hex')
}

function safeRetryAfter(reset: number): number {
  const delta = Math.ceil((reset - Date.now()) / 1000)
  return Number.isFinite(delta) ? Math.max(1, delta) : 1
}

export async function POST(req: Request) {
  const byIp = await rateLimitAsync(
    `forgot-password:ip:${clientIdentifier(req)}`,
    FORGOT_IP_ATTEMPTS,
    FORGOT_WINDOW_MS,
  )
  if (!byIp.success) {
    const retryAfter = safeRetryAfter(byIp.reset)
    return NextResponse.json(ACCEPTED, {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    })
  }

  const parsed = ForgotSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(ACCEPTED, { status: 200 })

  const email = parsed.data.email.trim().toLowerCase()

  const byAddress = await rateLimitAsync(
    `forgot-password:addr:${emailHash(email)}`,
    FORGOT_ADDRESS_ATTEMPTS,
    FORGOT_WINDOW_MS,
  )
  if (!byAddress.success) {
    const retryAfter = safeRetryAfter(byAddress.reset)
    return NextResponse.json(ACCEPTED, {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    })
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

  // The response is returned before the token is minted or the email is sent.
  // Token generation and email delivery add measurable latency, and the route
  // answers byte-identically for an address that does not exist. Minting the
  // token and sending the email after the response keeps the timing the same
  // for every outcome, so a caller cannot use response latency to tell whether
  // an account exists.
  const response = NextResponse.json(ACCEPTED, { status: 200 })

  void (async () => {
    try {
      const { token } = createPasswordResetToken(user.id, user.passwordChangedAt)

      const rendered = passwordResetTemplate({
        schoolName: user.school?.name ?? school.name,
        recipientName: user.name ?? 'there',
        actionUrl: emailActionUrl(portalOrigin(req), 'reset-password', token),
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
  })()

  return response
}
