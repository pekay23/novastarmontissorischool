/**
 * `reactivate` -- set a tenant's `isActive` to true.
 *
 * The inverse of `suspend`. It touches no other column: a suspended tenant was
 * never modified beyond `isActive`, so restoring that one flag restores the
 * tenant exactly.
 */
import { getPrisma } from "../config";
import { out } from "../output";
import { ValidationError } from "../validate";
import { requireConfirmation, resolveTenantCode, type ArgMap } from "./shared";

export const REACTIVATE_HELP = `Usage: novastar-tenant reactivate [--tenant <code>] [--yes]

Sets Tenant.isActive to true. With --yes it runs unattended; otherwise it asks
for confirmation on a terminal.`;

export async function runReactivate(args: ArgMap): Promise<void> {
  const code = resolveTenantCode(args);
  const db = getPrisma();

  const tenant = await db.tenant.findUnique({ where: { code }, select: { id: true, isActive: true } });
  if (!tenant) {
    throw new ValidationError([{ path: "--tenant", message: `No tenant with code "${code}".` }]);
  }

  await requireConfirmation(args, `reactivate ${code}`);

  if (tenant.isActive) {
    out.warn(`${code} is already active. Nothing changed.`);
    return;
  }

  await db.tenant.update({ where: { id: tenant.id }, data: { isActive: true } });

  if (args.flag("json")) {
    out.json({ code, isActive: true });
    return;
  }
  out.success(`Reactivated ${code}`);
}