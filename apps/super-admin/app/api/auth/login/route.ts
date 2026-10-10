import { NextResponse, type NextRequest } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  authenticateOperator,
  clearLoginFailures,
  createSessionToken,
  isLoginThrottled,
  LOGIN_FAILURE,
  recordLoginFailure,
  toOperatorProfile,
} from '@/lib/admin-auth'
import { AdminAuditAction, auditPlatformAction } from '@/lib/audit'
import { toErrorResponse } from '@/lib/errors'
import { clientAddressOf } from '@/lib/http'

/**
 * `POST /api/auth/login` — exchange an operator's username (or email) and password
 * for a signed session cookie.
 *
 * Stands in for the plan's `app/api/auth/[...nextauth]/route.ts`, which cannot be
 * built here: `next-auth` is not a dependency of this workspace and installing it
 * is outside this app's ownership. See `lib/admin-auth.ts` for the full rationale
 * and the threat model.
 *
 * Order of operations, and why:
 *
 * 1. Throttle check, before the body is read. A throttled caller should cost as
 *    little as possible.
 * 2. Body parse, then authenticate. `authenticateOperator` returns `null` for an
 *    unknown identifier, a wrong password, a locked account, a suspended account
 *    and a misconfigured deployment alike, and this route answers all five with
 *    the same status and the same body.
 * 3. Only after a success is a cookie minted. There is no path here that issues a
 *    token to an unverified caller.
 *
 * The body carries `identifier` and `password` — not `email` — because the login
 * accepts either a username or an address. The old field names are not accepted as
 * aliases: keeping `email` working would mean two spellings of one request for no
 * benefit, and this console has exactly one client.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const clientId = clientAddressOf(request)

  try {
    if (isLoginThrottled(clientId)) {
      // Not an audit entry: a throttle is not a credential guess that needs
      // recording, and writing one per request is how an audit table gets filled
      // with noise that hides a real attempt.
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Try again later.' },
        { status: 429 },
      )
    }

    const body = await readJson(request)
    if (body === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const identifier = typeof body.identifier === 'string' ? body.identifier : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const returnTo = typeof body.returnTo === 'string' && body.returnTo.startsWith('/admin/')
      ? body.returnTo
      : '/admin/tenants'

    const operator = await authenticateOperator({ identifier, password })
    if (!operator) {
      recordLoginFailure(clientId)
      // Best effort, and deliberately so: an audit table that is unreachable must
      // not stop an operator signing in to fix the thing that made it unreachable.
      // Tenant mutations do not get this leniency — see `lib/queries.ts`.
      //
      // `operatorId` is absent here and that is not an oversight: a refused attempt
      // may not have named a real operator, and inventing one would attribute a
      // guessed credential to a named person. The refusal is attributable to the
      // client address instead.
      await auditPlatformAction({
        action: AdminAuditAction.LOGIN_FAILED,
        entity: 'operator',
        description: `Failed operator sign-in from ${clientId}`,
        ipAddress: clientId,
        userAgent: request.headers.get('user-agent'),
      }).catch((error: unknown) => {
        console.error('[super-admin] Could not record a failed sign-in:', error)
      })
      return NextResponse.json({ error: LOGIN_FAILURE }, { status: 401 })
    }

    clearLoginFailures(clientId)

    // Unlike the failed attempt above, this is not best-effort. Platform-operator
    // access has to be auditable, and a session handed out without a matching audit
    // row is exactly the unauditable access that requirement exists to prevent.
    // The cookie is issued only after this resolves, so refusing here leaves no
    // session behind rather than an untraceable one.
    try {
      await auditPlatformAction({
        action: AdminAuditAction.LOGIN,
        entity: 'operator',
        entityId: operator.id,
        operatorId: operator.id,
        description: `Operator ${operator.username} signed in from ${clientId}`,
        ipAddress: clientId,
        userAgent: request.headers.get('user-agent'),
      })
    } catch (error) {
      console.error('[super-admin] Refusing sign-in: could not record the audit entry:', error)
      return NextResponse.json(
        { error: 'Sign-in cannot be completed: the audit log is unavailable.' },
        { status: 503 },
      )
    }

    const response = NextResponse.json({ operator: toOperatorProfile(operator), returnTo })
    response.cookies.set(
      ADMIN_SESSION_COOKIE,
      createSessionToken(operator),
      adminSessionCookieOptions(),
    )
    return response
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}