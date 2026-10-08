import 'server-only'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { resolveSchool } from '@/lib/auth/school-lookup'
import { FEATURE_FLAGS, type FeatureFlagKey } from '@/lib/system-config'
import { isUniqueConstraintViolation } from '@/lib/prisma-conflict'
import { createAuditLog, AuditLogAction } from '@/lib/audit/logger'
import { SSO_SCHOOL_CODE_COOKIE, schoolCodeFromCookie } from '@/lib/auth/sso-school-code'
import {
  resolveSsoAccount,
  ssoProviderLabel,
  type SsoResolutionDeps,
  type SsoTokenSet,
  type SsoUserRecord,
} from '@/lib/auth/sso'

/**
 * The NextAuth `signIn` callback for the OAuth providers: read the school code
 * out of the cookie the redirect left behind, wire the real collaborators into
 * `resolveSsoAccount`, and turn its answer into either "continue" or a redirect
 * that names the refusal.
 *
 * The rules live in `sso.ts`; this file is only the wiring. That split is what
 * keeps the security-critical part a pure function a test can drive end to end.
 */

/** What `resolveSsoAccount` needs to know about an `Account` row on read. */
const ACCOUNT_LINK_SELECT = { id: true, userId: true } as const

/**
 * The tenant's setting for one flag.
 *
 * Reads the override row and falls back to the registry default, which is the
 * rule `resolveFeatureFlags` applies on its read path — a stored `null` is not a
 * meaningful override here either. The default comes from the registry rather
 * than from a literal `false` so a later change to the registry is picked up
 * here without this file being edited, which is the whole reason the registry
 * exists.
 */
async function isTenantFlagEnabled(tenantId: string, flagKey: FeatureFlagKey): Promise<boolean> {
  const row = await prisma.systemConfig.findUnique({
    where: { tenantId_key: { tenantId, key: flagKey } },
    select: { value: true },
  })

  const stored: unknown = row && row.value !== null ? row.value : FEATURE_FLAGS[flagKey].defaultValue
  return stored === true
}

/**
 * The collaborators, bound to this deployment.
 *
 * `findUserByEmail` reproduces `authorize()`'s lookup exactly, including the
 * `OR` with the case-sensitive form: the insensitive comparison is what matches
 * the stored address when it was capitalised differently, and the exact form is
 * there because a case-insensitive scan cannot use the `(tenantId, email)` index.
 * Two shapes of the same query because the credential path has been running on
 * that pair for the life of the app, and SSO must not accept a different set of
 * addresses than the password form does.
 *
 * The `schoolId` in that `where` is what scopes the read to one tenant. A school
 * belongs to exactly one tenant, so scoping by school scopes by tenant, and the
 * same address in a second school's accounts is simply not in the result set.
 */
const deps: SsoResolutionDeps = {
  async findSchool(code) {
    const school = await resolveSchool(code)
    return school ? { id: school.id } : null
  },

  async findUserByEmail({ schoolId, email }) {
    return prisma.user.findFirst({
      where: {
        OR: [{ email: { equals: email, mode: 'insensitive' } }, { email }],
        schoolId,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        status: true,
        mustChangePassword: true,
        passwordChangedAt: true,
      },
    }) as Promise<SsoUserRecord | null>
  },

  async findAccountLink({ provider, providerAccountId }) {
    return prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      select: ACCOUNT_LINK_SELECT,
    })
  },

  /**
   * A `create`, not an upsert.
   *
   * An upsert's update branch would rebind an existing row to the account that
   * happens to be signing in now, which is precisely the cross-tenant takeover
   * `resolveSsoAccount` refuses two lines earlier — it would just be reached
   * through a race instead. Creating and treating the collision as a collision
   * keeps that decision in one place.
   *
   * So two concurrent first-time sign-ins with the same identity both try to
   * create, one wins, and the loser re-reads: if the row is now its own user's,
   * that is the same account linking twice, which is fine. If it belongs to
   * somebody else, the refusal is raised instead of being papered over.
   */
  async createAccountLink({ userId, provider, providerAccountId, tokens }) {
    try {
      await prisma.account.create({ data: { ...tokenColumns(tokens), userId, type: 'oauth', provider, providerAccountId } })
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err

      const winner = await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        select: ACCOUNT_LINK_SELECT,
      })
      if (winner && winner.userId !== userId) {
        throw new SsoIdentityAlreadyLinkedError()
      }
    }
  },

  isTenantFlagEnabled,
}

/** Thrown when the row already exists and belongs to a different portal account. */
class SsoIdentityAlreadyLinkedError extends Error {
  constructor() {
    super('The provider identity is already linked to a different portal account')
    this.name = 'SsoIdentityAlreadyLinkedError'
  }
}

/**
 * Only the columns `Account` actually has, and only the ones next-auth supplies.
 *
 * Spelled out rather than passing the token set through, so a field the token
 * type grows cannot reach a column that does not exist and turn a sign-in into a
 * 500.
 */
function tokenColumns(tokens: SsoTokenSet) {
  return {
    access_token: tokens.access_token ?? null,
    refresh_token: tokens.refresh_token ?? null,
    expires_at: tokens.expires_at ?? null,
    id_token: tokens.id_token ?? null,
    scope: tokens.scope ?? null,
    token_type: tokens.token_type ?? null,
    session_state: tokens.session_state ?? null,
  }
}

/** The sign-in page, with the refusal spelled out. */
function refusalRedirect(reason: string, providerId?: string | null): string {
  const params = new URLSearchParams({ error: reason })
  // The provider is echoed only when it is one of ours, because the sign-in page
  // renders a refusal message naming it and that text must never come from the URL.
  if (providerId && ssoProviderLabel(providerId)) params.set('provider', providerId)

  return `/portal/login?${params.toString()}`
}

/**
 * Refusals worth an audit entry are the ones `resolveSsoAccount` could attribute
 * to an account, which is exactly what carrying a context means — the refusals
 * below the account lookup have nobody to point at, and a row naming no one says
 * nothing an operator could act on. Those still reach the error log and still
 * reach the visitor as a sentence.
 *
 * Distinguishing "no account at this school" from "that account is suspended" is
 * not the existence oracle the credential path avoids. There, an unauthenticated
 * caller guessing an address learns whether it exists. Here the caller has
 * already proved to Google or Microsoft that they control the address, so the
 * answer concerns an account they would already know about — and a Head of School
 * whose staff member cannot tell "sign in with your password" from "ask us to
 * re-activate you" has no way to help them.
 */
export interface SsoSignInParams {
  account: {
    provider: string
    type: string
    providerAccountId: string
    [key: string]: unknown
  } | null
  profile?: Record<string, unknown>
}

/**
 * Resolve an OAuth sign-in.
 *
 * Returns `true` to continue, or the URL to send the visitor to instead. Never
 * throws for an ordinary refusal — next-auth turns a thrown message into
 * `?error=<that message>`, which would put an internal sentence in the address
 * bar — and never returns a URL built from anything the caller supplied.
 */
export async function ssoSignIn({ account, profile }: SsoSignInParams): Promise<boolean | string> {
  // Nothing to resolve without an account, and a provider id with no subject in
  // it has nothing to look up.
  if (!account || !account.providerAccountId) {
    return refusalRedirect('sso_unknown_provider')
  }

  const schoolCode = schoolCodeFromCookie((await cookies()).get(SSO_SCHOOL_CODE_COOKIE)?.value)

  let resolution
  try {
    resolution = await resolveSsoAccount(deps, {
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      claims: {
        sub: typeof profile?.sub === 'string' ? profile.sub : null,
        email: profile?.email ?? profile?.preferred_username,
        email_verified: profile?.email_verified,
      },
      schoolCode,
      tokens: account as SsoTokenSet,
    })
  } catch (err) {
    if (err instanceof SsoIdentityAlreadyLinkedError) {
      return refusalRedirect('sso_identity_linked_elsewhere', account.provider)
    }
    throw err
  }

  if (!resolution.allowed) {
    console.error('[auth] SSO sign-in refused', {
      provider: account.provider,
      reason: resolution.reason,
    })

    const context = resolution.context
    if (context?.userId) {
      await createAuditLog({
        userId: context.userId,
        tenantId: context.tenantId,
        schoolId: context.schoolId,
        action: AuditLogAction.LOGIN_FAILED,
        entity: 'users',
        entityId: context.userId,
        description: `Single sign-in refused (${account.provider}): ${resolution.reason}`,
      }).catch((err) => console.error('[auth] Failed to log SSO refusal:', err))
    }

    return refusalRedirect(resolution.reason, account.provider)
  }

  // Which provider vouched for the address, on every sign-in rather than only on
  // the one that created the linkage. `events.signIn` already records that
  // somebody signed in, but its entry carries the email address and nothing
  // else — so a Microsoft session and a Google session were indistinguishable
  // after the fact, and those two are not the same fact: Google asserts the
  // address is verified and Microsoft does not assert anything (see
  // `EmailVerificationRule`). Naming the provider here is what makes that
  // difference visible to an administrator reading the audit log, and it is the
  // reason `docs/technical/2026-10-03_193000-sso-oauth-provider-setup.md` can tell
  // an operator that the two paths are auditable rather than merely allowed.
  //
  // The provider id, not the display label, because that is what `Account.provider`
  // holds — so the entry can be correlated with the linkage row it describes.
  await createAuditLog({
    userId: resolution.userId,
    action: AuditLogAction.LOGIN,
    entity: 'users',
    entityId: resolution.userId,
    description: `Signed in with ${account.provider} single sign-on`,
    tenantId: resolution.tenantId,
  }).catch((err) => console.error('[auth] Failed to log SSO sign-in:', err))

  // The identity is bound now, and the binding is what lets the next visit be a
  // lookup. Recorded once per account rather than on every sign-in, and it is a
  // different fact from the LOGIN entries above and that `events.signIn` writes:
  // this one says the account became reachable with a third-party identity.
  if (resolution.linked) {
    await createAuditLog({
      userId: resolution.userId,
      action: AuditLogAction.LOGIN,
      entity: 'accounts',
      entityId: resolution.userId,
      description: `Linked the account to ${account.provider} single sign-on`,
      tenantId: resolution.tenantId,
    }).catch((err) => console.error('[auth] Failed to log SSO link:', err))
  }

  return true
}