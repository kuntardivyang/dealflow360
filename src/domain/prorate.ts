// Recurring billing arithmetic (PDF A5, B7). Periods are calendar based and inclusive:
// a monthly subscription anchored on Sep 1 runs Sep 1..Sep 30 (30 days), then Oct 1..Oct 31
// (31 days). Proration uses the real days of the real period, never a constant 30.
import { addDays, addMonths, daysInclusive, diffDays } from "./dates";
import { applyDiscount, divRound, pct } from "./money";
import type { BillingInterval, Bp, ISODate, Money, ProrateInput, ProrateResult, SchedulePeriod } from "@/lib/contract";

/** First day of the period after the one starting at `start`. */
export function nextPeriodStart(start: ISODate, interval: BillingInterval): ISODate {
  switch (interval) {
    case "WEEK":
      return addDays(start, 7);
    case "MONTH":
      return addMonths(start, 1);
    case "QUARTER":
      return addMonths(start, 3);
    case "YEAR":
      return addMonths(start, 12);
  }
}

/** Last day of the period starting at `start`. */
export function periodEnd(start: ISODate, interval: BillingInterval): ISODate {
  return addDays(nextPeriodStart(start, interval), -1);
}

/** Materialise `periods` billing periods from the anchor; each is billed on its first day. */
export function buildSchedule(anchor: ISODate, interval: BillingInterval, periods: number, netPerPeriod: Money, taxBp: Bp): SchedulePeriod[] {
  const out: SchedulePeriod[] = [];
  let start = anchor;
  for (let i = 0; i < periods; i++) {
    const end = periodEnd(start, interval);
    const tax = pct(netPerPeriod, taxBp);
    out.push({ periodStart: start, periodEnd: end, billDate: start, net: netPerPeriod, tax, total: netPerPeriod + tax });
    start = nextPeriodStart(start, interval);
  }
  return out;
}

/**
 * Mid-period quantity change. Credit the old quantity and charge the new one for the
 * remaining days of the current period (the change day counts when billChangeDay is on).
 * Each side is rounded half-up once; net = charge - credit, negative means a credit note.
 * Mode NONE means the change applies from the next period, so nothing is prorated.
 */
export function prorate(i: ProrateInput): ProrateResult {
  const daysInPeriod = daysInclusive(i.periodStart, i.periodEnd);
  const rawRemaining = diffDays(i.changeDate, i.periodEnd) + (i.billChangeDay ? 1 : 0);
  const remainingDays = Math.max(0, Math.min(daysInPeriod, rawRemaining));
  if (i.mode === "NONE" || remainingDays === 0) return { daysInPeriod, remainingDays, credit: 0, charge: 0, net: 0 };
  const perUnit = applyDiscount(i.unitPrice, i.discountBp);
  const credit = divRound(perUnit * i.oldQty * remainingDays, daysInPeriod);
  const charge = divRound(perUnit * i.newQty * remainingDays, daysInPeriod);
  return { daysInPeriod, remainingDays, credit, charge, net: charge - credit };
}
