// Odoo 19 upsell and renewal against the seeded database: both open a quotation on a
// running subscription, and confirming it folds the change in (upsell) or starts the
// next term and retires the parent (renewal).
import { afterAll, describe, expect, it } from "vitest";
import { toISODate, addDays } from "@/domain/dates";
import { ValidationError, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import * as orders from "@/services/order.service";
import * as svc from "@/services/quotation.service";
import * as subs from "@/services/subscription.service";

const created: number[] = [];

async function userByEmail(email: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}

/** Confirm a draft the whole way through: routing, send, then confirm on the customer's behalf. */
async function confirmAll(quotationId: number, version: number, rep: SessionUser, admin: SessionUser, customer: string) {
  const approved = await svc.confirmQuotation({ quotationId, version }, rep);
  expect(approved.status).toBe("APPROVED"); // nothing is discounted, so no approver is needed
  const sent = await orders.sendToCustomer({ quotationId, version: approved.version }, rep);
  return orders.confirmOnBehalf({ quotationId, version: sent.version, customerName: customer }, admin);
}

afterAll(async () => {
  const ids = { in: created };
  const invoices = await prisma.invoice.findMany({ where: { quotationId: ids }, select: { id: true } });
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } } });
  await prisma.subscriptionChange.deleteMany({ where: { subscription: { quotationId: ids } } });
  await prisma.creditNote.deleteMany({ where: { subscription: { quotationId: ids } } });
  await prisma.billingSchedule.deleteMany({ where: { subscription: { quotationId: ids } } });
  await prisma.invoice.deleteMany({ where: { quotationId: ids } });
  // Unlink both sides first: the app never deletes a subscription, so the FK's SET NULL
  // would otherwise leave a quotation with an intent and no subscription, which the
  // pairing check constraint rightly refuses.
  await prisma.quotation.updateMany({ where: { id: { in: created } }, data: { subscriptionId: null, subscriptionIntent: null } });
  await prisma.subscription.updateMany({ where: { quotationId: ids }, data: { renewedFromId: null } });
  await prisma.subscription.deleteMany({ where: { quotationId: ids } });
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("subscription upsell and renewal orders", () => {
  it("upsell: raises the parent's quantity and posts a prorated invoice, without a second subscription", async () => {
    const riya = await userByEmail("riya@test.com");
    const admin = await userByEmail("admin@test.com");
    const beta = await prisma.customer.findFirstOrThrow({ where: { name: "Beta Industries" } });
    const supportPro = await prisma.product.findFirstOrThrow({ where: { name: "Support Pro" } });

    const ref = await svc.createQuotation({ customerId: beta.id }, riya);
    created.push(ref.id);
    const v = await svc.addLine({ quotationId: ref.id, version: ref.version, productId: supportPro.id, qty: 2, discountBp: 0, source: "MANUAL" }, riya);
    await confirmAll(ref.id, v.version, riya, admin, "Beta Industries");
    const sub = await prisma.subscription.findFirstOrThrow({ where: { quotationId: ref.id } });
    expect(sub.qty).toBe(2);

    // Upsell opens a draft quotation carrying the current quantity.
    const upsell = await subs.startUpsell({ subscriptionId: sub.id }, riya);
    created.push(upsell.id);
    const opened = await prisma.quotation.findUniqueOrThrow({ where: { id: upsell.id }, include: { lines: true } });
    expect(opened.subscriptionIntent).toBe("UPSELL");
    expect(opened.subscriptionId).toBe(sub.id);
    expect(opened.lines).toHaveLength(1);
    expect(opened.lines[0].qty).toBe(2);
    expect(opened.lines[0].lineType).toBe("RECURRING");

    // The rep raises it to 5 and confirms.
    const raised = await svc.updateLine({ quotationId: upsell.id, version: opened.version, lineId: opened.lines[0].id, qty: 5 }, riya);
    await confirmAll(upsell.id, raised.version, riya, admin, "Beta Industries");

    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id }, include: { changes: true } });
    expect(after.qty).toBe(5); // folded into the parent
    expect(after.status).toBe("ACTIVE");
    expect(await prisma.subscription.count({ where: { quotationId: upsell.id } })).toBe(0); // no second subscription

    const proration = await prisma.invoice.findFirstOrThrow({ where: { subscriptionId: sub.id, kind: "PRORATION" }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    expect(proration.lines).toHaveLength(2);
    expect(proration.lines[0].qty).toBe(5); // charge the new quantity
    expect(proration.lines[1].qty).toBe(2); // credit the old one for the same days
    expect(proration.lines[1].net).toBeLessThan(0);
    expect(proration.total).toBeGreaterThan(0);
    expect(after.changes.some((c) => c.type === "QUANTITY" && c.oldQty === 2 && c.newQty === 5)).toBe(true);
  });

  it("renewal: starts the next term the day after the last scheduled period and retires the parent", async () => {
    const riya = await userByEmail("riya@test.com");
    const admin = await userByEmail("admin@test.com");
    const gamma = await prisma.customer.findFirstOrThrow({ where: { name: "Gamma Retail" } });
    const supportBasic = await prisma.product.findFirstOrThrow({ where: { name: "Support Basic" } });

    const ref = await svc.createQuotation({ customerId: gamma.id }, riya);
    created.push(ref.id);
    const v = await svc.addLine({ quotationId: ref.id, version: ref.version, productId: supportBasic.id, qty: 3, discountBp: 0, source: "MANUAL" }, riya);
    await confirmAll(ref.id, v.version, riya, admin, "Gamma Retail");
    const parent = await prisma.subscription.findFirstOrThrow({ where: { quotationId: ref.id }, include: { schedule: true } });
    const lastEnd = parent.schedule.reduce((max, s) => (s.periodEnd > max ? s.periodEnd : max), parent.currentPeriodEnd);

    const renewal = await subs.startRenewal({ subscriptionId: parent.id }, riya);
    created.push(renewal.id);
    const opened = await prisma.quotation.findUniqueOrThrow({ where: { id: renewal.id }, include: { lines: true } });
    expect(opened.subscriptionIntent).toBe("RENEWAL");
    await confirmAll(renewal.id, opened.version, riya, admin, "Gamma Retail");

    const successor = await prisma.subscription.findFirstOrThrow({ where: { quotationId: renewal.id }, include: { schedule: { orderBy: { periodStart: "asc" } } } });
    expect(successor.renewedFromId).toBe(parent.id);
    expect(successor.status).toBe("ACTIVE");
    expect(successor.qty).toBe(3);
    // The next term picks up exactly where the last scheduled period stopped.
    expect(toISODate(successor.currentPeriodStart)).toBe(addDays(toISODate(lastEnd), 1));
    expect(successor.schedule.length).toBe(parent.schedule.length);

    const retired = await prisma.subscription.findUniqueOrThrow({ where: { id: parent.id } });
    expect(retired.status).toBe("RENEWED");

    // The renewal is invoiced on confirmation, for the first period of the new term.
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { subscriptionId: successor.id, kind: "RECURRING" } });
    expect(toISODate(invoice.periodStart!)).toBe(toISODate(successor.currentPeriodStart));

    // A retired subscription cannot be renewed or upsold again.
    await expect(subs.startRenewal({ subscriptionId: parent.id }, riya)).rejects.toThrow();
    await expect(subs.startUpsell({ subscriptionId: parent.id }, riya)).rejects.toThrow();
  });

  it("refuses an upsell before the subscription has been invoiced", async () => {
    const riya = await userByEmail("riya@test.com");
    const beta = await prisma.customer.findFirstOrThrow({ where: { name: "Beta Industries" } });
    const supportPro = await prisma.product.findFirstOrThrow({ where: { name: "Support Pro" } });
    const sub = await prisma.subscription.create({
      data: {
        publicId: `uninv${Date.now().toString(36)}`.slice(0, 12),
        customerId: beta.id,
        productId: supportPro.id,
        planId: (await prisma.recurringPlan.findFirstOrThrow({ where: { interval: "MONTH" } })).id,
        qty: 1,
        unitPrice: supportPro.listPrice,
        taxBp: supportPro.taxBp,
        anchorDate: new Date("2026-09-01T00:00:00Z"),
        currentPeriodStart: new Date("2026-09-01T00:00:00Z"),
        currentPeriodEnd: new Date("2026-09-30T00:00:00Z"),
      },
    });
    try {
      await expect(subs.startUpsell({ subscriptionId: sub.id }, riya)).rejects.toThrow(ValidationError);
    } finally {
      await prisma.subscription.delete({ where: { id: sub.id } });
    }
  });
});
