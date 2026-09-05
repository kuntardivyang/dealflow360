// Hybrid order against the seeded database: one-time + recurring billed separately, then payments.
import { afterAll, describe, expect, it } from "vitest";
import { ValidationError, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import * as billing from "@/services/billing.service";
import * as orders from "@/services/order.service";
import * as svc from "@/services/quotation.service";

const created: number[] = [];

async function userByEmail(email: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}

afterAll(async () => {
  const invoices = await prisma.invoice.findMany({ where: { quotationId: { in: created } }, select: { id: true } });
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } } });
  await prisma.billingSchedule.deleteMany({ where: { subscription: { quotationId: { in: created } } } });
  await prisma.invoice.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.subscription.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.stockMove.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("billing on confirmation and payments", () => {
  it("bills a laptop and a monthly Support Pro separately, then pays partially, fully, and refuses overpayment", async () => {
    const riya = await userByEmail("riya@test.com");
    const admin = await userByEmail("admin@test.com");
    const farhan = await userByEmail("farhan@test.com");
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
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: ref.id } })).status).toBe("PAID");

    // a rep may not record payments
    await expect(billing.recordPayment({ invoiceId: oneTime.id, amount: 1, clientRef: `t-${ref.id}-5`, method: "CASH" }, riya)).rejects.toThrow();
  });
});
