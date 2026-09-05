import { describe, expect, it } from "vitest";
import { canOpenBackend, NAV_ITEMS, visibleNavItems } from "@/lib/nav";

describe("navigation visibility", () => {
  it("lists the nine mockup tabs in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Dashboard",
      "Quotations",
      "Approvals",
      "Fulfillment",
      "Subscriptions",
      "Invoices",
      "Deal Health",
      "Reports",
      "Product",
    ]);
  });

  it("hides admin links from a sales rep", () => {
    const labels = visibleNavItems("SALES_REP").map((i) => i.label);
    expect(labels).not.toContain("Product");
    expect(labels).toHaveLength(8);
    expect(canOpenBackend("SALES_REP")).toBe(false);
  });

  it("shows admin links to admin, manager and finance", () => {
    for (const role of ["ADMIN", "SALES_MANAGER", "FINANCE"] as const) {
      expect(visibleNavItems(role).map((i) => i.label)).toContain("Product");
      expect(canOpenBackend(role)).toBe(true);
    }
  });
});
