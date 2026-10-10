import { provisionTenant } from '@novastar/tenant-cli/provision'
import type { ProvisionInput } from '@novastar/tenant-cli/provision'
import { AdminAuditAction } from '@/lib/audit'
import { RequestError, ServerConfigError } from '@/lib/errors'
import { PLATFORM_AUDIT_SCOPE, writeAuditEntry, type TenantMutationContext } from '@/lib/queries'
import { ProvisionRequestSchema, type TenantSummary } from '@/types/admin'

/**
 * Tenant provisioning, shared by `POST /api/tenants` and
 * `POST /api/tenants/:tenantId/provision`.
 *
 * WHY THE IMPORT IS A SUBPATH
 * ---------------------------
 * `@novastar/tenant-cli`'s `index.ts` is a command-line entry point, not a barrel:
 * it exports nothing, calls `main()` at module scope and ends with
 * `process.exit(...)`. Importing the package root from a Next.js route would run
 * the CLI during module initialisation — in the build, in a worker, or in a test —
 * and take the process with it. `tools/tenant-cli/package.json` declares no
 * `exports` map, so `@novastar/tenant-cli/provision` resolves to
 * `tools/tenant-cli/provision.ts`, which is the library half: it reads no argv,
 * writes no terminal and never ends the run. That module was extracted for exactly
 * this caller; re-implementing it here would mean two copies of the transaction,
 * the idempotency key and the field rules.
 */

/** The fields of `ProvisionedTenant` that are safe to put in a response. */
export interface ProvisionOutcome {
  /** False when the code already existed and was reconciled in place. */
  readonly created: boolean
  readonly tenant: TenantSummary & { isActive: boolean }
  readonly school: { id: string; code: string; name: string }
  readonly admin: { id: string; email: string; roleName: string; created: boolean } | null
  readonly permissionsCreated: number
  readonly rolesCreated: number
}

/**
 * Whether the Bun runtime is available.
 *
 * `tools/tenant-cli/provision.ts` hashes the administrator password with
 * `Bun.password` (argon2id, matching `tools/seed`). That is the right primitive and
 * this app does not reimplement it — but it is a Bun global, and `next build` and
 * `next start` run on Node. Provisioning a tenant *without* an administrator
 * never reaches it; provisioning one *with* an administrator does.
 *
 * So the guard is on the admin path only, it names the actual cause, and it fails
 * closed. Refusing loudly is the alternative to a `TypeError: Bun is not defined`
 * halfway through a transaction, which an operator would read as a broken
 * database. The fix is to run this app on the Bun runtime, or to have
 * `tools/tenant-cli` accept a password hasher — which is a change in a workspace
 * this app does not own.
 */
function assertBunRuntimeForAdminHashing(): void {
  const runtime = (globalThis as { Bun?: { password?: unknown } }).Bun
  if (!runtime || typeof runtime.password !== 'object') {
    throw new ServerConfigError(
      'Provisioning a tenant with an administrator requires the Bun runtime: ' +
        "@novastar/tenant-cli's hashPassword calls Bun.password. This app is running on Node. " +
        'Provision without `admin`, create the administrator with `novastar-tenant user`, or ' +
        'run this app on Bun.',
    )
  }
}

interface ResolvedRequest {
  readonly input: ProvisionInput
  readonly adminEmail: string | null
}

/**
 * Turns a request body into `ProvisionInput`, resolving the administrator
 * password from the environment when the body omits it.
 *
 * The password is never echoed, never logged and never written to the audit
 * entry. When it is absent from both the body and `TENANT_ADMIN_PASSWORD`, the
 * shared function's own `assertAdminPassword` throws with a message naming the
 * variable — which is exactly the right behaviour and the reason this wrapper does
 * not invent a default.
 */
function resolveRequest(body: unknown): ResolvedRequest {
  const parsed = ProvisionRequestSchema.safeParse(body)
  if (!parsed.success) {
    throw new RequestError('Invalid provisioning request', 400, parsed.error.issues)
  }
  const request = parsed.data
  const adminEmail = request.admin?.email ?? null

  if (request.admin) {
    assertBunRuntimeForAdminHashing()
    const password = request.admin.password ?? process.env.TENANT_ADMIN_PASSWORD
    if (!password) {
      // Let the shared function produce the message: it knows the minimum length
      // and names TENANT_ADMIN_PASSWORD itself.
      throw new RequestError(
        'An administrator email was supplied without a password. Set TENANT_ADMIN_PASSWORD, ' +
          'or omit `admin` and create the account with `novastar-tenant user`.',
        400,
      )
    }
    return {
      input: {
        tenant: {
          name: request.tenant.name,
          code: request.tenant.code,
          domain: request.tenant.domain ?? null,
          settings: request.tenant.settings,
        },
        school: {
          name: request.school.name,
          code: request.school.code,
          address: request.school.address,
          phone: request.school.phone,
          email: request.school.email,
          established: new Date(request.school.established),
          motto: request.school.motto ?? null,
        },
        admin: {
          email: request.admin.email,
          password,
          roleName: request.admin.roleName,
        },
      },
      adminEmail,
    }
  }

  return {
    input: {
      tenant: {
        name: request.tenant.name,
        code: request.tenant.code,
        domain: request.tenant.domain ?? null,
        settings: request.tenant.settings,
      },
      school: {
        name: request.school.name,
        code: request.school.code,
        address: request.school.address,
        phone: request.school.phone,
        email: request.school.email,
        established: new Date(request.school.established),
        motto: request.school.motto ?? null,
      },
    },
    adminEmail: null,
  }
}

/**
 * Reduces `ProvisionedTenant` to the fields a response may carry.
 *
 * A hand-written projection again: the shared result is a full `Tenant` and a full
 * `School` row, and `School` carries contact details for a school that has not
 * finished being set up. The console needs the identity and the outcome, not the
 * whole row.
 */
function toOutcome(result: Awaited<ReturnType<typeof provisionTenant>>): ProvisionOutcome {
  return {
    created: result.created,
    tenant: {
      id: result.tenant.id,
      name: result.tenant.name,
      code: result.tenant.code,
      domain: result.tenant.domain,
      isActive: result.tenant.isActive,
      createdAt: result.tenant.createdAt.toISOString(),
      updatedAt: result.tenant.updatedAt.toISOString(),
      schoolCount: 1,
      userCount: result.admin ? 1 : 0,
    },
    school: { id: result.school.id, code: result.school.code, name: result.school.name },
    admin: result.admin
      ? {
          id: result.admin.id,
          email: result.admin.email,
          roleName: result.admin.roleName,
          created: result.admin.created,
        }
      : null,
    permissionsCreated: result.permissionsCreated,
    rolesCreated: result.rolesCreated,
  }
}

/**
 * Provisions a tenant that does not exist yet.
 *
 * `provisionTenant` is idempotent by `Tenant.code`, so a repeat of the same
 * request reconciles rather than creating a second tenant — the route can be
 * retried after a timeout without onboarding a school twice.
 */
export async function provisionNewTenant(
  body: unknown,
  context: TenantMutationContext,
): Promise<ProvisionOutcome> {
  const { input, adminEmail } = resolveRequest(body)
  const result = await provisionTenant(input)
  await recordProvisioning(result.tenant.id, result.tenant.code, result.created, adminEmail, context)
  return toOutcome(result)
}

/**
 * Reconciles provisioning onto a tenant that already exists.
 *
 * The guard is the interesting part. The route addressed a tenant by id, and this
 * refuses to provision a *different* one: `provisionTenant` is keyed by
 * `Tenant.code`, so a body naming another code would create or update that other
 * tenant while the operator believed they had touched the one in the URL. That is
 * a cross-tenant write expressed as an ordinary request, so it is refused with a
 * 409 that names both codes.
 *
 * It also refuses a body that tries to supply its own tenant id, for the same
 * reason in a smaller way: the URL is the only thing that addresses a tenant here.
 */
export async function provisionExistingTenant(
  tenantId: string,
  existing: { id: string; code: string },
  body: unknown,
  context: TenantMutationContext,
): Promise<ProvisionOutcome> {
  const { input, adminEmail } = resolveRequest(body)

  if (existing.id !== tenantId) {
    throw new RequestError(
      'The URL tenant does not match the tenant this operator is addressing.',
      409,
    )
  }
  if (input.tenant.code !== existing.code) {
    throw new RequestError(
      `Refusing to provision tenant "${input.tenant.code}" through the route for "${existing.code}". ` +
        'The URL tenant id is the only thing that addresses a tenant here.',
      409,
      { urlTenantId: tenantId, urlTenantCode: existing.code, bodyTenantCode: input.tenant.code },
    )
  }

  const result = await provisionTenant(input)
  await recordProvisioning(result.tenant.id, result.tenant.code, result.created, adminEmail, context)
  return toOutcome(result)
}

/**
 * Records the outcome of a provisioning run.
 *
 * `provisionTenant` owns its own transaction and does not write an audit entry —
 * the CLI has no operator to attribute one to. So it is written here, after, on
 * the tenant the result actually names rather than the code the request asked
 * for: on a reconcile those can only differ if the guard above failed to fire, and
 * this way the entry is right even if they do.
 *
 * Deliberately outside `provisionTenant`'s transaction. A second transaction is a
 * real cost, but the alternative is a shared function that both writes rows and
 * needs an operator identity it has no way of obtaining, and this app does not own
 * that package. The gap is one entry: a failed audit leaves the tenant created and
 * the console reporting a 500, which an operator retries.
 */
async function recordProvisioning(
  tenantId: string,
  tenantCode: string,
  created: boolean,
  adminEmail: string | null,
  context: TenantMutationContext,
): Promise<void> {
  await writeAuditEntry({
    tenantId,
    schoolId: PLATFORM_AUDIT_SCOPE,
    userId: null,
    operatorId: context.operatorId,
    action: AdminAuditAction.TENANT_PROVISION,
    entity: 'tenant',
    entityId: tenantId,
    description:
      `Tenant "${tenantCode}" ${created ? 'provisioned' : 'reconciled'} by ` +
      `${context.operatorEmail}`,
    changes: { code: tenantCode, created, adminEmail },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })
}
