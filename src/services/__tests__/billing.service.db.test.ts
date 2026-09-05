// Hybrid order against the seeded database: one-time + recurring billed separately, then payments.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ValidationError, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import * as billing from "@/services/billing.service";
import * as fulfillment from "@/services/fulfillment.service";
import * as orders from "@/services/order.service";
import * as svc from "@/services/quotation.service";

const created: number[] = [];
let stockBefore: { id: number; onHand: number; reserved: number }[] = [];

beforeAll(async () => {
  stockBefore = await prisma.stockLevel.findMany({ select: { id: true, onHand: true, reserved: true } });
});

async function userByEmail(email: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}

afterAll(async () => {
  const invoices = await prisma.invoice.findMany({ where: { quotationId: { in: created } }, select: { id: true } });
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } } });
  await prisma.subscriptionChange.deleteMany({ where: { subscription: { quotationId: { in: created } } } });
  await prisma.creditNote.deleteMany({ where: { subscription: { quotationId: { in: created } } } });
  await prisma.billingSchedule.deleteMany({ where: { subscription: { quotationId: { in: created } } } });
  await prisma.invoice.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.subscription.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.stockMove.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  for (const s of stockBefore) await prisma.stockLevel.update({ where: { id: s.id }, data: { onHand: s.onHand, reserved: s.reserved } });
  await prisma.$disconnect();
});

describe("billing on confirmation and payments", () => {
  it("bills a laptop and a monthly Support Pro separately, then pays partially, fully, and refuses overpayment", async () => {
    const riya = await userByEmail("riya@df.local");
    const admin = await userByEmail("admin@df.local");
    const farhan = await userByEmail("farhan@df.local");
    const beta = await prisma.customer.findFirstOrThrow({ where: { name: "Beta Industries" } });
    const laptop = await prisma.product.findFirstOrThrow({ where: { name: 'Laptop 14"' } });
    const supportPro = await prisma.product.findFirstOrThrow({ where: { name: "Support Pro" } });

    const ref = await svc.createQuotation({ customerId: beta.id }, riya);
    created.push(ref.id);
    let v = await svc.addLine({ quotationId: ref.id, version: ref.version, productId: laptop.id, qty: 2, discountBp: 500, source: "MANUAL" }, riya);
    v = await svc.addLine({ quotationId: ref.id, version: v.version, productId: supportPro.id, qty: 2, discountBp: 0, source: "MANUAL" }, riya);
    const approved = await svc.confirmQuotation({ quotationId: ref.id, version: v.version }, riya);
    const sent = await orders.sendToCustomer({ quotationId: ref.id, version: approved.version }, riya);
    await orders.confirmOnBehalf({ quotationId: ref.id, version: sent.version, customerName: "Beta Industries" }, admin);

    const invoices = await prisma.invoice.findMany({ where: { quotationId: ref.id }, orderBy: { number: "asc" }, include: { lines: true } });
    expect(invoices.map((i) => [i.kind, i.total])).toEqual([
      ["ONE_TIME", 134520_00], // 2 laptops at 5 % off plus 18 % tax
      ["RECURRING", 2360_00], // 2 seats x 1,000 plus 18 % tax, first month
    ]);
    expect(invoices.every((i) => /^INV-\d{4}-\d{4}$/.test(i.number))).toBe(true);

    const sub = await prisma.subscription.findFirstOrThrow({ where: { quotationId: ref.id }, include: { schedule: { orderBy: { periodStart: "asc" } } } });
    expect(sub.status).toBe("ACTIVE");
    expect(sub.qty).toBe(2);
    expect(sub.schedule).toHaveLength(12);
    expect(sub.schedule[0].status).toBe("INVOICED");
    expect(sub.schedule[0].invoiceId).toBe(invoices[1].id);
    expect(sub.schedule[1].status).toBe("SCHEDULED");
    expect(sub.schedule.every((s) => s.total === 2360_00)).toBe(true);

    const oneTime = invoices[0];
    const partial = await billing.recordPayment({ invoiceId: oneTime.id, amount: 30000_00, clientRef: `t-${ref.id}-1`, method: "BANK_TRANSFER" }, farhan);
    expect(partial.status).toBe("PARTIAL");
    expect(partial.due).toBe(104520_00);

    // retrying the same clientRef records nothing new
    const again = await billing.recordPayment({ invoiceId: oneTime.id, amount: 30000_00, clientRef: `t-${ref.id}-1`, method: "BANK_TRANSFER" }, farhan);
    expect(again.duplicate).toBe(true);
    expect(await prisma.payment.count({ where: { invoiceId: oneTime.id } })).toBe(1);

    await expect(billing.recordPayment({ invoiceId: oneTime.id, amount: 200000_00, clientRef: `t-${ref.id}-2`, method: "UPI" }, farhan)).rejects.toBeInstanceOf(ValidationError);

    const paid = await billing.recordPayment({ invoiceId: oneTime.id, amount: 104520_00, clientRef: `t-${ref.id}-3`, method: "UPI" }, farhan);
    expect(paid.status).toBe("PAID");
    expect(paid.due).toBe(0);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: ref.id } })).status).toBe("CONFIRMED"); // recurring invoice still open

    const recurring = await billing.recordPayment({ invoiceId: invoices[1].id, amount: 2360_00, clientRef: `t-${ref.id}-4`, method: "CARD" }, farhan);
    expect(recurring.status).toBe("PAID");
    // every invoice is paid, but the laptops have not left the warehouse: the order waits in CONFIRMED
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: ref.id } })).status).toBe("CONFIRMED");
    const plan = await prisma.fulfillmentPlan.findFirstOrThrow({ where: { quotationId: ref.id, status: "PROPOSED" } });
    await fulfillment.acceptPlan({ quotationId: ref.id, planId: plan.id }, farhan);
    for (const s of await prisma.shipment.findMany({ where: { planId: plan.id } })) await fulfillment.ship({ shipmentId: s.id }, farhan);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: ref.id } })).status).toBe("PAID"); // last shipment out completes the order

    await expect(billing.recordPayment({ invoiceId: invoices[1].id, amount: 1, clientRef: `t-${ref.id}-1`, method: "CASH" }, farhan)).rejects.toThrow(/another invoice/);

    // a rep may not record payments
    await expect(billing.recordPayment({ invoiceId: oneTime.id, amount: 1, clientRef: `t-${ref.id}-5`, method: "CASH" }, riya)).rejects.toThrow();
  });
});

describe("subscription quantity change", () => {
  it("prorates 2 to 3 seats into a proration invoice, re-prices the schedule, and 3 to 1 into a credit note", async () => {
    const { changeQuantity } = await import("@/services/subscription.service");
    const riya = await userByEmail("riya@df.local");
    const admin = await userByEmail("admin@df.local");
    const farhan = await userByEmail("farhan@df.local");
    const acme = await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
    const supportPro = await prisma.product.findFirstOrThrow({ where: { name: "Support Pro" } });
    const ref = await svc.createQuotation({ customerId: acme.id }, riya);
    created.push(ref.id);
    const v = await svc.addLine({ quotationId: ref.id, version: ref.version, productId: supportPro.id, qty: 2, discountBp: 0, source: "MANUAL" }, riya);
    const approved = await svc.confirmQuotation({ quotationId: ref.id, version: v.version }, riya);
    const sent = await orders.sendToCustomer({ quotationId: ref.id, version: approved.version }, riya);
    await orders.confirmOnBehalf({ quotationId: ref.id, version: sent.version, customerName: "Acme Corp" }, admin);
    const sub = await prisma.subscription.findFirstOrThrow({ where: { quotationId: ref.id } });
    const { toISODate } = await import("@/domain/dates");
    const start = toISODate(sub.currentPeriodStart);

    const up = await changeQuantity({ subscriptionId: sub.id, newQty: 3, effectiveDate: start }, farhan);
    expect(up.remainingDays).toBe(up.daysInPeriod); // change on day one: the whole period
    expect(up.credit).toBe(2000_00);
    expect(up.charge).toBe(3000_00);
    expect(up.net).toBe(1000_00);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: up.invoiceId! }, include: { lines: true } });
    expect(inv.kind).toBe("PRORATION");
    expect(inv.total).toBe(1180_00); // one extra seat plus 18 % tax
    expect(inv.lines).toHaveLength(2);
    const future = await prisma.billingSchedule.findMany({ where: { subscriptionId: sub.id, status: "SCHEDULED" } });
    expect(future.every((s) => s.total === 3540_00)).toBe(true); // 3 x 1,000 + tax

    const down = await changeQuantity({ subscriptionId: sub.id, newQty: 1, effectiveDate: start }, farhan);
    expect(down.net).toBe(-2000_00);
    const note = await prisma.creditNote.findUniqueOrThrow({ where: { id: down.creditNoteId! } });
    expect(note.amount).toBe(2360_00);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).qty).toBe(1);

    await expect(changeQuantity({ subscriptionId: sub.id, newQty: 1, effectiveDate: start }, farhan)).rejects.toBeInstanceOf(ValidationError);
    await expect(changeQuantity({ subscriptionId: sub.id, newQty: 4, effectiveDate: "2020-01-01" }, farhan)).rejects.toBeInstanceOf(ValidationError);
    await expect(changeQuantity({ subscriptionId: sub.id, newQty: 4, effectiveDate: start }, riya)).rejects.toThrow();

    // cancel with the seeded policy (immediate prorated refund as a credit note): unused days credited, future periods cancelled
    const { cancelSubscription } = await import("@/services/subscription.service");
    const cancelled = await cancelSubscription({ subscriptionId: sub.id, effectiveDate: start, reason: "Customer moved to a competitor" }, farhan);
    expect(cancelled.policy).toBe("IMMEDIATE_PRORATED_REFUND");
    expect(cancelled.credit).toBe(1000_00); // 1 seat, whole period unused
    const cn = await prisma.creditNote.findUniqueOrThrow({ where: { id: cancelled.creditNoteId! } });
    expect(cn.amount).toBe(1180_00);
    expect(cn.status).toBe("OPEN");
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id }, include: { schedule: true } });
    expect(after.status).toBe("CANCELLED");
    expect(after.schedule.filter((s) => s.status === "SCHEDULED")).toHaveLength(0);
    await expect(cancelSubscription({ subscriptionId: sub.id, reason: "again" }, farhan)).rejects.toThrow(/cannot go from cancelled/i);
  });
});
