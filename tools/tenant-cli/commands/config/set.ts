/**
 * `config set` -- write one dot-path into a settings document.
 *
 * The whole document is re-validated after the write, so a value that is wrong
 * for its key is rejected before it reaches the column. Unknown keys are
 * rejected rather than stored: the configuration-first promise only holds if a
 * misspelt key fails loudly instead of sitting in the JSON forever.
 */
import { getPrisma } from "../../config";
import { out } from "../../output";
import { SettingsSchema, ValidationError, parseDotPath, setDotPath } from "../../validate";
import { requireConfirmation, resolveTenantCode, type ArgMap } from "../shared";

export const CONFIG_SET_HELP = `Usage: novastar-tenant config set [--tenant <code>] --key <path> --value <json> [--school <code>]

  --key <path>     dot-path such as timezone or features.grading
  --value <json>   a JSON value: "Africa/Accra", true, 3, or GHS

The document is validated after the write, and an unknown key is an error.
Known top-level keys: currency, dateFormat, features, language, timeFormat, timezone.

Options:
  --tenant <code>   tenant code (default: TENANT_CODE)
  --school <code>   write to a school document instead of the tenant document
  --yes             required when stdin is not a terminal
  --json            print the resulting document`;

export async function runConfigSet(args: ArgMap): Promise<void> {
  const code = resolveTenantCode(args);
  const path = args.require("key");
  const value = parseJsonValue(args.require("value"));
  parseDotPath(path);

  const db = getPrisma();
  const tenant = await db.tenant.findUnique({
    where: { code },
    select: {
      id: true,
      settings: true,
      schools: { orderBy: { code: "asc" }, select: { id: true, code: true, settings: true } },
    },
  });
  if (!tenant) {
    throw new ValidationError([{ path: "--tenant", message: `No tenant with code "${code}".` }]);
  }

  const schoolCode = args.get("school");

  if (schoolCode === undefined) {
    await requireConfirmation(args, `config set ${code} ${path}`);
    const next = mergeSettings(tenant.settings, path, value, code);
    const updated = await db.tenant.update({
      where: { id: tenant.id },
      data: { settings: next as never },
    });
    report(args, `${code}.${path}`, value, updated.settings);
    return;
  }

  const school = tenant.schools.find((candidate) => candidate.code === schoolCode);
  if (!school) {
    throw new ValidationError([
      { path: "--school", message: `Tenant ${code} has no school with code "${schoolCode}".` },
    ]);
  }

  await requireConfirmation(args, `config set ${school.code} ${path}`);
  const next = mergeSettings(school.settings, path, value, `${school.code}`);
  const updated = await db.school.update({
    where: { id: school.id },
    data: { settings: next as never },
  });
  report(args, `${school.code}.${path}`, value, updated.settings);
}

/**
 * Applies the write to a copy of the stored document and re-validates the whole
 * result. A document that does not parse starts from `{}` so a legacy blob does
 * not permanently block every write.
 */
function mergeSettings(current: unknown, path: string, value: unknown, label: string): unknown {
  const stored = SettingsSchema.safeParse(current ?? {});
  const base = stored.success ? stored.data : {};
  const next = SettingsSchema.safeParse(setDotPath(base as Record<string, unknown>, path, value));
  if (!next.success) throw ValidationError.from(next.error, label);
  return next.data;
}

function report(args: ArgMap, label: string, value: unknown, settings: unknown): void {
  if (args.flag("json")) {
    out.json(settings);
    return;
  }
  out.success(`${label} = ${JSON.stringify(value)}`);
  out.line(`Document now: ${JSON.stringify(settings)}`);
}

/** A bare word is a string, which is what a timezone or a currency code needs. */
function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}