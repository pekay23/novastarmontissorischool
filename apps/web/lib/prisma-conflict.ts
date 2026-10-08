import { NextResponse } from 'next/server'

/**
 * The one place a Prisma unique-constraint violation is recognised.
 *
 * Prisma reports `P2002` when a write collides with a `@@unique` or `@unique`
 * constraint. For every model that carries one, that is an ordinary client
 * outcome — the row the caller wanted already exists — so it answers 409, not
 * 500. Reported as a 500 it misreports the fault and buries routine use in the
 * error log and on the platform-errors page.
 *
 * Matched on `name` and `code` rather than with `instanceof`. `instanceof`
 * silently returns false when the thrown error came from a second copy of
 * `@prisma/client` — which a hoisted monorepo `node_modules` makes possible —
 * and it cannot be exercised from a test that must not open a database
 * connection. Requiring BOTH fields is what keeps this narrow: an unrelated
 * error object that happens to carry a `code` is not caught, because the Prisma
 * error class name is checked alongside it.
 *
 * This helper used to be copy-pasted into six route handlers, each with its own
 * copy of the same rationale. One definition, one rationale, six imports.
 */
export function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'PrismaClientKnownRequestError' &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

/**
 * The 409 body. Same `{ error }` shape as every other response in these routes,
 * with a message the caller can act on rather than a generic fault string.
 */
export function duplicateResponse(
  message = 'A record with these values already exists',
): NextResponse {
  return NextResponse.json({ error: message }, { status: 409 })
}