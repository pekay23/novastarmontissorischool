/**
 * `show` -- one tenant in full.
 *
 * Read-only, so it is safe in CI against a disposable database and safe to run
 * casually. Never prints a credential: no `passwordHash`, no session token, no
 * connection string.
 */
import { getPrisma } from "../config";
import { out } from "../output";
import { ValidationError } from "../validate";
import { resolveTenantCode, type ArgMap } from "./shared";

export async function runShow(args: ArgMap): Promise<void> {
  const code = resolveTenantCode(args);
  const db = getPrisma();

  const tenant = await db.tenant.findUnique({
    where: { code },
    include: {
      schools: { orderBy: { code: "asc" } },
      brandings: true,
      configEntities: { orderBy: { type: "asc" } },
      _count: { select: { users: true, roles: true, permissions: true, classLevels: true, subjects: true } },
    },
  });

  if (!tenant) {
    throw new ValidationError([{ path: "--tenant", message: `No tenant with code "${code}".` }]);
  }

  if (args.flag("json")) {
    out.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        code: tenant.code,
        domain: tenant.domain,
        isActive: tenant.isActive,
        settings: tenant.settings,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      },
      schools: tenant.schools,
      branding: tenant.brandings,
      configEntities: tenant.configEntities,
      counts: tenant._count,
    });
    return;
  }

  out.heading(`Tenant ${tenant.code}`);
  out.table(
    [
      { field: "id", value: tenant.id },
      { field: "name", value: tenant.name },
      { field: "domain", value: tenant.domain ?? "-" },
      { field: "isActive", value: tenant.isActive ? "true" : "false" },
      { field: "users", value: tenant._count.users },
      { field: "roles", value: tenant._count.roles },
      { field: "permissions", value: tenant._count.permissions },
      { field: "classLevels", value: tenant._count.classLevels },
      { field: "subjects", value: tenant._count.subjects },
    ],
    [{ header: "FIELD", value: (row) => row.field }, { header: "VALUE", value: (row) => row.value }],
  );

  out.blank();
  out.heading("Schools");
  out.table(tenant.schools, [
    { header: "CODE", value: (row) => row.code },
    { header: "NAME", value: (row) => row.name },
    { header: "EMAIL", value: (row) => row.email },
    { header: "PHONE", value: (row) => row.phone },
    { header: "ESTABLISHED", value: (row) => row.established.toISOString().slice(0, 10) },
  ], { empty: "No schools." });

  out.blank();
  out.heading("Branding");
  out.table(tenant.brandings, [
    { header: "SCHOOL", value: (row) => row.name },
    { header: "PRIMARY", value: (row) => row.primaryColor },
    { header: "SECONDARY", value: (row) => row.secondaryColor },
    { header: "ACCENT", value: (row) => row.accentColor },
  ], { empty: "No branding rows." });

  out.blank();
  out.heading("Config entities");
  out.table(tenant.configEntities, [
    { header: "TYPE", value: (row) => row.type },
    { header: "NAME", value: (row) => row.name },
    { header: "SYSTEM", value: (row) => (row.isSystem ? "yes" : "no") },
    { header: "ACTIVE", value: (row) => (row.isActive ? "yes" : "no") },
  ], { empty: "No config entities." });
}