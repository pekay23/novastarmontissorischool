import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_SESSION_COOKIE, ADMIN_TENANT_COOKIE, verifySessionToken } from '@/lib/admin-auth'
import { AdminAuditAction, auditPlatformAction } from '@/lib/audit'
import { toErrorResponse } from '@/lib/errors'
import { clientAddressOf } from '@/lib/http'

/**
 * `POST /api/auth/logout` — drop the session cookie and the selected tenant.
 *
 * Answers 204 whether or not a session existed. A logout that reports "you were not
 * signed in" is a session oracle: it tells an unauthenticated caller whether a
 * token they happened to hold was ever valid.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
    const claims = verifySessionToken(token)

    // Only a signature that actually verifies gets an entry. A stale token being
    // discarded is not an event worth a row, and writing one for any presented
    // token would let a caller fill the audit table.
    //
    // The live-row re-read that `requireOperator` does is deliberately NOT repeated
    // here. A sign-out is a refusal to act, not an action: it needs no capability,
    // it destroys the caller's own cookie either way, and re-reading the row would
    // mean an unauthenticated endpoint paying a database query an attacker controls
    // the rate of. What it does need is to be attributable, so the entry names the
    // operator the *verified* token claims — `operatorId` is a foreign key, so a
    // token naming an id that no longer exists makes the write fail and the entry is
    // dropped rather than dangling.
    // Best effort, and deliberately the opposite of `login`, which refuses to issue
    // a session it could not audit. Refusing to complete a sign-out would leave the
    // operator authenticated because the audit table was briefly unavailable — a
    // worse outcome than a missing LOGOUT row, and one an attacker could engineer by
    // breaking the audit write first. Ending the session always succeeds; the gap is
    // logged.
    if (claims) {
      await auditPlatformAction({
        action: AdminAuditAction.LOGOUT,
        entity: 'operator',
        entityId: claims.id,
        operatorId: claims.id,
        description: `Operator ${claims.username} signed out from ${clientAddressOf(request)}`,
        ipAddress: clientAddressOf(request),
        userAgent: request.headers.get('user-agent'),
      }).catch((error: unknown) => {
        console.error('[super-admin] Could not record a sign-out:', error)
      })
    }

    const response = new NextResponse(null, { status: 204 })
    // An expired maxAge is the delete: the same path, and the same cookie name.
    response.cookies.set(ADMIN_SESSION_COOKIE, '', { path: '/', maxAge: 0 })
    response.cookies.set(ADMIN_TENANT_COOKIE, '', { path: '/', maxAge: 0 })
    return response
  } catch (error) {
    return toErrorResponse(error)
  }
}