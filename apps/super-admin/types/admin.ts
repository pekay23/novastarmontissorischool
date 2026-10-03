/**
 * The wire shapes the control plane exchanges.
 *
 * Every one is a hand-written projection rather than a database row type. That is
 * the point: `Tenant` has 20 relations and `User` carries `passwordHash`,
 * `twoFactorSecret`, `passkeyBridgeToken` and `verifyToken`, so a route that
 * returned either directly would publish credentials to the browser. A named
 * projection means adding a column to the schema cannot add it to a response, and
 * `tests/tenant-routes.test.ts` asserts the response keys are exactly these.
 */

import { z } from 'zod'

/**
 * The fields the tenant list exposes. Listed as data rather than left implicit so
 * a test can assert against it, and so a reviewer can see the surface in one
 * place instead of inferring it from a Prisma `select`.
 *
 * Notably absent: `settings`. `Tenant.settings` is the tenant's own
 * configuration document — language, currency, feature toggles — and it is shown
 * on the tenant's settings page, where an operator has already drilled into that
 * tenant. It has no business in a fleet roster.
 */
export const TENANT_LIST_FIELDS = [
  'id',
  'name',
  'code',
  'domain',
  'isActive',
  'createdAt',
  'updatedAt',
  'schoolCount',
  'userCount',
] as const

export type TenantListField = (typeof TENANT_LIST_FIELDS)[number]

/** The `/api/tenants` response body. */
export interface TenantSummary {
  id: string
  name: string
  code: string
  domain: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  schoolCount: number
  userCount: number
}

/** One tenant in full, as the detail page and `/api/tenants/:id` render it. */
export interface TenantDetail extends TenantSummary {
  settings: Record<string, unknown>
}

export interface SchoolSummary {
  id: string
  tenantId: string
  name: string
  code: string
  email: string
  phone: string
  address: string
  motto: string | null
  established: string
  createdAt: string
  updatedAt: string
}

/**
 * A tenant's user directory.
 *
 * Deliberately does NOT carry `passwordHash`, `twoFactorSecret`,
 * `passkeyBridgeToken` or `verifyToken`. The control plane can see who holds which
 * role and can suspend an account; it has no business reading a credential, and
 * the more fields a cross-tenant console returns, the more a single XSS in this
 * app costs.
 */
export interface TenantUserSummary {
  id: string
  tenantId: string
  schoolId: string | null
  email: string
  name: string | null
  roleName: string | null
  status: string
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
}

/**
 * The body of `POST /api/tenants/:tenantId/users`.
 *
 * `roleName` is a loose string narrowed against the seeded vocabulary by the shared
 * invite function, rather than a `z.enum` here. A schema-level enum and the shared
 * narrowing would be two answers to "what is a role name", and the shared function is
 * the one that has to be right for the portal as well — so this schema only checks the
 * envelope and hands over.
 *
 * `schoolId` is required, not optional: `User.schoolId` is nullable in the schema,
 * but an account with no school cannot have a role resolved and cannot be granted any
 * permission, so creating one here would produce an account locked out of the portal
 * on first sign-in. The route checks it belongs to the tenant in the URL.
 */
export const CreateTenantUserSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().trim().max(160).optional(),
  roleName: z.string().min(1).max(64),
  schoolId: z.string().min(1),
})

/** Whether the one-time setup link reached the recipient. */
export type SetupEmailOutcome = 'sent' | 'failed'

/**
 * What `POST /api/tenants/:tenantId/users` returns.
 *
 * No token, no password, no `verifyToken`. The setup link exists only in the email
 * that was sent, which is the point of not generating a password at all: there is
 * nothing here to leak if this response is ever read by something it was not meant
 * for.
 */
export interface CreatedTenantUser {
  userId: string
  tenantId: string
  schoolId: string
  email: string
  roleName: string
  status: 'created'
  /** False when the account exists but the setup email did not go out. */
  setupEmail: SetupEmailOutcome
  /** Why delivery failed, when it did. `not-configured` names `RESEND_API_KEY`. */
  setupEmailReason: string | null
  /** The deadline stated in the email, as an ISO timestamp. */
  setupLinkExpiresAt: string
}

export type AuditOutcome = 'healthy' | 'degraded' | 'unavailable'

export interface HealthCheck {
  readonly id: string
  readonly label: string
  readonly outcome: AuditOutcome
  /** Already-safe text. Never a connection string, never a stack trace. */
  readonly detail: string
}

export interface PlatformHealth {
  readonly generatedAt: string
  readonly checks: readonly HealthCheck[]
  readonly totals: {
    readonly tenants: number
    readonly activeTenants: number
    readonly schools: number
    readonly users: number
    readonly auditEntries: number
  }
  /** The *name* of the variable in play, never its value. */
  readonly databaseSource: 'SUPER_ADMIN_DATABASE_URL' | 'DATABASE_URL' | 'unset'
}

export interface AuditEntrySummary {
  id: string
  tenantId: string
  schoolId: string
  /** The tenant member, when the action was taken inside a tenant. */
  userId: string | null
  /**
   * The platform operator, when the action was taken from the cross-tenant console.
   *
   * A sibling of `userId` and not a replacement. Exactly one of the two is set on
   * any entry written by this codebase, and an entry written before per-operator
   * accounts existed has neither — see `AuditLog.operatorId` in the schema.
   */
  operatorId: string | null
  action: string
  entity: string
  entityId: string | null
  description: string | null
  createdAt: string
}

export interface Paged<T> {
  data: T[]
  meta: {
    total: number
    take: number
    skip: number
    hasMore: boolean
  }
}

/** The `?take=`/`?skip=` window, bounded so a client cannot ask for the whole table. */
export const PaginationQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(25),
  skip: z.coerce.number().int().min(0).max(100_000).default(0),
})

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>

/**
 * The body of `POST /api/tenants`.
 *
 * Shape mirrors `ProvisionInput` from `@novastar/tenant-cli/provision` but is
 * declared here as a loose container: the shared function is the authority on
 * what a valid tenant is, and duplicating its field rules in a second schema
 * would be a second thing to keep in step. This only checks that the envelope
 * exists and is an object, then hands over.
 */
export const ProvisionRequestSchema = z.object({
  tenant: z.object({
    name: z.string(),
    code: z.string(),
    domain: z.string().nullish(),
    settings: z.record(z.string(), z.unknown()).optional(),
  }),
  school: z.object({
    name: z.string(),
    code: z.string(),
    address: z.string(),
    phone: z.string(),
    email: z.string(),
    established: z.union([z.string(), z.date()]),
    motto: z.string().nullish(),
  }),
  admin: z
    .object({
      email: z.string(),
      /**
       * Optional here and defaulted from `TENANT_ADMIN_PASSWORD`. The field
       * exists so an operator can onboard a tenant from a script; when it is
       * omitted, nothing is generated and nothing is defaulted to a guess.
       */
      password: z.string().min(1).optional(),
      roleName: z.string().optional(),
    })
    .optional(),
})
