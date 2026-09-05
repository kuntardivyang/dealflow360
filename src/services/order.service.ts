// Owner: A. The hand-offs between approval and the order: send an approved quotation
// to the customer, and turn a confirmed quotation into an order (split proposal and,
// next, invoices). The portal confirm (B) calls confirmOrder inside its own transaction.
import { audit } from "@/lib/audit";
import { NotFoundError, actorFromUser, type Actor, type QuotationRef, type SendToCustomerInput, type SessionUser } from "@/lib/contract";
import { prisma, type Tx } from "@/lib/db";
import { assertActor, assertTransition } from "@/lib/state";
import { onConfirmedHooks } from "./portal-hooks";
import { assertOwnerOrAdmin, lockQuotation } from "./support";

const toRef = (q: { id: number; publicId: string; number: string; status: QuotationRef["status"]; version: number }): QuotationRef => ({
  id: q.id,
  publicId: q.publicId,
  number: q.number,
  status: q.status,
  version: q.version,
});

/** APPROVED -> SENT. The portal link is shown on screen; there is no email. */
export async function sendToCustomer(input: SendToCustomerInput, user: SessionUser): Promise<QuotationRef & { portalUrl: string }> {
  return prisma.$transaction(async (tx) => {
    const q = await tx.quotation.findUnique({ where: { id: input.quotationId } });
    if (!q) throw new NotFoundError("Quotation not found");
    assertOwnerOrAdmin(q, user);
    assertActor(actorFromUser(user), "SEND");
    assertTransition(q.status, "SEND");
    await lockQuotation(tx, q.id, input.version);
    const sent = await tx.quotation.update({ where: { id: q.id }, data: { status: "SENT", sentAt: new Date() } });
    await audit(tx, { entityType: "Quotation", entityId: q.id, quotationId: q.id, action: "SEND", actor: actorFromUser(user), after: { status: "SENT" } });
    return { ...toRef(sent), portalUrl: `/portal/q/${q.publicId}` };
  });
}

/**
 * The order is confirmed: status CONFIRMED, then the confirmation hooks run (split
 * proposal, billing). Runs inside the caller's transaction so a failing hook rolls the
 * confirm back. The portal confirm (B) does the same through portal-hooks.
 */
export async function confirmOrder(tx: Tx, quotationId: number, actor: Actor, confirmedBy: { contactId?: number; name: string }): Promise<QuotationRef> {
  const q = await tx.quotation.findUnique({ where: { id: quotationId } });
  if (!q) throw new NotFoundError("Quotation not found");
  assertActor(actor, "PORTAL_CONFIRM");
  assertTransition(q.status, "PORTAL_CONFIRM");
  const confirmed = await tx.quotation.update({
    where: { id: q.id },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedByContactId: confirmedBy.contactId ?? null, confirmedName: confirmedBy.name, version: { increment: 1 } },
  });
  const hooks = await onConfirmedHooks(tx, q.id, actor);
  await audit(tx, { entityType: "Quotation", entityId: q.id, quotationId: q.id, action: "PORTAL_CONFIRM", actor, after: { status: "CONFIRMED", confirmedBy: confirmedBy.name, ...hooks } });
  return toRef(confirmed);
}

/** Demo fallback and offline path: an ADMIN confirms on the customer's behalf. */
export async function confirmOnBehalf(input: { quotationId: number; version: number; customerName: string }, user: SessionUser): Promise<QuotationRef> {
  return prisma.$transaction(async (tx) => {
    const q = await tx.quotation.findUnique({ where: { id: input.quotationId } });
    if (!q) throw new NotFoundError("Quotation not found");
    await lockQuotation(tx, q.id, input.version);
    return confirmOrder(tx, q.id, actorFromUser(user), { name: `${input.customerName} (confirmed by ${user.name})` });
  });
}
