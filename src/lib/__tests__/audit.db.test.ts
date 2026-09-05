// Runs against the seeded development database (pnpm reset). Everything happens in a
// transaction that is rolled back, so the database is left exactly as it was.
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

class Rollback extends Error {}

afterAll(() => prisma.$disconnect());

describe("audit() against the database", () => {
  it("writes one row with actor, reason, before/after and bumps the quotation's lastActivityAt", async () => {
    const quote = await prisma.quotation.findFirstOrThrow({ where: { number: { endsWith: "-0001" } } });
    let auditId = 0;
    await prisma
      .$transaction(async (tx) => {
        auditId = await audit(tx, {
          entityType: "QuotationLine",
          entityId: 42,
          quotationId: quote.id,
          action: "LINE_UPDATE",
          actor: { type: "USER", id: 1, name: "Riya Rao", role: "SALES_REP" },
          reason: "test",
          before: { discountBp: 500, at: new Date("2026-09-05T10:00:00Z") },
          after: { discountBp: 1200 },
        });
        const row = await tx.auditLog.findUniqueOrThrow({ where: { id: auditId } });
        expect(row).toMatchObject({
          entityType: "QuotationLine",
          entityId: 42,
          quotationId: quote.id,
          action: "LINE_UPDATE",
          actorType: "USER",
          actorId: 1,
          actorName: "Riya Rao",
          actorRole: "SALES_REP",
          reason: "test",
          beforeJson: { discountBp: 500, at: "2026-09-05T10:00:00.000Z" },
          afterJson: { discountBp: 1200 },
        });
        const bumped = await tx.quotation.findUniqueOrThrow({ where: { id: quote.id } });
        expect(bumped.lastActivityAt.getTime()).toBeGreaterThan(quote.lastActivityAt.getTime());
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    expect(auditId).toBeGreaterThan(0);
    expect(await prisma.auditLog.findUnique({ where: { id: auditId } })).toBeNull();
    const untouched = await prisma.quotation.findUniqueOrThrow({ where: { id: quote.id } });
    expect(untouched.lastActivityAt.getTime()).toBe(quote.lastActivityAt.getTime());
  });

  it("leaves before/after null when not given and accepts a system actor without a quotation", async () => {
    await prisma
      .$transaction(async (tx) => {
        const id = await audit(tx, { entityType: "RiskConfig", entityId: 1, action: "UPDATE", actor: { type: "SYSTEM", id: null, name: "System" } });
        const row = await tx.auditLog.findUniqueOrThrow({ where: { id } });
        expect(row.quotationId).toBeNull();
        expect(row.beforeJson).toBeNull();
        expect(row.afterJson).toBeNull();
        expect(row.actorId).toBeNull();
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
