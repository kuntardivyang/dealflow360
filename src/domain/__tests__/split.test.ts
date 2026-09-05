import { describe, expect, it } from "vitest";
import { splitWarehouses, validateOverride } from "@/domain/split";
import type { DemandLine, StockRow, WarehouseInfo } from "@/lib/contract";

const main: WarehouseInfo = { id: 1, name: "Main Warehouse", shipCostWeight: 500_00, priority: 1 };
const east: WarehouseInfo = { id: 2, name: "East Depot", shipCostWeight: 800_00, priority: 2 };
const LAPTOP = 1;
const DOCK = 2;
const stock: StockRow[] = [
  { stockLevelId: 1, warehouseId: 1, productId: LAPTOP, available: 6 },
  { stockLevelId: 2, warehouseId: 2, productId: LAPTOP, available: 5 },
  { stockLevelId: 3, warehouseId: 1, productId: DOCK, available: 20 },
  { stockLevelId: 4, warehouseId: 2, productId: DOCK, available: 0 },
];
const laptops = (qty: number): DemandLine => ({ lineId: 10, productId: LAPTOP, qty, unitPrice: 60000_00 });
const docks = (qty: number): DemandLine => ({ lineId: 11, productId: DOCK, qty, unitPrice: 6000_00 });

describe("splitWarehouses", () => {
  it("uses one warehouse when it can cover the whole order", () => {
    const plan = splitWarehouses([laptops(5)], stock, [east, main]);
    expect(plan.shipmentCount).toBe(1);
    expect(plan.shipments[0].warehouseId).toBe(1); // Main is cheaper
    expect(plan.backorders).toEqual([]);
    expect(plan.estCost).toBe(500_00);
  });

  it("splits 10 laptops as Main 6 + East 4 with two shipments", () => {
    const plan = splitWarehouses([laptops(10), docks(10)], stock, [main, east]);
    expect(plan.shipmentCount).toBe(2);
    expect(plan.shipments.map((s) => [s.warehouseId, s.lines.map((l) => [l.productId, l.qty])])).toEqual([
      [1, [[LAPTOP, 6], [DOCK, 10]]],
      [2, [[LAPTOP, 4]]],
    ]);
    expect(plan.estCost).toBe(1300_00); // as in the demo script
    expect(plan.backorders).toEqual([]);
  });

  it("backorders what no warehouse has", () => {
    const plan = splitWarehouses([laptops(12)], stock, [main, east]);
    expect(plan.shipmentCount).toBe(2);
    expect(plan.backorders).toEqual([{ lineId: 10, productId: LAPTOP, qty: 1 }]);
  });

  it("is deterministic regardless of input order", () => {
    const a = splitWarehouses([docks(3), laptops(10)], [...stock].reverse(), [east, main]);
    const b = splitWarehouses([laptops(10), docks(3)], stock, [main, east]);
    expect(a).toEqual(b);
  });

  it("returns an empty plan for no demand", () => {
    const plan = splitWarehouses([], stock, [main, east]);
    expect(plan.shipmentCount).toBe(0);
    expect(plan.backorders).toEqual([]);
  });
});

describe("validateOverride", () => {
  it("rejects allocations above stock or above the ordered quantity", () => {
    const errors = validateOverride(
      [
        { lineId: 10, productId: LAPTOP, qty: 8, warehouseId: 2 },
        { lineId: 10, productId: LAPTOP, qty: 6, warehouseId: 1 },
      ],
      [laptops(10)],
      stock,
    );
    expect(errors).toHaveLength(2); // East has 5, and 14 > 10 ordered
  });

  it("accepts a valid partial allocation", () => {
    expect(validateOverride([{ lineId: 10, productId: LAPTOP, qty: 6, warehouseId: 1 }], [laptops(10)], stock)).toEqual([]);
  });
});
