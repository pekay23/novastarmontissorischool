/**
 * `config get` -- read a tenant or school settings document, pretty-printed.
 *
 * Read-only. The document is validated on the way out so an invalid shape
 * already stored by an older tool is reported rather than presented as healthy.
 */
import { getPrisma } from "../../config";
import { out } from "../../output";
import { ValidationError, parseSettings } from "../../validate";
import { resolveTenantCode, type ArgMap } from "../shared";

export async function runConfigGet(args: ArgMap): Promise<void> {
  const code = resolveTenantCode(args);
  const db = getPrisma();

  const tenant = await db.tenant.findUnique({
    where: { code },
    select: { id: true, settings: true, schools: { orderBy: { code: "asc" }, select: { code: true, settings: true } } },
  });
  if (!tenant) {
    throw new ValidationError([{ path: "--tenant", message: `No tenant with code "${code}".` }]);
  }

  const schoolCode = args.get("school");
  if (schoolCode === undefined) {
    out.json(parseSettings(tenant.settings, `${code}.settings`));
    return;
  }

  const school = tenant.schools.find((candidate) => candidate.code === schoolCode);
  if (!school) {
    throw new ValidationError([
      { path: "--school", message: `Tenant ${code} has no school with code "${schoolCode}".` },
    ]);
  }

  out.json(parseSettings(school.settings, `${schoolCode}.settings`));
}

export const CONFIG_GET_HELP = `Usage: novastar-tenant config get [--tenant <code>] [--school <code>]

Reads the settings document and prints it as pretty JSON. With no --school the
tenant document is printed. Read-only.`;