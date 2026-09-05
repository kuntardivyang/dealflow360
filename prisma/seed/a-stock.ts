// Owner: A. Warehouses and stock. Laptop 14" is Main 6 / East 5 so qty 10 splits and qty 12 backorders.
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { seedCatalogue } from "./a-catalogue";
import { log, rs } from "./util";

type Catalogue = Awaited<ReturnType<typeof seedCatalogue>>;

export async function seedStock(db: PrismaClient, c: Catalogue) {
  const main = await db.warehouse.create({ data: { name: "Main Warehouse", city: "Ahmedabad", shipCostWeight: rs(500), priority: 1 } });
  const east = await db.warehouse.create({ data: { name: "East Depot", city: "Kolkata", shipCostWeight: rs(800), priority: 2 } });

  const rows: { warehouseId: number; productId: number; onHand: number; reorderPoint: number; leadDays: number }[] = [
    { warehouseId: main.id, productId: c.laptop.id, onHand: 6, reorderPoint: 4, leadDays: 7 },
    { warehouseId: east.id, productId: c.laptop.id, onHand: 5, reorderPoint: 2, leadDays: 10 },
    { warehouseId: main.id, productId: c.laptop16.id, onHand: 3, reorderPoint: 1, leadDays: 14 },
    { warehouseId: east.id, productId: c.laptop16.id, onHand: 0, reorderPoint: 1, leadDays: 14 },
    { warehouseId: main.id, productId: c.dock.id, onHand: 20, reorderPoint: 5, leadDays: 5 },
    { warehouseId: east.id, productId: c.dock.id, onHand: 0, reorderPoint: 5, leadDays: 5 },
    { warehouseId: main.id, productId: c.monitor.id, onHand: 2, reorderPoint: 3, leadDays: 7 },
    { warehouseId: east.id, productId: c.monitor.id, onHand: 10, reorderPoint: 3, leadDays: 7 },
  ];
  await db.stockLevel.createMany({ data: rows });
  log("stock", "Main Warehouse + East Depot, 8 stock rows (Laptop 6 / 5)");
  return { main, east };
}
