import { afterAll, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import * as svc from "@/services/quotation.service";
import { suggestFor } from "@/services/upsell.service";

const created: number[] = [];
async function userByEmail(email: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}
const product = (name: string) => prisma.product.findFirstOrThrow({ where: { name } });

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("upsell suggestions", () => {
  it("ranks the docking station first for a laptop cart, shows the margin delta, excludes cart items", async () => {
    const riya = await userByEmail("riya@test.com");
    const acme = await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
    const laptop = await product('Laptop 14"');
    const ref = await svc.createQuotation({ customerId: acme.id }, riya);
    created.push(ref.id);
    await svc.addLine({ quotationId: ref.id, version: ref.version, productId: laptop.id, qty: 10, discountBp: 1200, source: "MANUAL" }, riya);

    const s = await suggestFor(ref.id);
    expect(s[0].name).toBe("Docking Station"); // 14 co-purchases in history
    expect(s[0].marginDelta).toBe(2400_00); // 6,000 list, 3,600 cost
    expect(s[0].reason).toMatch(/Laptop 14"/);
    expect(s.map((x) => x.name)).not.toContain('Laptop 14"');
    expect(s.map((x) => x.name)).toContain("Setup Service");
    expect(s.find((x) => x.name === "Support Pro")?.isPromoted).toBe(true);
  });

  it("puts the promoted Support Pro first for a Support Basic cart, and shows only promoted products for an empty cart", async () => {
    const riya = await userByEmail("riya@test.com");
    const beta = await prisma.customer.findFirstOrThrow({ where: { name: "Beta Industries" } });
    const basic = await product("Support Basic");
    const ref = await svc.createQuotation({ customerId: beta.id }, riya);
    created.push(ref.id);
    await svc.addLine({ quotationId: ref.id, version: ref.version, productId: basic.id, qty: 1, discountBp: 0, source: "MANUAL" }, riya);
    const s = await suggestFor(ref.id);
    expect(s[0].name).toBe("Support Pro");
    expect(s[0].score).toBe(5 + 5); // 5 co-purchases + promo boost

    const empty = await svc.createQuotation({ customerId: beta.id }, riya);
    created.push(empty.id);
    const e = await suggestFor(empty.id);
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((x) => x.isPromoted)).toBe(true);
  });
});
