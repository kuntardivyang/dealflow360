"use server";

// Owner: B. Server actions for the back-end configuration forms. Each one: role guard,
// shared Zod schema, service call inside a transaction with an audit row, revalidate.
import { revalidatePath } from "next/cache";
import { requireActionUser } from "@/lib/auth/internal";
import {
  approvalRuleSchema,
  BACKEND_ROLES,
  categorySchema,
  ok,
  parseInput,
  planSchema,
  pricelistRuleSchema,
  productPlanPriceSchema,
  productSchema,
  riskConfigSchema,
  stockLevelSchema,
  tierSchema,
  toActionError,
  userRoleSchema,
  warehouseSchema,
  type ActionResult,
  type Role,
} from "@/lib/contract";
import type { z } from "zod";
import * as admin from "@/services/admin.service";

type Saver<S extends z.ZodTypeAny, R> = (input: z.infer<S>, user: Awaited<ReturnType<typeof requireActionUser>>) => Promise<R>;

async function run<S extends z.ZodTypeAny, R extends { id: number }>(
  schema: S,
  input: unknown,
  save: Saver<S, R>,
  paths: string[],
  roles: readonly Role[] = BACKEND_ROLES,
): Promise<ActionResult<{ id: number }>> {
  const p = parseInput(schema, input);
  if (!p.ok) return p;
  try {
    const user = await requireActionUser(roles);
    const row = await save(p.data, user);
    for (const path of paths) revalidatePath(path);
    return ok({ id: row.id });
  } catch (e) {
    return toActionError(e);
  }
}

const TIERS = ["/admin/tiers", "/admin"];
const WAREHOUSES = ["/admin/warehouses", "/fulfillment", "/admin"];
const PLANS = ["/admin/plans", "/admin"];
const PRODUCTS = ["/admin/products", "/admin"];

export async function saveTier(input: unknown) {
  return run(tierSchema, input, admin.saveTier, TIERS);
}
export async function saveCategory(input: unknown) {
  return run(categorySchema, input, admin.saveCategory, TIERS);
}
export async function saveApprovalRule(input: unknown) {
  return run(approvalRuleSchema, input, admin.saveApprovalRule, TIERS);
}
export async function saveRiskConfig(input: unknown) {
  return run(riskConfigSchema, input, admin.saveRiskConfig, TIERS);
}
export async function saveWarehouse(input: unknown) {
  return run(warehouseSchema, input, admin.saveWarehouse, WAREHOUSES);
}
export async function saveStockLevel(input: unknown) {
  return run(stockLevelSchema, input, admin.saveStockLevel, WAREHOUSES);
}
export async function savePlan(input: unknown) {
  return run(planSchema, input, admin.savePlan, PLANS);
}
export async function saveProduct(input: unknown) {
  return run(productSchema, input, admin.saveProduct, PRODUCTS);
}
export async function savePricelistRule(input: unknown) {
  return run(pricelistRuleSchema, input, admin.savePricelistRule, PRODUCTS);
}
export async function saveProductPlanPrice(input: unknown) {
  return run(productPlanPriceSchema, input, admin.saveProductPlanPrice, [...PRODUCTS, "/quotes"]);
}

export async function setUserRole(input: unknown) {
  return run(userRoleSchema, input, admin.setUserRole, ["/admin/users", "/admin"], ["ADMIN"]);
}
