// Owner: A. Every mutation runs in one transaction: optimistic lock, status guard,
// the change, recompute of totals and risk, and an audit row.
import { Prisma } from "@/generated/prisma/client";
import type { BillingInterval } from "@/generated/prisma/enums";
import { parseISODate } from "@/domain/dates";
import { applyDiscount } from "@/domain/money";
import { computeTotals } from "@/domain/totals";
import {
  NotFoundError,
  ValidationError,
  actorFromUser,
  approverRoleSchema,
  type AddLineInput,
  type ConfirmOutcome,
  type ConfirmQuotationInput,
  type CreateCustomerInput,
  type CreateQuotationInput,
  type ReviseQuotationInput,
  type QuotationRef,
  type QuotationStatus,
  type QuotationTotalsView,
  type RemoveLineInput,
  type RiskWeights,
  type RoutingRule,
  type SessionUser,
  type SetCustomerInput,
  type SetOrderDiscountInput,
  type UpdateLineInput,
} from "@/lib/contract";
import { prisma, type Tx } from "@/lib/db";
import { publicId } from "@/lib/ids";
import { scoreLines } from "@/domain/risk";
import { riskPreview } from "@/domain/route";
import { audit } from "@/lib/audit";
import { EDIT_SUPERSEDES_APPROVAL, assertActor, assertTransition } from "@/lib/state";
import { assertOwnerOrAdmin, lockQuotation, nextNumber } from "./support";

const toRef = (q: { id: number; publicId: string; number: string; status: QuotationStatus; version: number }): QuotationRef => ({
  id: q.id,
  publicId: q.publicId,
  number: q.number,
  status: q.status,
  version: q.version,
});

/** A rep creates a customer with its portal contact (password demo1234 until the contact changes it). */
export async function createCustomer(input: CreateCustomerInput, user: SessionUser): Promise<{ id: number; publicId: string; name: string }> {
  const { hashPassword } = await import("@/lib/auth/internal");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customerContact.findUnique({ where: { email: input.contactEmail } });
    if (existing) throw new ValidationError("A portal contact with this email already exists", { contactEmail: ["Already in use"] });
    const customer = await tx.customer.create({
      data: {
        publicId: publicId(),
        name: input.name,
        city: input.city ?? null,
        email: input.contactEmail,
        tierId: input.tierId,
        contacts: { create: { name: input.contactName, email: input.contactEmail, passwordHash: await hashPassword("demo1234") } },
      },
    });
    await audit(tx, { entityType: "Customer", entityId: customer.id, action: "CREATE", actor: actorFromUser(user), after: { name: input.name, tierId: input.tierId, contact: input.contactEmail } });
    return { id: customer.id, publicId: customer.publicId, name: customer.name };
  });
}

export async function createQuotation(input: CreateQuotationInput, user: SessionUser): Promise<QuotationRef> {
  return prisma.$transaction(async (tx) => {
    assertActor(actorFromUser(user), "EDIT_LINES"); // reps and admins build quotations
    const customer = input.customerId ? await tx.customer.findFirst({ where: { id: input.customerId, archivedAt: null } }) : null;
    if (input.customerId && !customer) throw new NotFoundError("Customer not found");
    const number = await nextNumber(tx, "quotation", "Q");
    const q = await tx.quotation.create({
      data: {
        publicId: publicId(),
        number,
        customerId: customer?.id ?? null,
        repUserId: user.id,
        promisedDate: input.promisedDate ? parseISODate(input.promisedDate) : null,
        notes: input.notes ?? null,
      },
    });
    await audit(tx, {
      entityType: "Quotation",
      entityId: q.id,
      quotationId: q.id,
      action: "CREATE",
      actor: actorFromUser(user),
      after: { number, customer: customer?.name ?? null },
    });
    return toRef(q);
  });
}

/**
 * Pick or change the customer of an editable quotation. Every existing line is re-priced
 * from the new tier (price list rule) and its ceiling re-snapshotted, then totals and risk
 * are recomputed, so the builder always shows the terms the customer would get.
 */
export async function setCustomer(input: SetCustomerInput, user: SessionUser): Promise<QuotationTotalsView & { customer: { id: number; name: string; tier: string; ceilingBp: number } }> {
  return prisma.$transaction(async (tx) => {
    const q = await loadForEdit(tx, input.quotationId, input.version, user);
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, archivedAt: null }, include: { tier: true } });
    if (!customer) throw new NotFoundError("Customer not found");
    await tx.quotation.update({ where: { id: q.id }, data: { customerId: customer.id } });
    const lines = await tx.quotationLine.findMany({ where: { quotationId: q.id }, include: { product: { include: { category: true } } } });
    for (const l of lines) {
      const rule = await bestPricelistRule(tx, customer.tier.id, l.product.categoryId, l.product.id);
      const unitPrice = rule ? applyDiscount(l.product.listPrice, rule.discountBp) : l.product.listPrice;
      const ceilingBp =
        l.product.category.discountCeilingBp === null ? customer.tier.discountCeilingBp : Math.min(customer.tier.discountCeilingBp, l.product.category.discountCeilingBp);
      await tx.quotationLine.update({ where: { id: l.id }, data: { unitPrice, ceilingBp, pricelistRuleId: rule?.id ?? null } });
    }
    await audit(tx, {
      entityType: "Quotation",
      entityId: q.id,
      quotationId: q.id,
      action: "SET_CUSTOMER",
      actor: actorFromUser(user),
      before: { customer: q.customer?.name ?? null },
      after: { customer: customer.name, tier: customer.tier.name },
    });
    const view = await recompute(tx, q.id);
    return { ...view, customer: { id: customer.id, name: customer.name, tier: customer.tier.name, ceilingBp: customer.tier.discountCeilingBp } };
  });
}

export async function addLine(input: AddLineInput, user: SessionUser): Promise<QuotationTotalsView> {
  return prisma.$transaction(async (tx) => {
    const q = await loadForEdit(tx, input.quotationId, input.version, user);
    const product = await tx.product.findFirst({
      where: { id: input.productId, archivedAt: null },
      include: { category: true, plans: { where: { archivedAt: null }, orderBy: { id: "asc" } }, planPrices: true },
    });
    if (!product) throw new NotFoundError("Product not found");
    if (!Number.isInteger(input.qty) || input.qty < 1) throw new ValidationError("Quantity must be a whole number of at least 1", { qty: ["At least 1"] });

    // The Subscription switch on the product decides the line type; the product's
    // Recurring interval picks the plan (product-specific first, then the shared one).
    const isSubscription = product.isSubscription;
    let planId: number | null = null;
    if (isSubscription) {
      const plan = input.planId ? await tx.recurringPlan.findFirst({ where: { id: input.planId, archivedAt: null } }) : await planForProduct(tx, product);
      if (!plan) throw new ValidationError("Pick a recurring plan for this subscription product", { planId: ["Required"] });
      planId = plan.id;
    }

    if (!q.customer) throw new ValidationError("Pick a customer first: prices and discount limits depend on the customer's tier", { customerId: ["Required"] });
    const tier = q.customer.tier;
    const rule = await bestPricelistRule(tx, tier.id, product.categoryId, product.id);
    // Time-based pricing: a recurring line is priced from the product's row for the chosen
    // plan (monthly, six-monthly, yearly...), falling back to the list price when it has none.
    const planPrice = planId === null ? undefined : product.planPrices.find((pp) => pp.planId === planId);
    const basePrice = planPrice?.price ?? product.listPrice;
    const unitPrice = rule ? applyDiscount(basePrice, rule.discountBp) : basePrice;
    const ceilingBp =
      product.category.discountCeilingBp === null ? tier.discountCeilingBp : Math.min(tier.discountCeilingBp, product.category.discountCeilingBp);

    const existing = await tx.quotationLine.findFirst({ where: { quotationId: q.id, productId: product.id, planId } });
    if (existing) {
      const updated = await tx.quotationLine.update({
        where: { id: existing.id },
        data: { qty: existing.qty + input.qty, ...(input.discountBp > 0 ? { discountBp: input.discountBp } : {}) },
      });
      await audit(tx, {
        entityType: "QuotationLine",
        entityId: existing.id,
        quotationId: q.id,
        action: "LINE_UPDATE",
        actor: actorFromUser(user),
        before: { product: product.name, qty: existing.qty, discountBp: existing.discountBp },
        after: { product: product.name, qty: updated.qty, discountBp: updated.discountBp, source: input.source },
      });
    } else {
      const count = await tx.quotationLine.count({ where: { quotationId: q.id } });
      const line = await tx.quotationLine.create({
        data: {
          quotationId: q.id,
          productId: product.id,
          planId,
          lineType: isSubscription ? "RECURRING" : "ONE_TIME",
          source: input.source,
          description: product.name,
          qty: input.qty,
          unitPrice,
          unitCost: product.cost,
          taxBp: product.taxBp,
          discountBp: input.discountBp,
          ceilingBp,
          pricelistRuleId: rule?.id ?? null,
          sortOrder: count + 1,
        },
      });
      await audit(tx, {
        entityType: "QuotationLine",
        entityId: line.id,
        quotationId: q.id,
        action: "LINE_ADD",
        actor: actorFromUser(user),
        after: { product: product.name, qty: input.qty, discountBp: input.discountBp, unitPrice, source: input.source, priceRule: rule?.note ?? null },
      });
    }
    return recompute(tx, q.id);
  });
}

export async function updateLine(input: UpdateLineInput, user: SessionUser): Promise<QuotationTotalsView> {
  return prisma.$transaction(async (tx) => {
    const q = await loadForEdit(tx, input.quotationId, input.version, user);
    const line = await tx.quotationLine.findFirst({ where: { id: input.lineId, quotationId: q.id } });
    if (!line) throw new NotFoundError("Line not found");
    if (input.qty !== undefined && (!Number.isInteger(input.qty) || input.qty < 1)) throw new ValidationError("Quantity must be a whole number of at least 1", { qty: ["At least 1"] });
    const data = {
      ...(input.qty !== undefined ? { qty: input.qty } : {}),
      ...(input.discountBp !== undefined ? { discountBp: input.discountBp } : {}),
    };
    if (Object.keys(data).length === 0) throw new ValidationError("Nothing to change");
    const updated = await tx.quotationLine.update({ where: { id: line.id }, data });
    await audit(tx, {
      entityType: "QuotationLine",
      entityId: line.id,
      quotationId: q.id,
      action: "LINE_UPDATE",
      actor: actorFromUser(user),
      before: { product: line.description, qty: line.qty, discountBp: line.discountBp },
      after: { product: line.description, qty: updated.qty, discountBp: updated.discountBp },
    });
    return recompute(tx, q.id);
  });
}

export async function removeLine(input: RemoveLineInput, user: SessionUser): Promise<QuotationTotalsView> {
  return prisma.$transaction(async (tx) => {
    const q = await loadForEdit(tx, input.quotationId, input.version, user);
    const line = await tx.quotationLine.findFirst({ where: { id: input.lineId, quotationId: q.id } });
    if (!line) throw new NotFoundError("Line not found");
    await tx.quotationLine.delete({ where: { id: line.id } });
    await audit(tx, {
      entityType: "QuotationLine",
      entityId: line.id,
      quotationId: q.id,
      action: "LINE_REMOVE",
      actor: actorFromUser(user),
      before: { product: line.description, qty: line.qty, discountBp: line.discountBp },
    });
    return recompute(tx, q.id);
  });
}

export async function setOrderDiscount(input: SetOrderDiscountInput, user: SessionUser): Promise<QuotationTotalsView> {
  return prisma.$transaction(async (tx) => {
    const q = await loadForEdit(tx, input.quotationId, input.version, user);
    await tx.quotation.update({ where: { id: q.id }, data: { orderDiscountBp: input.orderDiscountBp } });
    await audit(tx, {
      entityType: "Quotation",
      entityId: q.id,
      quotationId: q.id,
      action: "ORDER_DISCOUNT",
      actor: actorFromUser(user),
      before: { orderDiscountBp: q.orderDiscountBp },
      after: { orderDiscountBp: input.orderDiscountBp },
    });
    return recompute(tx, q.id);
  });
}

/**
 * The single confirm. Routing decides the destination: APPROVED when no rule fires,
 * otherwise PENDING_APPROVAL with an ApprovalRequest and one step per approver role.
 * The rep never asks for approval; the system does.
 */
export async function confirmQuotation(input: ConfirmQuotationInput, user: SessionUser): Promise<ConfirmOutcome> {
  return prisma.$transaction(async (tx) => {
    const q = await tx.quotation.findUnique({ where: { id: input.quotationId }, include: { lines: { select: { id: true } } } });
    if (!q) throw new NotFoundError("Quotation not found");
    assertOwnerOrAdmin(q, user);
    assertActor(actorFromUser(user), "CONFIRM");
    assertTransition(q.status, "CONFIRM");
    if (!q.customerId) throw new ValidationError("Pick a customer before confirming", { customerId: ["Required"] });
    if (q.lines.length === 0) throw new ValidationError("Add at least one line before confirming");
    await lockQuotation(tx, q.id, input.version);

    const view = await recompute(tx, q.id);
    const chain = view.risk.chain;
    const actor = actorFromUser(user);

    if (chain.length === 0) {
      const approved = await tx.quotation.update({ where: { id: q.id }, data: { status: "APPROVED" } });
      await audit(tx, {
        entityType: "Quotation",
        entityId: q.id,
        quotationId: q.id,
        action: "CONFIRM",
        actor,
        after: { status: "APPROVED", score: view.risk.score, chain: [] },
      });
      return { ...toRef(approved), chain: [], requestId: null };
    }

    // One request per approval round. A returned quotation re-confirms under a new version.
    let approvalVersion = q.approvalVersion;
    const clash = await tx.approvalRequest.findUnique({ where: { quotationId_version: { quotationId: q.id, version: approvalVersion } } });
    if (clash) approvalVersion += 1;
    const request = await tx.approvalRequest.create({
      data: {
        quotationId: q.id,
        version: approvalVersion,
        riskScore: view.risk.score,
        riskBreakdown: JSON.parse(JSON.stringify(view.risk)) as Prisma.InputJsonValue,
        chain: [...chain],
        steps: { create: chain.map((role, i) => ({ stepNo: i + 1, requiredRole: role })) },
      },
    });
    const pending = await tx.quotation.update({ where: { id: q.id }, data: { status: "PENDING_APPROVAL", approvalVersion } });
    await audit(tx, {
      entityType: "Quotation",
      entityId: q.id,
      quotationId: q.id,
      action: "CONFIRM",
      actor,
      after: { status: "PENDING_APPROVAL", score: view.risk.score, chain, requestId: request.id, approvalVersion },
    });
    return { ...toRef(pending), chain, requestId: request.id };
  });
}

/** A rejected quotation goes back to DRAFT for a new approval round. */
export async function reviseQuotation(input: ReviseQuotationInput, user: SessionUser): Promise<QuotationRef> {
  return prisma.$transaction(async (tx) => {
    const q = await tx.quotation.findUnique({ where: { id: input.quotationId } });
    if (!q) throw new NotFoundError("Quotation not found");
    assertOwnerOrAdmin(q, user);
    assertActor(actorFromUser(user), "REVISE");
    assertTransition(q.status, "REVISE");
    await lockQuotation(tx, q.id, input.version);
    const draft = await tx.quotation.update({ where: { id: q.id }, data: { status: "DRAFT", approvalVersion: { increment: 1 } } });
    await audit(tx, {
      entityType: "Quotation",
      entityId: q.id,
      quotationId: q.id,
      action: "REVISE",
      actor: actorFromUser(user),
      before: { status: q.status, approvalVersion: q.approvalVersion },
      after: { status: "DRAFT", approvalVersion: draft.approvalVersion },
    });
    return toRef(draft);
  });
}

/**
 * Recompute every line, the order totals, the margin and the risk preview from
 * the snapshots on the lines. Called at the end of every mutation.
 */
export async function recompute(tx: Tx, quotationId: number): Promise<QuotationTotalsView> {
  const q = await tx.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  const totals = computeTotals(
    q.lines.map((l) => ({ lineId: l.id, unitPrice: l.unitPrice, qty: l.qty, discountBp: l.discountBp, unitCost: l.unitCost, taxBp: l.taxBp })),
    q.orderDiscountBp,
  );
  for (const lt of totals.lines) {
    await tx.quotationLine.update({
      where: { id: lt.lineId },
      data: { effectiveDiscountBp: lt.effectiveDiscountBp, gross: lt.gross, discountAmount: lt.discountAmount, net: lt.net, tax: lt.tax, total: lt.total },
    });
  }
  const cfg = await loadRiskWeights(tx);
  const rules = await loadRoutingRules(tx);
  const scored = scoreLines(
    q.lines.map((l, i) => ({ lineId: l.id, effectiveDiscountBp: totals.lines[i].effectiveDiscountBp, ceilingBp: l.ceilingBp, gross: totals.lines[i].gross })),
    totals.marginBp,
    cfg,
  );
  const risk = riskPreview(scored, totals.total, rules);
  const updated = await tx.quotation.update({
    where: { id: quotationId },
    data: {
      grossTotal: totals.grossTotal,
      discountTotal: totals.discountTotal,
      netTotal: totals.netTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      costTotal: totals.costTotal,
      marginBp: totals.marginBp,
      riskScore: risk.score,
      riskBreakdown: JSON.parse(JSON.stringify(risk)) as Prisma.InputJsonValue,
    },
  });
  return { totals, risk, version: updated.version };
}

async function loadForEdit(tx: Tx, id: number, version: number, user: SessionUser) {
  const q = await tx.quotation.findUnique({ where: { id }, include: { customer: { include: { tier: true } } } });
  if (!q) throw new NotFoundError("Quotation not found");
  assertOwnerOrAdmin(q, user);
  assertActor(actorFromUser(user), "EDIT_LINES");
  assertTransition(q.status, "EDIT_LINES");
  await lockQuotation(tx, id, version);
  if (!EDIT_SUPERSEDES_APPROVAL.includes(q.status)) return q;
  // Editing an approved or sent quotation invalidates its approval: back to DRAFT, new approval round.
  await tx.approvalRequest.updateMany({ where: { quotationId: id, status: "PENDING" }, data: { status: "SUPERSEDED", resolvedAt: new Date() } });
  const back = await tx.quotation.update({
    where: { id },
    data: { status: "DRAFT", approvalVersion: { increment: 1 }, negotiationPending: false },
  });
  await audit(tx, {
    entityType: "Quotation",
    entityId: id,
    quotationId: id,
    action: "SUPERSEDE_APPROVAL",
    actor: actorFromUser(user),
    before: { status: q.status, approvalVersion: q.approvalVersion },
    after: { status: back.status, approvalVersion: back.approvalVersion },
  });
  return { ...q, status: back.status, approvalVersion: back.approvalVersion };
}

const INTERVAL_LABEL: Record<BillingInterval, string> = { WEEK: "Weekly", MONTH: "Monthly", QUARTER: "Quarterly", YEAR: "Yearly" };
const DEFAULT_PERIODS: Record<BillingInterval, number> = { WEEK: 52, MONTH: 12, QUARTER: 4, YEAR: 1 };

/**
 * The plan behind a product ticked as a subscription: a plan limited to this product on its
 * interval, else the shared plan for that interval, else a shared plan is created for the
 * interval (Weekly / Monthly / Quarterly / Yearly) so ticking the switch is enough.
 */
export async function planForProduct(
  tx: Tx,
  product: { id: number; name: string; recurringInterval: BillingInterval | null; plans: { id: number; interval: BillingInterval }[] },
): Promise<{ id: number } | null> {
  const interval = product.recurringInterval;
  if (!interval) return product.plans[0] ?? null;
  const own = product.plans.find((p) => p.interval === interval) ?? product.plans[0];
  if (own) return own;
  const shared = await tx.recurringPlan.findFirst({ where: { archivedAt: null, productId: null, interval }, orderBy: { id: "asc" } });
  if (shared) return shared;
  return tx.recurringPlan.create({ data: { name: INTERVAL_LABEL[interval], interval, periods: DEFAULT_PERIODS[interval] } });
}

/** Narrowest matching tier rule wins: product, then category, then tier wide. */
async function bestPricelistRule(tx: Tx, tierId: number, categoryId: number, productId: number) {
  const rules = await tx.pricelistRule.findMany({
    where: { tierId, OR: [{ productId }, { productId: null, categoryId }, { productId: null, categoryId: null }] },
  });
  const rank = (r: { productId: number | null; categoryId: number | null }) => (r.productId ? 0 : r.categoryId ? 1 : 2);
  return rules.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

export async function loadRiskWeights(tx: Tx): Promise<RiskWeights> {
  const row = await tx.riskConfig.findUnique({ where: { id: 1 } });
  if (!row) return { wWorst: 50, wBlended: 40, wMargin: 10, normWorstBp: 1000, normBlendedBp: 500, normMarginBp: 1000, floorMarginBp: 2000 };
  const { wWorst, wBlended, wMargin, normWorstBp, normBlendedBp, normMarginBp, floorMarginBp } = row;
  return { wWorst, wBlended, wMargin, normWorstBp, normBlendedBp, normMarginBp, floorMarginBp };
}

export async function loadRoutingRules(tx: Tx): Promise<RoutingRule[]> {
  const rows = await tx.approvalRule.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } });
  return rows.map((r) => ({
    sequence: r.sequence,
    minScore: r.minScore,
    maxWorstOverageBp: r.maxWorstOverageBp,
    maxOrderTotal: r.maxOrderTotal,
    chain: approverRoleSchema.array().catch([]).parse(r.chain),
  }));
}
