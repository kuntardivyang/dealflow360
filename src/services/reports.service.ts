// Owner: B. Reporting (PDF A7): quotations in a period, filtered by rep, approval status
// and product or category, with the three summary tiles. The XLS export uses the same
// query so the file always matches the screen.
import { addDays, todayISO } from "@/domain/dates";
import type { Prisma } from "@/generated/prisma/client";
import type { QuotationStatus, ReportFilterInput } from "@/lib/contract";
import { prisma } from "@/lib/db";

const APPROVED_LIKE: QuotationStatus[] = ["APPROVED", "SENT", "UNDER_NEGOTIATION", "CONFIRMED", "FULFILLMENT", "PAID"];

export function periodRange(f: ReportFilterInput, now = new Date()): { from: string; to: string } {
  const today = todayISO("Asia/Kolkata", now);
  if (f.period === "today") return { from: today, to: today };
  if (f.period === "week") return { from: addDays(today, -6), to: today };
  if (f.period === "custom" && f.from && f.to) return { from: f.from, to: f.to };
  return { from: addDays(today, -29), to: today };
}

function whereFor(f: ReportFilterInput): Prisma.QuotationWhereInput {
  const { from, to } = periodRange(f);
  const where: Prisma.QuotationWhereInput = {
    createdAt: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${addDays(to, 1)}T00:00:00Z`) },
  };
  if (f.repUserId) where.repUserId = f.repUserId;
  if (f.approval === "pending") where.status = "PENDING_APPROVAL";
  if (f.approval === "approved") where.status = { in: APPROVED_LIKE };
  if (f.approval === "rejected") where.status = "REJECTED";
  if (f.productId) where.lines = { some: { productId: f.productId } };
  else if (f.categoryId) where.lines = { some: { product: { categoryId: f.categoryId } } };
  return where;
}

export async function runReport(f: ReportFilterInput) {
  const where = whereFor(f);
  const [quotes, upsell, reps, products, categories] = await Promise.all([
    prisma.quotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        customer: { select: { name: true } },
        rep: { select: { name: true } },
        approvalRequests: { select: { status: true, createdAt: true, resolvedAt: true } },
        lines: { select: { source: true, product: { select: { name: true } } } },
      },
    }),
    prisma.quotationLine.groupBy({ by: ["productId"], where: { source: "UPSELL", quotation: where }, _count: { _all: true }, orderBy: { _count: { productId: "desc" } }, take: 1 }),
    prisma.user.findMany({ where: { role: "SALES_REP", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productCategory.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  const durations = quotes.flatMap((q) => q.approvalRequests.filter((r) => r.status === "APPROVED" && r.resolvedAt).map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 3_600_000));
  const avgApprovalHours = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const topUpsold = upsell[0] ? await prisma.product.findUnique({ where: { id: upsell[0].productId }, select: { name: true } }) : null;

  const rows = quotes.map((q) => ({
    id: q.id,
    publicId: q.publicId,
    number: q.number,
    customer: q.customer?.name ?? "–",
    rep: q.rep.name,
    status: q.status,
    createdAt: q.createdAt,
    total: q.total,
    netTotal: q.netTotal,
    discountTotal: q.discountTotal,
    marginBp: q.marginBp,
    riskScore: q.riskScore,
    approvals: q.approvalRequests.length,
    upsellLines: q.lines.filter((l) => l.source === "UPSELL").length,
  }));
  const totals = {
    count: rows.length,
    total: rows.reduce((a, r) => a + r.total, 0),
    netTotal: rows.reduce((a, r) => a + r.netTotal, 0),
    discountTotal: rows.reduce((a, r) => a + r.discountTotal, 0),
  };
  return {
    range: periodRange(f),
    rows,
    totals,
    tiles: { quotesCreated: rows.length, avgApprovalHours, topUpsold: topUpsold?.name ?? null, topUpsoldCount: upsell[0]?._count._all ?? 0 },
    options: { reps, products, categories },
  };
}

export type ReportResult = Awaited<ReturnType<typeof runReport>>;
