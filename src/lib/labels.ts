import type { Role } from "@/generated/prisma/enums";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  SALES_REP: "Sales Rep",
  SALES_MANAGER: "Sales Manager",
  FINANCE: "Finance",
};
