/**
 * `suspend` -- set a tenant's `isActive` to false.
 *
 * Never deletes. A suspended tenant keeps every row it has; reactivating it
 * restores sign-in exactly as it was. Deleting is not an operation this tool has,
 * because the portal has no way to recover from one and the schema is full of
 * foreign keys that would either fail or cascade.
 */
import { getPrisma } from "../config";
import { out } from "../output";
import { ValidationError } from "../validate";
import { requireConfirmation, resolveTenantCode, type ArgMap } from "./shared";

export const SUSPEND_HELP = `Usage: novastar-tenant suspend [--tenant <code>] [--yes]

Sets Tenant.isActive to false. Nothing is deleted. With --yes it runs
unattended; otherwise it asks for confirmation on a terminal.`;

export async function runSuspend(args: ArgMap): Promise<void> {
  const code = resolveTenantCode(args);
  const db = getPrisma();

  const tenant = await db.tenant.findUnique({
    where: { code },
    select: { id: true, isActive: true, _count: { select: { schools: true, users: true } } },
  });
  if (!tenant) {
    throw new ValidationError([{ path: "--tenant", message: `No tenant with code "${code}".` }]);
  }

  await requireConfirmation(args, `suspend ${code}`);

  if (!tenant.isActive) {
    out.warn(`${code} is already suspended. Nothing changed.`);
    return;
  }

  await db.tenant.update({ where: { id: tenant.id }, data: { isActive: false } });

  if (args.flag("json")) {
    out.json({ code, isActive: false, retained: tenant._count });
    return;
  }

  out.success(`Suspended ${code}`);
  out.line(
    `Retained ${tenant._count.schools} school(s) and ${tenant._count.users} user(s). ` +
      `Nothing was deleted.`,
  );
}