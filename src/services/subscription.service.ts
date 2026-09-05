// Owner: A. Mid-cycle subscription changes (PDF A5, B7). The quantity change is prorated
// against the real current period: a positive net posts a PRORATION invoice, a negative
// net issues a credit note, and every future scheduled period is re-priced.
import { parseISODate, todayISO, toISODate, addDays } from "@/domain/dates";
import { applyDiscount, pct } from "@/domain/money";
import { prorate } from "@/domain/prorate";
import { audit } from "@/lib/audit";
import { ForbiddenError, NotFoundError, OPS_ROLES, ValidationError, actorFromUser, type CancelSubscriptionInput, type ChangeQuantityInput, type ProrateResult, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { publicId } from "@/lib/ids";
import { assertSubscriptionChangeable, assertSubscriptionTransition } from "@/lib/state";
import { nextNumber } from "./support";

export type ChangeOutcome = ProrateResult & { invoiceId: number | null; creditNoteId: number | null; invoiceNumber: string | null };

export async function changeQuantity(input: ChangeQuantityInput, user: SessionUser): Promise<ChangeOutcome> {
  if (!OPS_ROLES.includes(user.role)) throw new ForbiddenError("Only Finance, a Sales Manager or an Admin can change a subscription");
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: input.subscriptionId }, include: { plan: true, product: true, schedule: { orderBy: { periodStart: "asc" } } } });
    if (!sub) throw new NotFoundError("Subscription not found");
    assertSubscriptionChangeable(sub.status);
    if (input.newQty === sub.qty) throw new ValidationError("Quantity is unchanged", { newQty: ["Pick a different quantity"] });

    const periodStart = toISODate(sub.currentPeriodStart);
    const periodEnd = toISODate(sub.currentPeriodEnd);
    if (input.effectiveDate < periodStart || input.effectiveDate > periodEnd) {
      throw new ValidationError(`Effective date must fall inside the current period ${periodStart} to ${periodEnd}`, { effectiveDate: ["Outside the current period"] });
    }

    const result = prorate({
      periodStart,
      periodEnd,
      changeDate: input.effectiveDate,
      unitPrice: sub.unitPrice,
      discountBp: sub.discountBp,
      oldQty: sub.qty,
      newQty: input.newQty,
      mode: sub.plan.prorationMode,
      billChangeDay: sub.plan.billChangeDay,
    });

    const actor = actorFromUser(user);
    const today = todayISO();
    let invoiceId: number | null = null;
    let invoiceNumber: string | null = null;
    let creditNoteId: number | null = null;

    if (result.net > 0) {
      const number = await nextNumber(tx, "invoice", "INV");
      const chargeTax = pct(result.charge, sub.taxBp);
      const creditTax = pct(result.credit, sub.taxBp);
      const invoice = await tx.invoice.create({
        data: {
          publicId: publicId(),
          number,
          kind: "PRORATION",
          customerId: sub.customerId,
          quotationId: sub.quotationId,
          subscriptionId: sub.id,
          subtotal: result.net,
          taxTotal: chargeTax - creditTax,
          total: result.net + chargeTax - creditTax,
          issueDate: parseISODate(today),
          dueDate: parseISODate(addDays(today, 15)),
          periodStart: sub.currentPeriodStart,
          periodEnd: sub.currentPeriodEnd,
          lines: {
            create: [
              { description: `${sub.product.name} · ${input.newQty} seats from ${input.effectiveDate} (${result.remainingDays} of ${result.daysInPeriod} days)`, qty: input.newQty, unitPrice: sub.unitPrice, discountBp: sub.discountBp, net: result.charge, taxBp: sub.taxBp, tax: chargeTax, total: result.charge + chargeTax, sortOrder: 1 },
              { description: `Credit: ${sub.product.name} · ${sub.qty} seats already billed for the same days`, qty: sub.qty, unitPrice: sub.unitPrice, discountBp: sub.discountBp, net: -result.credit, taxBp: sub.taxBp, tax: -creditTax, total: -(result.credit + creditTax), sortOrder: 2 },
            ],
          },
        },
      });
      invoiceId = invoice.id;
      invoiceNumber = number;
    } else if (result.net < 0) {
      const amount = -result.net + pct(-result.net, sub.taxBp);
      const note = await tx.creditNote.create({
        data: {
          number: await nextNumber(tx, "credit_note", "CN"),
          customerId: sub.customerId,
          subscriptionId: sub.id,
          amount,
          reason: `${sub.product.name} reduced from ${sub.qty} to ${input.newQty} seats on ${input.effectiveDate}, ${result.remainingDays} of ${result.daysInPeriod} days credited`,
        },
      });
      creditNoteId = note.id;
    }

    // Future periods are billed at the new quantity.
    const perPeriodNet = applyDiscount(sub.unitPrice * input.newQty, sub.discountBp);
    const perPeriodTax = pct(perPeriodNet, sub.taxBp);
    await tx.billingSchedule.updateMany({ where: { subscriptionId: sub.id, status: "SCHEDULED" }, data: { net: perPeriodNet, tax: perPeriodTax, total: perPeriodNet + perPeriodTax } });
    await tx.subscription.update({ where: { id: sub.id }, data: { qty: input.newQty } });
    await tx.subscriptionChange.create({
      data: {
        subscriptionId: sub.id,
        type: "QUANTITY",
        effectiveDate: parseISODate(input.effectiveDate),
        oldQty: sub.qty,
        newQty: input.newQty,
        daysInPeriod: result.daysInPeriod,
        remainingDays: result.remainingDays,
        credit: result.credit,
        charge: result.charge,
        net: result.net,
        invoiceId,
        creditNoteId,
        createdById: user.id,
      },
    });
    await audit(tx, {
      entityType: "Subscription",
      entityId: sub.id,
      quotationId: sub.quotationId,
      action: "SUBSCRIPTION_QTY",
      actor,
      before: { qty: sub.qty },
      after: { qty: input.newQty, effectiveDate: input.effectiveDate, credit: result.credit, charge: result.charge, net: result.net, invoiceNumber, creditNoteId },
    });
    return { ...result, invoiceId, creditNoteId, invoiceNumber };
  });
}

export type CancelOutcome = { subscriptionId: number; policy: string; cancelEffective: string; credit: number; creditNoteId: number | null; refundPaymentId: number | null };

/**
 * Cancel per the plan's policy. END_OF_PERIOD: runs to the end of the current period, nothing
 * credited. IMMEDIATE_PRORATED_REFUND: the unused days of the current period are credited
 * (credit note, or a refund payment on the paid invoice when the plan says so). NO_REFUND:
 * stops now, nothing credited. Future scheduled periods are cancelled in every case.
 */
export async function cancelSubscription(input: CancelSubscriptionInput, user: SessionUser): Promise<CancelOutcome> {
  if (!OPS_ROLES.includes(user.role)) throw new ForbiddenError("Only Finance, a Sales Manager or an Admin can cancel a subscription");
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: input.subscriptionId }, include: { plan: true, product: true, invoices: { where: { kind: "RECURRING" }, orderBy: { periodStart: "desc" }, take: 1 } } });
    if (!sub) throw new NotFoundError("Subscription not found");
    assertSubscriptionTransition(sub.status, "CANCELLED");
    const periodStart = toISODate(sub.currentPeriodStart);
    const periodEnd = toISODate(sub.currentPeriodEnd);
    const effective = input.effectiveDate ?? todayISO();
    if (effective < periodStart || effective > periodEnd) {
      throw new ValidationError(`Effective date must fall inside the current period ${periodStart} to ${periodEnd}`, { effectiveDate: ["Outside the current period"] });
    }
    const policy = sub.plan.cancelPolicy;
    const cancelEffective = policy === "END_OF_PERIOD" ? periodEnd : effective;

    let credit = 0;
    let creditNoteId: number | null = null;
    let refundPaymentId: number | null = null;
    if (policy === "IMMEDIATE_PRORATED_REFUND") {
      const r = prorate({ periodStart, periodEnd, changeDate: effective, unitPrice: sub.unitPrice, discountBp: sub.discountBp, oldQty: sub.qty, newQty: 0, mode: sub.plan.prorationMode, billChangeDay: sub.plan.billChangeDay });
      credit = r.credit;
      if (credit > 0) {
        const amount = credit + pct(credit, sub.taxBp);
        const paidInvoice = sub.invoices[0]?.status === "PAID" ? sub.invoices[0] : null;
        const refund = sub.plan.refundMethod === "REFUND_PAYMENT" && paidInvoice;
        const note = await tx.creditNote.create({
          data: {
            number: await nextNumber(tx, "credit_note", "CN"),
            customerId: sub.customerId,
            subscriptionId: sub.id,
            invoiceId: paidInvoice?.id ?? null,
            amount,
            status: refund ? "REFUNDED" : "OPEN",
            reason: `${sub.product.name} cancelled on ${effective}: ${r.remainingDays} of ${r.daysInPeriod} days unused. ${input.reason}`,
          },
        });
        creditNoteId = note.id;
        if (refund) {
          const payment = await tx.payment.create({
            data: { invoiceId: paidInvoice.id, kind: "REFUND", amount, method: "BANK_TRANSFER", clientRef: `refund-${note.number}`, note: `Refund for credit note ${note.number}`, createdById: user.id },
          });
          refundPaymentId = payment.id;
        }
      }
    }

    await tx.billingSchedule.updateMany({ where: { subscriptionId: sub.id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
    await tx.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelEffective: parseISODate(cancelEffective) } });
    await tx.subscriptionChange.create({
      data: { subscriptionId: sub.id, type: "CANCEL", effectiveDate: parseISODate(cancelEffective), oldQty: sub.qty, newQty: 0, credit, net: -credit, creditNoteId, note: input.reason, createdById: user.id },
    });
    await audit(tx, {
      entityType: "Subscription",
      entityId: sub.id,
      quotationId: sub.quotationId,
      action: "SUBSCRIPTION_CANCEL",
      actor: actorFromUser(user),
      reason: input.reason,
      before: { status: sub.status, qty: sub.qty },
      after: { status: "CANCELLED", policy, cancelEffective, credit, creditNoteId, refundPaymentId },
    });
    return { subscriptionId: sub.id, policy, cancelEffective, credit, creditNoteId, refundPaymentId };
  });
}
