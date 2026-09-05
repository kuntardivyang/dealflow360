// Runs against the seeded development database. Builds its own SENT quotations for Acme
// (Gold, 15 %) and removes them afterwards.
import { afterAll, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, type PortalUser, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { authenticatePortal } from "@/lib/auth/portal";
import { confirmFromPortal, getPortalQuotation, listPortalQuotations, respondToRequest, submitRequest } from "@/services/portal.service";

const created: number[] = [];
let acmeBuyer: PortalUser;
let betaBuyer: PortalUser;

async function riya(): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "riya@df.local" } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}

/** A SENT Acme quote: laptop x10 @12 % (fine) and setup service x2 @8 % (fine); ceilings 15 / 10. */
async function sentQuote(withPendingRequest = false) {
  const rep = await riya();
  const acme = await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
  const laptop = await prisma.product.findFirstOrThrow({ where: { name: 'Laptop 14"' } });
  const setup = await prisma.product.findFirstOrThrow({ where: { name: "Setup Service" } });
  const q = await prisma.quotation.create({
    data: {
      publicId: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 12).padEnd(12, "z"),
      number: `P-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      customerId: acme.id,
      repUserId: rep.id,
      status: "SENT",
      sentAt: new Date(),
      approvalVersion: 1,
      lines: {
        create: [
          { productId: laptop.id, description: laptop.name, qty: 10, unitPrice: laptop.listPrice, unitCost: laptop.cost, taxBp: laptop.taxBp, discountBp: 1200, effectiveDiscountBp: 1200, ceilingBp: 1500, sortOrder: 1 },
          { productId: setup.id, description: setup.name, qty: 2, unitPrice: setup.listPrice, unitCost: setup.cost, taxBp: setup.taxBp, discountBp: 800, effectiveDiscountBp: 800, ceilingBp: 1000, sortOrder: 2 },
        ],
      },
      ...(withPendingRequest
        ? { approvalRequests: { create: { version: 1, riskScore: 10, riskBreakdown: {}, chain: ["SALES_MANAGER"], steps: { create: [{ stepNo: 1, requiredRole: "SALES_MANAGER" }] } } } }
        : {}),
    },
    include: { lines: true },
  });
  created.push(q.id);
  return q;
}

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("portal service against the database", () => {
  it("logs a contact in and scopes every read to their own customer", async () => {
    acmeBuyer = (await authenticatePortal("buyer@acme.com", "demo1234"))!;
    betaBuyer = (await authenticatePortal("buyer@beta.com", "demo1234"))!;
    expect(acmeBuyer).toMatchObject({ customerName: "Acme Corp" });
    expect(await authenticatePortal("buyer@acme.com", "nope")).toBeNull();

    const q = await sentQuote();
    const dto = await getPortalQuotation(q.publicId, acmeBuyer);
    expect(dto).toMatchObject({ number: q.number, status: "Sent", canConfirm: true });
    expect(JSON.stringify(dto)).not.toMatch(/cost|margin|risk|ceiling/i);
    await expect(getPortalQuotation(q.publicId, betaBuyer)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listPortalQuotations(acmeBuyer)).some((d) => d.publicId === q.publicId)).toBe(true);
    expect((await listPortalQuotations(betaBuyer)).some((d) => d.publicId === q.publicId)).toBe(false);
  });

  it("a comment moves the quote to Under Negotiation and the rep can decline it back to Sent", async () => {
    const q = await sentQuote();
    const dto = await submitRequest({ publicId: q.publicId, type: "COMMENT", lineId: q.lines[1].id, message: "Can we push this to next month?" }, acmeBuyer);
    expect(dto.status).toBe("Under Negotiation");
    expect(dto.requests[0]).toMatchObject({ type: "COMMENT", status: "OPEN", lineId: q.lines[1].id });
    expect(dto.canConfirm).toBe(true); // a comment does not block confirmation

    const rep = await riya();
    const ref = await respondToRequest({ quotationId: q.id, requestId: dto.requests[0].id, decision: "DECLINE", note: "Dates are fixed" }, rep);
    expect(ref.status).toBe("SENT");
    const after = await getPortalQuotation(q.publicId, acmeBuyer);
    expect(after.requests[0]).toMatchObject({ status: "DECLINED", responseNote: "Dates are fixed" });
  });

  it("a counter within the ceiling and the margin floor waits for the rep; accepting it applies the discount and returns the quote to Sent", async () => {
    const q = await sentQuote();
    // Setup service 8 % -> 9 % (ceiling 10 %); order margin stays above the 20 % floor.
    const dto = await submitRequest({ publicId: q.publicId, type: "COUNTER_DISCOUNT", lineId: q.lines[1].id, proposedDiscountBp: 900 }, acmeBuyer);
    expect(dto.status).toBe("Under Negotiation");
    expect(dto.canConfirm).toBe(false); // an open counter blocks confirmation
    await expect(confirmFromPortal({ publicId: q.publicId, fullName: "Nisha Acme" }, acmeBuyer)).rejects.toBeInstanceOf(ConflictError);

    const ref = await respondToRequest({ quotationId: q.id, requestId: dto.requests[0].id, decision: "ACCEPT" }, await riya());
    expect(ref.status).toBe("SENT");
    const after = await getPortalQuotation(q.publicId, acmeBuyer);
    expect(after.lines[1].discountBp).toBe(900);
    expect(after.requests[0].status).toBe("ACCEPTED");
  });

  it("a counter above the ceiling re-enters approval by itself: new request version, old one superseded, confirm blocked", async () => {
    const q = await sentQuote(true);
    const dto = await submitRequest({ publicId: q.publicId, type: "COUNTER_DISCOUNT", lineId: q.lines[1].id, proposedDiscountBp: 2500 }, acmeBuyer);
    expect(dto.status).toBe("Awaiting internal approval");
    expect(dto.canConfirm).toBe(false);

    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id }, include: { approvalRequests: { orderBy: { version: "asc" }, include: { steps: true } } } });
    expect(after.status).toBe("PENDING_APPROVAL");
    expect(after.negotiationPending).toBe(true);
    expect(after.approvalVersion).toBe(2);
    expect(after.approvalRequests.map((r) => [r.version, r.status])).toEqual([
      [1, "SUPERSEDED"],
      [2, "PENDING"],
    ]);
    // 25 % on services (ceiling 10 %) is 15 points over: Manager and Finance.
    expect(after.approvalRequests[1].steps.map((s) => s.requiredRole)).toEqual(["SALES_MANAGER", "FINANCE"]);
    const line = await prisma.quotationLine.findUniqueOrThrow({ where: { id: q.lines[1].id } });
    expect(line.discountBp).toBe(800);

    await expect(submitRequest({ publicId: q.publicId, type: "COMMENT", message: "hello?" }, acmeBuyer)).rejects.toBeInstanceOf(ConflictError);
    await expect(confirmFromPortal({ publicId: q.publicId, fullName: "Nisha Acme" }, acmeBuyer)).rejects.toBeInstanceOf(ConflictError);
  });

  it("confirming a clean quote records who confirmed and moves it to Confirmed", async () => {
    const q = await sentQuote();
    const dto = await confirmFromPortal({ publicId: q.publicId, fullName: "Nisha Acme" }, acmeBuyer);
    expect(dto.status).toBe("Confirmed");
    expect(dto.canConfirm).toBe(false);
    expect(dto.confirmedAt).not.toBeNull();
    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id }, include: { auditLogs: true } });
    expect(after).toMatchObject({ status: "CONFIRMED", confirmedName: "Nisha Acme", confirmedByContactId: acmeBuyer.contactId });
    expect(after.auditLogs.map((a) => a.action)).toContain("PORTAL_CONFIRM");
    await expect(confirmFromPortal({ publicId: q.publicId, fullName: "Again" }, acmeBuyer)).rejects.toBeInstanceOf(ConflictError);
  });
});
