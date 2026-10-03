/**
 * `user` -- create a tenant administrator, or rotate an existing one's password.
 *
 * The password is read from `TENANT_ADMIN_PASSWORD` or from a masked prompt.
 * There is no default, no command-line option and nothing echoed to stdout: a
 * password on `argv` is visible to every process on the machine, and a known
 * default is a backdoor. `tools/seed` has that fallback; it is not copied here.
 */
import { getPrisma } from "../config";
import { out } from "../output";
import { DEFAULT_ADMIN_ROLE, MIN_ADMIN_PASSWORD_LENGTH, hashPassword } from "../provision";
import { ValidationError, validateEmail } from "../validate";
import { requireConfirmation, readSecret, resolveTenantCode, type ArgMap } from "./shared";

export const USER_HELP = `Usage: novastar-tenant user [--tenant <code>] --email <email> [--rotate] [--role <name>]

Creates a User row for the tenant, or rotates the password of an existing one.

The password comes from TENANT_ADMIN_PASSWORD or a masked prompt. There is no
default password and no command-line option.

Options:
  --tenant <code>   tenant code (default: TENANT_CODE)
  --email <email>   the account's email (required)
  --role <name>     role to grant on create (default: ${DEFAULT_ADMIN_ROLE})
  --rotate          set a new password on an existing account instead of creating one
  --yes             required when stdin is not a terminal
  --json            print the result as JSON`;

export async function runUser(args: ArgMap): Promise<void> {
  const code = resolveTenantCode(args);
  const email = validateEmail(args.require("email"), "--email");
  const rotate = args.flag("rotate");
  const db = getPrisma();

  const tenant = await db.tenant.findUnique({
    where: { code },
    select: { id: true, schools: { orderBy: { code: "asc" }, select: { id: true } } },
  });
  if (!tenant) {
    throw new ValidationError([{ path: "--tenant", message: `No tenant with code "${code}".` }]);
  }

  const existing = await db.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    select: { id: true, isActive: true },
  });

  if (!existing && !rotate) {
    out.warn(`No account for ${email} on ${code}. Creating one.`);
  }
  if (existing && !rotate) {
    throw new ValidationError([
      { path: "--email", message: `An account for ${email} already exists on ${code}. Pass --rotate to set a new password.` },
    ]);
  }

  const password = await readSecret("TENANT_ADMIN_PASSWORD", `New password for ${email}`);
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new ValidationError([
      {
        path: "password",
        message: `Must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters. Nothing was written.`,
      },
    ]);
  }

  await requireConfirmation(args, rotate ? `rotate the password for ${email}` : `create ${email} on ${code}`);

  const passwordHash = await hashPassword(password);

  if (existing) {
    const updated = await db.user.update({
      where: { id: existing.id },
      data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() },
      select: { id: true, email: true, isActive: true },
    });
    if (args.flag("json")) {
      out.json({ action: "rotated", ...updated });
      return;
    }
    out.success(`Password rotated for ${email}`);
    return;
  }

  const roleName = args.get("role") ?? DEFAULT_ADMIN_ROLE;
  const role = await db.role.upsert({
    where: {
      tenantId_schoolId_name: {
        tenantId: tenant.id,
        schoolId: tenant.schools[0]?.id ?? "",
        name: roleName,
      },
    },
    create: {
      tenantId: tenant.id,
      schoolId: tenant.schools[0]?.id ?? null,
      name: roleName,
      isSystem: true,
      permissions: [],
    },
    update: {},
    select: { id: true, name: true },
  });

  const created = await db.user.create({
    data: {
      tenantId: tenant.id,
      schoolId: tenant.schools[0]?.id ?? null,
      email,
      roleId: role.id,
      isActive: true,
      mustChangePassword: true,
      passwordChangedAt: new Date(),
      passwordHash,
    },
    select: { id: true, email: true, isActive: true },
  });

  if (args.flag("json")) {
    out.json({ action: "created", ...created, role: role.name });
    return;
  }
  out.success(`Created ${email} on ${code} with role ${role.name}`);
  out.line("The password was not printed. It must be changed at first sign-in.");
}