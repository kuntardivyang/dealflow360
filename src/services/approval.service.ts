// Owner: B. Approval decisions (PDF B4). One action, three outcomes: approve the
// current step, reject, or return for revision. Guards, in order: actor role, quotation
// state, request still pending, this user may decide this step (right role, lowest
// pending step, not the quote's own rep), then a conditional update that lets exactly
// one of two simultaneous approvers win. Everything, including the audit row, is one
// transaction. A counter-offer approval (negotiationPending) applies the customer's
// proposed discount and sends the quote back to the portal.
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import {
  actorFromUser,
  approverRoleSchema,
  ConflictError,
  NotFoundError,
  riskBand,
  type ApprovalDecisionInput,
  type ApprovalRequestStatus,
  type ApproverRole,
  type QuotationRef,
  type QuotationStatus,
  type SessionUser,
} from "@/lib/contract";
import { ROLE_LABEL } from "@/lib/labels";
import { prisma, type Tx } from "@/lib/db";
import { assertActor, assertCanDecide, assertRequestTransition, assertStepTransition, assertTransition, actionableStep } from "@/lib/state";
import { recompute } from "@/services/quotation.service";

export type DecisionOutcome = QuotationRef & { auditLogId: number };

export async function decide(input: ApprovalDecisionInput, user: SessionUser): Promise<DecisionOutcome> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findUnique({
      where: { id: input.requestId },
      include: { steps: { orderBy: { stepNo: "asc" } }, quotation: true },
    });
    if (!request) throw new NotFoundError("Approval request not found");
    const step = request.steps.find((s) => s.id === input.stepId);
    if (!step) throw new NotFoundError("Approval step not found");
    const q = request.quotation;
    const actor = actorFromUser(user);
    const action = input.decision === "APPROVE" ? "APPROVE_STEP" : input.decision === "REJECT" ? "REJECT" : "RETURN";

    assertActor(actor, action);
    assertTransition(q.status, action);
    assertRequestTransition(request.status, input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "RETURNED");
    // A step that was already decided is a stale click (409), not a permissions problem (403).
    assertStepTransition(step.status, input.decision === "REJECT" ? "REJECTED" : "APPROVED");
    assertCanDecide(step, request.steps, user, q);

    const note = input.note?.trim() || null;
    const now = new Date();
    let nextStatus: QuotationStatus;
    let requestStatus: ApprovalRequestStatus = "PENDING";

    if (input.decision === "RETURN") {
      // Claim the whole request: a second "return" or a racing approve loses.
      const claimed = await tx.approvalRequest.updateMany({
        where: { id: request.id, status: "PENDING" },
        data: { status: "RETURNED", reason: note, resolvedAt: now },
      });
      if (claimed.count !== 1) throw new ConflictError("This request was already decided. Refresh to see the result.");
      requestStatus = "RETURNED";
      nextStatus = "DRAFT";
    } else {
      // Claim this step: two approvers clicking at once -> one wins, the other gets a 409.
      const claimed = await tx.approvalStep.updateMany({
        where: { id: step.id, status: "PENDING" },
        data: { status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", actedById: user.id, actedAt: now, note },
      });
      if (claimed.count !== 1) throw new ConflictError("This step was already decided by someone else. Refresh to see the result.");

      if (input.decision === "REJECT") {
        await tx.approvalRequest.update({ where: { id: request.id }, data: { status: "REJECTED", reason: note, resolvedAt: now } });
        requestStatus = "REJECTED";
        nextStatus = q.negotiationPending ? "SENT" : "REJECTED";
      } else {
        const remaining = request.steps.filter((s) => s.id !== step.id && s.status === "PENDING");
        if (remaining.length > 0) {
          nextStatus = "PENDING_APPROVAL";
        } else {
          await tx.approvalRequest.update({ where: { id: request.id }, data: { status: "APPROVED", resolvedAt: now } });
          requestStatus = "APPROVED";
          nextStatus = q.negotiationPending ? "SENT" : "APPROVED";
        }
      }
    }

    const resolved = requestStatus !== "PENDING";
    if (resolved && q.negotiationPending) {
      await settleCounterOffers(tx, q.id, requestStatus === "APPROVED", user.id, note);
      if (requestStatus === "APPROVED") await recompute(tx, q.id);
    }

    const updated = await tx.quotation.update({
      where: { id: q.id },
      data: {
        status: nextStatus,
        version: { increment: 1 },
        ...(resolved ? { negotiationPending: false } : {}),
        ...(input.decision === "RETURN" ? { approvalVersion: { increment: 1 } } : {}),
      },
    });

    const auditLogId = await audit(tx, {
      entityType: input.decision === "RETURN" ? "ApprovalRequest" : "ApprovalStep",
      entityId: input.decision === "RETURN" ? request.id : step.id,
      quotationId: q.id,
      action: input.decision,
      actor,
      reason: note,
      before: { status: q.status, step: step.stepNo, role: step.requiredRole, requestVersion: request.version },
      after: { status: nextStatus, request: requestStatus, negotiationPending: resolved ? false : q.negotiationPending },
    });

    return { id: updated.id, publicId: updated.publicId, number: updated.number, status: updated.status, version: updated.version, auditLogId };
  });
}

/** A counter-offer that needed approval: apply the proposed discounts (accepted) or leave the lines alone (declined). */
async function settleCounterOffers(tx: Tx, quotationId: number, accepted: boolean, userId: number, note: string | null): Promise<void> {
  const open = await tx.portalRequest.findMany({ where: { quotationId, type: "COUNTER_DISCOUNT", status: "OPEN" } });
  for (const r of open) {
    if (accepted && r.lineId !== null && r.proposedDiscountBp !== null) {
      await tx.quotationLine.update({ where: { id: r.lineId }, data: { discountBp: r.proposedDiscountBp } });
    }
    await tx.portalRequest.update({
      where: { id: r.id },
      data: { status: accepted ? "ACCEPTED" : "DECLINED", respondedById: userId, respondedAt: new Date(), responseNote: note },
    });
  }
}

// ---------------------------------------------------------------------------
// Read models for the two screens
// ---------------------------------------------------------------------------

export type ApprovalRow = {
  requestId: number;
  publicId: string;
  number: string;
  customer: string;
  riskScore: number;
  band: ReturnType<typeof riskBand>;
  status: ApprovalRequestStatus;
  stage: string;
  assignedTo: string;
  version: number;
  createdAt: Date;
};

export const parseChain = (chain: Prisma.JsonValue): ApproverRole[] => approverRoleSchema.array().catch([]).parse(chain);

export async function listApprovals(): Promise<{ rows: ApprovalRow[]; counts: { pending: number; returned: number; approved: number } }> {
  const [requests, financeUsers, grouped] = await Promise.all([
    prisma.approvalRequest.findMany({
      include: { steps: { orderBy: { stepNo: "asc" } }, quotation: { include: { customer: true, rep: { include: { manager: true } } } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.user.findMany({ where: { role: "FINANCE", isActive: true }, orderBy: { id: "asc" } }),
    prisma.approvalRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const count = (s: ApprovalRequestStatus) => grouped.find((g) => g.status === s)?._count._all ?? 0;

  const rows = requests.map((r): ApprovalRow => {
    const next = r.status === "PENDING" ? actionableStep(r.steps) : null;
    let stage = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", RETURNED: "Returned", SUPERSEDED: "Superseded" }[r.status];
    let assignedTo = "–";
    if (next) {
      stage = ROLE_LABEL[next.requiredRole];
      assignedTo =
        next.requiredRole === "SALES_MANAGER"
          ? (r.quotation.rep.manager?.name ?? "Any sales manager")
          : (financeUsers.map((u) => u.name).join(", ") || "Finance");
    }
    return {
      requestId: r.id,
      publicId: r.quotation.publicId,
      number: r.quotation.number,
      customer: r.quotation.customer.name,
      riskScore: r.riskScore,
      band: riskBand(r.riskScore),
      status: r.status,
      stage,
      assignedTo,
      version: r.version,
      createdAt: r.createdAt,
    };
  });
  return { rows, counts: { pending: count("PENDING"), returned: count("RETURNED"), approved: count("APPROVED") } };
}

export async function getApprovalDetail(publicId: string) {
  const quotation = await prisma.quotation.findUnique({
    where: { publicId },
    include: {
      customer: { include: { tier: true } },
      rep: true,
      lines: { orderBy: { sortOrder: "asc" }, include: { product: { include: { category: true } } } },
      approvalRequests: { orderBy: { version: "desc" }, include: { steps: { orderBy: { stepNo: "asc" }, include: { actedBy: true } } } },
      auditLogs: { orderBy: { at: "desc" }, take: 50 },
    },
  });
  if (!quotation || quotation.approvalRequests.length === 0) return null;
  const current = quotation.approvalRequests[0];
  return { quotation, current, chain: parseChain(current.chain), history: quotation.approvalRequests.slice(1) };
}

export type ApprovalDetail = NonNullable<Awaited<ReturnType<typeof getApprovalDetail>>>;
