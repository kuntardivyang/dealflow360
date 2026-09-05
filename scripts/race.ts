// Proof of the stock reservation lock: two people accept the same split at the same time,
// stock is 6 and each order wants 5. Exactly one wins, the other gets 409, and
// reserved never exceeds on_hand. Run with: pnpm exec tsx scripts/race.ts (seeded database).
import "dotenv/config";
import { ConflictError, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import * as fulfillment from "@/services/fulfillment.service";
import * as orders from "@/services/order.service";
import * as svc from "@/services/quotation.service";

async function user(email: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}

async function confirmedOrder(customerName: string, productId: number, qty: number, riya: SessionUser, admin: SessionUser) {
  const customer = await prisma.customer.findFirstOrThrow({ where: { name: customerName } });
  const ref = await svc.createQuotation({ customerId: customer.id }, riya);
  const v = await svc.addLine({ quotationId: ref.id, version: ref.version, productId, qty, discountBp: 0, source: "MANUAL" }, riya);
  const ok = await svc.confirmQuotation({ quotationId: ref.id, version: v.version }, riya);
  const sent = await orders.sendToCustomer({ quotationId: ref.id, version: ok.version }, riya);
  await orders.confirmOnBehalf({ quotationId: ref.id, version: sent.version, customerName }, admin);
  const plan = await prisma.fulfillmentPlan.findFirstOrThrow({ where: { quotationId: ref.id, status: "PROPOSED" } });
  return { quotationId: ref.id, planId: plan.id };
}

async function main() {
  const [riya, admin, farhan] = await Promise.all([user("riya@df.local"), user("admin@df.local"), user("farhan@df.local")]);
  const laptop = await prisma.product.findFirstOrThrow({ where: { name: 'Laptop 14"' } });
  const main = await prisma.stockLevel.findFirstOrThrow({ where: { product: { id: laptop.id }, warehouse: { name: "Main Warehouse" } } });
  const east = await prisma.stockLevel.findFirstOrThrow({ where: { product: { id: laptop.id }, warehouse: { name: "East Depot" } } });
  const before = { main: { ...main }, east: { ...east } };
  // Only Main Warehouse has stock for this run: 6 laptops, nothing in East.
  await prisma.stockLevel.update({ where: { id: main.id }, data: { onHand: 6, reserved: 0 } });
  await prisma.stockLevel.update({ where: { id: east.id }, data: { onHand: 0, reserved: 0 } });

  const a = await confirmedOrder("Acme Corp", laptop.id, 5, riya, admin);
  const b = await confirmedOrder("Beta Industries", laptop.id, 5, riya, admin);
  console.log("two confirmed orders, each wants 5 laptops; Main Warehouse has 6");

  const results = await Promise.allSettled([
    fulfillment.acceptPlan({ quotationId: a.quotationId, planId: a.planId }, farhan),
    fulfillment.acceptPlan({ quotationId: b.quotationId, planId: b.planId }, farhan),
  ]);
  const wins = results.filter((r) => r.status === "fulfilled").length;
  const conflicts = results.filter((r) => r.status === "rejected" && r.reason instanceof ConflictError).length;
  const after = await prisma.stockLevel.findUniqueOrThrow({ where: { id: main.id } });
  console.log(`accepted: ${wins}, refused with 409: ${conflicts}, Main on_hand ${after.onHand} reserved ${after.reserved}`);
  const pass = wins === 1 && conflicts === 1 && after.reserved === 5 && after.reserved <= after.onHand;
  console.log(pass ? "PASS: one order reserved 5, the other was refused, stock never oversold" : "FAIL");

  // clean up
  for (const o of [a, b]) {
    await prisma.stockMove.deleteMany({ where: { quotationId: o.quotationId } });
    const inv = await prisma.invoice.findMany({ where: { quotationId: o.quotationId }, select: { id: true } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: inv.map((i) => i.id) } } });
    await prisma.invoice.deleteMany({ where: { quotationId: o.quotationId } });
    await prisma.quotation.delete({ where: { id: o.quotationId } });
  }
  await prisma.stockLevel.update({ where: { id: main.id }, data: { onHand: before.main.onHand, reserved: before.main.reserved } });
  await prisma.stockLevel.update({ where: { id: east.id }, data: { onHand: before.east.onHand, reserved: before.east.reserved } });
  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
