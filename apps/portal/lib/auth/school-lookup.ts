import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Resolves the school (tenant) a sign-in or account-recovery attempt belongs to.
 *
 * `schoolCode` is optional: when omitted we fall back to DEFAULT_SCHOOL_CODE,
 * which lets single-school deployments (Novastar) sign in without needing to
 * know the internal school code.
 *
 * Returns `null` when the code names no school, or when no code was supplied and
 * `DEFAULT_SCHOOL_CODE` is unset. Callers must treat `null` as "cannot proceed"
 * rather than "no tenant": `User.tenantId` is non-nullable and email uniqueness
 * is `@@unique([tenantId, email])`, so the same address can exist in two tenants
 * and "find the user by email alone" would be a cross-tenant read.
 *
 * Shared by `lib/auth.ts` and the account-recovery routes so all four flows agree
 * on which tenant an attempt belongs to.
 */
export async function resolveSchool(schoolCode?: string | null) {
  if (schoolCode) {
    return prisma.school.findFirst({
      where: { OR: [{ id: schoolCode }, { code: schoolCode }] },
      select: { id: true, name: true },
    })
  }

  const fallbackCode = process.env.DEFAULT_SCHOOL_CODE
  if (!fallbackCode) {
    console.error('[auth] No schoolCode supplied and DEFAULT_SCHOOL_CODE is not set')
    return null
  }

  return prisma.school.findFirst({
    where: { code: fallbackCode },
    select: { id: true, name: true },
  })
}

/**
 * The origin an emailed link should point at.
 *
 * Dynamically determines the correct origin from the request headers when
 * available, falling back to the configured NEXTAUTH_URL or NEXT_PUBLIC_ORIGIN.
 * This follows the Aerojet Academy pattern of request-based URL detection,
 * allowing email links to work correctly regardless of which address the
 * user is accessing the portal from.
 */
/**
 * The set of origins trusted to build email links from.
 *
 * Populated from `NEXTAUTH_URL` (and `NEXT_PUBLIC_ORIGIN` as a fallback) at
 * module load. Request-derived origins are validated against this allowlist
 * before being used: the `Host` and `X-Forwarded-Proto` headers are
 * attacker-controllable when the app is reachable without a trusted reverse
 * proxy, and accepting them unchecked would let an attacker point
 * password-reset and verification emails at a domain they control.
 */
function buildAllowedOrigins(): string[] {
  const candidates = [process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_ORIGIN]
  const origins: string[] = []
  for (const raw of candidates) {
    if (!raw) continue
    try {
      origins.push(new URL(raw).origin)
    } catch {
      // An unparseable configured origin is a deployment error, not a security
      // hole: it is ignored here and surfaced by the throw below when no
      // request-derived origin matches either.
    }
  }
  return origins
}

const ALLOWED_ORIGINS = buildAllowedOrigins()

function originMatchesAllowlist(candidate: string): boolean {
  try {
    const origin = new URL(candidate).origin
    return ALLOWED_ORIGINS.some((allowed) => allowed === origin)
  } catch {
    return false
  }
}

export function portalOrigin(req?: Request): string {
  // Try to determine origin from request headers first, but only if the
  // resolved origin matches a configured allowlist. This prevents host header
  // injection: an attacker who can reach the portal directly (or whose
  // traffic bypasses the proxy's header rewrite) cannot cause email links to
  // point at a domain they control.
  if (req) {
    const host = req.headers.get('host') || ''
    const protocol = req.headers.get('x-forwarded-proto') || 'http'

    if (host) {
      const candidate = `${protocol}://${host}`.replace(/\/$/, '')
      if (originMatchesAllowlist(candidate)) {
        return candidate
      }
    }
  }

  // Fallback to configured environment variables
  const configured = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_ORIGIN
  if (!configured) {
    throw new Error(
      'Neither NEXTAUTH_URL nor NEXT_PUBLIC_ORIGIN is set, so no verification or reset link ' +
        'can be built. Set NEXTAUTH_URL in .env (see .env.example).',
    )
  }
  return configured.replace(/\/$/, '')
}
