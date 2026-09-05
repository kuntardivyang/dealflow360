// Order path against the seeded database: approve, send, confirm on behalf, split, accept, ship.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictError, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import * as fulfillment from "@/services/fulfillment.service";
import * as orders from "@/services/order.service";
import * as svc from "@/services/quotation.service";

const created: number[] = [];
let stockBefore: { id: number; onHand: number; reserved: number }[] = [];

async function userByEmail(email: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}
const product = (name: string) => prisma.product.findFirstOrThrow({ where: { name } });
const stockOf = async (warehouse: string, productName: string) =>
  prisma.stockLevel.findFirstOrThrow({ where: { warehouse: { name: warehouse }, product: { name: productName } } });

beforeAll(async () => {
  stockBefore = await prisma.stockLevel.findMany({ select: { id: true, onHand: true, reserved: true } });
});

afterAll(async () => {
  const invoices = await prisma.invoice.findMany({ where: { quotationId: { in: created } }, select: { id: true } });
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } } });
  await prisma.billingSchedule.deleteMany({ where: { subscription: { quotationId: { in: created } } } });
  await prisma.invoice.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.subscription.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.stockMove.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  for (const s of stockBefore) await prisma.stockLevel.update({ where: { id: s.id }, data: { onHand: s.onHand, reserved: s.reserved } });
  await prisma.$disconnect();
});

describe("order path: confirm, split, reserve, ship", () => {
  it("splits 10 laptops as Main 6 + East 4, reserves with row locks, ships from Main", async () => {
    const riya = await userByEmail("riya@df.local");
    const admin = await userByEmail("admin@df.local");
    const farhan = await userByEmail("farhan@df.local");
    const acme = await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
    const laptop = await product('Laptop 14"');
    const dock = await product("Docking Station");
    const setup = await product("Setup Service");

    const ref = await svc.createQuotation({ customerId: acme.id }, riya);
    created.push(ref.id);
    let v = await svc.addLine({ quotationId: ref.id, version: ref.version, productId: laptop.id, qty: 10, discountBp: 1000, source: "MANUAL" }, riya);
    v = await svc.addLine({ quotationId: ref.id, version: v.version, productId: dock.id, qty: 10, discountBp: 0, source: "MANUAL" }, riya);
    v = await svc.addLine({ quotationId: ref.id, version: v.version, productId: setup.id, qty: 1, discountBp: 0, source: "MANUAL" }, riya);
    const approved = await svc.confirmQuotation({ quotationId: ref.id, version: v.version }, riya);
    expect(approved.status).toBe("APPROVED"); // 10 % on a Gold 15 % ceiling, nothing to review

    const sent = await orders.sendToCustomer({ quotationId: ref.id, version: approved.version }, riya);
    expect(sent.status).toBe("SENT");
    expect(sent.portalUrl).toBe(`/portal/q/${ref.publicId}`);

    // a rep cannot confirm on behalf; an admin can
    await expect(orders.confirmOnBehalf({ quotationId: ref.id, version: sent.version, customerName: "Acme Corp" }, riya)).rejects.toThrow();
    const confirmed = await orders.confirmOnBehalf({ quotationId: ref.id, version: sent.version, customerName: "Acme Corp" }, admin);
    expect(confirmed.status).toBe("CONFIRMED");

    const plan = await prisma.fulfillmentPlan.findFirstOrThrow({ where: { quotationId: ref.id, status: "PROPOSED" }, include: { lines: { include: { warehouse: true, quotationLine: true } } } });
    const alloc = plan.lines.map((l) => [l.warehouse?.name ?? "BACKORDER", l.quotationLine.description, l.qty]).sort();
    expect(alloc).toEqual([
      ["East Depot", 'Laptop 14"', 4],
      ["Main Warehouse", "Docking Station", 10],
      ["Main Warehouse", 'Laptop 14"', 6],
    ]);
    expect(plan.shipmentCount).toBe(2);
    expect(plan.estCost).toBe(1300_00);
    expect(plan.lines.some((l) => l.quotationLine.description === "Setup Service")).toBe(false); // services never ship

    const mainBefore = await stockOf("Main Warehouse", 'Laptop 14"');
    const accepted = await fulfillment.acceptPlan({ quotationId: ref.id, planId: plan.id }, farhan);
    expect(accepted.status).toBe("FULFILLMENT");
    const mainAfter = await stockOf("Main Warehouse", 'Laptop 14"');
    const eastAfter = await stockOf("East Depot", 'Laptop 14"');
    expect(mainAfter.reserved - mainBefore.reserved).toBe(6);
    expect(eastAfter.reserved).toBeGreaterThanOrEqual(4);
    const shipments = await prisma.shipment.findMany({ where: { planId: plan.id }, include: { warehouse: true } });
    expect(shipments.map((s) => s.warehouse.name).sort()).toEqual(["East Depot", "Main Warehouse"]);

    // accepting twice is refused and reserves nothing more
    await expect(fulfillment.acceptPlan({ quotationId: ref.id, planId: plan.id }, farhan)).rejects.toBeInstanceOf(ConflictError);
    expect((await stockOf("Main Warehouse", 'Laptop 14"')).reserved).toBe(mainAfter.reserved);

    // shipping from Main takes 6 laptops and 10 docks out of stock and releases the reservation
    const main = shipments.find((s) => s.warehouse.name === "Main Warehouse")!;
    await fulfillment.ship({ shipmentId: main.id }, farhan);
    const mainShipped = await stockOf("Main Warehouse", 'Laptop 14"');
    expect(mainShipped.onHand).toBe(mainBefore.onHand - 6);
    expect(mainShipped.reserved).toBe(mainBefore.reserved);
    await expect(fulfillment.ship({ shipmentId: main.id }, farhan)).rejects.toBeInstanceOf(ConflictError);

    const actions = (await prisma.auditLog.findMany({ where: { quotationId: ref.id }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["CREATE", "LINE_ADD", "LINE_ADD", "LINE_ADD", "CONFIRM", "SEND", "INVOICES_CREATED", "SPLIT_PROPOSED", "PORTAL_CONFIRM", "SPLIT_ACCEPTED", "SHIP"]);
  });

  it("backorders what no warehouse has and rejects a stale accept when stock ran out", async () => {
    const riya = await userByEmail("riya@df.local");
    const admin = await userByEmail("admin@df.local");
    const beta = await prisma.customer.findFirstOrThrow({ where: { name: "Beta Industries" } });
    const monitor = await product('Monitor 27"'); // Main 2, East 10

    const ref = await svc.createQuotation({ customerId: beta.id }, riya);
    created.push(ref.id);
    const v = await svc.addLine({ quotationId: ref.id, version: ref.version, productId: monitor.id, qty: 13, discountBp: 0, source: "MANUAL" }, riya);
    const approved = await svc.confirmQuotation({ quotationId: ref.id, version: v.version }, riya);
    const sent = await orders.sendToCustomer({ quotationId: ref.id, version: approved.version }, riya);
    await orders.confirmOnBehalf({ quotationId: ref.id, version: sent.version, customerName: "Beta Industries" }, admin);
    const plan = await prisma.fulfillmentPlan.findFirstOrThrow({ where: { quotationId: ref.id, status: "PROPOSED" }, include: { lines: true } });
    const backorder = plan.lines.find((l) => l.isBackorder);
    expect(backorder?.qty).toBe(1);
    expect(plan.lines.filter((l) => !l.isBackorder).reduce((s, l) => s + l.qty, 0)).toBe(12);

    // stock disappears under the proposal: the accept must fail, nothing half-reserved
    const east = await stockOf("East Depot", 'Monitor 27"');
    await prisma.stockLevel.update({ where: { id: east.id }, data: { onHand: east.onHand - 5 } });
    await expect(fulfillment.acceptPlan({ quotationId: ref.id, planId: plan.id }, admin)).rejects.toBeInstanceOf(ConflictError);
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: ref.id } });
    expect(q.status).toBe("CONFIRMED");
    expect((await stockOf("Main Warehouse", 'Monitor 27"')).reserved).toBe(0);
    expect((await prisma.fulfillmentPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("PROPOSED");
  });
});
