import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'
import { portalOrigin, resolveSchool } from '@/lib/auth/school-lookup'
import {
  EMAIL_TOKEN_TTL_HOURS,
  emailActionUrl,
  issueEmailToken,
} from '@/lib/auth/email-verification'
import { sendEmail, verifyEmailTemplate } from '@novastar/notifications'
import { prisma } from '@/lib/prisma'

/**
 * Re-issues an email verification link.
 *
 * Deny-by-default in the sense that matters here: this is an unauthenticated
 * write to a user record, so every branch — unknown address, wrong school,
 * disabled account, already verified, delivery failure — answers with the same
 * body. A response that said "no account with that address" would turn the
 * endpoint into an account-existence oracle for anyone who knows a staff member's
 * address, and into a way to confirm a guessed address belongs to a parent rather
 * than to staff.
 */

/** Per client address. Bounds a burst spread across many different addresses. */
const RESEND_IP_ATTEMPTS = 5
/** Per address. The real control: an attacker rotating addresses still gets 3/hour. */
const RESEND_ADDRESS_ATTEMPTS = 3
const RESEND_WINDOW_MS = 60 * 60 * 1000

const ResendSchema = z.object({
  email: z.string().email().max(320),
  /** Optional: a single-school deployment omits it and falls back to DEFAULT_SCHOOL_CODE. */
  schoolCode: z.string().max(64).optional(),
})

/** The one response, whatever actually happened. */
const ACCEPTED = {
  message: 'If that address has an unverified account, a new verification link is on its way.',
}

export async function POST(req: Request) {
  const byIp = checkRateLimit(
    `verify-email-resend:ip:${clientIdentifier(req)}`,
    RESEND_IP_ATTEMPTS,
    RESEND_WINDOW_MS,
  )
  if (!byIp.success) {
    const retryAfter = Math.max(1, Math.ceil((byIp.reset - Date.now()) / 1000))
    return NextResponse.json(
      { message: 'Too many requests. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  const parsed = ResendSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    // A malformed address is answered exactly like a well-formed one, so the
    // schema cannot be used to probe whether an address is well-formed.
    return NextResponse.json(ACCEPTED, { status: 200 })
  }

  const email = parsed.data.email.trim().toLowerCase()

  const byAddress = checkRateLimit(
    `verify-email-resend:addr:${email}`,
    RESEND_ADDRESS_ATTEMPTS,
    RESEND_WINDOW_MS,
  )
  if (!byAddress.success) {
    const retryAfter = Math.max(1, Math.ceil((byAddress.reset - Date.now()) / 1000))
    return NextResponse.json(ACCEPTED, { status: 429, headers: { 'Retry-After': String(retryAfter) } })
  }

  const school = await resolveSchool(parsed.data.schoolCode)
  if (!school) return NextResponse.json(ACCEPTED, { status: 200 })

  const user = await prisma.user.findFirst({
    // Scoped exactly as `authorize()` scopes a password login — by school, not by
    // tenant alone. Email uniqueness is `@@unique([tenantId, email])`, so the same
    // address can hold accounts in two schools, and a lookup that ignored the
    // school could mint a token for the wrong one.
    where: {
      schoolId: school.id,
      email: { equals: email, mode: 'insensitive' },
      emailVerified: null,
      isActive: true,
    },
    select: { id: true, email: true, name: true, school: { select: { name: true } } },
  })

  if (!user) return NextResponse.json(ACCEPTED, { status: 200 })

  const { token } = await issueEmailToken(user.id)

  try {
    const rendered = verifyEmailTemplate({
      schoolName: user.school?.name ?? school.name,
      recipientName: user.name ?? 'there',
      actionUrl: emailActionUrl(portalOrigin(), 'verify-email', token),
      expiresInHours: EMAIL_TOKEN_TTL_HOURS,
    })
    await sendEmail({
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
  } catch (error) {
    // Logged, then answered with the same 200 as everything else. That log line
    // is the whole point of `sendEmail` throwing: it used to swallow the failure
    // and return null, so a person waiting on a link that was never sent had no
    // way to learn that, and neither did the operator.
    console.error('[auth] verification email was not delivered:', error)
  }

  return NextResponse.json(ACCEPTED, { status: 200 })
}
