import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { hasPermission } from '@novastar/auth'
import { portalOrigin } from '@/lib/auth/school-lookup'
import {
  createInvitedUser,
  InviteError,
  INVITE_TOKEN_TTL_HOURS,
  inviteActionUrl,
  mayGrantRole,
} from '@novastar/auth/invite'
import { PLATFORM_ROLE_NAMES } from '@novastar/shared-types'
import { sendEmail, setPasswordTemplate } from '@novastar/notifications'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'
import { duplicateResponse, isUniqueConstraintViolation } from '@/lib/prisma-conflict'
import { createAuditLog, AuditLogAction } from '@/lib/audit/logger'

/**
 * Creates a staff member WITH a login, in one transaction.
 *
 * WHY THIS ROUTE EXISTS
 * ---------------------
 * `POST /api/teachers` writes a `Staff` row and nothing else, and its
 * `StaffSchema` demands a `userId` that must already exist. `POST
 * /api/auth/invite` writes the `User` and nothing else. Neither is usable on its
 * own: the first asks a human to supply an identifier nobody can create, the
 * second leaves a login with no staff profile — which cannot sign in usefully,
 * because a sign-in with no `Staff` row has no workspace to land in.
 *
 * Calling the two in sequence from the browser does not fix that. Between the two
 * requests there is a state in which one of the two halves exists and the person
 * can do nothing with it, and a crash, a closed tab or a lost connection leaves
 * them there permanently. So the two writes happen here, inside one transaction:
 * either both rows exist or neither does. There is no window to observe, and no
 * request sequence that can be interrupted between them.
 *
 * ONE DEFINITION OF THE INVITED STATE
 * -----------------------------------
 * The account is created by `createInvitedUser` in `@novastar/auth/invite` — the
 * same function `POST /api/auth/invite` and the platform console call. It owns the
 * invited state (`passwordHash: null`, `mustChangePassword: true`, unverified), the
 * token format, and the privilege ceiling. This route does not restate any of it.
 *
 * NO PASSWORD, EVER
 * -----------------
 * The recipient sets their own password through the one-time link. There is no
 * `password` field in the schema below, and `.strict()` refuses a body carrying one,
 * so a password cannot be smuggled in even by a caller who tries. Nothing is
 * generated and nothing is emailed: the link is the credential, and a mailbox —
 * including one under a forwarding rule — holds nothing that needs rotating.
 *
 * GATE: `teacher:create`, THE KEY THIS PAGE ALREADY GUARDS
 * --------------------------------------------------------
 * The same permission `POST /api/teachers` requires, called the same way, with the
 * same session-derived `tenantId` and `schoolId`. Deliberately NOT
 * `isUserSecurityAdmin`, which is what `POST /api/auth/invite` uses: that set
 * includes `ADMIN_STAFF`, who does not hold `teacher:create`, so reusing it here
 * would WIDEN the set of people who can create a staff record, and would leave a
 * second role list in charge of the same page. One key, one meaning — create a
 * staff member — and the privilege ceiling below decides what that account may be.
 *
 * WHAT IS AND IS NOT DERIVED FROM THE CALLER
 * ------------------------------------------
 * `tenantId`, `schoolId` and `userId` come from the session and from nowhere else;
 * the body cannot carry them, because `.strict()` rejects unknown keys rather than
 * stripping them. The role is a NAME, narrowed through `PLATFORM_ROLE_NAMES` and
 * resolved inside `{ tenantId, schoolId, name }` by the shared function — never a
 * `roleId`, which would name a row in another school. The ceiling is
 * `mayGrantRole` / `ROLE_GRANT_RANK`, evaluated inside `createInvitedUser` before
 * the role lookup, so an escalation attempt cannot be used to enumerate a school's
 * roles.
 *
 * NO ROW SCOPE, AND WHY THAT IS CORRECT
 * ------------------------------------
 * The audit (`tests/audit-limited-scope-gates.test.ts`) flags any mutation handler
 * that gates on a key some seeded role holds at a scope narrower than `all` without
 * resolving visibility of its own. No seeded role holds `teacher:create` below
 * `all` — `ROLE_GRANT_RULES` grants it only to HEADMASTER (`() => true`) and
 * ASSISTANT_HEAD (`category !== 'system'`), both school-wide. There is no class or
 * department dimension to narrow: the account being created is new, so there is no
 * existing row whose visibility could be consulted.
 *
 * AUDIT, INSIDE THE TRANSACTION
 * -----------------------------
 * `logAuditEvent` takes the transaction client and writes through it, so a rolled
 * back creation leaves no trace of having been attempted. Its own chain read is
 * still made through the module client — that is pre-existing behaviour of the
 * shared helper, unchanged here.
 *
 * DELIVERY IS NOT DELIVERED
 * -------------------------
 * `sendEmail` rejects, so a missing `RESEND_API_KEY` is visible rather than silent.
 * The email is sent AFTER the commit: sending inside the transaction would leave a
 * link alive for an account that then rolled back. A rejection is reported as
 * `502 created-not-delivered` with the ids, never as a 201 — the account exists
 * either way, and the operator has to be able to tell "invited" from "invited and
 * the email actually went out".
 */

/** Same shape as the invite route's budget: an authenticated, admin-only action. */
const CREATE_ATTEMPTS = 20
const CREATE_WINDOW_MS = 60 * 60 * 1000

/**
 * Strict, and strict on purpose.
 *
 * `.strict()` turns an unrecognised key into a 400 instead of silently dropping
 * it. That is the difference between "this endpoint cannot be told to write into
 * another tenant" and "this endpoint cannot be told, and says so". It is what
 * makes `tenantId`, `schoolId`, `userId`, `roleId` and `password` refusals rather
 * than no-ops, and each of those is asserted in the test suite.
 *
 * `hireDate` matches what `<input type="date">` emits, so the browser cannot
 * produce a value the column cannot store, and is additionally refused when it is
 * shaped like a date but is not one: `new Date('2026-02-31')` is the 3rd of March,
 * so the pattern alone stored a date nobody entered.
 */
const StaffAccountSchema = z
  .object({
    email: z.string().email().max(320),
    roleName: z.string().min(1).max(64),
    employeeId: z.string().min(1).max(64),
    firstName: z.string().min(1).max(120),
    lastName: z.string().min(1).max(120),
    otherNames: z.string().max(160).optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
    phone: z.string().min(1).max(40),
    hireDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD a date field emits.')
      .refine(
        (value) => {
          const parsed = new Date(`${value}T00:00:00.000Z`)
          return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
        },
        'That date does not exist on the calendar.',
      ),
    address: z.string().max(300).optional(),
    childStudentId: z.string().optional(),
  })
  .strict()

/**
 * What this caller may do here, so the page can hide the button and offer only the
 * roles that will be accepted.
 *
 * `false` rather than a 403 when the key is missing: this is a capability probe,
 * and the page needs an answer for a caller who cannot use the form at all — the
 * same arrangement as `GET /api/promotions` returning `canPromote: false`.
 *
 * `grantableRoleNames` is computed from `ROLE_GRANT_RANK` through `mayGrantRole`,
 * the same function `createInvitedUser` enforces. Listing roles the server would
 * refuse is how a UI teaches a user that the refusal is a glitch; and listing them
 * from a second copy of the ordering would reintroduce exactly the drift this
 * table exists to prevent.
 */
export async function GET() {
  try {
    const { userId, tenantId, schoolId, role } = await getCachedSessionAndTenant()
    if (!schoolId) {
      return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
    }
    if (!(await hasPermission(userId, 'teacher:create', tenantId, schoolId))) {
      return NextResponse.json({ data: { canCreate: false, grantableRoleNames: [] } })
    }
    return NextResponse.json({
      data: {
        canCreate: true,
        grantableRoleNames: PLATFORM_ROLE_NAMES.filter((name) =>
          mayGrantRole({ kind: 'school-role', roleName: role }, name),
        ),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    console.error('[TEACHERS_INVITE_CAPABILITIES]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

export async function POST(req: Request) {
  const { success, reset } = checkRateLimit(
    `teachers-invite:${clientIdentifier(req)}`,
    CREATE_ATTEMPTS,
    CREATE_WINDOW_MS,
  )
  if (!success) {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    return NextResponse.json(
      { error: 'Too many staff accounts created. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  try {
    const { userId, tenantId, schoolId, role } = await getCachedSessionAndTenant()

    if (!schoolId) {
      return NextResponse.json(
        { error: 'You are not assigned to a school, so no staff member can be created.' },
        { status: 400 },
      )
    }
    if (!(await hasPermission(userId, 'teacher:create', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = StaffAccountSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 },
      )
    }
    const data = parsed.data

    // What `User.name` shows, and what the email greets them by. Built here rather
    // than taken from the body so the account name and the staff row cannot
    // disagree about who this is.
    const fullName = data.otherNames
      ? `${data.firstName} ${data.otherNames} ${data.lastName}`
      : `${data.firstName} ${data.lastName}`

    let created: { userId: string; staffId: string; roleName: string; email: string; token: string }
    try {
      created = await prisma.$transaction(async (tx) => {
        // `tx` is handed to the shared function rather than the module client, which
        // is the only thing that makes this atomic. `createInvitedUser` writes the
        // `User` row and its token through the client it is given, so both land in
        // this transaction.
        const invite = await createInvitedUser(
          {
            tenantId,
            schoolId,
            roleName: data.roleName,
            email: data.email,
            name: fullName,
            // The ceiling: this caller may not mint an account that outranks them.
            authority: { kind: 'school-role', roleName: role },
          },
          tx,
        )

        const staff = await tx.staff.create({
          data: {
            tenantId,
            schoolId,
            userId: invite.userId,
            employeeId: data.employeeId,
            firstName: data.firstName,
            lastName: data.lastName,
            otherNames: data.otherNames || null,
            gender: data.gender,
            phone: data.phone,
            email: invite.email,
            address: data.address || null,
            hireDate: new Date(data.hireDate),
          },
        })

        let parentId: string | null = null
        if (invite.roleName === 'PARENT') {
          const existingParent = await tx.parent.findFirst({
            where: { tenantId, schoolId, email: invite.email },
          })
          if (existingParent) {
            if (!existingParent.userId) {
              await tx.parent.update({
                where: { id: existingParent.id },
                data: { userId: invite.userId },
              })
            }
            parentId = existingParent.id
          } else {
            const parent = await tx.parent.create({
              data: {
                tenantId,
                schoolId,
                userId: invite.userId,
                firstName: data.firstName,
                lastName: data.lastName,
                phone: data.phone,
                email: invite.email,
                address: data.address || null,
              },
            })
            parentId = parent.id
          }

          if (data.childStudentId) {
            const student = await tx.student.findFirst({
              where: { id: data.childStudentId, tenantId, schoolId },
            })
            if (!student) {
              throw new Error('Student not found')
            }
            await tx.student.update({
              where: { id: student.id },
              data: { parentId },
            })
          }
        }

        await createAuditLog(
          {
            userId,
            action: AuditLogAction.CREATE,
            entity: 'users',
            entityId: invite.userId,
            description:
              `Created staff account ${invite.email} as ${invite.roleName} ` +
              `(employee ${data.employeeId})`,
            tenantId,
            schoolId,
          },
          tx,
        )

        return {
          userId: invite.userId,
          staffId: staff.id,
          roleName: invite.roleName,
          email: invite.email,
          token: invite.token,
        }
      })
    } catch (error) {
      // `createInvitedUser` refuses before writing anything for every one of these,
      // so a refusal here also rolls back the Staff insert that never ran.
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
          // 403, not 400: the request was well formed and the caller is
          // authenticated. What failed is their authority, and saying so is what lets
          // an operator tell "I may not" from "I typed it wrong".
          return NextResponse.json({ error: error.message }, { status: 403 })
        }
        if (error.reason === 'duplicate') {
          return duplicateResponse('An account with that email address already exists.')
        }
        return NextResponse.json({ error: 'Provide a valid email address.' }, { status: 400 })
      }
      // `Staff @@unique([tenantId, schoolId, employeeId])` — the employee number is
      // already in use in this school. This is the refusal that proves the
      // transaction: the `User` created a statement earlier is rolled back with it.
      if (isUniqueConstraintViolation(error)) {
        return duplicateResponse('A staff member with that employee ID already exists.')
      }
      throw error
    }

    const school = await prisma.school.findFirst({
      where: { id: schoolId, tenantId },
      select: { name: true },
    })

    // AFTER the commit, deliberately. A send inside the transaction would mail a
    // live setup link for an account that then rolled back.
    try {
      const rendered = setPasswordTemplate({
        schoolName: school?.name ?? 'Novastar Montessori School',
        recipientName: fullName,
        actionUrl: inviteActionUrl(portalOrigin(), created.token),
        expiresInHours: INVITE_TOKEN_TTL_HOURS,
      })
      await sendEmail({
        to: created.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      })
    } catch (error) {
      // The staff member exists and can sign in the moment they set a password; the
      // link is what they need, and it did not arrive. Reported as its own status so
      // the UI can say so, rather than swallowed into a success the operator would
      // read as "they have been told".
      console.error('[TEACHERS_INVITE] account created but the setup email was not delivered:', error)
      return NextResponse.json(
        {
          status: 'created-not-delivered',
          userId: created.userId,
          staffId: created.staffId,
          email: created.email,
        },
        { status: 502 },
      )
    }

    return NextResponse.json(
      {
        status: 'invited',
        userId: created.userId,
        staffId: created.staffId,
        email: created.email,
        roleName: created.roleName,
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    if (isUniqueConstraintViolation(error)) {
      return duplicateResponse('That staff member already exists.')
    }
    console.error('[TEACHERS_INVITE]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}