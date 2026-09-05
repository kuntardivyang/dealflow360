// Runs against the seeded development database (pnpm reset). Creates its own
// quotations and deletes them afterwards.
import { afterAll, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, type SessionUser } from "@/lib/contract";
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
    const riya = await userByEmail("riya@df.local");
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
    const riya = await userByEmail("riya@df.local");
    const arjun = await userByEmail("arjun@df.local");
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
    const riya = await userByEmail("riya@df.local");
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
});
