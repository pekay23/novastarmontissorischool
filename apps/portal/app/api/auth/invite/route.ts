import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { isUserSecurityAdmin } from '@/lib/constants/platform-roles'
import { portalOrigin } from '@/lib/auth/school-lookup'
import {
  createInvitedUser,
  INVITE_TOKEN_TTL_HOURS,
  inviteActionUrl,
  InviteError,
} from '@novastar/auth/invite'
import { sendEmail, setPasswordTemplate } from '@novastar/notifications'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'
import { duplicateResponse, isUniqueConstraintViolation } from '@/lib/prisma-conflict'
import { createAuditLog, AuditLogAction } from '@/lib/audit/logger'

/**
 * Invites a person to the portal and emails them a one-time setup link.
 *
 * The agreed design: invite a person, they choose their own password. No
 * password is ever generated here or emailed, so there is no provisional
 * credential to leak from a mailbox and nothing for the recipient to rotate later.
 *
 * The account is created by `createInvitedUser` in `@novastar/auth/invite`, which
 * the platform console also calls: one definition of the invited state, one token
 * format, one privilege ceiling. This route keeps the parts that are the portal's —
 * the session, the rate limit, the wording of each refusal.
 *
 * DENY BY DEFAULT, FOUR WAYS
 * --------------------------
 * 1. A session is required. `proxy.ts` exempts all of `/api/auth/*` from its own
 *    session check, so the check has to live here — the same arrangement as the
 *    TOTP and passkey registration routes.
 * 2. The caller must hold a user-security admin role
 *    (`isUserSecurityAdmin`), so an ordinary teacher cannot mint accounts.
 * 3. `tenantId` and `schoolId` come from the session, never the body, and
 *    `roleName` is resolved against that same tenant and school — so a caller
 *    cannot create an account in another school, or grant a role that belongs to
 *    one.
 * 4. The role the caller names must not outrank the caller's own. That check is
 *    `mayGrantRole` inside the shared function, and it is the one that was
 *    missing: `USER_SECURITY_ADMIN_ROLES` includes `ADMIN_STAFF`, so before it
 *    existed an `ADMIN_STAFF` account could post `{"roleName":"HEADMASTER"}`,
 *    have the Head of School role row resolve in their own school, receive the
 *    setup link and hold full administrative access. A ceiling an operator cannot
 *    see is not a control, so it sits in the function that mints the account and
 *    is asserted in `packages/auth`'s own tests.
 *
 * Unlike the recovery routes, this one is authenticated and admin-only, so a 409
 * for a duplicate address is useful information rather than a disclosure.
 */
const INVITE_ATTEMPTS = 20
const INVITE_WINDOW_MS = 60 * 60 * 1000

const InviteSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().max(160).optional(),
  /** A seeded role name, resolved within the caller's tenant and school. */
  roleName: z.string().min(1).max(64),
})

export async function POST(req: Request) {
  const { success, reset } = checkRateLimit(
    `auth-invite:${clientIdentifier(req)}`,
    INVITE_ATTEMPTS,
    INVITE_WINDOW_MS,
  )
  if (!success) {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: 'Too many invitations. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  try {
    const { userId, tenantId, schoolId, role } = await getCachedSessionAndTenant()

    if (!isUserSecurityAdmin(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!schoolId) {
      return NextResponse.json(
        { error: 'You are not assigned to a school, so no account can be created.' },
        { status: 400 },
      )
    }

    const parsed = InviteSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Provide an email address and a role name.' },
        { status: 400 },
      )
    }

    let invite: Awaited<ReturnType<typeof createInvitedUser>>
    try {
      // The role *name* is handed over, not a `roleId`: the shared function
      // narrows it through the seeded vocabulary and resolves it against this
      // caller's tenant and school, so a role row belonging to another school
      // cannot be named here at all.
      invite = await createInvitedUser({
        tenantId,
        schoolId,
        roleName: parsed.data.roleName,
        email: parsed.data.email,
        name: parsed.data.name ?? null,
        // The ceiling: this caller may not mint an account that outranks them.
        authority: { kind: 'school-role', roleName: role },
      })
    } catch (error) {
      if (error instanceof InviteError) {
        if (error.reason === 'unknown-role') {
          return NextResponse.json({ error: 'Unknown role name.' }, { status: 400 })
        }
        if (error.reason === 'role-not-in-school') {
          return NextResponse.json(
            { error: 'That role does not exist in your school.' },
            { status: 400 },
          )
        }
        if (error.reason === 'role-out-of-scope') {
          // 403, not 400: the request was well formed and the caller was
          // authenticated. What failed is their authority, and saying so is what
          // lets an operator tell "I may not" from "I typed it wrong".
          return NextResponse.json({ error: error.message }, { status: 403 })
        }
        if (error.reason === 'duplicate') {
          return duplicateResponse('An account with that email address already exists.')
        }
        return NextResponse.json({ error: 'Provide a valid email address.' }, { status: 400 })
      }
      throw error
    }

    const school = await prisma.school.findFirst({
      where: { id: schoolId, tenantId },
      select: { name: true },
    })

    try {
      const rendered = setPasswordTemplate({
        schoolName: school?.name ?? 'Novastar Montessori School',
        recipientName: parsed.data.name ?? 'there',
        actionUrl: inviteActionUrl(portalOrigin(), invite.token),
        expiresInHours: INVITE_TOKEN_TTL_HOURS,
      })
      await sendEmail({
        // The normalised address the row was written with, so the message and the
        // audit entry name the same account.
        to: invite.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      })
    } catch (error) {
      // The account exists but the link did not reach them. Logged, and reported
      // as a distinct status rather than a success, because "invited" with no
      // email is the state the previous swallowing `sendEmail` hid: the operator
      // had no signal that the person would never receive it.
      console.error('[auth] invitation email was not delivered:', error)
      return NextResponse.json(
        { status: 'created-not-delivered', userId: invite.userId },
        { status: 502 },
      )
    }

    await createAuditLog({
      userId,
      action: AuditLogAction.CREATE,
      entity: 'users',
      entityId: invite.userId,
      description: `Invited ${invite.email} as ${invite.roleName}`,
      tenantId,
      schoolId,
    }).catch((err) => console.error('[auth] Failed to log event:', err))

    return NextResponse.json({ status: 'invited', userId: invite.userId }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    if (isUniqueConstraintViolation(error)) {
      // `@@unique([tenantId, email])` — an account with that address already
      // exists in this school.
      return duplicateResponse('An account with that email address already exists.')
    }
    console.error('[AUTH_INVITE]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}
