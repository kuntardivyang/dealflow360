// Runs against the seeded development database. Creates its own rows and removes them.
import { afterAll, describe, expect, it } from "vitest";
import { riskConfigSchema, ValidationError, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { saveApprovalRule, saveStockLevel, saveTier, saveWarehouse } from "@/services/admin.service";

const tierIds: number[] = [];
const warehouseIds: number[] = [];
const ruleIds: number[] = [];

async function admin(): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.com" } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}

afterAll(async () => {
  await prisma.approvalRule.deleteMany({ where: { id: { in: ruleIds } } });
  await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
  await prisma.customerTier.deleteMany({ where: { id: { in: tierIds } } });
  await prisma.auditLog.deleteMany({ where: { entityType: { in: ["CustomerTier", "Warehouse", "StockLevel", "ApprovalRule"] }, actorName: "Admin", reason: null, at: { gt: new Date(Date.now() - 60_000) } } });
  await prisma.$disconnect();
});

describe("admin service against the database", () => {
  it("creates and updates a tier with an audit row each time", async () => {
    const user = await admin();
    const tier = await saveTier({ name: `Platinum ${Date.now()}`, discountCeilingBp: 2000, sortOrder: 9 }, user);
    tierIds.push(tier.id);
    expect(tier.discountCeilingBp).toBe(2000);
    const updated = await saveTier({ id: tier.id, name: tier.name, discountCeilingBp: 1800, sortOrder: 9 }, user);
    expect(updated.discountCeilingBp).toBe(1800);
    const logs = await prisma.auditLog.findMany({ where: { entityType: "CustomerTier", entityId: tier.id }, orderBy: { id: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["CREATE", "UPDATE"]);
    expect(logs[1].beforeJson).toMatchObject({ discountCeilingBp: 2000 });
    expect(logs[1].afterJson).toMatchObject({ discountCeilingBp: 1800 });
  });

  it("a new warehouse with stock is usable at once, and on-hand changes leave a stock move", async () => {
    const user = await admin();
    const laptop = await prisma.product.findFirstOrThrow({ where: { name: 'Laptop 14"' } });
    const wh = await saveWarehouse({ name: `Reviewer Depot ${Date.now()}`, city: "Surat", shipCostWeight: 60000, priority: 3 }, user);
    warehouseIds.push(wh.id);
    const level = await saveStockLevel({ warehouseId: wh.id, productId: laptop.id, onHand: 3, reorderPoint: 1, leadDays: 5 }, user);
    expect(level.onHand).toBe(3);
    await saveStockLevel({ warehouseId: wh.id, productId: laptop.id, onHand: 5, reorderPoint: 1, leadDays: 5 }, user);
    const moves = await prisma.stockMove.findMany({ where: { stockLevelId: level.id }, orderBy: { id: "asc" } });
    expect(moves.map((m) => [m.type, m.qty])).toEqual([
      ["RECEIPT", 3],
      ["RECEIPT", 2],
    ]);
    await prisma.stockLevel.update({ where: { id: level.id }, data: { reserved: 4 } });
    await expect(saveStockLevel({ warehouseId: wh.id, productId: laptop.id, onHand: 2, reorderPoint: 1, leadDays: 5 }, user)).rejects.toBeInstanceOf(ValidationError);
  });

  it("saves an approval rule with its chain", async () => {
    const user = await admin();
    const rule = await saveApprovalRule(
      { sequence: 90 + Math.floor(Math.random() * 900), name: "Test rule", minScore: 70, maxWorstOverageBp: null, maxOrderTotal: null, chain: ["SALES_MANAGER", "FINANCE"], isActive: false },
      user,
    );
    ruleIds.push(rule.id);
    expect(rule.chain).toEqual(["SALES_MANAGER", "FINANCE"]);
    expect(rule.isActive).toBe(false);
  });

  it("rejects risk weights that do not add up to 100", () => {
    const bad = riskConfigSchema.safeParse({ wWorst: 50, wBlended: 40, wMargin: 20, normWorstBp: 1000, normBlendedBp: 500, normMarginBp: 1000, floorMarginBp: 2000, stalledDays: 3, anomalyZ: 2, anomalyAbsBp: 1000, minHistory: 5 });
    expect(bad.success).toBe(false);
  });
});
