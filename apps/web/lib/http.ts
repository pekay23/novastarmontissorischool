import { NextResponse, type NextRequest } from 'next/server'
import type { AdminContext } from '@/lib/admin-context'
import type { TenantMutationContext } from '@/lib/queries'
import { PaginationQuerySchema, type PaginationQuery } from '@/types/admin'

/**
 * Request-level helpers shared by the route handlers.
 *
 * Small on purpose. Each of these exists because the same three lines were about
 * to be written in five routes with a slight difference in each, and a difference
 * in `clientAddressOf` between the throttle key and the audit entry is a
 * difference an operator cannot see and a reader cannot account for.
 */

/**
 * The client address, for throttling and for the audit entry.
 *
 * `x-forwarded-for` is trusted only because this app is not meant to sit behind an
 * arbitrary caller: it is deployed behind the same reverse proxy as the portal. A
 * deployment that exposes it directly would let a caller rotate the header and
 * reset a throttle window on every attempt, which is why the login limiter is
 * documented as a mitigation rather than a control.
 */
export function clientAddressOf(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

/**
 * What a mutation's audit entry is attributed to.
 *
 * The operator's id and address both come from the *verified session*, never from
 * a request field, so a caller cannot file an action under somebody else's name.
 *
 * `operatorId` is what makes the entry attributable: `AuditLog.userId` stays
 * `null` because the operator has no `User` row, and pointing it at the nearest
 * school administrator would attribute a platform-wide action to a tenant member
 * who did not perform it. The two identities are separate columns and a console
 * entry names exactly one of them.
 */
export function mutationContext(context: AdminContext, request: NextRequest): TenantMutationContext {
  return {
    operatorId: context.operator.id,
    operatorEmail: context.operator.email,
    ipAddress: clientAddressOf(request),
    userAgent: request.headers.get('user-agent'),
  }
}

/**
 * The `?take=`/`?skip=` window.
 *
 * `safeParse` rather than `parse` on purpose: a hand-edited `?take=999999` is not
 * a 500, it is the default page. The bounds inside the schema are the real
 * control, and this keeps an unreadable value from turning a list page into an
 * error page.
 */
export function parsePagination(url: string): PaginationQuery {
  const params = new URL(url).searchParams
  const parsed = PaginationQuerySchema.safeParse({
    take: params.get('take') ?? undefined,
    skip: params.get('skip') ?? undefined,
  })
  return parsed.success ? parsed.data : { take: 25, skip: 0 }
}

/** A JSON body with `no-store`, which every response in this app carries. */
export function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'private, no-store' } })
}
