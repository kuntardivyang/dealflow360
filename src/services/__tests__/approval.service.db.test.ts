// Runs against the seeded development database. Creates its own quotations with
// approval requests and deletes them afterwards (cascades remove steps and audit rows).
import { afterAll, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { decide, getApprovalDetail, listApprovals } from "@/services/approval.service";

const created: number[] = [];

async function userByEmail(email: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}

/** A pending quotation with a two-step request (Manager, then Finance), owned by riya. */
async function pendingQuote(chain: ("SALES_MANAGER" | "FINANCE")[], negotiationPending = false) {
  const riya = await userByEmail("riya@df.local");
  const acme = await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
  const setup = await prisma.product.findFirstOrThrow({ where: { name: "Setup Service" } });
  const q = await prisma.quotation.create({
    data: {
      publicId: `test${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 12).padEnd(12, "x"),
      number: `T-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      customerId: acme.id,
      repUserId: riya.id,
      status: "PENDING_APPROVAL",
      negotiationPending,
      lines: {
        create: {
          productId: setup.id,
          description: setup.name,
          qty: 2,
          unitPrice: setup.listPrice,
          unitCost: setup.cost,
          taxBp: setup.taxBp,
          discountBp: 1800,
          effectiveDiscountBp: 1800,
          ceilingBp: 1000,
        },
      },
      approvalRequests: {
        create: {
          version: 1,
          riskScore: 42,
          riskBreakdown: {},
          chain,
          steps: { create: chain.map((role, i) => ({ stepNo: i + 1, requiredRole: role })) },
        },
      },
    },
    include: { approvalRequests: { include: { steps: true } }, lines: true },
  });
  created.push(q.id);
  const request = q.approvalRequests[0];
  return { q, request, steps: [...request.steps].sort((a, b) => a.stepNo - b.stepNo) };
}

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("approval service against the database", () => {
  it("Manager then Finance: the quote stays pending after step 1 and is approved after step 2, with an audit row each", async () => {
    const meera = await userByEmail("meera@df.local");
    const farhan = await userByEmail("farhan@df.local");
    const { q, request, steps } = await pendingQuote(["SALES_MANAGER", "FINANCE"]);

    const first = await decide({ requestId: request.id, stepId: steps[0].id, decision: "APPROVE", note: "ok, 8 pp on services" }, meera);
    expect(first.status).toBe("PENDING_APPROVAL");
    expect(first.auditLogId).toBeGreaterThan(0);

    const second = await decide({ requestId: request.id, stepId: steps[1].id, decision: "APPROVE" }, farhan);
    expect(second.status).toBe("APPROVED");

    const detail = await getApprovalDetail(q.publicId);
    expect(detail?.current.status).toBe("APPROVED");
    expect(detail?.current.steps.map((s) => s.status)).toEqual(["APPROVED", "APPROVED"]);
    expect(detail?.quotation.auditLogs.map((a) => a.action)).toEqual(["APPROVE", "APPROVE"]);
    expect(detail?.quotation.auditLogs[1].reason).toBe("ok, 8 pp on services");
  });

  it("Finance cannot act before the Manager step; the rep cannot approve their own quote; a decided step is a 409", async () => {
    const riya = await userByEmail("riya@df.local");
    const meera = await userByEmail("meera@df.local");
    const farhan = await userByEmail("farhan@df.local");
    const { request, steps } = await pendingQuote(["SALES_MANAGER", "FINANCE"]);

    await expect(decide({ requestId: request.id, stepId: steps[1].id, decision: "APPROVE" }, farhan)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decide({ requestId: request.id, stepId: steps[0].id, decision: "APPROVE" }, farhan)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decide({ requestId: request.id, stepId: steps[0].id, decision: "APPROVE" }, { ...riya, role: "SALES_MANAGER" })).rejects.toBeInstanceOf(ForbiddenError);

    await decide({ requestId: request.id, stepId: steps[0].id, decision: "APPROVE" }, meera);
    await expect(decide({ requestId: request.id, stepId: steps[0].id, decision: "APPROVE" }, meera)).rejects.toBeInstanceOf(ConflictError);
  });

  it("two simultaneous approvals of the same step: exactly one wins", async () => {
    const meera = await userByEmail("meera@df.local");
    const admin = await userByEmail("admin@df.local");
    const { request, steps } = await pendingQuote(["SALES_MANAGER"]);
    const results = await Promise.allSettled([
      decide({ requestId: request.id, stepId: steps[0].id, decision: "APPROVE" }, meera),
      decide({ requestId: request.id, stepId: steps[0].id, decision: "APPROVE" }, admin),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
  });

  it("return for revision sends the quote back to DRAFT with the reason and bumps the approval version", async () => {
    const meera = await userByEmail("meera@df.local");
    const { q, request, steps } = await pendingQuote(["SALES_MANAGER"]);
    const out = await decide({ requestId: request.id, stepId: steps[0].id, decision: "RETURN", note: "Requested justification" }, meera);
    expect(out.status).toBe("DRAFT");
    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id }, include: { approvalRequests: true } });
    expect(after.approvalVersion).toBe(2);
    expect(after.approvalRequests[0]).toMatchObject({ status: "RETURNED", reason: "Requested justification" });
    await expect(decide({ requestId: request.id, stepId: steps[0].id, decision: "APPROVE" }, meera)).rejects.toBeInstanceOf(ConflictError);
  });

  it("reject marks the request and the quote rejected", async () => {
    const meera = await userByEmail("meera@df.local");
    const { request, steps } = await pendingQuote(["SALES_MANAGER"]);
    const out = await decide({ requestId: request.id, stepId: steps[0].id, decision: "REJECT", note: "Margin too thin" }, meera);
    expect(out.status).toBe("REJECTED");
    const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(req).toMatchObject({ status: "REJECTED", reason: "Margin too thin" });
  });

  it("approving a customer counter-offer applies the proposed discount and returns the quote to the portal (SENT)", async () => {
    const meera = await userByEmail("meera@df.local");
    const { q, request, steps } = await pendingQuote(["SALES_MANAGER"], true);
    const contact = await prisma.customerContact.findFirstOrThrow({ where: { email: "buyer@acme.com" } });
    await prisma.portalRequest.create({
      data: { quotationId: q.id, lineId: q.lines[0].id, contactId: contact.id, type: "COUNTER_DISCOUNT", proposedDiscountBp: 2500, status: "OPEN" },
    });
    const out = await decide({ requestId: request.id, stepId: steps[0].id, decision: "APPROVE", note: "fine for Acme" }, meera);
    expect(out.status).toBe("SENT");
    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id }, include: { lines: true, portalRequests: true } });
    expect(after.negotiationPending).toBe(false);
    expect(after.lines[0].discountBp).toBe(2500);
    expect(after.lines[0].effectiveDiscountBp).toBe(2500); // recomputed
    expect(after.portalRequests[0]).toMatchObject({ status: "ACCEPTED", responseNote: "fine for Acme" });
  });

  it("lists requests with stage and assignee", async () => {
    const { rows, counts } = await listApprovals();
    expect(counts.pending + counts.approved + counts.returned).toBeGreaterThan(0);
    const pending = rows.find((r) => r.status === "PENDING");
    if (pending) expect(["Sales Manager", "Finance"]).toContain(pending.stage);
  });
});
