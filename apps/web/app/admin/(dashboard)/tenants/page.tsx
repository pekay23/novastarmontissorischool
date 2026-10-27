import { requireCapabilityPage } from "@/lib/admin-context";
import { listTenantsAcrossPlatform } from "@/lib/queries";
import { TenantTable } from "@/components/tenant-table";
import { TenantFormClient } from "@/components/tenant-form-client";
import { hasOperatorCapability } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Tenants" };

export default async function TenantsPage() {
  const context = await requireCapabilityPage("tenant:read");
  const tenants = await listTenantsAcrossPlatform();
  const canProvision = hasOperatorCapability(
    context.operator.capabilities,
    "tenant:provision",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Tenants</h1>
        <p className="text-sm text-muted-foreground">
          Every tenant on the platform. Select one above to drill into its
          schools, users and settings.
        </p>
      </div>
      {canProvision ? <TenantFormClient /> : null}
      <TenantTable tenants={tenants} />
    </div>
  );
}
