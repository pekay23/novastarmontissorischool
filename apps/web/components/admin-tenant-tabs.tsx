"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  tenantIdFromPathname,
  tenantTabs,
  visibleNav,
} from "@/lib/admin-navigation";
import { hasOperatorCapability } from "@/lib/permissions";

export function AdminTenantTabs({ granted }: { granted: readonly string[] }) {
  const pathname = usePathname();
  const tenantId = tenantIdFromPathname(pathname);
  if (!tenantId) return null;
  const currentPath = pathname.replace(/\/+$/, "");
  return (
    <nav aria-label="This tenant">
      <ul className="flex flex-wrap gap-1 rounded-md border border-border bg-card px-2 py-1.5">
        {visibleNav(tenantTabs(tenantId), granted, hasOperatorCapability).map(
          (item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                title={item.description}
                aria-current={currentPath === item.href ? "page" : undefined}
                className="rounded px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {item.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
