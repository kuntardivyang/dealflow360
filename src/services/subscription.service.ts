// Owner: A. Mid-cycle subscription changes (PDF A5, B7). The quantity change is prorated
// against the real current period: a positive net posts a PRORATION invoice, a negative
// net issues a credit note, and every future scheduled period is re-priced.
import { parseISODate, todayISO, toISODate, addDays } from "@/domain/dates";
import { applyDiscount, pct } from "@/domain/money";
import { prorate } from "@/domain/prorate";
import { lineCeilingBp } from "@/domain/risk";
import { audit } from "@/lib/audit";
import {
  ForbiddenError,
  NotFoundError,
  OPS_ROLES,
  ValidationError,
  actorFromUser,
  type Actor,
  type CancelSubscriptionInput,
  type ChangeQuantityInput,
  type ProrateResult,
  type QuotationRef,
  type SessionUser,
  type StartRenewalInput,
  type StartUpsellInput,
} from "@/lib/contract";
import { prisma, type Tx } from "@/lib/db";
import { publicId } from "@/lib/ids";
import { assertSubscriptionChangeable, assertSubscriptionTransition } from "@/lib/state";
import { recompute } from "./quotation.service";
import { nextNumber } from "./support";

export type ChangeOutcome = ProrateResult & { invoiceId: number | null; creditNoteId: number | null; invoiceNumber: string | null };

/** A subscription loaded with everything the proration needs. */
type SubForChange = {
  id: number;
  customerId: number;
  quotationId: number | null;
  productId: number;
  qty: number;
  unitPrice: number;
  discountBp: number;
  taxBp: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  product: { name: string };
  plan: { prorationMode: "DAY_BASED" | "NONE"; billChangeDay: boolean };
};

/**
 * The proration engine shared by Modify Subscription and by a confirmed upsell order.
 * Credits the old quantity and charges the new one for the remaining days of the current
 * period, re-prices every future scheduled period, and records the change. The caller
 * owns the transaction and has already checked the guards.
 */
export async function applyQuantityChange(
  tx: Tx,
  sub: SubForChange,
  newQty: number,
  effectiveDate: string,
  actor: Actor,
  createdById: number | null,
  note?: string,
): Promise<ChangeOutcome> {
  const periodStart = toISODate(sub.currentPeriodStart);
  const periodEnd = toISODate(sub.currentPeriodEnd);
  const result = prorate({
    periodStart,
    periodEnd,
    changeDate: effectiveDate,
    unitPrice: sub.unitPrice,
    discountBp: sub.discountBp,
    oldQty: sub.qty,
    newQty,
    mode: sub.plan.prorationMode,
    billChangeDay: sub.plan.billChangeDay,
  });

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
            { description: `${sub.product.name} · ${newQty} seats from ${effectiveDate} (${result.remainingDays} of ${result.daysInPeriod} days)`, qty: newQty, unitPrice: sub.unitPrice, discountBp: sub.discountBp, net: result.charge, taxBp: sub.taxBp, tax: chargeTax, total: result.charge + chargeTax, sortOrder: 1 },
            { description: `Credit: ${sub.product.name} · ${sub.qty} seats already billed for the same days`, qty: sub.qty, unitPrice: sub.unitPrice, discountBp: sub.discountBp, net: -result.credit, taxBp: sub.taxBp, tax: -creditTax, total: -(result.credit + creditTax), sortOrder: 2 },
          ],
        },
      },
    });
    invoiceId = invoice.id;
    invoiceNumber = number;
  } else if (result.net < 0) {
    const amount = -result.net + pct(-result.net, sub.taxBp);
    const cn = await tx.creditNote.create({
      data: {
        number: await nextNumber(tx, "credit_note", "CN"),
        customerId: sub.customerId,
        subscriptionId: sub.id,
        amount,
        reason: `${sub.product.name} reduced from ${sub.qty} to ${newQty} seats on ${effectiveDate}, ${result.remainingDays} of ${result.daysInPeriod} days credited`,
      },
    });
    creditNoteId = cn.id;
  }

  // Future periods are billed at the new quantity.
  const perPeriodNet = applyDiscount(sub.unitPrice * newQty, sub.discountBp);
  const perPeriodTax = pct(perPeriodNet, sub.taxBp);
  await tx.billingSchedule.updateMany({ where: { subscriptionId: sub.id, status: "SCHEDULED" }, data: { net: perPeriodNet, tax: perPeriodTax, total: perPeriodNet + perPeriodTax } });
  await tx.subscription.update({ where: { id: sub.id }, data: { qty: newQty } });
  await tx.subscriptionChange.create({
    data: {
      subscriptionId: sub.id,
      type: "QUANTITY",
      effectiveDate: parseISODate(effectiveDate),
      oldQty: sub.qty,
      newQty,
      daysInPeriod: result.daysInPeriod,
      remainingDays: result.remainingDays,
      credit: result.credit,
      charge: result.charge,
      net: result.net,
      invoiceId,
      creditNoteId,
      note: note ?? null,
      createdById,
    },
  });
  await audit(tx, {
    entityType: "Subscription",
    entityId: sub.id,
    quotationId: sub.quotationId,
    action: "SUBSCRIPTION_QTY",
    actor,
    reason: note ?? null,
    before: { qty: sub.qty },
    after: { qty: newQty, effectiveDate, credit: result.credit, charge: result.charge, net: result.net, invoiceNumber, creditNoteId },
  });
  return { ...result, invoiceId, creditNoteId, invoiceNumber };
}

export async function changeQuantity(input: ChangeQuantityInput, user: SessionUser): Promise<ChangeOutcome> {
  if (!OPS_ROLES.includes(user.role)) throw new ForbiddenError("Only Finance, a Sales Manager or an Admin can change a subscription");
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: input.subscriptionId }, include: { plan: true, product: true } });
    if (!sub) throw new NotFoundError("Subscription not found");
    assertSubscriptionChangeable(sub.status);
    if (input.newQty === sub.qty) throw new ValidationError("Quantity is unchanged", { newQty: ["Pick a different quantity"] });
    const periodStart = toISODate(sub.currentPeriodStart);
    const periodEnd = toISODate(sub.currentPeriodEnd);
    if (input.effectiveDate < periodStart || input.effectiveDate > periodEnd) {
      throw new ValidationError(`Effective date must fall inside the current period ${periodStart} to ${periodEnd}`, { effectiveDate: ["Outside the current period"] });
    }
    return applyQuantityChange(tx, sub, input.newQty, input.effectiveDate, actorFromUser(user), user.id);
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

// ---------------------------------------------------------------------------
// Upsell and renewal (Odoo 19). Both buttons open a quotation against the running
// subscription rather than editing it in place, so the change goes through the same
// pricing, risk scoring and approval routing as any other deal. What happens on
// confirmation lives in billing.service.onConfirmed.
// ---------------------------------------------------------------------------

/** The day the next term starts: the day after the last period already scheduled. */
export function renewalStartFor(sub: { currentPeriodEnd: Date; schedule: { periodEnd: Date }[] }): string {
  const last = sub.schedule.reduce<Date>((max, s) => (s.periodEnd > max ? s.periodEnd : max), sub.currentPeriodEnd);
  return addDays(toISODate(last), 1);
}

type OpenOrderResult = QuotationRef & { subscriptionId: number };

/** Shared body of Upsell and Renew: a draft quotation carrying one recurring line for this subscription. */
async function openSubscriptionOrder(
  tx: Tx,
  subscriptionId: number,
  intent: "UPSELL" | "RENEWAL",
  user: SessionUser,
  describe: (productName: string) => string,
): Promise<OpenOrderResult> {
  const sub = await tx.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, product: { include: { category: true } }, customer: { include: { tier: true } }, schedule: true },
  });
  if (!sub) throw new NotFoundError("Subscription not found");
  if (intent === "UPSELL") assertSubscriptionChangeable(sub.status);
  else assertSubscriptionTransition(sub.status, "RENEWED");

  const number = await nextNumber(tx, "quotation", "Q");
  const ceilingBp = lineCeilingBp(sub.customer.tier.discountCeilingBp, sub.product.category.discountCeilingBp);
  const q = await tx.quotation.create({
    data: {
      publicId: publicId(),
      number,
      customerId: sub.customerId,
      repUserId: user.id,
      subscriptionId: sub.id,
      subscriptionIntent: intent,
      notes: describe(sub.product.name),
      lines: {
        create: [
          {
            productId: sub.productId,
            planId: sub.planId,
            lineType: "RECURRING",
            source: "MANUAL",
            description: sub.product.name,
            qty: sub.qty,
            unitPrice: sub.unitPrice,
            unitCost: sub.product.cost,
            taxBp: sub.taxBp,
            discountBp: sub.discountBp,
            ceilingBp,
            sortOrder: 1,
          },
        ],
      },
    },
  });
  await recompute(tx, q.id);
  const saved = await tx.quotation.findUniqueOrThrow({ where: { id: q.id } });
  await audit(tx, {
    entityType: "Quotation",
    entityId: q.id,
    quotationId: q.id,
    action: intent === "UPSELL" ? "SUBSCRIPTION_UPSELL_OPENED" : "SUBSCRIPTION_RENEWAL_OPENED",
    actor: actorFromUser(user),
    after: { number, subscription: sub.publicId, product: sub.product.name, qty: sub.qty },
  });
  return { id: saved.id, publicId: saved.publicId, number: saved.number, status: saved.status, version: saved.version, subscriptionId: sub.id };
}

/**
 * Upsell: a quotation prefilled with the current quantity, for the rep to raise. Odoo
 * requires the subscription to have been invoiced first, so the same guard applies here.
 */
export async function startUpsell(input: StartUpsellInput, user: SessionUser): Promise<OpenOrderResult> {
  return prisma.$transaction(async (tx) => {
    const invoiced = await tx.invoice.count({ where: { subscriptionId: input.subscriptionId } });
    if (invoiced === 0) throw new ValidationError("Invoice the subscription before upselling it");
    return openSubscriptionOrder(tx, input.subscriptionId, "UPSELL", user, (p) => `Upsell of ${p}: raise the quantity, then confirm to apply it prorated for the remaining days.`);
  });
}

/** Renew: a quotation for the next term. Confirming it creates the successor subscription. */
export async function startRenewal(input: StartRenewalInput, user: SessionUser): Promise<OpenOrderResult> {
  return prisma.$transaction(async (tx) =>
    openSubscriptionOrder(tx, input.subscriptionId, "RENEWAL", user, (p) => `Renewal of ${p} for the next term. Confirming it starts a successor subscription.`),
  );
}
