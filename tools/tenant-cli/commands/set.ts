/**
 * `set` -- patch one mutable field on a Tenant or a School.
 *
 * `Tenant.code` is not patchable. It is the routing key and the subdomain, so
 * changing it would move a live tenant to a different URL. It is set once at
 * creation.
 */
import { getPrisma } from "../config";
import { out } from "../output";
import {
  SchoolPatchSchema,
  TenantPatchSchema,
  ValidationError,
  parseEstablished,
  parsePatch,
  validateDomain,
  validateEmail,
} from "../validate";
import { requireConfirmation, resolveTenantCode, type ArgMap } from "./shared";

const TENANT_FIELDS = ["name", "domain", "isActive"] as const;
const SCHOOL_FIELDS = [
  "name",
  "address",
  "phone",
  "email",
  "logoUrl",
  "motto",
  "established",
] as const;

export const SET_HELP = `Usage: novastar-tenant set [--tenant <code>] --field <name> --value <value> [--school <code>]

Fields on Tenant:
  name, domain, isActive

Fields on School:
  name, address, phone, email, logoUrl, motto, established (yyyy-mm-dd)

Values are parsed as JSON where that makes sense: true/false for booleans,
"text" or bare text for strings.

Options:
  --tenant <code>   tenant code (default: TENANT_CODE)
  --school <code>   patch a school instead of the tenant
  --field <name>    required
  --value <value>   required
  --yes             required when stdin is not a terminal
  --json            print the updated row as JSON`;

export async function runSet(args: ArgMap): Promise<void> {
  const code = resolveTenantCode(args);
  const field = args.require("field");
  const raw = args.require("value");
  const db = getPrisma();

  const tenant = await db.tenant.findUnique({ where: { code }, select: { id: true, code: true } });
  if (!tenant) {
    throw new ValidationError([{ path: "--tenant", message: `No tenant with code "${code}".` }]);
  }

  const schoolCode = args.get("school");
  if (schoolCode !== undefined) {
    await setSchool(args, tenant.id, field, raw, schoolCode);
    return;
  }

  if (!(TENANT_FIELDS as readonly string[]).includes(field)) {
    throw new ValidationError([
      {
        path: "--field",
        message: `Unknown tenant field "${field}". Expected one of: ${TENANT_FIELDS.join(", ")}.`,
      },
    ]);
  }

  const value = coerceTenantValue(field, raw);
  const data = parsePatch(TenantPatchSchema, { [field]: value }, "--field");

  await requireConfirmation(args, `set ${code}.${field}`);

  const updated = await db.tenant.update({
    where: { id: tenant.id },
    data: data as never,
  });

  if (args.flag("json")) {
    out.json(updated);
    return;
  }
  out.success(`${code}.${field} updated`);
}

async function setSchool(
  args: ArgMap,
  tenantId: string,
  field: string,
  raw: string,
  schoolCode: string,
): Promise<void> {
  if (!(SCHOOL_FIELDS as readonly string[]).includes(field)) {
    throw new ValidationError([
      {
        path: "--field",
        message: `Unknown school field "${field}". Expected one of: ${SCHOOL_FIELDS.join(", ")}.`,
      },
    ]);
  }

  const value = coerceSchoolValue(field, raw);
  const data = parsePatch(SchoolPatchSchema, { [field]: value }, "--field");

  const db = getPrisma();
  const school = await db.school.findUnique({
    where: { tenantId_code: { tenantId, code: schoolCode } },
    select: { id: true, code: true },
  });
  if (!school) {
    throw new ValidationError([
      { path: "--school", message: `Tenant has no school with code "${schoolCode}".` },
    ]);
  }

  await requireConfirmation(args, `set ${school.code}.${field}`);

  const updated = await db.school.update({ where: { id: school.id }, data: data as never });

  if (args.flag("json")) {
    out.json(updated);
    return;
  }
  out.success(`${school.code}.${field} updated`);
}

function coerceTenantValue(field: string, raw: string): unknown {
  if (field === "isActive") {
    if (raw === "true" || raw === "false") return raw === "true";
    throw new ValidationError([{ path: "--value", message: "isActive expects true or false." }]);
  }
  if (field === "domain") return validateDomain(raw, "--value");
  return stripQuotes(raw);
}

function coerceSchoolValue(field: string, raw: string): unknown {
  switch (field) {
    case "email":
      return validateEmail(stripQuotes(raw), "--value");
    case "established":
      return parseEstablished(stripQuotes(raw), "--value");
    case "logoUrl":
    case "motto":
      return raw === "null" ? null : stripQuotes(raw);
    default:
      return stripQuotes(raw);
  }
}

function stripQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}