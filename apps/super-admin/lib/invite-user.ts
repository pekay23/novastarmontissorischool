import { sendEmail, setPasswordTemplate, EmailDeliveryError } from '@novastar/notifications'
import {
  createInvitedUser,
  INVITE_TOKEN_TTL_HOURS,
  inviteActionUrl,
} from '@novastar/auth/invite'
import { AdminAuditAction, auditTenantAction } from '@/lib/audit'
import { RequestError } from '@/lib/errors'
import { getSchoolInTenant, type TenantMutationContext } from '@/lib/queries'
import type { CreatedTenantUser, SetupEmailOutcome } from '@/types/admin'

/**
 * Creating a school-level account from the console: this app's adapter over the
 * shared invite function in `@novastar/auth/invite`.
 *
 * WHY AN ADAPTER RATHER THAN THE SHARED FUNCTION DIRECTLY
 * ------------------------------------------------------
 * `lib/provision.ts` is the same shape for the same reasons, and the reasoning
 * transfers. The shared function knows how an invited account is built and what a
 * caller may grant; it does not know what a `PlatformOperator` is, where the setup
 * link's origin comes from, or that this app files its audit entries with an
 * `operatorId`. Those are this app's facts, and the two that are not are the email
 * and the audit entry — so they live here rather than in a package that has no
 * operator to attribute an entry to.
 *
 * The account itself is created by the same function the portal calls. There is no
 * second writer of `User` rows in this app, for the same reason there is no second
 * writer of `Tenant` rows: two writers mean two sets of field rules and two places a
 * credential state could be established wrongly.
 *
 * NO PASSWORD, NO TOKEN IN THE RESPONSE
 * -------------------------------------
 * There is no field anywhere in this path that accepts a password, and the raw setup
 * token goes into the email and nowhere else — not the response, not the audit entry,
 * not a log line. The recipient's mailbox is the only place a working credential
 * exists, which is the settled product decision: a mailbox, including one under a
 * forwarding rule, has nothing to rotate.
 */

/**
 * Where the recipient's setup link points.
 *
 * The set-password page lives in the **portal**, not in this console, so the link is
 * built from the portal's origin. `NEXTAUTH_URL` is the portal's own canonical,
 * configured public origin; `NEXT_PUBLIC_ORIGIN` is the fallback for a setup that has
 * only the public one. Failing loudly is the alternative — a link built from the
 * console's own origin 404s in the recipient's browser, and for a 24-hour single-use
 * token that is a support call.
 */
function portalOrigin(): string {
  const configured = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_ORIGIN
  if (!configured) {
    throw new RequestError(
      'Neither NEXTAUTH_URL nor NEXT_PUBLIC_ORIGIN is set, so no password-setup link can be ' +
        'built. Set NEXTAUTH_URL to the portal origin in .env (see .env.example).',
      503,
    )
  }
  return configured
}

export interface InviteTenantUserInput {
  /** The tenant in the URL, already proven to exist by `requireTenantScope`. */
  tenantId: string
  schoolId: string
  roleName: string
  email: string
  name: string | null
}

export interface InviteTenantUserOutcome {
  readonly user: CreatedTenantUser
  readonly delivered: boolean
}

/**
 * Creates the account, sends the setup link, and files the audit entry.
 *
 * ORDER
 * -----
 * School, then account, then email, then audit. Each step depends on the one before:
 * the school names the tenant the account must belong to and supplies the name the
 * email greets, and the email is attempted before the audit entry is written so the
 * entry can record whether it was delivered.
 *
 * That last point is the reason this is not one transaction. `AuditLog` has no column
 * for "the provider accepted the message", and the only way to know is to try — so a
 * single entry written after the attempt is strictly more informative than one written
 * before it. The cost is the same one `lib/provision.ts` documents and accepts: a
 * crash between the create and the entry leaves an account with no record of who made
 * it. An operator who sees the account in the directory but no entry in the audit log
 * can re-issue; what they must never see is the reverse, an entry claiming a delivery
 * that did not happen.
 */
export async function inviteTenantUser(
  input: InviteTenantUserInput,
  context: TenantMutationContext,
): Promise<InviteTenantUserOutcome> {
  const school = await getSchoolInTenant(input.tenantId, input.schoolId)
  if (!school) {
    // 404 rather than 400: the school id is not in this tenant, which is the same
    // answer a school id belonging to a tenant the operator cannot see would get.
    throw new RequestError(`No school with id "${input.schoolId}" in this tenant.`, 404)
  }

  const invite = await createInvitedUser({
    tenantId: input.tenantId,
    schoolId: school.id,
    roleName: input.roleName,
    email: input.email,
    name: input.name,
    // The privilege ceiling. A platform operator belongs to no school and holds no
    // school role, so there is nothing above it to be capped by — its authority over
    // tenants is already total, `tenant:provision` lets it create a tenant and its
    // first administrator. What it must never do is act outside the tenant it has
    // scoped to, and that is what the two lookups above and the URL below enforce:
    // every id written here came from the request path or from a tenant-scoped read,
    // never from the body.
    authority: { kind: 'platform-operator' },
  })

  const delivery = await deliverSetupLink(invite, school.name, input.name)

  await auditTenantAction({
    tenantId: input.tenantId,
    schoolId: school.id,
    userId: invite.userId,
    operatorId: context.operatorId,
    action: AdminAuditAction.TENANT_USER_CREATE,
    entity: 'user',
    entityId: invite.userId,
    description:
      `Account created for ${invite.email} as ${invite.roleName} in ${school.name} by ` +
      `${context.operatorEmail}; setup email ${delivery.status}`,
    changes: {
      email: invite.email,
      roleName: invite.roleName,
      roleId: invite.roleId,
      schoolId: school.id,
      setupEmail: delivery.status,
      ...(delivery.reason === null ? {} : { setupEmailReason: delivery.reason }),
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return {
    delivered: delivery.status === 'sent',
    user: {
      userId: invite.userId,
      tenantId: input.tenantId,
      schoolId: school.id,
      email: invite.email,
      roleName: invite.roleName,
      status: 'created',
      setupEmail: delivery.status,
      setupEmailReason: delivery.reason,
      setupLinkExpiresAt: invite.expiresAt.toISOString(),
    },
  }
}

/**
 * Attempts the one-time setup email and reports what happened, rather than letting the
 * rejection escape.
 *
 * `sendEmail` throws `EmailDeliveryError` for every failure, and the previous
 * swallowing implementation made "invited" indistinguishable from "invited, and the
 * person will never receive their link" — which is a recipient stranded with an
 * account they cannot sign into and no way forward. The outcome is returned so the
 * audit entry can record it, and the route can answer 502 instead of 201.
 *
 * Only the `reason` crosses this boundary. The provider's message may name the
 * address that bounced or the template that failed to render, and neither belongs in
 * a cross-tenant console's response or in a hash-chained audit entry. It is logged
 * server-side with the same treatment the notifications package gives it.
 */
async function deliverSetupLink(
  invite: { token: string; email: string; expiresAt: Date },
  schoolName: string,
  recipientName: string | null,
): Promise<{ status: SetupEmailOutcome; reason: string | null }> {
  try {
    const rendered = setPasswordTemplate({
      schoolName,
      recipientName: recipientName ?? 'there',
      actionUrl: inviteActionUrl(portalOrigin(), invite.token),
      expiresInHours: INVITE_TOKEN_TTL_HOURS,
    })
    await sendEmail({
      to: invite.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
    return { status: 'sent', reason: null }
  } catch (error) {
    const reason = error instanceof EmailDeliveryError ? error.reason : 'unknown'
    console.error(
      '[super-admin] account created but its setup email was not delivered:',
      error instanceof Error ? error.message : error,
    )
    return { status: 'failed', reason }
  }
}