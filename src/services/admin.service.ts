// Owner: B. Back-end configuration (PDF A2-A5). Every rule the engine reads at run time
// lives in these tables; nothing is hard-coded. Each save is one transaction with an
// audit row carrying before/after, so a reviewer can see who changed a ceiling and when.
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import {
  actorFromUser,
  NotFoundError,
  ValidationError,
  type ApprovalRuleInput,
  type CategoryInput,
  type PlanInput,
  type PricelistRuleInput,
  type ProductPlanPriceInput,
  type ProductInput,
  type RiskConfigInput,
  type SessionUser,
  type StockLevelInput,
  type TierInput,
  type UserRoleInput,
  type WarehouseInput,
} from "@/lib/contract";
import { prisma, type Tx } from "@/lib/db";

/** Create or update one row and write the audit entry in the same transaction. */
async function saveRow<T extends { id: number }>(
  entityType: string,
  user: SessionUser,
  id: number | undefined,
  read: (tx: Tx, id: number) => Promise<T | null>,
  create: (tx: Tx) => Promise<T>,
  update: (tx: Tx, id: number) => Promise<T>,
  summary: (row: T) => Record<string, unknown>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const before = id ? await read(tx, id) : null;
    if (id && !before) throw new NotFoundError(`${entityType} not found`);
    const row = id ? await update(tx, id) : await create(tx);
    await audit(tx, {
      entityType,
      entityId: row.id,
      action: id ? "UPDATE" : "CREATE",
      actor: actorFromUser(user),
      before: before ? summary(before) : undefined,
      after: summary(row),
    });
    return row;
  });
}

export function saveTier(input: TierInput, user: SessionUser) {
  const data = { name: input.name, discountCeilingBp: input.discountCeilingBp, sortOrder: input.sortOrder };
  return saveRow(
    "CustomerTier",
    user,
    input.id,
    (tx, id) => tx.customerTier.findUnique({ where: { id } }),
    (tx) => tx.customerTier.create({ data }),
    (tx, id) => tx.customerTier.update({ where: { id }, data }),
    (t) => ({ name: t.name, discountCeilingBp: t.discountCeilingBp, sortOrder: t.sortOrder }),
  );
}

export function saveCategory(input: CategoryInput, user: SessionUser) {
  const data = { name: input.name, discountCeilingBp: input.discountCeilingBp, minMarginBp: input.minMarginBp };
  return saveRow(
    "ProductCategory",
    user,
    input.id,
    (tx, id) => tx.productCategory.findUnique({ where: { id } }),
    (tx) => tx.productCategory.create({ data }),
    (tx, id) => tx.productCategory.update({ where: { id }, data }),
    (c) => ({ name: c.name, discountCeilingBp: c.discountCeilingBp, minMarginBp: c.minMarginBp }),
  );
}

export function saveApprovalRule(input: ApprovalRuleInput, user: SessionUser) {
  const data = {
    sequence: input.sequence,
    name: input.name,
    minScore: input.minScore,
    maxWorstOverageBp: input.maxWorstOverageBp,
    maxOrderTotal: input.maxOrderTotal,
    chain: [...input.chain],
    isActive: input.isActive,
  };
  return saveRow(
    "ApprovalRule",
    user,
    input.id,
    (tx, id) => tx.approvalRule.findUnique({ where: { id } }),
    (tx) => tx.approvalRule.create({ data }),
    (tx, id) => tx.approvalRule.update({ where: { id }, data }),
    (r) => ({ sequence: r.sequence, name: r.name, minScore: r.minScore, maxWorstOverageBp: r.maxWorstOverageBp, maxOrderTotal: r.maxOrderTotal, chain: r.chain, isActive: r.isActive }),
  );
}

export async function saveRiskConfig(input: RiskConfigInput, user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.riskConfig.findUnique({ where: { id: 1 } });
    const row = await tx.riskConfig.upsert({ where: { id: 1 }, create: { id: 1, ...input, updatedById: user.id }, update: { ...input, updatedById: user.id } });
    await audit(tx, { entityType: "RiskConfig", entityId: 1, action: "UPDATE", actor: actorFromUser(user), before: before ?? undefined, after: input });
    return row;
  });
}

export function saveWarehouse(input: WarehouseInput, user: SessionUser) {
  const data = { name: input.name, city: input.city ?? null, shipCostWeight: input.shipCostWeight, priority: input.priority };
  return saveRow(
    "Warehouse",
    user,
    input.id,
    (tx, id) => tx.warehouse.findUnique({ where: { id } }),
    (tx) => tx.warehouse.create({ data }),
    (tx, id) => tx.warehouse.update({ where: { id }, data }),
    (w) => ({ name: w.name, city: w.city, shipCostWeight: w.shipCostWeight, priority: w.priority }),
  );
}

/** Stock is keyed by (warehouse, product). Changing on-hand writes a StockMove so the ledger explains every level. */
export async function saveStockLevel(input: StockLevelInput, user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const key = { warehouseId_productId: { warehouseId: input.warehouseId, productId: input.productId } };
    const before = await tx.stockLevel.findUnique({ where: key });
    if (before && input.onHand < before.reserved) {
      throw new ValidationError("On hand cannot go below the quantity already reserved", { onHand: [`${before.reserved} units are reserved for confirmed orders`] });
    }
    const row = await tx.stockLevel.upsert({
      where: key,
      create: { warehouseId: input.warehouseId, productId: input.productId, onHand: input.onHand, reorderPoint: input.reorderPoint, leadDays: input.leadDays },
      update: { onHand: input.onHand, reorderPoint: input.reorderPoint, leadDays: input.leadDays },
    });
    const delta = input.onHand - (before?.onHand ?? 0);
    if (delta !== 0) {
      await tx.stockMove.create({
        data: { stockLevelId: row.id, type: delta > 0 ? "RECEIPT" : "ADJUST", qty: Math.abs(delta), note: `Admin set on hand to ${input.onHand}`, createdById: user.id },
      });
    }
    await audit(tx, {
      entityType: "StockLevel",
      entityId: row.id,
      action: before ? "UPDATE" : "CREATE",
      actor: actorFromUser(user),
      before: before ? { onHand: before.onHand, reorderPoint: before.reorderPoint, leadDays: before.leadDays } : undefined,
      after: { warehouseId: row.warehouseId, productId: row.productId, onHand: row.onHand, reorderPoint: row.reorderPoint, leadDays: row.leadDays },
    });
    return row;
  });
}

export function savePlan(input: PlanInput, user: SessionUser) {
  const data = {
    name: input.name,
    interval: input.interval,
    periods: input.periods,
    prorationMode: input.prorationMode,
    billChangeDay: input.billChangeDay,
    cancelPolicy: input.cancelPolicy,
    refundMethod: input.refundMethod,
    productId: input.productId,
  };
  return saveRow(
    "RecurringPlan",
    user,
    input.id,
    (tx, id) => tx.recurringPlan.findUnique({ where: { id } }),
    (tx) => tx.recurringPlan.create({ data }),
    (tx, id) => tx.recurringPlan.update({ where: { id }, data }),
    (p) => ({ name: p.name, interval: p.interval, periods: p.periods, prorationMode: p.prorationMode, billChangeDay: p.billChangeDay, cancelPolicy: p.cancelPolicy, refundMethod: p.refundMethod }),
  );
}

export function saveProduct(input: ProductInput, user: SessionUser) {
  const data = {
    sku: input.sku,
    name: input.name,
    description: input.description ?? null,
    kind: input.kind,
    isSubscription: input.isSubscription,
    recurringInterval: input.recurringInterval,
    categoryId: input.categoryId,
    unit: input.unit,
    listPrice: input.listPrice,
    cost: input.cost,
    taxBp: input.taxBp,
    isPromoted: input.isPromoted,
    parentId: input.parentId,
    variantLabel: input.variantLabel ?? null,
    extraPrice: input.extraPrice,
  };
  return saveRow(
    "Product",
    user,
    input.id,
    (tx, id) => tx.product.findUnique({ where: { id } }),
    (tx) => tx.product.create({ data }),
    (tx, id) => tx.product.update({ where: { id }, data }),
    (p) => ({ sku: p.sku, name: p.name, kind: p.kind, isSubscription: p.isSubscription, recurringInterval: p.recurringInterval, categoryId: p.categoryId, listPrice: p.listPrice, cost: p.cost, taxBp: p.taxBp, isPromoted: p.isPromoted, parentId: p.parentId, extraPrice: p.extraPrice }),
  );
}

export function savePricelistRule(input: PricelistRuleInput, user: SessionUser) {
  const data = { tierId: input.tierId, categoryId: input.categoryId, productId: input.productId, discountBp: input.discountBp, note: input.note ?? null };
  return saveRow(
    "PricelistRule",
    user,
    input.id,
    (tx, id) => tx.pricelistRule.findUnique({ where: { id } }),
    (tx) => tx.pricelistRule.create({ data }),
    (tx, id) => tx.pricelistRule.update({ where: { id }, data }),
    (r) => ({ tierId: r.tierId, categoryId: r.categoryId, productId: r.productId, discountBp: r.discountBp }),
  );
}

export function saveProductPlanPrice(input: ProductPlanPriceInput, user: SessionUser) {
  const data = { productId: input.productId, planId: input.planId, price: input.price };
  return saveRow(
    "ProductPlanPrice",
    user,
    input.id,
    (tx, id) => tx.productPlanPrice.findUnique({ where: { id } }),
    (tx) => tx.productPlanPrice.upsert({ where: { productId_planId: { productId: data.productId, planId: data.planId } }, create: data, update: { price: data.price } }),
    (tx, id) => tx.productPlanPrice.update({ where: { id }, data }),
    (r) => ({ productId: r.productId, planId: r.planId, price: r.price }),
  );
}

/** Admin only (checked by the action). Role is read from this row on every request, so it applies at once. */
export async function setUserRole(input: UserRoleInput, user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before) throw new NotFoundError("User not found");
    if (input.managerId !== null && input.managerId === input.userId) throw new ValidationError("A user cannot be their own manager", { managerId: ["Pick someone else"] });
    const row = await tx.user.update({ where: { id: input.userId }, data: { role: input.role, managerId: input.managerId } });
    await audit(tx, {
      entityType: "User",
      entityId: row.id,
      action: "ROLE_CHANGE",
      actor: actorFromUser(user),
      before: { role: before.role, managerId: before.managerId },
      after: { role: row.role, managerId: row.managerId },
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export async function getGovernanceConfig() {
  const [tiers, categories, rules, riskConfig] = await Promise.all([
    prisma.customerTier.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.productCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.approvalRule.findMany({ orderBy: { sequence: "asc" } }),
    prisma.riskConfig.findUnique({ where: { id: 1 } }),
  ]);
  return { tiers, categories, rules, riskConfig };
}

export async function getWarehousesWithStock() {
  const [warehouses, products] = await Promise.all([
    prisma.warehouse.findMany({
      where: { archivedAt: null },
      orderBy: [{ priority: "asc" }, { id: "asc" }],
      include: { stockLevels: { include: { product: { select: { id: true, name: true, sku: true } } }, orderBy: { productId: "asc" } } },
    }),
    prisma.product.findMany({ where: { archivedAt: null, kind: "GOOD" }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true } }),
  ]);
  return { warehouses, products };
}

export async function getPlans() {
  const [plans, products] = await Promise.all([
    prisma.recurringPlan.findMany({ where: { archivedAt: null }, orderBy: { id: "asc" }, include: { product: { select: { id: true, name: true } } } }),
    prisma.product.findMany({ where: { archivedAt: null, isSubscription: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { plans, products };
}

export type GovernanceConfig = Awaited<ReturnType<typeof getGovernanceConfig>>;
export type WarehousesWithStock = Awaited<ReturnType<typeof getWarehousesWithStock>>;
export type PlansView = Awaited<ReturnType<typeof getPlans>>;
export const jsonChain = (chain: Prisma.JsonValue): string[] => (Array.isArray(chain) ? (chain as string[]) : []);

export async function getProducts() {
  const [products, rules, tiers] = await Promise.all([
    prisma.product.findMany({
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
      include: { category: { select: { name: true } }, variants: { select: { id: true, variantLabel: true } }, parent: { select: { name: true } } },
    }),
    prisma.pricelistRule.count(),
    prisma.customerTier.count(),
  ]);
  return {
    products,
    tiles: {
      active: products.filter((p) => !p.archivedAt).length,
      archived: products.filter((p) => p.archivedAt).length,
      pricelistRules: rules,
      tiers,
      variants: products.filter((p) => p.parentId !== null).length,
    },
  };
}

export async function getProductEditor(id: number | null) {
  const [product, categories, tiers, parents, warehouses, recurringPlans] = await Promise.all([
    id === null
      ? null
      : prisma.product.findUnique({
          where: { id },
          include: {
            category: true,
            parent: { select: { id: true, name: true } },
            variants: { orderBy: { id: "asc" }, include: { category: { select: { name: true } } } },
            pricelistRules: { orderBy: { id: "asc" }, include: { tier: { select: { name: true } } } },
            stockLevels: { include: { warehouse: { select: { name: true } } } },
            plans: { where: { archivedAt: null }, select: { id: true, name: true, interval: true } },
            planPrices: { orderBy: { planId: "asc" }, include: { plan: { select: { id: true, name: true, interval: true } } } },
          },
        }),
    prisma.productCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.customerTier.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.product.findMany({ where: { parentId: null, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.warehouse.findMany({ where: { archivedAt: null }, orderBy: { priority: "asc" }, select: { id: true, name: true } }),
    prisma.recurringPlan.findMany({ where: { archivedAt: null }, orderBy: { id: "asc" }, select: { id: true, name: true, interval: true } }),
  ]);
  return { product, categories, tiers, parents, warehouses, recurringPlans };
}

export async function getUsers() {
  return prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }], include: { manager: { select: { id: true, name: true } }, _count: { select: { quotations: true } } } });
}
