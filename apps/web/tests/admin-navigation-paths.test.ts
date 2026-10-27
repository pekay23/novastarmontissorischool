import { describe, expect, it } from "bun:test";
import {
  PLATFORM_NAV,
  tenantIdFromPathname,
  tenantTabs,
} from "@/lib/admin-navigation";

describe("mounted admin navigation", () => {
  it("uses the actual platform overview route", () => {
    expect(PLATFORM_NAV.find((item) => item.label === "Overview")?.href).toBe(
      "/admin/overview",
    );
  });
  it("takes the tenant from the current URL, including nested account pages", () => {
    expect(tenantIdFromPathname("/admin/tenants/tenant-beta/users/")).toBe(
      "tenant-beta",
    );
    expect(tenantIdFromPathname("/admin/tenants/")).toBeNull();
    expect(tenantIdFromPathname("/admin/overview/")).toBeNull();
    expect(tenantIdFromPathname("/portal/students/tenant-beta")).toBeNull();
  });
  it("round-trips encoded tenant ids without treating their contents as a route", () => {
    const links = tenantTabs("school/a?b");
    expect(links[0].href).toBe("/admin/tenants/school%2Fa%3Fb");
    expect(tenantIdFromPathname(links[0].href)).toBe("school/a?b");
    expect(tenantIdFromPathname("/admin/tenants/%invalid")).toBeNull();
  });
});
