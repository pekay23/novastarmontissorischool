/**
 * `create` -- provision a tenant, its first school and an optional administrator.
 *
 * A thin wrapper. Every decision that matters lives in `provision.ts`, because
 * `apps/super-admin` calls that same function and the two must not diverge.
 *
 * The administrator password is read from `TENANT_ADMIN_PASSWORD` or from a
 * masked prompt. It is deliberately not a flag: a value on `argv` is visible to
 * every process on the machine and is kept in shell history.
 */
import { optionalEnv } from "../config";
import { out } from "../output";
import { provisionTenant, type ProvisionInput } from "../provision";
import {
  parseEstablished,
  parseSettings,
  validateCode,
  validateDomain,
  validateEmail,
} from "../validate";
import { readSecret, type ArgMap } from "./shared";

export const CREATE_HELP = `Usage: novastar-tenant create --code <code> --name <name> --school-name <name>
                        --address <address> --phone <phone> --email <email> --established <yyyy-mm-dd>

Required:
  --code <code>          tenant code; the routing key and subdomain. Lowercase,
                         digits and single hyphens, starting and ending alphanumeric
  --name <name>          tenant display name
  --school-name <name>   first school's name
  --school-code <code>   first school's code (default: main)
  --address <address>    school address (required by the schema with no default)
  --phone <phone>        school phone (required by the schema with no default)
  --email <email>        school email (required by the schema with no default)
  --established <date>   school founding date, no later than today

Optional:
  --domain <hostname>    custom domain, e.g. school.example.com
  --motto <text>         school motto
  --settings <json>      tenant settings document, validated before it is written
  --admin-email <email>  create the initial administrator. Default: TENANT_ADMIN_EMAIL
  --admin-role <name>    role to grant (default: HEADMASTER)
  --json                 print the result as JSON

The administrator password comes from TENANT_ADMIN_PASSWORD or a masked prompt.
There is no default and no command-line option.

Re-running with the same --code updates the existing tenant. It never creates a
second one, and never resets an existing administrator's password.`;

export async function runCreate(args: ArgMap): Promise<void> {
  const tenantCode = validateCode(args.require("code"), "--code");
  const tenantName = args.require("name");
  const domain = validateDomain(args.get("domain"), "--domain");

  const school = {
    name: args.require("school-name"),
    code: validateCode(args.get("school-code") ?? "main", "--school-code"),
    address: args.require("address"),
    phone: args.require("phone"),
    email: validateEmail(args.require("email"), "--email"),
    established: parseEstablished(args.require("established"), "--established"),
    motto: args.get("motto") ?? null,
  };

  const settingsArg = args.get("settings");
  const settings = settingsArg ? parseSettings(JSON.parse(settingsArg), "--settings") : undefined;

  const adminEmail = resolveAdminEmail(args);
  let admin: ProvisionInput["admin"];
  if (adminEmail) {
    const password = await readSecret("TENANT_ADMIN_PASSWORD", `Password for ${adminEmail}`);
    admin = { email: adminEmail, password };
  }

  const input: ProvisionInput = {
    tenant: { name: tenantName, code: tenantCode, domain, ...(settings ? { settings } : {}) },
    school,
    ...(admin ? { admin } : {}),
  };

  const result = await provisionTenant(input);

  if (args.flag("json")) {
    out.json({
      created: result.created,
      tenant: { id: result.tenant.id, code: result.tenant.code, isActive: result.tenant.isActive },
      school: { id: result.school.id, code: result.school.code },
      admin: result.admin,
      permissionsCreated: result.permissionsCreated,
      rolesCreated: result.rolesCreated,
    });
    return;
  }

  out.success(
    result.created
      ? `Created tenant ${result.tenant.code} with school ${result.school.code}`
      : `Updated existing tenant ${result.tenant.code} (no duplicate created)`,
  );
  out.line(`Tenant id: ${result.tenant.id}`);
  out.line(`School id:  ${result.school.id}`);
  if (result.admin) {
    out.line(
      `Administrator: ${result.admin.email} (role ${result.admin.roleName}, ` +
        `${result.admin.created ? "created" : "already existed; password untouched"})`,
    );
  } else {
    out.line("Administrator: none. Create one with `novastar-tenant user`.");
  }
  out.line(
    `Base RBAC on this run: ${result.permissionsCreated} permissions, ${result.rolesCreated} roles.`,
  );
}

function resolveAdminEmail(args: ArgMap): string | null {
  const raw = args.get("admin-email") ?? optionalEnv("TENANT_ADMIN_EMAIL");
  if (!raw) return null;
  return validateEmail(raw, "--admin-email");
}