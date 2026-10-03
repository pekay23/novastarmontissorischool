/**
 * The shared tenant provisioning function.
 *
 * `apps/super-admin` imports `provisionTenant` from this package, so this file is
 * a library, not a CLI module. It reads no command-line arguments, writes to no
 * terminal, and never ends the run: it takes an input object, returns a result
 * object, and leaves talking to a human to the caller. Everything that prints
 * lives in `commands/`.
 *
 * The one platform API it reaches for is `Bun.password`, which hashes rather
 * than prints.
 */
import { prisma } from "@novastar/database";
import type { Prisma, School, Tenant } from "@novastar/database";
import { PERMISSION_CATALOG, PLATFORM_ROLE_NAMES, permissionsForRole } from "@novastar/shared-types";
import {
  ValidationError,
parseEstablished,
  parseOptionalSettings,
  validateCode,
  validateDomain,
  validateEmail,
} from "./validate";

/**
 * The role granted to the initial administrator when the caller names none.
 * `HEADMASTER` is the platform role identifier (user-facing copy calls it
 * Head of School); it is the widest grant in `PLATFORM_ROLE_NAMES`.
 */
export const DEFAULT_ADMIN_ROLE = "HEADMASTER";

/**
 * A provisioned administrator with no password is a tenant nobody can sign in
 * to. There is no default and no generated value: the caller must supply one, or
 * omit `admin` entirely and create the account later with `commands/user.ts`.
 */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

export const ADMIN_PASSWORD_ENV_VAR = "TENANT_ADMIN_PASSWORD";

export interface ProvisionInput {
  tenant: {
    name: string;
    code: string;
    domain?: string | null;
    settings?: Record<string, unknown>;
  };
  school: {
    name: string;
    code: string;
    address: string;
    phone: string;
    email: string;
    established: Date;
    motto?: string | null;
  };
  admin?: { email: string; password: string; roleName?: string };
}

export interface ProvisionedAdmin {
  readonly id: string;
  readonly email: string;
  readonly roleName: string;
  /** False when the account already existed and was left untouched. */
  readonly created: boolean;
}

export interface ProvisionedTenant {
  /** False when a tenant with this `code` already existed and was updated in place. */
  readonly created: boolean;
  readonly tenant: Tenant;
  readonly school: School;
  readonly admin: ProvisionedAdmin | null;
  /** Base RBAC rows written on the create path; zero on the update path. */
  readonly permissionsCreated: number;
  readonly rolesCreated: number;
}

export interface ProvisionInputErrorDetail {
  readonly path: string;
  readonly message: string;
}

/** Thrown when the input cannot produce a valid tenant, before anything is written. */
export class ProvisionInputError extends Error {
  readonly issues: readonly ProvisionInputErrorDetail[];

  constructor(issues: readonly ProvisionInputErrorDetail[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "ProvisionInputError";
    this.issues = issues;
  }
}

/**
 * Throws when an administrator email arrives with no usable password. The message
 * names `TENANT_ADMIN_PASSWORD` so the operator has something to act on instead
 * of a bare "missing field".
 */
export function assertAdminPassword(admin: ProvisionInput["admin"]): string {
  const password = admin?.password ?? "";
  if (password.trim().length === 0) {
    throw new Error(
      `An administrator email was supplied without a password. Set ${ADMIN_PASSWORD_ENV_VAR} ` +
        `in the environment, or omit the admin entirely and create the account later with ` +
        `\`novastar-tenant user\`. This tool has no default password and never generates one.`,
    );
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `The administrator password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters. ` +
        `Set ${ADMIN_PASSWORD_ENV_VAR} to a longer value.`,
    );
  }
  return password;
}

function collect(run: () => void, sink: ProvisionInputErrorDetail[]): void {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) {
      for (const issue of error.issues) sink.push({ path: issue.path, message: issue.message });
      return;
    }
    throw error;
  }
}

/**
 * Validates and normalises the whole input up front.
 *
 * Nothing reaches the database until every field has passed, so a rejected
 * `create` leaves no tenant, no school and no partial admin behind. The plan's
 * acceptance criterion is `create --code "Bad Code!"` failing on validation and
 * touching nothing, and this is what guarantees it.
 */
export function normalizeProvisionInput(input: ProvisionInput): {
  readonly tenantCode: string;
  readonly tenantName: string;
  readonly domain: string | null;
  readonly settings: Record<string, unknown> | undefined;
  readonly school: ProvisionInput["school"];
  readonly admin: { readonly email: string; readonly roleName: string } | null;
} {
  const issues: ProvisionInputErrorDetail[] = [];

  let tenantCode = "";
  collect(() => {
    tenantCode = validateCode(input.tenant.code, "tenant.code");
  }, issues);

  let tenantName = "";
  collect(() => {
    tenantName = requireText(input.tenant.name, "tenant.name");
  }, issues);

  let domain: string | null = null;
  collect(() => {
    domain = validateDomain(input.tenant.domain, "tenant.domain");
  }, issues);

  let settings: Record<string, unknown> | undefined;
  collect(() => {
    settings = parseOptionalSettings(input.tenant.settings, "tenant.settings");
  }, issues);

  collect(() => {
    validateCode(input.school.code, "school.code");
  }, issues);
  collect(() => {
    requireText(input.school.name, "school.name");
  }, issues);
  collect(() => {
    requireText(input.school.address, "school.address");
  }, issues);
  collect(() => {
    requireText(input.school.phone, "school.phone");
  }, issues);
  collect(() => {
    validateEmail(input.school.email, "school.email");
  }, issues);
  collect(() => {
    parseEstablished(input.school.established, "school.established");
  }, issues);

  let admin: { email: string; roleName: string } | null = null;
  if (input.admin) {
    collect(() => {
      admin = {
        email: validateEmail(input.admin?.email, "admin.email"),
        roleName: input.admin?.roleName?.trim() || DEFAULT_ADMIN_ROLE,
      };
    }, issues);
  }

  if (issues.length > 0) {
    throw new ProvisionInputError(issues);
  }

  return {
    tenantCode,
    tenantName,
    domain,
    settings,
    school: { ...input.school, motto: input.school.motto ?? null },
    admin,
  };
}

function requireText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (text.length === 0) {
    throw new ValidationError([{ path: field, message: "Must not be empty." }]);
  }
  return text;
}

/** argon2id, matching `tools/seed`. No `argon2` or `bcryptjs`: both have unresolved version conflicts elsewhere here. */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

/**
 * Provisions a tenant, its first school and an optional administrator.
 *
 * One interactive transaction covers every write. A tenant with a school but no
 * administrator, or a school pointing at nothing, is worse than no tenant at
 * all: it looks healthy in `list` and fails at sign-in.
 *
 * Idempotent by `Tenant.code`, which is the `@unique` routing key. Re-running
 * with the same code updates the existing tenant instead of creating a second
 * one, so `create` is safe to retry.
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionedTenant> {
  const normalized = normalizeProvisionInput(input);
  const passwordHash = input.admin ? await hashPassword(assertAdminPassword(input.admin)) : null;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.tenant.findUnique({
      where: { code: normalized.tenantCode },
      select: { id: true, settings: true },
    });

    // Supplied settings merge onto whatever is already stored, so a re-run that
    // sets one key does not erase the keys `config set` added since.
    const mergedSettings = mergeSettings(existing?.settings, normalized.settings);

    const tenant = await tx.tenant.upsert({
      where: { code: normalized.tenantCode },
      create: {
        name: normalized.tenantName,
        code: normalized.tenantCode,
        domain: normalized.domain,
        // Explicit rather than leaning on the column default: the plan requires
        // the value to be visible where the tenant is created.
        isActive: true,
        settings: toJson(mergedSettings ?? {}),
      },
      update: {
        name: normalized.tenantName,
        domain: normalized.domain,
        // `isActive` is deliberately absent from the update branch. `suspend`
        // sets it to false, and a re-provision that flipped it back would
        // silently undo a suspension.
        ...(mergedSettings === undefined ? {} : { settings: toJson(mergedSettings) }),
      },
    });

    const school = await tx.school.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: normalized.school.code } },
      create: {
        tenantId: tenant.id,
        name: normalized.school.name,
        code: normalized.school.code,
        address: normalized.school.address,
        phone: normalized.school.phone,
        email: normalized.school.email,
        motto: normalized.school.motto ?? null,
        established: normalized.school.established,
      },
      update: {
        name: normalized.school.name,
        address: normalized.school.address,
        phone: normalized.school.phone,
        email: normalized.school.email,
        motto: normalized.school.motto ?? null,
        established: normalized.school.established,
      },
    });

    let permissionsCreated = 0;
    let rolesCreated = 0;

    if (!existing) {
      // Base RBAC is written once, when the tenant is born. Re-running must not
      // rewrite `Role.permissions` on a tenant whose roles an administrator has
      // since tuned -- `clone` and `config set` are the tools for that.
      permissionsCreated = await seedPermissions(tx, tenant.id);
      rolesCreated = await seedPlatformRoles(tx, tenant.id, school.id);

      // Branding is presentation, and an administrator edits it. Creating it
      // once from the school name gives the portal something to render; the
      // update path leaves it alone.
      await tx.branding.upsert({
        where: { tenantId_schoolId: { tenantId: tenant.id, schoolId: school.id } },
        create: {
          tenantId: tenant.id,
          schoolId: school.id,
          name: school.name,
          address: school.address,
          phone: school.phone,
          email: school.email,
          motto: school.motto,
        },
        update: {},
      });
    }

    let admin: ProvisionedAdmin | null = null;
    if (normalized.admin && passwordHash) {
      const role = await tx.role.upsert({
        where: {
          tenantId_schoolId_name: {
            tenantId: tenant.id,
            schoolId: school.id,
            name: normalized.admin.roleName,
          },
        },
        create: {
          tenantId: tenant.id,
          schoolId: school.id,
          name: normalized.admin.roleName,
          isSystem: true,
          permissions: permissionsForRoleSafe(normalized.admin.roleName),
        },
        update: {},
      });

      const existingAdmin = await tx.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: normalized.admin.email } },
        select: { id: true },
      });

      const user = await tx.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: normalized.admin.email } },
        create: {
          tenantId: tenant.id,
          schoolId: school.id,
          email: normalized.admin.email,
          name: tenant.name,
          roleId: role.id,
          isActive: true,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          passwordHash,
        },
        // Empty on purpose. Re-running `create` must never reset credentials.
        update: {},
      });

      admin = {
        id: user.id,
        email: normalized.admin.email,
        roleName: role.name,
        created: existingAdmin === null,
      };
    }

    return {
      created: existing === null,
      tenant,
      school,
      admin,
      permissionsCreated,
      rolesCreated,
    };
  });
}

async function seedPermissions(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  for (const permission of PERMISSION_CATALOG) {
    await tx.permission.upsert({
      where: { tenantId_key: { tenantId, key: permission.key } },
      create: {
        tenantId,
        key: permission.key,
        description: permission.description,
        category: permission.category,
        resource: permission.resource,
        action: permission.action,
        scope: permission.scope,
        isSystem: true,
      },
      update: {},
    });
  }
  return PERMISSION_CATALOG.length;
}

async function seedPlatformRoles(
  tx: Prisma.TransactionClient,
  tenantId: string,
  schoolId: string,
): Promise<number> {
  // Scoped to the school rather than the tenant, matching `tools/seed`. Prisma
  // types a nullable column inside a compound unique as `string`, so a
  // tenant-scoped role (`schoolId: null`) cannot be selected through
  // `tenantId_schoolId_name` at all, and `upsert` on it is not expressible.
  for (const roleName of PLATFORM_ROLE_NAMES) {
    await tx.role.upsert({
      where: { tenantId_schoolId_name: { tenantId, schoolId, name: roleName } },
      create: {
        tenantId,
        schoolId,
        name: roleName,
        description: `${roleName} role, created at tenant provisioning.`,
        isSystem: true,
        permissions: permissionsForRole(roleName),
      },
      update: {},
    });
  }
  return PLATFORM_ROLE_NAMES.length;
}

function permissionsForRoleSafe(roleName: string): string[] {
  const known = PLATFORM_ROLE_NAMES.includes(roleName as (typeof PLATFORM_ROLE_NAMES)[number]);
  return known ? permissionsForRole(roleName as (typeof PLATFORM_ROLE_NAMES)[number]) : [];
}

function mergeSettings(
  existing: unknown,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (incoming === undefined) return undefined;
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
    return { ...incoming };
  }
  return { ...(existing as Record<string, unknown>), ...incoming };
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

export { ValidationError };