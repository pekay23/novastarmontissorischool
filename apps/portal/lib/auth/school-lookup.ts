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
 * `NEXTAUTH_URL` first, because that is the canonical, configured public origin
 * of this NextAuth deployment; `NEXT_PUBLIC_ORIGIN` as the fallback for setups
 * that only set the public one. A link built from the wrong origin is a link that
 * 404s in the recipient's browser, which for a one-hour reset token is a support
 * call.
 */
export function portalOrigin(): string {
  const configured = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_ORIGIN
  if (!configured) {
    throw new Error(
      'Neither NEXTAUTH_URL nor NEXT_PUBLIC_ORIGIN is set, so no verification or reset link ' +
        'can be built. Set NEXTAUTH_URL in .env (see .env.example).',
    )
  }
  return configured.replace(/\/$/, '')
}
