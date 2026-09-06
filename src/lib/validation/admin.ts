// Owner: B. Backend configuration forms. `id` present = edit, absent = create.
import { z } from "zod";
import { zBp, zId, zMoney, zName } from "./common";

export const approverRoleSchema = z.enum(["SALES_MANAGER", "FINANCE"]);
export const roleSchema = z.enum(["ADMIN", "SALES_REP", "SALES_MANAGER", "FINANCE"]);

export const tierSchema = z.object({ id: zId.optional(), name: zName, discountCeilingBp: zBp, sortOrder: z.coerce.number().int().default(0) });

export const categorySchema = z.object({
  id: zId.optional(),
  name: zName,
  discountCeilingBp: zBp.nullable(),
  minMarginBp: zBp.default(0),
});

export const approvalRuleSchema = z.object({
  id: zId.optional(),
  sequence: z.coerce.number().int().min(1),
  name: zName,
  minScore: z.coerce.number().int().min(0).max(100),
  maxWorstOverageBp: zBp.nullable().default(null),
  maxOrderTotal: zMoney.nullable().default(null),
  chain: z.array(approverRoleSchema).min(1, "Pick at least one approver"),
  isActive: z.coerce.boolean().default(true),
});

export const riskConfigSchema = z
  .object({
    wWorst: z.coerce.number().int().min(0).max(100),
    wBlended: z.coerce.number().int().min(0).max(100),
    wMargin: z.coerce.number().int().min(0).max(100),
    normWorstBp: zBp,
    normBlendedBp: zBp,
    normMarginBp: zBp,
    floorMarginBp: zBp,
    stalledDays: z.coerce.number().int().min(1).max(365),
    anomalyZ: z.coerce.number().min(0.5).max(10),
    anomalyAbsBp: zBp,
    minHistory: z.coerce.number().int().min(1).max(100),
  })
  .refine((v) => v.wWorst + v.wBlended + v.wMargin === 100, { path: ["wWorst"], message: "Weights must add up to 100" });

export const warehouseSchema = z.object({
  id: zId.optional(),
  name: zName,
  city: z.string().trim().max(80).nullish(),
  shipCostWeight: zMoney, // paise per shipment
  priority: z.coerce.number().int().min(1).max(1000).default(100),
});

export const stockLevelSchema = z.object({
  warehouseId: zId,
  productId: zId,
  onHand: z.coerce.number().int().min(0),
  reorderPoint: z.coerce.number().int().min(0).default(0),
  leadDays: z.coerce.number().int().min(0).max(365).default(7),
});

export const billingIntervalSchema = z.enum(["WEEK", "MONTH", "QUARTER", "YEAR"]);

export const planSchema = z.object({
  id: zId.optional(),
  name: zName,
  interval: billingIntervalSchema,
  periods: z.coerce.number().int().min(1).max(60).default(12),
  prorationMode: z.enum(["DAY_BASED", "NONE"]).default("DAY_BASED"),
  billChangeDay: z.coerce.boolean().default(true),
  cancelPolicy: z.enum(["END_OF_PERIOD", "IMMEDIATE_PRORATED_REFUND", "NO_REFUND"]).default("IMMEDIATE_PRORATED_REFUND"),
  refundMethod: z.enum(["CREDIT_NOTE", "REFUND_PAYMENT"]).default("CREDIT_NOTE"),
  productId: zId.nullable().default(null),
});

/** Screen 17: the Subscription switch reveals Recurring (interval); the price is then per period. */
export const productSchema = z
  .object({
    id: zId.optional(),
    sku: z.string().trim().min(2).max(40),
    name: zName,
    description: z.string().trim().max(2000).optional(),
    kind: z.enum(["GOOD", "SERVICE"]),
    isSubscription: z.coerce.boolean().default(false),
    recurringInterval: billingIntervalSchema.nullable().default(null),
    categoryId: zId,
    unit: z.string().trim().min(1).max(20).default("Each"),
    listPrice: zMoney,
    cost: zMoney,
    taxBp: zBp.default(1800),
    isPromoted: z.coerce.boolean().default(false),
    parentId: zId.nullable().default(null),
    variantLabel: z.string().trim().max(60).optional(),
    extraPrice: zMoney.default(0),
  })
  .refine((p) => !p.isSubscription || p.recurringInterval !== null, { path: ["recurringInterval"], message: "Pick how often a subscription is billed" })
  .transform((p) => ({ ...p, recurringInterval: p.isSubscription ? p.recurringInterval : null }));

export const pricelistRuleSchema = z.object({
  id: zId.optional(),
  tierId: zId,
  categoryId: zId.nullable().default(null),
  productId: zId.nullable().default(null),
  discountBp: zBp,
  note: z.string().trim().max(200).nullish(),
});

/** One price per (product, recurring plan): Odoo's time-based pricing table. */
export const productPlanPriceSchema = z.object({ id: zId.optional(), productId: zId, planId: zId, price: zMoney });

export const userRoleSchema = z.object({ userId: zId, role: roleSchema, managerId: zId.nullable().default(null) });

export type TierInput = z.infer<typeof tierSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type ApprovalRuleInput = z.infer<typeof approvalRuleSchema>;
export type RiskConfigInput = z.infer<typeof riskConfigSchema>;
export type WarehouseInput = z.infer<typeof warehouseSchema>;
export type StockLevelInput = z.infer<typeof stockLevelSchema>;
export type PlanInput = z.infer<typeof planSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type PricelistRuleInput = z.infer<typeof pricelistRuleSchema>;
export type ProductPlanPriceInput = z.infer<typeof productPlanPriceSchema>;
export type UserRoleInput = z.infer<typeof userRoleSchema>;
