import GoogleProvider from 'next-auth/providers/google'
import type { Provider } from 'next-auth/providers/index'

/**
 * Google and Microsoft sign-in for the portal: which providers exist, and the
 * one rule that decides whether a returning visitor gets a session.
 *
 * Everything here is deliberately free of server-only imports — no prisma, no
 * `server-only`, no `next/headers` — so the sign-in page can import the button
 * labels and the refusal messages from the same definitions the server refuses
 * with. A message that exists in two places is a message that eventually
 * explains something the code no longer does.
 *
 * The database work lives in `sso-signin.ts`, which supplies the dependencies
 * `resolveSsoAccount` needs. That split is the whole testability story: the
 * rules that must not regress — who may sign in, whose account, whose school —
 * are a pure function over injected collaborators, so a test drives every
 * refusal without a provider, a network, or a database.
 */

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const SSO_GOOGLE_PROVIDER_ID = 'google'

/**
 * Not `azure-ad`.
 *
 * next-auth v4 ships a provider under that id, and it is the wrong one twice
 * over: it reads the legacy v1.0 endpoints, and it fetches a profile photo from
 * Graph with a scope the portal never asks for. The id is also what is written
 * to `Account.provider`, so a name that could be confused with the legacy
 * provider's would put two different meanings in one column. This is the
 * Microsoft Entra ID provider, spelled the way Auth.js v5 spells it, on the v2.0
 * endpoints.
 */
export const SSO_MICROSOFT_PROVIDER_ID = 'microsoft-entra-id'

export type SsoProviderId = typeof SSO_GOOGLE_PROVIDER_ID | typeof SSO_MICROSOFT_PROVIDER_ID

/** The per-tenant switch each provider is gated by, from `lib/system-config.ts`. */
export type SsoFlagKey = 'sso_google' | 'sso_microsoft'

/**
 * Whether the provider makes a machine-checkable statement about the address.
 *
 * `required-claim` — the provider returns an `email_verified` flag, and its
 * absence is a refusal. Google does, in both the ID token and userinfo.
 *
 * `no-claim` — the provider returns no such flag at all, so demanding one would
 * refuse every sign-in including the ones that should succeed. Microsoft Entra
 * ID's v2.0 userinfo response carries `sub`, `name`, `given_name`,
 * `family_name`, `picture` and `email`, and no `email_verified`; its ID token
 * does not carry one either. The address it returns is directory-managed for a
 * work or school account, and a verified primary alias for a personal account,
 * so Microsoft has verified it even though it does not say so in the response.
 *
 * Under BOTH rules an explicit `email_verified: false` is a refusal. Only the
 * difference is whether silence counts as an answer.
 */
export type EmailVerificationRule = 'required-claim' | 'no-claim'

export interface SsoProviderDescriptor {
  id: SsoProviderId
  /** The name on the sign-in button and in every message a visitor reads. */
  label: string
  /**
   * The per-tenant switch. The environment variables are the hard prerequisite;
   * this is the only thing a Head of School can change.
   */
  flagKey: SsoFlagKey
  emailVerification: EmailVerificationRule
  clientId: string
  clientSecret: string
}

/**
 * The environment variables each provider is configured from.
 *
 * Named in one place so the deployment guide, `.env.example` and this module
 * cannot disagree about what to call them.
 */
export const SSO_PROVIDER_ENV: Record<SsoProviderId, { clientId: string; clientSecret: string }> = {
  [SSO_GOOGLE_PROVIDER_ID]: {
    clientId: 'GOOGLE_CLIENT_ID',
    clientSecret: 'GOOGLE_CLIENT_SECRET',
  },
  [SSO_MICROSOFT_PROVIDER_ID]: {
    clientId: 'MICROSOFT_ENTRA_ID_CLIENT_ID',
    clientSecret: 'MICROSOFT_ENTRA_ID_CLIENT_SECRET',
  },
}

/** Registry order, so the provider list and every message derived from it are stable. */
const SSO_PROVIDER_ORDER = [SSO_GOOGLE_PROVIDER_ID, SSO_MICROSOFT_PROVIDER_ID] as const

/**
 * The scopes this portal asks either provider for.
 *
 * Identity only. The portal authenticates people; it reads no Google Drive, no
 * Microsoft Graph, no mail and no calendar, so asking for more would enlarge what
 * an attacker could reach by compromising one credential for no benefit here.
 * It would also change what the operator has to do before the button works: any
 * additional Google scope moves the app into verification territory, and the
 * Microsoft equivalent needs admin consent for anything beyond these three.
 * See `docs/technical/2026-10-03_193000-sso-oauth-provider-setup.md`.
 */
export const SSO_SCOPE = 'openid email profile'

const SSO_PROVIDER_METADATA: Record<
  SsoProviderId,
  { label: string; flagKey: SsoFlagKey; emailVerification: EmailVerificationRule }
> = {
  [SSO_GOOGLE_PROVIDER_ID]: {
    label: 'Google',
    flagKey: 'sso_google',
    emailVerification: 'required-claim',
  },
  [SSO_MICROSOFT_PROVIDER_ID]: {
    label: 'Microsoft',
    flagKey: 'sso_microsoft',
    emailVerification: 'no-claim',
  },
}

/**
 * The display name for a provider id, or `null` for an id this app does not own.
 *
 * The sign-in page renders only the providers NextAuth reports, so it never sees
 * an unknown id in practice; the `null` arm is there so a crafted URL parameter
 * produces no text rather than an unlabelled string.
 */
export function ssoProviderLabel(id: string): string | null {
  return id in SSO_PROVIDER_METADATA ? SSO_PROVIDER_METADATA[id as SsoProviderId].label : null
}

// ---------------------------------------------------------------------------
// Registration — absent credentials means no provider at all
// ---------------------------------------------------------------------------

/**
 * The providers this deployment can actually offer, in registry order.
 *
 * A provider whose client id or secret is absent or blank is simply not
 * returned, and `buildSsoProviders` therefore does not register it. That is the
 * point: registering it anyway produces a provider NextAuth lists on
 * `/api/auth/providers` — which is where the sign-in page reads its button list
 * from, so a button would appear — and fails at the moment somebody clicks it,
 * after the round trip has already cost them a Google page and a click.
 *
 * `providerAccountId`/secret pairs are read from the environment exactly once,
 * here, and the resulting list is what both the provider list and every refusal
 * message are derived from. Nothing else in the app re-reads these variables.
 */
export function readConfiguredSsoProviders(
  env: Record<string, string | undefined> = process.env
): SsoProviderDescriptor[] {
  const configured: SsoProviderDescriptor[] = []

  for (const id of SSO_PROVIDER_ORDER) {
    const names = SSO_PROVIDER_ENV[id]
    const clientId = env[names.clientId]?.trim()
    const clientSecret = env[names.clientSecret]?.trim()

    // Trimmed, because a variable set to a single space is a paste accident
    // rather than a credential, and NextAuth would accept it as one.
    if (!clientId || !clientSecret) continue

    configured.push({ id, ...SSO_PROVIDER_METADATA[id], clientId, clientSecret })
  }

  return configured
}

/** Whether this deployment has credentials for `id`. */
export function isSsoProviderConfigured(
  id: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  return readConfiguredSsoProviders(env).some((provider) => provider.id === id)
}

function googleSignInProvider(descriptor: SsoProviderDescriptor): Provider {
  return GoogleProvider({
    clientId: descriptor.clientId,
    clientSecret: descriptor.clientSecret,
    authorization: {
      params: {
        scope: SSO_SCOPE,
        // Google's account chooser. Without it Google silently signs in whichever
        // account it considers current, and a visitor who means their school
        // address but is signed in to a personal one gets the "no account at this
        // school" refusal for an identity they never chose.
        prompt: 'select_account',
      },
    },
  })
}

/**
 * Microsoft Entra ID (v2.0), including personal Microsoft accounts.
 *
 * `wellKnown` on the `common` authority rather than explicit endpoint URLs,
 * because `common` is the only authority that resolves personal accounts as well
 * as work and school ones, and because discovery is what keeps the endpoint list
 * from being a copy that goes stale.
 *
 * `idToken` is deliberately absent. With it set, next-auth validates the ID
 * token's `iss` against the discovered issuer, and on `common` that issuer is
 * `https://login.microsoftonline.com/common/v2.0` while the token carries the
 * tenant-specific `https://login.microsoftonline.com/<tenant-id>/v2.0` — so every
 * sign-in would fail on an issuer mismatch. Leaving it off makes next-auth read
 * the profile from the userinfo endpoint, which is the same call Google's
 * provider makes for accounts that have no ID token and carries the same claims.
 *
 * `checks: ['pkce', 'state']` is the same pair next-auth's own Google provider
 * uses. Both checks are opt-in, so a custom provider that omits them sends an
 * authorization request with no CSRF state at all.
 */
function microsoftEntraIdProvider(descriptor: SsoProviderDescriptor): Provider {
  return {
    id: SSO_MICROSOFT_PROVIDER_ID,
    name: descriptor.label,
    type: 'oauth',
    wellKnown: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
    clientId: descriptor.clientId,
    clientSecret: descriptor.clientSecret,
    authorization: { params: { scope: SSO_SCOPE, prompt: 'select_account' } },
    checks: ['pkce', 'state'],
    profile(claims: Record<string, unknown>) {
      // `email` first, `preferred_username` second. For a personal Microsoft
      // account Entra reports the login alias in `preferred_username`, and that
      // alias is the verified primary address the account was created with, so
      // it is an assertion by Microsoft rather than something the visitor typed.
      const email =
        typeof claims.email === 'string' && claims.email
          ? claims.email
          : typeof claims.preferred_username === 'string'
            ? claims.preferred_username
            : null

      return {
        id: typeof claims.sub === 'string' ? claims.sub : '',
        name: typeof claims.name === 'string' ? claims.name : null,
        email,
        image: typeof claims.picture === 'string' ? claims.picture : null,
      }
    },
    // Present so next-auth records which credentials the provider was built with,
    // matching what the built-in providers do. Not a second source of truth:
    // `readConfiguredSsoProviders` is.
    options: { clientId: descriptor.clientId, clientSecret: descriptor.clientSecret },
  }
}

/**
 * The provider list `authOptions.providers` is built from.
 *
 * Credentials stays at index 0 in `auth.ts`, not here — this function returns
 * only the OAuth providers, appended after it.
 */
export function buildSsoProviders(
  env: Record<string, string | undefined> = process.env
): Provider[] {
  return readConfiguredSsoProviders(env).map((descriptor) =>
    descriptor.id === SSO_GOOGLE_PROVIDER_ID
      ? googleSignInProvider(descriptor)
      : microsoftEntraIdProvider(descriptor)
  )
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * Every reason an OAuth sign-in can be turned down.
 *
 * Namespaced with an `sso_` prefix so they cannot collide with the codes
 * next-auth writes into the same `error` query parameter (`AccessDenied`,
 * `OAuthAccountNotLinked`, `CredentialsSignin`, …), and so the sign-in page can
 * tell "we refused this deliberately" from "something went wrong".
 */
export const SSO_REFUSAL_REASONS = [
  'sso_unknown_provider',
  'sso_no_email',
  'sso_email_unverified',
  'sso_no_school_code',
  'sso_unknown_school',
  'sso_disabled_for_school',
  'sso_no_account',
  'sso_account_suspended',
  'sso_account_inactive',
  'sso_password_not_set',
  'sso_identity_linked_elsewhere',
] as const

export type SsoRefusalReason = (typeof SSO_REFUSAL_REASONS)[number]

/** The raw claims the provider returned, narrowed to the fields this file reads. */
export interface SsoProviderClaims {
  /** The provider's stable identifier for this person. */
  sub?: string | null
  email?: unknown
  email_verified?: unknown
}

/**
 * What a refusal is, in words the person signing in can act on.
 *
 * Held here rather than in the callback so the sign-in page — which only ever
 * receives the code, in a query parameter — can render the same sentence the
 * server chose, without the server putting free text into a URL.
 *
 * `null` for an unrecognised code, so a crafted `?error=` renders nothing
 * instead of echoing an attacker's sentence back into the page.
 */
export function ssoRefusalMessage(
  reason: string,
  providerLabel?: string | null
): string | null {
  const provider = providerLabel ?? 'this sign-in method'

  const messages: Record<SsoRefusalReason, string> = {
    sso_unknown_provider: 'That sign-in method is not available. Contact your school administrator.',
    sso_no_email: `${provider} did not send an email address, so we cannot match you to an account.`,
    sso_email_unverified: `${provider} has not confirmed this email address, so we cannot match you to an account.`,
    sso_no_school_code: 'Enter your school code before choosing a sign-in method.',
    sso_unknown_school: 'That school code was not recognised. Check it with your Head of School.',
    sso_disabled_for_school: `Sign-in with ${provider} is not switched on for your school. Ask your Head of School to turn it on.`,
    sso_no_account: `No portal account exists at your school for this email address. Your Head of School has to create one before you can sign in this way.`,
    sso_account_suspended: 'This account has been suspended. Contact your school administration.',
    sso_account_inactive: 'This account is no longer active. Contact your school administration.',
    sso_password_not_set:
      'This account still needs a password before single sign-on can be used. Use the setup link your administrator sent you.',
    sso_identity_linked_elsewhere: `This ${provider} account is already linked to a different portal account. Sign in with your password, or ask your Head of School to unlink it.`,
  }

  return Object.hasOwn(messages, reason) ? messages[reason as SsoRefusalReason] : null
}

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

/**
 * The `User` columns the decision below depends on. Deliberately narrow: the
 * resolution reads these and nothing else, so a new column cannot quietly become
 * part of what decides who gets a session.
 */
export interface SsoUserRecord {
  id: string
  tenantId: string
  email: string
  status: string
  /**
   * Whether the account still owes its first password. Combined with
   * `passwordChangedAt` this is the same expression every `authorize()` return
   * value uses.
   */
  mustChangePassword: boolean
  passwordChangedAt: Date | null
}

/** The token fields `Account` stores, as next-auth hands them to the callback. */
export interface SsoTokenSet {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  id_token?: string
  scope?: string
  token_type?: string
  session_state?: string
}

export interface SsoAccountLink {
  id: string
  userId: string
}

/**
 * The collaborators `resolveSsoAccount` needs. Every one is injected so the
 * rules can be exercised against plain data.
 */
export interface SsoResolutionDeps {
  /** The school the typed code named, or `null` when it names none. */
  findSchool: (code: string) => Promise<{ id: string } | null>
  /**
   * The account at `schoolId` whose address matches `email` without regard to
   * case, or `null`.
   */
  findUserByEmail: (args: { schoolId: string; email: string }) => Promise<SsoUserRecord | null>
  /** The existing linkage for this provider identity, or `null`. */
  findAccountLink: (args: {
    provider: string
    providerAccountId: string
  }) => Promise<SsoAccountLink | null>
  /**
   * Write the linkage. Must be idempotent on `(provider, providerAccountId)`, so
   * two concurrent first-time sign-ins converge instead of one of them failing.
   */
  createAccountLink: (args: {
    userId: string
    provider: string
    providerAccountId: string
    tokens: SsoTokenSet
  }) => Promise<void>
  /** The tenant's setting for the provider's feature flag. */
  isTenantFlagEnabled: (tenantId: string, flagKey: SsoFlagKey) => Promise<boolean>
}

export interface SsoResolutionInput {
  provider: string
  /** The provider's stable identifier for this person. */
  providerAccountId: string
  claims: SsoProviderClaims
  /** The school code carried across the redirect, or `null` when there was none. */
  schoolCode: string | null
  tokens: SsoTokenSet
}

/**
 * What a refusal knows about the attempt behind it.
 *
 * Present only once a real account has been identified, so an audit entry can
 * name a tenant and a person. Absent on the refusals that happen before any
 * account is found, because there is nothing to attribute the attempt to.
 */
export interface SsoRefusalContext {
  userId?: string
  tenantId?: string
  schoolId?: string
}

export type SsoResolution =
  | {
      allowed: true
      userId: string
      tenantId: string
      /** `false` when the linkage was already there — nothing was written. */
      linked: boolean
    }
  | { allowed: false; reason: SsoRefusalReason; context?: SsoRefusalContext }

/** Statuses that end a person's access, matching the checks in `authorize()`. */
const INACTIVE_STATUSES = new Set(['SUSPENDED', 'ARCHIVED', 'DELETED'])

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

/**
 * Whether the provider's claim about the address is good enough, and the reason
 * it is not when it is not.
 *
 * An explicit `false` is a refusal under both rules. A provider that asserts
 * nothing at all is a refusal only when the provider is one that does assert:
 * see `EmailVerificationRule`, which is where that asymmetry is explained.
 */
export function evaluateEmailVerification(
  rule: EmailVerificationRule,
  claims: SsoProviderClaims
): SsoRefusalReason | null {
  if (claims.email_verified === false) return 'sso_email_unverified'
  if (rule === 'required-claim' && claims.email_verified !== true) return 'sso_email_unverified'
  return null
}

/**
 * Decide whether a returning visitor gets a session, and persist the linkage
 * that makes the next visit a lookup rather than a question.
 *
 * The order below is the decision, and each step can only turn it down:
 *
 *   1. The provider is one this app registered.
 *   2. The provider asserted an address at all.
 *   3. The provider vouched for that address, or is one that vouches by
 *      construction.
 *   4. A school code survived the redirect.
 *   5. That code names a school.
 *   6. The school has switched this provider on.
 *   7. An account already exists at that school for that address.
 *   8. That account is active.
 *   9. That account is not still waiting for its first password.
 *  10. This provider identity is not already linked to somebody else's account.
 *
 * Step 7 is the one the rest of the system cannot supply. `@auth/prisma-adapter`
 * is wired into `authOptions`, but it cannot create a user here: `User.tenantId`
 * is non-nullable, so its `createUser` has no tenant to write, and the only email
 * uniqueness the schema offers is `@@unique([tenantId, email])` while the
 * adapter's `getUserByEmail` looks the address up with `findUnique({ where: {
 * email } })`, which that schema cannot satisfy. So nothing is auto-provisioned
 * here: no `User` is created, no `Session` is minted, and an address nobody
 * pre-created is a refusal with a name. An administrator creates the account
 * first, or there is no account.
 *
 * Nor is anything linked by address. `allowDangerousEmailAccountLinking` would
 * do exactly that, and an attacker who can get an OAuth identity asserting
 * somebody else's address would inherit that person's school portal. The address
 * is a lookup key here and nothing more.
 *
 * Step 10 is the second account at the same address. `Account` is unique on
 * `(provider, providerAccountId)`, so one Google or Microsoft identity can be
 * bound to one portal account, full stop. Someone who genuinely has accounts at
 * two schools cannot sign in to the second with the same provider — and that is
 * the correct outcome rather than an inconvenience: the alternative is a single
 * OAuth identity that walks into whichever school its bearer names. The refusal
 * is named so it is not mistaken for "no account".
 */
export async function resolveSsoAccount(
  deps: SsoResolutionDeps,
  input: SsoResolutionInput
): Promise<SsoResolution> {
  const descriptor =
    input.provider in SSO_PROVIDER_METADATA
      ? SSO_PROVIDER_METADATA[input.provider as SsoProviderId]
      : null
  if (!descriptor) return { allowed: false, reason: 'sso_unknown_provider' }

  const email = firstNonEmptyString(input.claims.email)?.toLowerCase() ?? null
  if (!email) return { allowed: false, reason: 'sso_no_email' }

  const verification = evaluateEmailVerification(descriptor.emailVerification, input.claims)
  if (verification) return { allowed: false, reason: verification }

  if (!input.schoolCode) return { allowed: false, reason: 'sso_no_school_code' }

  const school = await deps.findSchool(input.schoolCode)
  if (!school) return { allowed: false, reason: 'sso_unknown_school' }

  // Scoped by school, which is what scopes it by tenant: a school belongs to
  // exactly one tenant, and `resolveSchool` matches on a primary key. A user
  // with no school is unreachable here for the same reason it is unreachable
  // through `authorize()`, which also filters on `schoolId`.
  const user = await deps.findUserByEmail({ schoolId: school.id, email })
  if (!user) return { allowed: false, reason: 'sso_no_account' }

  if (!(await deps.isTenantFlagEnabled(user.tenantId, descriptor.flagKey))) {
    return {
      allowed: false,
      reason: 'sso_disabled_for_school',
      context: { userId: user.id, tenantId: user.tenantId, schoolId: school.id },
    }
  }

  if (user.status === 'SUSPENDED') {
    return {
      allowed: false,
      reason: 'sso_account_suspended',
      context: { userId: user.id, tenantId: user.tenantId, schoolId: school.id },
    }
  }
  if (INACTIVE_STATUSES.has(user.status)) {
    return {
      allowed: false,
      reason: 'sso_account_inactive',
      context: { userId: user.id, tenantId: user.tenantId, schoolId: school.id },
    }
  }

  // The proxy sends any session carrying this flag to the setup page, and that
  // page is reached by an emailed link. A visitor arriving through a provider has
  // no such link, so allowing them in would drop them on a page they cannot
  // leave. The account has to be given a password first — which the same
  // expression already requires of every `authorize()` return value.
  if (user.mustChangePassword && !user.passwordChangedAt) {
    return {
      allowed: false,
      reason: 'sso_password_not_set',
      context: { userId: user.id, tenantId: user.tenantId, schoolId: school.id },
    }
  }

  const existing = await deps.findAccountLink({
    provider: input.provider,
    providerAccountId: input.providerAccountId,
  })

  if (existing) {
    if (existing.userId !== user.id) {
      return {
        allowed: false,
        reason: 'sso_identity_linked_elsewhere',
        context: { userId: user.id, tenantId: user.tenantId, schoolId: school.id },
      }
    }
    return { allowed: true, userId: user.id, tenantId: user.tenantId, linked: false }
  }

  await deps.createAccountLink({
    userId: user.id,
    provider: input.provider,
    providerAccountId: input.providerAccountId,
    tokens: input.tokens,
  })

  return { allowed: true, userId: user.id, tenantId: user.tenantId, linked: true }
}