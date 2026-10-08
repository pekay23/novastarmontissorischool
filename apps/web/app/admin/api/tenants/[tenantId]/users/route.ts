import type { NextRequest } from 'next/server'
import { requireCapability, requireTenantScope } from '@/lib/admin-context'
import { RequestError, toErrorResponse } from '@/lib/errors'
import { json, mutationContext } from '@/lib/http'
import { inviteTenantUser } from '@/lib/invite-user'
import { CreateTenantUserSchema } from '@/types/admin'
import { InviteError } from '@novastar/auth/invite'

/**
 * `POST /api/tenants/:tenantId/users` — create a school-level account in this tenant.
 *
 * THE GAPS THIS CLOSES
 * --------------------
 * Until this route existed the only user creation anywhere was a side effect of
 * provisioning, which makes exactly one administrator and then stops. A tenant with
 * three schools and one account could not get a second one from the console, so
 * account creation had to go through the portal — which an operator has no account
 * in. The console could read a directory it had no lawful way to change.
 *
 * WHAT THIS ROUTE IS NOT
 * ----------------------
 * It is not a way to set somebody's password. There is no `password` field, no
 * `passwordHash`, and the only thing the recipient receives is a single-use link that
 * makes them choose their own. That is a settled product decision, and it is the
 * reason this is a safe capability to hand to an operator: the credential never
 * exists in transit, in this app, or in a mailbox that forwards.
 *
 * WHY TWO CAPABILITIES AND NOT ONE
 * --------------------------------
 * `tenant:user:read` is read-only and stays that way. This route requires
 * `tenant:user:create`, which is not implied by it and not implied by
 * `tenant:provision` — a console that could provision a tenant but not add a teacher
 * to a tenant that already exists would have a strange hole, and one that could add a
 * teacher could not on a day the tenant was already live. Deny-by-default is the
 * point: an operator who holds neither never reaches the first query.
 *
 * THE TENANT IS THE URL'S, AND ONLY THE URL'S
 * -------------------------------------------
 * `tenantId` comes from the route segment and is re-read through `requireTenantScope`,
 * which 404s on a miss. A body naming a `tenantId` is refused with a 409 rather than
 * ignored, for the same reason `PATCH /api/tenants/:id` refuses one: silently dropping
 * it would let an operator believe they had created an account in one school while
 * creating it in another. The `schoolId` the body does carry is looked up with
 * `{ id, tenantId }` — both predicates, not one — so a school in another tenant is a
 * 404 and the role it would have resolved is never even read.
 *
 * And there is no `roleId`. The body names a role by *name*, which
 * `createInvitedUser` narrows through the seeded vocabulary and resolves inside this
 * tenant and school. A `roleId` would be a cuid naming a row anywhere in the fleet,
 * and accepting one would put the privilege decision in the hands of whoever wrote
 * the request rather than in code that checks it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  try {
    const context = await requireCapability('tenant:user:create')
    const { tenantId } = await params
    const body = await readBody(request)

    // Body checks before the database. None of these answers depends on whether the
    // tenant exists, so a 400 here reveals nothing a 404 would not.
    if (Object.hasOwn(body, 'tenantId')) {
      throw new RequestError(
        'The URL segment addresses the tenant. A body may not name one.',
        409,
        { urlTenantId: tenantId, bodyTenantId: body.tenantId },
      )
    }
    if (Object.hasOwn(body, 'roleId')) {
      throw new RequestError(
        'Name the role by `roleName`. A `roleId` is refused rather than ignored, because a role ' +
          'row is addressed by an id that means nothing outside the tenant and school it belongs ' +
          'to, and the request is not allowed to choose a role row directly.',
        400,
      )
    }

    const parsed = CreateTenantUserSchema.safeParse(body)
    if (!parsed.success) {
      throw new RequestError(
        'Provide `email`, `roleName` and `schoolId`. `name` is optional.',
        400,
        parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      )
    }

    const tenant = await requireTenantScope(tenantId)

    let outcome: Awaited<ReturnType<typeof inviteTenantUser>>
    try {
      outcome = await inviteTenantUser(
        {
          tenantId: tenant.id,
          schoolId: parsed.data.schoolId,
          roleName: parsed.data.roleName,
          email: parsed.data.email,
          name: parsed.data.name ?? null,
        },
        mutationContext(context, request),
      )
    } catch (error) {
      if (error instanceof InviteError) {
        throw inviteFailure(error)
      }
      throw error
    }

    if (!outcome.delivered) {
      // 502, and the body says what happened. The account exists — it is in the
      // directory and in the audit entry — so this is not a retry of the create; it
      // is a report that the one thing the recipient needs never arrived. Answering
      // 201 here is the failure mode this exists to prevent: an operator told "invited"
      // has no reason to chase the person who never got the link.
      return json({ ...outcome.user, error: 'The account was created but the setup email was not delivered.' }, 502)
    }

    return json(outcome.user, 201)
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * Maps a refusal from the shared invite function onto this app's status codes.
 *
 * The statuses are the console's, not the portal's, and they are chosen so an operator
 * can tell three different mistakes apart from the body alone: 400 for a request that
 * names something that does not exist, 409 for one that names something that already
 * does, 403 for one naming a role this operator's authority does not cover. A platform
 * operator is never refused the third — see `mayGrantRole` — and the branch exists so
 * that if the ceiling ever changes, the refusal is a stated decision rather than a
 * crash.
 */
function inviteFailure(error: InviteError): RequestError {
  switch (error.reason) {
    case 'duplicate':
      return new RequestError('An account with that email address already exists in this tenant.', 409)
    case 'role-not-in-school':
      return new RequestError('That role does not exist in the school named.', 400)
    case 'role-out-of-scope':
      return new RequestError(error.message, 403)
    case 'unknown-role':
    case 'invalid-email':
      return new RequestError(error.message, 400)
  }
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new RequestError('Invalid request body', 400)
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof RequestError) throw error
    throw new RequestError('Invalid request body', 400)
  }
}