// What a customer has already extracted across their own closed orders, so the rep sees it
// while answering a counter-offer rather than a week later on a dashboard. Read-only.
import { summariseConcessions, type ConcessionHistory } from "@/domain/concession";
import type { Bp } from "@/lib/contract";
import { prisma } from "@/lib/db";

/** Only committed business counts as evidence, never another draft. */
const CLOSED = ["CONFIRMED", "FULFILLMENT", "PAID"] as const;

/** Realised order-level discount, the same measure the deal-health anomaly check uses. */
const realisedDiscountBp = (q: { grossTotal: number; discountTotal: number }): Bp =>
  q.grossTotal === 0 ? 0 : Math.round((q.discountTotal * 10000) / q.grossTotal);

/**
 * The customer's discount history, excluding the quotation being looked at so a rep is
 * never compared against the deal in front of them. `null` when there is too little
 * history to say anything honest.
 */
export async function customerConcessionHistory(customerId: number, excludeQuotationId?: number): Promise<ConcessionHistory | null> {
  const closed = await prisma.quotation.findMany({
    where: { customerId, status: { in: [...CLOSED] }, ...(excludeQuotationId ? { id: { not: excludeQuotationId } } : {}) },
    select: { grossTotal: true, discountTotal: true },
    orderBy: { confirmedAt: "desc" },
    take: 50,
  });
  return summariseConcessions(closed.map(realisedDiscountBp));
}
