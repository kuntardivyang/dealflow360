// Runs against the seeded development database (pnpm reset). Creates its own
// quotations and deletes them afterwards.
import { afterAll, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, ValidationError, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import * as svc from "@/services/quotation.service";

const created: number[] = [];

async function userByEmail(email: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}
const product = (name: string) => prisma.product.findFirstOrThrow({ where: { name } });
const customer = (name: string) => prisma.customer.findFirstOrThrow({ where: { name } });

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("quotation service against the database", () => {
  it("builds the PDF section 10 quote: laptop fine, setup service 8 points over, score 42, Sales Manager only", async () => {
    const riya = await userByEmail("riya@test.com");
    const acme = await customer("Acme Corp");
    const ref = await svc.createQuotation({ customerId: acme.id }, riya);
    created.push(ref.id);
    expect(ref.number).toMatch(/^Q-\d{4}-\d{4}$/);
    expect(ref.status).toBe("DRAFT");

    const laptop = await product('Laptop 14"');
    const setup = await product("Setup Service");

    let view = await svc.addLine({ quotationId: ref.id, version: ref.version, productId: laptop.id, qty: 10, discountBp: 1200, source: "MANUAL" }, riya);
    expect(view.totals.netTotal).toBe(528000_00);
    expect(view.risk.score).toBe(0);
    expect(view.risk.chain).toEqual([]);

    view = await svc.addLine({ quotationId: ref.id, version: view.version, productId: setup.id, qty: 2, discountBp: 1800, source: "MANUAL" }, riya);
    expect(view.risk.lines.map((l) => l.overageBp).sort()).toEqual([0, 800]);
    expect(view.risk.worstOverageBp).toBe(800);
    expect(view.risk.blendedOverageBp).toBe(21);
    expect(view.totals.marginBp).toBe(2017);
    expect(view.risk.score).toBe(42);
    expect(view.risk.chain).toEqual(["SALES_MANAGER"]);

    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: ref.id }, include: { lines: true } });
    expect(stored.total).toBe(view.totals.total);
    expect(stored.riskScore).toBe(42);
    expect(stored.lines.find((l) => l.description === "Setup Service")?.ceilingBp).toBe(1000); // min(Gold 15 %, Services 10 %)
    expect(stored.lines.find((l) => l.description === 'Laptop 14"')?.ceilingBp).toBe(1500);
    expect(stored.version).toBe(view.version);

    const audits = await prisma.auditLog.findMany({ where: { quotationId: ref.id }, orderBy: { id: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["CREATE", "LINE_ADD", "LINE_ADD"]);
    expect(audits[0].actorName).toBe("Riya Rao");
  });

  it("rejects a stale version and another rep, and applies tier price rules", async () => {
    const riya = await userByEmail("riya@test.com");
    const arjun = await userByEmail("arjun@test.com");
    const beta = await customer("Beta Industries"); // Silver: Training Day has a 5 % tier rule
    const ref = await svc.createQuotation({ customerId: beta.id }, riya);
    created.push(ref.id);
    const training = await product("Training Day");

    const view = await svc.addLine({ quotationId: ref.id, version: ref.version, productId: training.id, qty: 1, discountBp: 0, source: "MANUAL" }, riya);
    expect(view.totals.lines[0].gross).toBe(14250_00); // 15,000 less the Silver 5 % price rule

    await expect(svc.setOrderDiscount({ quotationId: ref.id, version: ref.version, orderDiscountBp: 500 }, riya)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.setOrderDiscount({ quotationId: ref.id, version: view.version, orderDiscountBp: 500 }, arjun)).rejects.toBeInstanceOf(ForbiddenError);

    const after = await svc.setOrderDiscount({ quotationId: ref.id, version: view.version, orderDiscountBp: 3000 }, riya);
    expect(after.totals.lines[0].effectiveDiscountBp).toBe(3000);
    expect(after.risk.worstOverageBp).toBe(2000); // 30 % against the Silver 10 % ceiling
    expect(after.risk.chain).toEqual(["SALES_MANAGER", "FINANCE"]);
  });

  it("merges a repeated product into one line, updates and removes it", async () => {
    const riya = await userByEmail("riya@test.com");
    const gamma = await customer("Gamma Retail");
    const ref = await svc.createQuotation({ customerId: gamma.id }, riya);
    created.push(ref.id);
    const dock = await product("Docking Station");

    let view = await svc.addLine({ quotationId: ref.id, version: ref.version, productId: dock.id, qty: 2, discountBp: 0, source: "MANUAL" }, riya);
    view = await svc.addLine({ quotationId: ref.id, version: view.version, productId: dock.id, qty: 3, discountBp: 0, source: "UPSELL" }, riya);
    expect(view.totals.lines).toHaveLength(1);
    expect(view.totals.lines[0].gross).toBe(5 * 6000_00);

    view = await svc.updateLine({ quotationId: ref.id, version: view.version, lineId: view.totals.lines[0].lineId, qty: 1, discountBp: 400 }, riya);
    expect(view.totals.lines[0].net).toBe(5760_00);
    expect(view.risk.chain).toEqual([]); // 4 % within Bronze 5 %

    view = await svc.removeLine({ quotationId: ref.id, version: view.version, lineId: view.totals.lines[0].lineId }, riya);
    expect(view.totals.lines).toHaveLength(0);
    expect(view.totals.marginBp).toBeNull();
  });

  it("the Subscription switch on the product makes the line recurring on the product's interval; a plain product stays one-time", async () => {
    const riya = await userByEmail("riya@test.com");
    const beta = await customer("Beta Industries");
    const ref = await svc.createQuotation({ customerId: beta.id }, riya);
    created.push(ref.id);

    // Seeded: Support Pro is a SERVICE ticked as a subscription, billed monthly; the laptop is a plain good.
    const supportPro = await product("Support Pro");
    expect(supportPro.kind).toBe("SERVICE");
    expect(supportPro.isSubscription).toBe(true);
    expect(supportPro.recurringInterval).toBe("MONTH");
    let view = await svc.addLine({ quotationId: ref.id, version: ref.version, productId: supportPro.id, qty: 2, discountBp: 0, source: "MANUAL" }, riya);
    const laptop = await product('Laptop 14"');
    view = await svc.addLine({ quotationId: ref.id, version: view.version, productId: laptop.id, qty: 1, discountBp: 0, source: "MANUAL" }, riya);

    const lines = await prisma.quotationLine.findMany({ where: { quotationId: ref.id }, include: { plan: true }, orderBy: { sortOrder: "asc" } });
    expect(lines[0].lineType).toBe("RECURRING");
    expect(lines[0].plan?.interval).toBe("MONTH"); // the shared Monthly plan, picked from the product's Recurring setting
    expect(lines[1].lineType).toBe("ONE_TIME");
    expect(lines[1].planId).toBeNull();

    // A product ticked as recurring on an interval with no plan yet: the shared plan is created on first use.
    const weekly = await prisma.product.create({
      data: { sku: `SB-WEEKLY-${ref.id}`, name: `Weekly Backup ${ref.id}`, kind: "SERVICE", isSubscription: true, recurringInterval: "WEEK", categoryId: supportPro.categoryId, listPrice: 200_00, cost: 50_00 },
    });
    try {
      await svc.addLine({ quotationId: ref.id, version: view.version, productId: weekly.id, qty: 1, discountBp: 0, source: "MANUAL" }, riya);
      const weeklyLine = await prisma.quotationLine.findFirstOrThrow({ where: { quotationId: ref.id, productId: weekly.id }, include: { plan: true } });
      expect(weeklyLine.lineType).toBe("RECURRING");
      expect(weeklyLine.plan).toMatchObject({ interval: "WEEK", productId: null, periods: 52 });
    } finally {
      await prisma.quotationLine.deleteMany({ where: { productId: weekly.id } });
      await prisma.product.delete({ where: { id: weekly.id } });
    }
  });
});

describe("confirm and approval rounds", () => {
  it("confirms the PDF quote into PENDING_APPROVAL with one Sales Manager step, and a within-limit quote straight to APPROVED", async () => {
    const riya = await userByEmail("riya@test.com");
    const acme = await customer("Acme Corp");
    const laptop = await product('Laptop 14"');
    const setup = await product("Setup Service");

    const over = await svc.createQuotation({ customerId: acme.id }, riya);
    created.push(over.id);
    let v = await svc.addLine({ quotationId: over.id, version: over.version, productId: laptop.id, qty: 10, discountBp: 1200, source: "MANUAL" }, riya);
    v = await svc.addLine({ quotationId: over.id, version: v.version, productId: setup.id, qty: 2, discountBp: 1800, source: "MANUAL" }, riya);
    const outcome = await svc.confirmQuotation({ quotationId: over.id, version: v.version }, riya);
    expect(outcome.status).toBe("PENDING_APPROVAL");
    expect(outcome.chain).toEqual(["SALES_MANAGER"]);
    const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: outcome.requestId! }, include: { steps: true } });
    expect(request.version).toBe(1);
    expect(request.riskScore).toBe(42);
    expect(request.steps.map((s) => [s.stepNo, s.requiredRole, s.status])).toEqual([[1, "SALES_MANAGER", "PENDING"]]);
    // confirming twice is an illegal transition
    await expect(svc.confirmQuotation({ quotationId: over.id, version: outcome.version }, riya)).rejects.toBeInstanceOf(ConflictError);
    // editing while pending is not allowed either
    await expect(svc.setOrderDiscount({ quotationId: over.id, version: outcome.version, orderDiscountBp: 100 }, riya)).rejects.toBeInstanceOf(ConflictError);

    const fine = await svc.createQuotation({ customerId: acme.id }, riya);
    created.push(fine.id);
    const fv = await svc.addLine({ quotationId: fine.id, version: fine.version, productId: laptop.id, qty: 1, discountBp: 1000, source: "MANUAL" }, riya);
    const approved = await svc.confirmQuotation({ quotationId: fine.id, version: fv.version }, riya);
    expect(approved.status).toBe("APPROVED");
    expect(approved.chain).toEqual([]);
    expect(approved.requestId).toBeNull();

    // an edit after approval supersedes it: back to DRAFT with a new approval round
    const edited = await svc.setOrderDiscount({ quotationId: fine.id, version: approved.version, orderDiscountBp: 3000 }, riya);
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: fine.id } });
    expect(q.status).toBe("DRAFT");
    expect(q.approvalVersion).toBe(2);
    expect(edited.risk.chain).toEqual(["SALES_MANAGER", "FINANCE"]); // 30 % on a Gold 15 % ceiling
    const again = await svc.confirmQuotation({ quotationId: fine.id, version: edited.version }, riya);
    expect(again.status).toBe("PENDING_APPROVAL");
    const r2 = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: again.requestId! }, include: { steps: true } });
    expect(r2.version).toBe(2);
    expect(r2.steps.map((s) => s.requiredRole)).toEqual(["SALES_MANAGER", "FINANCE"]);

    const actions = (await prisma.auditLog.findMany({ where: { quotationId: fine.id }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["CREATE", "LINE_ADD", "CONFIRM", "SUPERSEDE_APPROVAL", "ORDER_DISCOUNT", "CONFIRM"]);
  });

  it("refuses to confirm an empty quotation", async () => {
    const riya = await userByEmail("riya@test.com");
    const gamma = await customer("Gamma Retail");
    const ref = await svc.createQuotation({ customerId: gamma.id }, riya);
    created.push(ref.id);
    await expect(svc.confirmQuotation({ quotationId: ref.id, version: ref.version }, riya)).rejects.toBeInstanceOf(ValidationError);
  });
});
