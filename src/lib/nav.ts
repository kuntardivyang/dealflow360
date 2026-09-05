import type { Role } from "@/generated/prisma/enums";
import { BACKEND_ROLES } from "@/lib/contract";

export type NavItem = { label: string; href: string; roles?: readonly Role[] };

// The nine tabs of the mockup, in order. "Product" is the admin catalogue, so it is
// limited to the back-end roles; a Sales Rep never sees admin links.
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Quotations", href: "/quotes" },
  { label: "Approvals", href: "/approvals" },
  { label: "Fulfillment", href: "/fulfillment" },
  { label: "Subscriptions", href: "/subscriptions" },
  { label: "Invoices", href: "/invoices" },
  { label: "Deal Health", href: "/health" },
  { label: "Reports", href: "/reports" },
  { label: "Product", href: "/admin/products", roles: BACKEND_ROLES },
];

/** Tabs a user may see. `null` (no session yet) shows everything so the frame can be reviewed before auth lands. */
export function visibleNavItems(role: Role | null): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || role === null || item.roles.includes(role));
}

export function canOpenBackend(role: Role | null): boolean {
  return role === null || BACKEND_ROLES.includes(role);
}
