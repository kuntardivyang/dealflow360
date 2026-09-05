// Owner: A. Warehouse split proposals, acceptance with locked stock reservation,
// shipping and stock receipts (PDF A4, B6). Every mutation is one transaction.
import { Prisma } from "@/generated/prisma/client";
import { addDays, todayISO, parseISODate } from "@/domain/dates";
import { splitWarehouses, validateOverride } from "@/domain/split";
import { audit } from "@/lib/audit";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  actorFromUser,
  type AcceptSplitInput,
  type Actor,
  type DemandLine,
  type OverrideSplitInput,
  type QuotationRef,
  type SessionUser,
  type ShipInput,
  type StockReceiptInput,
  type StockRow,
  type WarehouseInfo,
} from "@/lib/contract";
import { prisma, type Tx } from "@/lib/db";
import { assertActor, assertPlanTransition, assertShipmentTransition, assertTransition } from "@/lib/state";

type PlanRef = QuotationRef & { planId: number };

/** Lines that need stock: goods only. Services and subscriptions never ship. */
async function loadDemand(tx: Tx, quotationId: number): Promise<DemandLine[]> {
  const lines = await tx.quotationLine.findMany({
    where: { quotationId, product: { kind: "GOOD" } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, productId: true, qty: true, unitPrice: true },
  });
  return lines.map((l) => ({ lineId: l.id, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice }));
}

async function loadStock(tx: Tx, productIds: number[]): Promise<{ stock: StockRow[]; warehouses: WarehouseInfo[]; leadDays: Map<number, number> }> {
  const warehouses = await tx.warehouse.findMany({ where: { archivedAt: null }, orderBy: [{ shipCostWeight: "asc" }, { priority: "asc" }] });
  const rows = await tx.stockLevel.findMany({ where: { productId: { in: productIds }, warehouseId: { in: warehouses.map((w) => w.id) } } });
  const leadDays = new Map<number, number>();
  for (const r of rows) leadDays.set(r.productId, Math.max(leadDays.get(r.productId) ?? 0, r.leadDays));
  return {
    stock: rows.map((r) => ({ stockLevelId: r.id, warehouseId: r.warehouseId, productId: r.productId, available: r.onHand - r.reserved })),
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, shipCostWeight: w.shipCostWeight, priority: w.priority })),
    leadDays,
  };
}

/**
 * Propose a split for a confirmed quotation from live stock. Called inside the
 * transaction that confirms the order (portal confirm or admin confirm on behalf).
 * Any earlier PROPOSED plan is superseded. Returns null when nothing needs shipping.
 */
export async function proposePlan(tx: Tx, quotationId: number, actor: Actor): Promise<number | null> {
  const demand = await loadDemand(tx, quotationId);
  if (demand.length === 0) return null;
  await tx.fulfillmentPlan.updateMany({ where: { quotationId, status: "PROPOSED" }, data: { status: "SUPERSEDED" } });
  const { stock, warehouses, leadDays } = await loadStock(tx, [...new Set(demand.map((d) => d.productId))]);
  const plan = splitWarehouses(demand, stock, warehouses);
  const today = todayISO();
  const created = await tx.fulfillmentPlan.create({
    data: {
      quotationId,
      status: "PROPOSED",
      shipmentCount: plan.shipmentCount,
      estCost: plan.estCost,
      createdById: actor.type === "USER" ? actor.id : null,
      lines: {
        create: [
          ...plan.shipments.flatMap((s) => s.lines.map((l) => ({ quotationLineId: l.lineId, warehouseId: s.warehouseId, qty: l.qty }))),
          ...plan.backorders.map((b) => ({
            quotationLineId: b.lineId,
            warehouseId: null,
            qty: b.qty,
            isBackorder: true,
            expectedDate: parseISODate(addDays(today, leadDays.get(b.productId) ?? 7)),
          })),
        ],
      },
    },
  });
  await audit(tx, {
    entityType: "FulfillmentPlan",
    entityId: created.id,
    quotationId,
    action: "SPLIT_PROPOSED",
    actor,
    after: { shipments: plan.shipments.map((s) => ({ warehouseId: s.warehouseId, lines: s.lines })), backorders: plan.backorders, estCost: plan.estCost },
  });
  return created.id;
}

/**
 * Reserve stock for accepted allocations. Locks the stock rows in id order (no
 * deadlocks), then applies conditional updates: a row that no longer has enough
 * available stock makes the whole transaction fail with 409.
 */
export async function reserveStock(tx: Tx, allocations: { stockLevelId: number; qty: number }[]): Promise<void> {
  const ids = [...new Set(allocations.map((a) => a.stockLevelId))].sort((a, b) => a - b);
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM stock_level WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  for (const a of allocations) {
    const n = await tx.$executeRaw`UPDATE stock_level SET reserved = reserved + ${a.qty}, updated_at = now() WHERE id = ${a.stockLevelId} AND on_hand - reserved >= ${a.qty}`;
    if (n !== 1) throw new ConflictError("Stock changed since the split was proposed. A new split has to be proposed.");
  }
}

async function acceptInTx(tx: Tx, planId: number, quotationId: number, user: SessionUser, reason?: string): Promise<PlanRef> {
  const actor = actorFromUser(user);
  assertActor(actor, "ACCEPT_SPLIT");
  const q = await tx.quotation.findUnique({ where: { id: quotationId } });
  if (!q) throw new NotFoundError("Quotation not found");
  assertTransition(q.status, "ACCEPT_SPLIT");
  const plan = await tx.fulfillmentPlan.findFirst({ where: { id: planId, quotationId }, include: { lines: { include: { quotationLine: true } } } });
  if (!plan) throw new NotFoundError("Split proposal not found");
  assertPlanTransition(plan.status, "ACCEPTED");
  const locked = await tx.fulfillmentPlan.updateMany({ where: { id: plan.id, status: "PROPOSED" }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedById: user.id } });
  if (locked.count !== 1) throw new ConflictError("This split was already accepted");

  const shipped = plan.lines.filter((l) => l.warehouseId !== null);
  const stockRows = await tx.stockLevel.findMany({
    where: { OR: shipped.map((l) => ({ warehouseId: l.warehouseId!, productId: l.quotationLine.productId })) },
  });
  const stockId = (warehouseId: number, productId: number) => {
    const row = stockRows.find((s) => s.warehouseId === warehouseId && s.productId === productId);
    if (!row) throw new ConflictError("A warehouse in this plan no longer stocks the product");
    return row.id;
  };
  await reserveStock(
    tx,
    shipped.map((l) => ({ stockLevelId: stockId(l.warehouseId!, l.quotationLine.productId), qty: l.qty })),
  );

  const warehouseIds = [...new Set(shipped.map((l) => l.warehouseId!))];
  const warehouses = await tx.warehouse.findMany({ where: { id: { in: warehouseIds } } });
  for (const wid of warehouseIds) {
    const shipment = await tx.shipment.create({ data: { planId: plan.id, warehouseId: wid, status: "RESERVED", shipCost: warehouses.find((w) => w.id === wid)?.shipCostWeight ?? 0 } });
    const mine = shipped.filter((l) => l.warehouseId === wid);
    await tx.fulfillmentLine.updateMany({ where: { id: { in: mine.map((l) => l.id) } }, data: { shipmentId: shipment.id } });
    for (const l of mine) {
      await tx.stockMove.create({
        data: { stockLevelId: stockId(wid, l.quotationLine.productId), type: "RESERVE", qty: l.qty, quotationId, shipmentId: shipment.id, createdById: user.id },
      });
    }
  }
  const updated = await tx.quotation.update({ where: { id: quotationId }, data: { status: "FULFILLMENT" } });
  await audit(tx, {
    entityType: "FulfillmentPlan",
    entityId: plan.id,
    quotationId,
    action: plan.isManual ? "SPLIT_OVERRIDE_ACCEPTED" : "SPLIT_ACCEPTED",
    actor,
    reason,
    after: { shipments: warehouseIds.length, backorders: plan.lines.filter((l) => l.isBackorder).map((l) => ({ lineId: l.quotationLineId, qty: l.qty })) },
  });
  return { id: updated.id, publicId: updated.publicId, number: updated.number, status: updated.status, version: updated.version, planId: plan.id };
}

/** Accept the suggested split: reserve stock and open one shipment per warehouse. */
export async function acceptPlan(input: AcceptSplitInput, user: SessionUser): Promise<PlanRef> {
  return prisma.$transaction(async (tx) => acceptInTx(tx, input.planId, input.quotationId, user), { isolationLevel: "ReadCommitted" });
}

/** Manual override: validate the allocation against stock, replace the proposal, then accept it. */
export async function overridePlan(input: OverrideSplitInput, user: SessionUser): Promise<PlanRef> {
  return prisma.$transaction(
    async (tx) => {
      const demand = await loadDemand(tx, input.quotationId);
      const { stock } = await loadStock(tx, [...new Set(demand.map((d) => d.productId))]);
      const productOf = new Map(demand.map((d) => [d.lineId, d.productId]));
      const allocations = input.allocations.map((a) => {
        const productId = productOf.get(a.lineId);
        if (productId === undefined) throw new ValidationError("A line in the override does not belong to this order");
        return { lineId: a.lineId, productId, qty: a.qty, warehouseId: a.warehouseId };
      });
      const errors = validateOverride(allocations, demand, stock);
      if (errors.length > 0) throw new ValidationError(errors.join(". "), { allocations: errors });

      const current = await tx.fulfillmentPlan.findFirst({ where: { id: input.planId, quotationId: input.quotationId } });
      if (!current) throw new NotFoundError("Split proposal not found");
      assertPlanTransition(current.status, "SUPERSEDED");
      await tx.fulfillmentPlan.update({ where: { id: current.id }, data: { status: "SUPERSEDED" } });

      const placed = new Map<number, number>();
      for (const a of allocations) placed.set(a.lineId, (placed.get(a.lineId) ?? 0) + a.qty);
      const warehouses = await tx.warehouse.findMany({ where: { id: { in: [...new Set(allocations.map((a) => a.warehouseId))] } } });
      const manual = await tx.fulfillmentPlan.create({
        data: {
          quotationId: input.quotationId,
          status: "PROPOSED",
          isManual: true,
          reason: input.reason,
          shipmentCount: new Set(allocations.map((a) => a.warehouseId)).size,
          estCost: [...new Set(allocations.map((a) => a.warehouseId))].reduce((s, wid) => s + (warehouses.find((w) => w.id === wid)?.shipCostWeight ?? 0), 0),
          createdById: user.id,
          lines: {
            create: [
              ...allocations.map((a) => ({ quotationLineId: a.lineId, warehouseId: a.warehouseId, qty: a.qty })),
              ...demand
                .filter((d) => d.qty - (placed.get(d.lineId) ?? 0) > 0)
                .map((d) => ({ quotationLineId: d.lineId, warehouseId: null, qty: d.qty - (placed.get(d.lineId) ?? 0), isBackorder: true })),
            ],
          },
        },
      });
      return acceptInTx(tx, manual.id, input.quotationId, user, input.reason);
    },
    { isolationLevel: "ReadCommitted" },
  );
}

/** Ship a reserved shipment: stock leaves the warehouse, reservation is released. */
export async function ship(input: ShipInput, user: SessionUser): Promise<{ shipmentId: number }> {
  return prisma.$transaction(async (tx) => {
    const actor = actorFromUser(user);
    assertActor(actor, "SHIP");
    const shipment = await tx.shipment.findUnique({ where: { id: input.shipmentId }, include: { lines: { include: { quotationLine: true } }, plan: true } });
    if (!shipment) throw new NotFoundError("Shipment not found");
    assertShipmentTransition(shipment.status, "SHIPPED");
    const q = await tx.quotation.findUniqueOrThrow({ where: { id: shipment.plan.quotationId } });
    assertTransition(q.status, "SHIP");
    for (const l of shipment.lines) {
      const row = await tx.stockLevel.findUnique({ where: { warehouseId_productId: { warehouseId: shipment.warehouseId, productId: l.quotationLine.productId } } });
      if (!row) throw new ConflictError("Stock row missing for this shipment");
      const n = await tx.$executeRaw`UPDATE stock_level SET on_hand = on_hand - ${l.qty}, reserved = reserved - ${l.qty}, updated_at = now() WHERE id = ${row.id} AND reserved >= ${l.qty} AND on_hand >= ${l.qty}`;
      if (n !== 1) throw new ConflictError("Reserved stock no longer matches this shipment");
      await tx.stockMove.create({ data: { stockLevelId: row.id, type: "SHIP", qty: l.qty, quotationId: q.id, shipmentId: shipment.id, createdById: user.id } });
    }
    await tx.shipment.update({ where: { id: shipment.id }, data: { status: "SHIPPED", shippedAt: new Date() } });
    await audit(tx, { entityType: "Shipment", entityId: shipment.id, quotationId: q.id, action: "SHIP", actor, after: { warehouseId: shipment.warehouseId, lines: shipment.lines.map((l) => ({ lineId: l.quotationLineId, qty: l.qty })) } });
    return { shipmentId: shipment.id };
  });
}

/** Stock arrives: on hand goes up, a receipt move is recorded. Backorder consolidation prompts come later. */
export async function receiveStock(input: StockReceiptInput, user: SessionUser): Promise<{ stockLevelId: number }> {
  return prisma.$transaction(async (tx) => {
    const actor = actorFromUser(user);
    const row = await tx.stockLevel.upsert({
      where: { warehouseId_productId: { warehouseId: input.warehouseId, productId: input.productId } },
      create: { warehouseId: input.warehouseId, productId: input.productId, onHand: input.qty },
      update: { onHand: { increment: input.qty } },
    });
    await tx.stockMove.create({ data: { stockLevelId: row.id, type: "RECEIPT", qty: input.qty, note: input.note ?? null, createdById: user.id } });
    await audit(tx, { entityType: "StockLevel", entityId: row.id, action: "STOCK_RECEIPT", actor, after: { warehouseId: input.warehouseId, productId: input.productId, qty: input.qty } });
    return { stockLevelId: row.id };
  });
}
