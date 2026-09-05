// Warehouse split for a confirmed order (PDF A4, B6). Objective: the fewest shipments,
// then the lowest shipping cost. One shipment per warehouse per order. Deterministic:
// inputs are sorted before the greedy pass, so the same stock gives the same plan.
import type { DemandLine, Money, SplitAllocation, SplitPlan, StockRow, WarehouseInfo } from "@/lib/contract";

type Remaining = Map<number, number>; // lineId -> qty still to place
type Avail = Map<string, number>; // `${warehouseId}:${productId}` -> available

const key = (w: number, p: number) => `${w}:${p}`;

function byCostThenPriority(a: WarehouseInfo, b: WarehouseInfo): number {
  return a.shipCostWeight - b.shipCostWeight || a.priority - b.priority || a.id - b.id;
}

/** Value a warehouse can still cover for the remaining demand. */
function coverValue(w: WarehouseInfo, lines: DemandLine[], remaining: Remaining, avail: Avail): Money {
  return lines.reduce((sum, l) => {
    const need = remaining.get(l.lineId) ?? 0;
    const have = avail.get(key(w.id, l.productId)) ?? 0;
    return sum + Math.min(need, have) * l.unitPrice;
  }, 0);
}

export function splitWarehouses(lines: DemandLine[], stock: StockRow[], warehouses: WarehouseInfo[]): SplitPlan {
  const demand = [...lines].filter((l) => l.qty > 0).sort((a, b) => a.lineId - b.lineId);
  const ordered = [...warehouses].sort(byCostThenPriority);
  const remaining: Remaining = new Map(demand.map((l) => [l.lineId, l.qty]));
  const avail: Avail = new Map();
  for (const s of stock) avail.set(key(s.warehouseId, s.productId), Math.max(0, s.available));

  const totalValue = demand.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const shipments: SplitPlan["shipments"] = [];

  const take = (w: WarehouseInfo) => {
    const alloc: SplitAllocation[] = [];
    for (const l of demand) {
      const need = remaining.get(l.lineId) ?? 0;
      const have = avail.get(key(w.id, l.productId)) ?? 0;
      const qty = Math.min(need, have);
      if (qty <= 0) continue;
      alloc.push({ lineId: l.lineId, productId: l.productId, qty });
      remaining.set(l.lineId, need - qty);
      avail.set(key(w.id, l.productId), have - qty);
    }
    if (alloc.length > 0) shipments.push({ warehouseId: w.id, lines: alloc, estCost: w.shipCostWeight });
  };

  // 1) A single warehouse that covers everything wins outright (cheapest first).
  const whole = ordered.find((w) => coverValue(w, demand, remaining, avail) === totalValue && totalValue > 0);
  if (whole) {
    take(whole);
  } else {
    // 2) Greedy: the warehouse covering the most remaining value, tie by cost, until nothing more can be placed.
    while ([...remaining.values()].some((q) => q > 0)) {
      let best: WarehouseInfo | null = null;
      let bestValue = 0;
      for (const w of ordered) {
        const v = coverValue(w, demand, remaining, avail);
        if (v > bestValue) {
          best = w;
          bestValue = v;
        }
      }
      if (!best) break;
      take(best);
    }
  }

  // 3) Whatever is left is backordered.
  const backorders: SplitAllocation[] = demand
    .filter((l) => (remaining.get(l.lineId) ?? 0) > 0)
    .map((l) => ({ lineId: l.lineId, productId: l.productId, qty: remaining.get(l.lineId) ?? 0 }));

  return {
    shipments,
    backorders,
    shipmentCount: shipments.length,
    estCost: shipments.reduce((s, sh) => s + sh.estCost, 0),
  };
}

/** Validate a manual override: every line fully covered or explicitly short, nothing over stock. Returns messages, [] = ok. */
export function validateOverride(allocations: SplitAllocation[] & { warehouseId?: number }[], lines: DemandLine[], stock: StockRow[]): string[] {
  const errors: string[] = [];
  const byLine = new Map<number, number>();
  const byStock = new Map<string, number>();
  for (const a of allocations as (SplitAllocation & { warehouseId: number })[]) {
    if (a.qty <= 0) errors.push(`Line ${a.lineId}: quantity must be positive`);
    byLine.set(a.lineId, (byLine.get(a.lineId) ?? 0) + a.qty);
    const k = key(a.warehouseId, a.productId);
    byStock.set(k, (byStock.get(k) ?? 0) + a.qty);
  }
  for (const l of lines) {
    const placed = byLine.get(l.lineId) ?? 0;
    if (placed > l.qty) errors.push(`Line ${l.lineId}: allocated ${placed}, ordered ${l.qty}`);
  }
  for (const [k, qty] of byStock) {
    const [w, p] = k.split(":").map(Number);
    const row = stock.find((s) => s.warehouseId === w && s.productId === p);
    const available = row?.available ?? 0;
    if (qty > available) errors.push(`Warehouse ${w}, product ${p}: allocated ${qty}, available ${available}`);
  }
  return errors;
}
