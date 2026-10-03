/**
 * `list` -- every tenant with its school and user counts.
 *
 * Deliberately cross-tenant. This is an operator tool, not a portal API: the
 * whole point is to see every school the deployment serves, including the ones
 * nobody has logged into yet.
 */
import { getPrisma } from "../config";
import { out } from "../output";
import type { ArgMap } from "./shared";

export async function runList(args: ArgMap): Promise<void> {
  const db = getPrisma();
  const tenants = await db.tenant.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      domain: true,
      isActive: true,
      createdAt: true,
      _count: { select: { schools: true, users: true } },
    },
  });

  if (args.flag("json")) {
    out.json(
      tenants.map((tenant) => ({
        id: tenant.id,
        code: tenant.code,
        name: tenant.name,
        domain: tenant.domain,
        isActive: tenant.isActive,
        createdAt: tenant.createdAt,
        schoolCount: tenant._count.schools,
        userCount: tenant._count.users,
      })),
    );
    return;
  }

  out.table(tenants, [
    { header: "CODE", value: (row) => row.code },
    { header: "NAME", value: (row) => row.name },
    { header: "DOMAIN", value: (row) => row.domain },
    { header: "ACTIVE", value: (row) => (row.isActive ? "yes" : "no") },
    { header: "SCHOOLS", value: (row) => row._count.schools, align: "right" },
    { header: "USERS", value: (row) => row._count.users, align: "right" },
    { header: "CREATED", value: (row) => row.createdAt.toISOString().slice(0, 10) },
  ], { empty: "No tenants exist yet. Create one with `novastar-tenant create`." });
}