// Owner: B. Customer portal negotiation (PDF B8, Quick Test step 7). Every query is
// scoped by the customer on the portal session and answered through the whitelist DTO.
// A counter-discount that breaks a ceiling re-enters approval by itself: no rep click.
import { Prisma } from "@/generated/prisma/client";
import { scoreLines } from "@/domain/risk";
import { riskPreview } from "@/domain/route";
import { computeTotals } from "@/domain/totals";
import { audit } from "@/lib/audit";
import {
  actorFromPortal,
  actorFromUser,
  ConflictError,
  NotFoundError,
  PORTAL_VISIBLE_STATUSES,
  ValidationError,
  type Actor,
  type ApproverRole,
  type PortalConfirmInput,
  type PortalQuotationDTO,
  type PortalRequestInput,
  type PortalUser,
  type QuotationRef,
  type RespondToRequestInput,
  type RiskPreview,
  type SessionUser,
} from "@/lib/contract";
import { prisma, type Tx } from "@/lib/db";
import { toPortalQuotation } from "@/lib/dto/portal";
import { assertActor, assertTransition } from "@/lib/state";
import { loadRiskWeights, loadRoutingRules, recompute } from "@/services/quotation.service";
import { assertOwnerOrAdmin } from "@/services/support";
import { onConfirmedHooks } from "./portal-hooks";

const PORTAL_INCLUDE = {
  customer: { select: { name: true, tierId: true } },
  lines: { orderBy: { sortOrder: "asc" as const } },
  portalRequests: { orderBy: { createdAt: "desc" as const } },
} as const;

/** The scoped lookup every portal read and write goes through. Not yours or not sent = 404, never 403. */
async function loadForCustomer(tx: Tx, publicId: string, customerId: number) {
  const q = await tx.quotation.findFirst({
    where: { publicId, customerId, sentAt: { not: null }, status: { in: [...PORTAL_VISIBLE_STATUSES] } },
    include: PORTAL_INCLUDE,
  });
  if (!q) throw new NotFoundError("Quotation not found");
  return q;
}

export async function getPortalQuotation(publicId: string, portal: PortalUser): Promise<PortalQuotationDTO> {
  return toPortalQuotation(await loadForCustomer(prisma, publicId, portal.customerId));
}

export async function listPortalQuotations(portal: PortalUser): Promise<PortalQuotationDTO[]> {
  const rows = await prisma.quotation.findMany({
    where: { customerId: portal.customerId, sentAt: { not: null }, status: { in: [...PORTAL_VISIBLE_STATUSES] } },
    include: PORTAL_INCLUDE,
    orderBy: { lastActivityAt: "desc" },
  });
  return rows.map(toPortalQuotation);
}

/**
 * Comment, change request or counter discount. A counter is scored on the proposed
 * terms: within every ceiling -> UNDER_NEGOTIATION for the rep to accept or decline;
 * above a ceiling -> a new approval round (approvalVersion + 1, old request SUPERSEDED,
 * status PENDING_APPROVAL, negotiationPending) with no rep involvement.
 */
export async function submitRequest(input: PortalRequestInput, portal: PortalUser): Promise<PortalQuotationDTO> {
  return prisma.$transaction(async (tx) => {
    const q = await loadForCustomer(tx, input.publicId, portal.customerId);
    const actor = actorFromPortal(portal);
    assertActor(actor, "PORTAL_REQUEST");
    assertTransition(q.status, "PORTAL_REQUEST");

    const line = input.lineId !== undefined ? q.lines.find((l) => l.id === input.lineId) : undefined;
    if (input.lineId !== undefined && !line) throw new ValidationError("That line is not on this quotation", { lineId: ["Pick a line from this quotation"] });

    const request = await tx.portalRequest.create({
      data: {
        quotationId: q.id,
        lineId: line?.id ?? null,
        contactId: portal.contactId,
        type: input.type,
        message: input.message?.trim() || null,
        proposedDiscountBp: input.type === "COUNTER_DISCOUNT" ? (input.proposedDiscountBp ?? null) : null,
        requestedDeliveryDate: input.requestedDeliveryDate ? new Date(`${input.requestedDeliveryDate}T00:00:00Z`) : null,
      },
    });

    let nextStatus: "UNDER_NEGOTIATION" | "PENDING_APPROVAL" = "UNDER_NEGOTIATION";
    let chain: ApproverRole[] = [];
    let approvalVersion = q.approvalVersion;

    if (input.type === "COUNTER_DISCOUNT" && line && input.proposedDiscountBp !== undefined) {
      const proposed = await previewProposal(tx, q, line.id, input.proposedDiscountBp);
      chain = proposed.chain;
      if (chain.length > 0) {
        approvalVersion = await openApprovalRound(tx, q.id, q.approvalVersion, proposed, `Customer counter: ${line.description} to ${input.proposedDiscountBp / 100}%`);
        nextStatus = "PENDING_APPROVAL";
      }
    }

    await tx.quotation.update({
      where: { id: q.id },
      data: { status: nextStatus, version: { increment: 1 }, approvalVersion, ...(nextStatus === "PENDING_APPROVAL" ? { negotiationPending: true } : {}) },
    });
    await audit(tx, {
      entityType: "PortalRequest",
      entityId: request.id,
      quotationId: q.id,
      action: input.type === "COUNTER_DISCOUNT" ? "PORTAL_COUNTER" : input.type === "CHANGE_REQUEST" ? "PORTAL_CHANGE_REQUEST" : "PORTAL_COMMENT",
      actor,
      reason: input.message?.trim() || null,
      before: { status: q.status, ...(line ? { line: line.description, discountBp: line.discountBp } : {}) },
      after: { status: nextStatus, ...(input.proposedDiscountBp !== undefined ? { proposedDiscountBp: input.proposedDiscountBp } : {}), chain, approvalVersion },
    });
    return toPortalQuotation(await loadForCustomer(tx, input.publicId, portal.customerId));
  });
}

/**
 * One click. Allowed only from SENT / UNDER_NEGOTIATION with no open counter. Routing is
 * re-run on the applied terms as a safety net; CONFIRMED triggers billing and fulfillment.
 */
export async function confirmFromPortal(input: PortalConfirmInput, portal: PortalUser): Promise<PortalQuotationDTO> {
  return prisma.$transaction(async (tx) => {
    const q = await loadForCustomer(tx, input.publicId, portal.customerId);
    const actor = actorFromPortal(portal);
    assertActor(actor, "PORTAL_CONFIRM");
    assertTransition(q.status, "PORTAL_CONFIRM");
    if (q.portalRequests.some((r) => r.type === "COUNTER_DISCOUNT" && r.status === "OPEN")) {
      throw new ConflictError("Your counter-offer is still being reviewed. Wait for the answer before confirming.");
    }

    const view = await recompute(tx, q.id);
    if (view.risk.chain.length > 0) {
      const approvalVersion = await openApprovalRound(tx, q.id, q.approvalVersion, view.risk, "Terms changed since approval");
      await tx.quotation.update({ where: { id: q.id }, data: { status: "PENDING_APPROVAL", approvalVersion, negotiationPending: true, version: { increment: 1 } } });
      await audit(tx, { entityType: "Quotation", entityId: q.id, quotationId: q.id, action: "PORTAL_CONFIRM", actor, after: { status: "PENDING_APPROVAL", chain: view.risk.chain } });
      return toPortalQuotation(await loadForCustomer(tx, input.publicId, portal.customerId));
    }

    const now = new Date();
    await tx.quotation.update({
      where: { id: q.id },
      data: { status: "CONFIRMED", confirmedAt: now, confirmedByContactId: portal.contactId, confirmedName: input.fullName, version: { increment: 1 } },
    });
    const hooks = await onConfirmedHooks(tx, q.id, actor);
    await audit(tx, {
      entityType: "Quotation",
      entityId: q.id,
      quotationId: q.id,
      action: "PORTAL_CONFIRM",
      actor,
      before: { status: q.status },
      after: { status: "CONFIRMED", confirmedName: input.fullName, total: view.totals.total, ...hooks },
    });
    return toPortalQuotation(await loadForCustomer(tx, input.publicId, portal.customerId));
  });
}

/** Rep side: accept or decline an open portal request. Accepting a counter applies the discount and re-routes. */
export async function respondToRequest(input: RespondToRequestInput, user: SessionUser): Promise<QuotationRef> {
  return prisma.$transaction(async (tx) => {
    const q = await tx.quotation.findUnique({ where: { id: input.quotationId }, include: { portalRequests: true } });
    if (!q) throw new NotFoundError("Quotation not found");
    assertOwnerOrAdmin(q, user);
    const actor = actorFromUser(user);
    assertActor(actor, "REP_RESPOND");
    assertTransition(q.status, "REP_RESPOND");
    const request = q.portalRequests.find((r) => r.id === input.requestId);
    if (!request) throw new NotFoundError("Request not found");
    if (request.status !== "OPEN") throw new ConflictError("This request was already answered");

    const note = input.note?.trim() || null;
    await tx.portalRequest.update({
      where: { id: request.id },
      data: { status: input.decision === "ACCEPT" ? "ACCEPTED" : "DECLINED", responseNote: note, respondedById: user.id, respondedAt: new Date() },
    });

    let nextStatus: "SENT" | "UNDER_NEGOTIATION" | "PENDING_APPROVAL" = "SENT";
    let approvalVersion = q.approvalVersion;
    let chain: ApproverRole[] = [];
    if (input.decision === "ACCEPT" && request.type === "COUNTER_DISCOUNT" && request.lineId !== null && request.proposedDiscountBp !== null) {
      await tx.quotationLine.update({ where: { id: request.lineId }, data: { discountBp: request.proposedDiscountBp } });
      const view = await recompute(tx, q.id);
      chain = view.risk.chain;
      if (chain.length > 0) {
        approvalVersion = await openApprovalRound(tx, q.id, q.approvalVersion, view.risk, "Rep accepted a customer counter above the ceiling");
        nextStatus = "PENDING_APPROVAL";
      }
    }
    if (nextStatus === "SENT") {
      const stillOpen = q.portalRequests.some((r) => r.id !== request.id && r.status === "OPEN");
      if (stillOpen) nextStatus = "UNDER_NEGOTIATION";
    }
    const updated = await tx.quotation.update({
      where: { id: q.id },
      data: { status: nextStatus, approvalVersion, version: { increment: 1 }, ...(nextStatus === "PENDING_APPROVAL" ? { negotiationPending: true } : {}) },
    });
    await audit(tx, {
      entityType: "PortalRequest",
      entityId: request.id,
      quotationId: q.id,
      action: input.decision === "ACCEPT" ? "REQUEST_ACCEPT" : "REQUEST_DECLINE",
      actor,
      reason: note,
      before: { status: q.status, type: request.type, proposedDiscountBp: request.proposedDiscountBp },
      after: { status: nextStatus, chain, approvalVersion },
    });
    return { id: updated.id, publicId: updated.publicId, number: updated.number, status: updated.status, version: updated.version };
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type LoadedQuote = Prisma.QuotationGetPayload<{ include: typeof PORTAL_INCLUDE }>;

/** Score the order as it would be with one line at the proposed discount, with the chain it would trigger. */
async function previewProposal(tx: Tx, q: LoadedQuote, lineId: number, proposedBp: number): Promise<RiskPreview> {
  const inputs = q.lines.map((l) => ({
    lineId: l.id,
    unitPrice: l.unitPrice,
    qty: l.qty,
    discountBp: l.id === lineId ? proposedBp : l.discountBp,
    unitCost: l.unitCost,
    taxBp: l.taxBp,
  }));
  const totals = computeTotals(inputs, q.orderDiscountBp);
  const scored = q.lines.map((l, i) => ({ lineId: l.id, effectiveDiscountBp: totals.lines[i].effectiveDiscountBp, ceilingBp: l.ceilingBp, gross: totals.lines[i].gross }));
  const [cfg, rules] = await Promise.all([loadRiskWeights(tx), loadRoutingRules(tx)]);
  return riskPreview(scoreLines(scored, totals.marginBp, cfg), totals.total, rules);
}

/** New approval request + steps for the given risk; any pending request is superseded. Returns the new approval version. */
async function openApprovalRound(tx: Tx, quotationId: number, currentVersion: number, risk: RiskPreview, reason: string): Promise<number> {
  await tx.approvalRequest.updateMany({ where: { quotationId, status: "PENDING" }, data: { status: "SUPERSEDED", resolvedAt: new Date(), reason } });
  let version = currentVersion + 1;
  while (await tx.approvalRequest.findUnique({ where: { quotationId_version: { quotationId, version } } })) version += 1;
  await tx.approvalRequest.create({
    data: {
      quotationId,
      version,
      riskScore: risk.score,
      riskBreakdown: JSON.parse(JSON.stringify(risk)) as Prisma.InputJsonValue,
      chain: [...risk.chain],
      steps: { create: risk.chain.map((role, i) => ({ stepNo: i + 1, requiredRole: role })) },
    },
  });
  return version;
}

export const portalActor = (portal: PortalUser): Actor => actorFromPortal(portal);
