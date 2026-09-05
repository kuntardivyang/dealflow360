// Owner: A. Billing on confirmation and payments (PDF A5, B7, steps 6 and 8).
// One-time lines make one invoice. Each recurring line makes a subscription with its
// billing schedule and the invoice for the first period. Payments are append-only and
// idempotent by clientRef; invoice status is derived from paidAmount.
import { parseISODate, todayISO, addDays } from "@/domain/dates";
import { buildSchedule, periodEnd } from "@/domain/prorate";
import { audit } from "@/lib/audit";
import { ConflictError, NotFoundError, actorFromUser, type Actor, type RecordPaymentInput, type SessionUser } from "@/lib/contract";
import { prisma, type Tx } from "@/lib/db";
import { publicId } from "@/lib/ids";
import { applyPayment, assertActor, assertTransition } from "@/lib/state";
import { nextNumber } from "./support";

const DUE_DAYS = 15;

/**
 * Called inside the confirming transaction. Returns how many invoices were created.
 * ONE_TIME lines -> Invoice(ONE_TIME). RECURRING lines -> Subscription + BillingSchedule
 * (plan.periods rows) + Invoice(RECURRING) for period one, posted immediately.
 */
export async function onConfirmed(tx: Tx, quotationId: number, actor: Actor): Promise<{ invoicesCreated: number; subscriptionsCreated: number }> {
  const q = await tx.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { lines: { orderBy: { sortOrder: "asc" }, include: { plan: true, product: true } } } });
  const today = todayISO();
  const issue = parseISODate(today);
  const due = parseISODate(addDays(today, DUE_DAYS));
  let invoicesCreated = 0;
  let subscriptionsCreated = 0;
  const numbers: string[] = [];

  const oneTime = q.lines.filter((l) => l.lineType === "ONE_TIME");
  if (oneTime.length > 0) {
    const number = await nextNumber(tx, "invoice", "INV");
    await tx.invoice.create({
      data: {
        publicId: publicId(),
        number,
        kind: "ONE_TIME",
        customerId: q.customerId!,
        quotationId: q.id,
        subtotal: oneTime.reduce((s, l) => s + l.net, 0),
        taxTotal: oneTime.reduce((s, l) => s + l.tax, 0),
        total: oneTime.reduce((s, l) => s + l.total, 0),
        issueDate: issue,
        dueDate: due,
        lines: {
          create: oneTime.map((l, i) => ({
            quotationLineId: l.id,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discountBp: l.effectiveDiscountBp,
            net: l.net,
            taxBp: l.taxBp,
            tax: l.tax,
            total: l.total,
            sortOrder: i + 1,
          })),
        },
      },
    });
    invoicesCreated += 1;
    numbers.push(number);
  }

  for (const line of q.lines.filter((l) => l.lineType === "RECURRING")) {
    if (!line.plan) throw new ConflictError(`Recurring line ${line.description} has no plan`);
    const schedule = buildSchedule(today, line.plan.interval, line.plan.periods, line.net, line.taxBp);
    const subscription = await tx.subscription.create({
      data: {
        publicId: publicId(),
        customerId: q.customerId!,
        quotationId: q.id,
        quotationLineId: line.id,
        productId: line.productId,
        planId: line.planId!,
        qty: line.qty,
        unitPrice: line.unitPrice,
        discountBp: line.effectiveDiscountBp,
        taxBp: line.taxBp,
        status: "ACTIVE",
        anchorDate: issue,
        currentPeriodStart: issue,
        currentPeriodEnd: parseISODate(periodEnd(today, line.plan.interval)),
        schedule: {
          create: schedule.map((p) => ({
            periodStart: parseISODate(p.periodStart),
            periodEnd: parseISODate(p.periodEnd),
            billDate: parseISODate(p.billDate),
            net: p.net,
            tax: p.tax,
            total: p.total,
          })),
        },
      },
      include: { schedule: { orderBy: { periodStart: "asc" } } },
    });
    subscriptionsCreated += 1;
    const first = subscription.schedule[0];
    const number = await nextNumber(tx, "invoice", "INV");
    const invoice = await tx.invoice.create({
      data: {
        publicId: publicId(),
        number,
        kind: "RECURRING",
        customerId: q.customerId!,
        quotationId: q.id,
        subscriptionId: subscription.id,
        subtotal: first.net,
        taxTotal: first.tax,
        total: first.total,
        issueDate: issue,
        dueDate: due,
        periodStart: first.periodStart,
        periodEnd: first.periodEnd,
        lines: {
          create: [
            {
              quotationLineId: line.id,
              description: `${line.description} · ${line.plan.name} · ${schedule[0].periodStart} to ${schedule[0].periodEnd}`,
              qty: line.qty,
              unitPrice: line.unitPrice,
              discountBp: line.effectiveDiscountBp,
              net: first.net,
              taxBp: line.taxBp,
              tax: first.tax,
              total: first.total,
              sortOrder: 1,
            },
          ],
        },
      },
    });
    await tx.billingSchedule.update({ where: { id: first.id }, data: { status: "INVOICED", invoiceId: invoice.id } });
    invoicesCreated += 1;
    numbers.push(number);
  }

  if (invoicesCreated > 0) {
    await audit(tx, { entityType: "Quotation", entityId: q.id, quotationId: q.id, action: "INVOICES_CREATED", actor, after: { invoices: numbers, subscriptions: subscriptionsCreated } });
  }
  return { invoicesCreated, subscriptionsCreated };
}

/**
 * Record a payment. Idempotent by clientRef: a retried form submit returns the same
 * result without a second payment row. Status follows paidAmount; when every invoice
 * of the order is paid, the quotation becomes PAID.
 */
export async function recordPayment(input: RecordPaymentInput, user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const actor = actorFromUser(user);
    assertActor(actor, "RECORD_PAYMENT");
    const existing = await tx.payment.findUnique({ where: { clientRef: input.clientRef }, include: { invoice: true } });
    if (existing && existing.invoiceId !== input.invoiceId) throw new ConflictError("This payment reference was already used on another invoice");
    if (existing) {
      return { invoiceId: existing.invoiceId, status: existing.invoice.status, paidAmount: existing.invoice.paidAmount, due: existing.invoice.total - existing.invoice.paidAmount, duplicate: true };
    }
    const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice) throw new NotFoundError("Invoice not found");
    const next = applyPayment(invoice, input.amount);
    await tx.payment.create({
      data: { invoiceId: invoice.id, kind: "PAYMENT", amount: input.amount, method: input.method, clientRef: input.clientRef, reference: input.reference ?? null, note: input.note ?? null, createdById: user.id },
    });
    // Conditional on the paid amount we read: two simultaneous payments cannot overwrite each other.
    const locked = await tx.invoice.updateMany({
      where: { id: invoice.id, paidAmount: invoice.paidAmount, status: invoice.status },
      data: { paidAmount: next.paidAmount, status: next.status, paidAt: next.status === "PAID" ? new Date() : null },
    });
    if (locked.count !== 1) throw new ConflictError("Another payment was recorded on this invoice just now. Refresh and try again.");
    await audit(tx, {
      entityType: "Invoice",
      entityId: invoice.id,
      quotationId: invoice.quotationId,
      action: "RECORD_PAYMENT",
      actor,
      before: { status: invoice.status, paidAmount: invoice.paidAmount },
      after: { status: next.status, paidAmount: next.paidAmount, amount: input.amount, method: input.method },
    });

    if (next.status === "PAID" && invoice.quotationId) {
      const open = await tx.invoice.count({ where: { quotationId: invoice.quotationId, status: { in: ["POSTED", "PARTIAL"] } } });
      // Goods still waiting in a warehouse keep the order in FULFILLMENT; it becomes PAID once the last shipment leaves.
      const waiting =
        (await tx.shipment.count({ where: { plan: { quotationId: invoice.quotationId, status: "ACCEPTED" }, status: "RESERVED" } })) +
        (await tx.fulfillmentPlan.count({ where: { quotationId: invoice.quotationId, status: "PROPOSED" } }));
      const q = await tx.quotation.findUniqueOrThrow({ where: { id: invoice.quotationId } });
      if (open === 0 && waiting === 0 && (q.status === "CONFIRMED" || q.status === "FULFILLMENT")) {
        assertTransition(q.status, "RECORD_PAYMENT");
        await tx.quotation.update({ where: { id: q.id }, data: { status: "PAID" } });
        await audit(tx, { entityType: "Quotation", entityId: q.id, quotationId: q.id, action: "PAID", actor, before: { status: q.status }, after: { status: "PAID" } });
      }
    }
    return { invoiceId: invoice.id, status: next.status, paidAmount: next.paidAmount, due: next.due, duplicate: false };
  });
}
